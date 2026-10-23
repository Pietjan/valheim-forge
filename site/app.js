// The page: a character, an item at a level, and what the Forge of
// Potential will do with it. Everything runs in the browser; the save
// never leaves the machine.
import * as G from './game.js';
import { parse as parseFch } from './fch.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  db: null,
  recipeOf: new Map(), // item id -> the recipe the Forge of Potential uses
  idToHash: new Map(),
  hashToId: new Map(),
  character: { name: '', seeds: new Map(), items: [], fromSave: false, file: '' },
  selected: null, // { id, level }
  steps: 10,
  results: 1,
  earlier: new Map(), // target level -> attempts already made (no-save mode)
  compare: null, // { id, level }
  category: 'all',
  query: '',
};

async function main() {
  const res = await fetch('data.json');
  state.db = await res.json();
  index();
  const u = new URL(location.href);
  if (u.searchParams.get('name')) { state.character.name = u.searchParams.get('name'); $('#name').value = state.character.name; }
  if (u.searchParams.get('item') && state.recipeOf.has(u.searchParams.get('item'))) {
    state.selected = { id: u.searchParams.get('item'), level: clampLevel(u.searchParams.get('level') || '1') };
  }
  if (u.searchParams.get('cmp') && state.recipeOf.has(u.searchParams.get('cmp'))) {
    state.compare = { id: u.searchParams.get('cmp'), level: clampLevel(u.searchParams.get('cmplevel') || '1') };
  }
  $('#game-version').textContent = state.db.game ? `game ${state.db.game}, data from ${state.db.extracted}` : `data from ${state.db.extracted}`;
  bind();
  renderAll();
  // ?fch=<same-origin url> loads a save from the server, for working on
  // the page without a file dialog.
  const fchUrl = u.searchParams.get('fch');
  if (fchUrl && new URL(fchUrl, location.href).origin === location.origin) {
    const r = await fetch(fchUrl);
    if (r.ok) loadFile(new File([await r.blob()], fchUrl.split('/').pop()));
  }
}

// index decides which items the forge takes: every recipe that spends
// an idol. An item with several such recipes keeps the first.
function index() {
  for (const r of state.db.recipes) {
    if (!r.resources.some((x) => x.upgrader)) continue;
    if (!state.recipeOf.has(r.item)) state.recipeOf.set(r.item, r);
  }
  for (const id of Object.keys(state.db.items)) {
    const h = G.stableHash(id);
    state.idToHash.set(id, h);
    state.hashToId.set(h, id);
  }
}

function item(id) { return state.db.items[id]; }
function iconUrl(id) { return `icons/${encodeURIComponent(id)}.png`; }
function icon(id, cls = '') {
  const it = item(id) || state.db.stations[id];
  if (it && it.icon) return `<img class="icon ${cls}" src="${iconUrl(id)}" alt="" loading="lazy">`;
  return `<span class="icon ${cls} icon-missing"></span>`;
}
function nameOf(id) { const it = item(id); return it ? it.name : id; }

function category(it) {
  if (G.isWeapon(it) || G.isAmmo(it)) return 'weapons';
  if (G.isArmor(it) || it.type === 'Trinket' || it.type === 'Utility') return 'armor';
  if (G.isShield(it)) return 'shields';
  return 'other';
}

// ---------- events ----------

function bind() {
  const drop = $('#drop');
  const file = $('#file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); });
  $('#name').addEventListener('input', (e) => { state.character.name = e.target.value; if (state.character.fromSave) { state.character.fromSave = false; } renderCharacter(false); renderItem(); });
  $('#forget').addEventListener('click', () => { state.character = { name: '', seeds: new Map(), items: [], fromSave: false, file: '' }; $('#name').value = ''; renderAll(); });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); renderPicker(); });
  $('#category').addEventListener('change', (e) => { state.category = e.target.value; renderPicker(); });
  $('#picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    select(b.dataset.pick, state.selected && state.selected.id === b.dataset.pick ? state.selected.level : 1);
  });
  $('#character').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    select(b.dataset.pick, parseInt(b.dataset.level || '1', 10));
  });
  $('#item').addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'level') { state.selected.level = clampLevel(t.value); renderItem(false); }
    else if (t.id === 'steps') { state.steps = parseInt(t.value, 10); renderItem(false); }
    else if (t.id === 'results') { state.results = parseInt(t.value, 10); renderItem(false); }
    else if (t.dataset.earlier) { state.earlier.set(parseInt(t.dataset.earlier, 10), Math.max(0, parseInt(t.value, 10) || 0)); renderItem(false); }
    else if (t.id === 'cmp-search') { renderCompareList(t.value.trim().toLowerCase()); }
    else if (t.id === 'cmp-level') { if (state.compare) { state.compare.level = clampLevel(t.value); renderCompare(); } }
  });
  $('#item').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmp]');
    if (b) { state.compare = { id: b.dataset.cmp, level: state.compare ? state.compare.level : state.selected.level }; $('#cmp-search').value = ''; renderCompareList(''); renderCompare(); return; }
    if (e.target.id === 'cmp-clear') { state.compare = null; renderCompare(); }
  });
  $('#find').addEventListener('click', runFinder);
}

function clampLevel(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(99, Math.max(1, n)) : 1;
}

function select(id, level) {
  state.selected = { id, level };
  state.earlier = new Map();
  const u = new URL(location.href);
  u.searchParams.set('item', id);
  u.searchParams.set('level', String(level));
  history.replaceState(null, '', u);
  renderPicker();
  renderItem(true);
  $('#item').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadFile(f) {
  const status = $('#file-status');
  status.textContent = `Reading ${f.name}…`;
  status.className = 'status';
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const p = await parseFch(bytes);
    state.character = { name: p.name, seeds: p.seeds, items: p.items, fromSave: true, file: f.name, playerId: p.playerId, version: p.version, checksumOk: p.checksumOk, knownRecipes: p.knownRecipes, trailing: p.trailing };
    $('#name').value = p.name;
    let msg = `${f.name}: ${p.name}, character version ${p.version}, ${p.seeds.size} forge slot${p.seeds.size === 1 ? '' : 's'} stored.`;
    if (p.checksumOk === false) msg += ' The checksum does not match: the file is damaged or was edited.';
    if (p.trailing) msg += ` ${p.trailing} unread bytes at the end: the format may have changed.`;
    status.textContent = msg;
    status.className = 'status' + (p.checksumOk === false || p.trailing ? ' warn' : ' ok');
  } catch (err) {
    status.textContent = `Could not read ${f.name}: ${err.message}`;
    status.className = 'status warn';
    return;
  }
  renderAll();
}

// ---------- rendering ----------

function renderAll() {
  renderCharacter(true);
  renderPicker();
  renderItem(true);
}

function renderCharacter(full) {
  const c = state.character;
  $('#forget').hidden = !c.fromSave;
  $('#drop').hidden = c.fromSave;
  $('#name').readOnly = c.fromSave;
  if (!full) return;
  const inv = $('#inventory');
  if (!c.fromSave) { inv.innerHTML = ''; return; }
  // The forge-able items the character carries, one chip per item and
  // level, and the slots the save already holds seeds for.
  const seen = new Set();
  const chips = [];
  for (const it of c.items) {
    const id = it.hash ? state.hashToId.get(it.hash) : it.name;
    if (!id || !state.recipeOf.has(id)) continue;
    const k = `${id}@${it.quality}`;
    if (seen.has(k)) continue;
    seen.add(k);
    chips.push(`<button class="chip" data-pick="${esc(id)}" data-level="${it.quality}" title="${esc(id)}">${icon(id)}<span>${esc(nameOf(id))}</span><b>${it.quality}</b>${it.equipped ? '<i title="equipped">●</i>' : ''}</button>`);
  }
  const slots = [];
  for (const [key, seed] of c.seeds) {
    const hit = decodeSlot(key);
    if (hit) slots.push(`<button class="chip" data-pick="${esc(hit.id)}" data-level="${Math.max(1, hit.level - 1)}" title="key ${key}, seed ${seed}">${icon(hit.id)}<span>${esc(nameOf(hit.id))}</span><b>→${hit.level}</b></button>`);
    else slots.push(`<span class="chip chip-unknown" title="seed ${seed}">key ${key}<b>?</b></span>`);
  }
  inv.innerHTML = `
    <div class="sub"><h3>Forge-able items in the inventory</h3>${chips.length ? `<div class="chips">${chips.join('')}</div>` : '<p class="muted">None. An item has to be in the inventory, not a chest, to show here.</p>'}</div>
    <div class="sub"><h3>Slots with a stored seed</h3><p class="muted">One per item and target level the character has attempted. Click one to look at the next attempt.</p>${slots.length ? `<div class="chips">${slots.join('')}</div>` : '<p class="muted">None yet: every first attempt will start from the character name.</p>'}</div>`;
}

// decodeSlot finds the item and level a stored key belongs to, by trying
// every forge-able item at levels 1 to 60.
function decodeSlot(key) {
  for (const id of state.recipeOf.keys()) {
    const base = state.idToHash.get(id);
    const level = (key - base) | 0;
    if (level >= 1 && level <= 60) return { id, level };
  }
  return null;
}

function renderPicker() {
  const grid = $('#picker');
  const ids = [...state.recipeOf.keys()]
    .filter((id) => state.category === 'all' || category(item(id)) === state.category)
    .filter((id) => !state.query || nameOf(id).toLowerCase().includes(state.query) || id.toLowerCase().includes(state.query))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  grid.innerHTML = ids.map((id) => {
    const it = item(id);
    const on = state.selected && state.selected.id === id ? ' on' : '';
    return `<button class="tile${on}" data-pick="${esc(id)}" title="${esc(id)}">${icon(id, 'big')}<span class="tile-name">${esc(it.name)}</span><span class="tile-sub">${esc(it.type.replace(/([a-z])([A-Z])/g, '$1 $2'))} · max ${it.maxQuality}</span></button>`;
  }).join('') || '<p class="muted">Nothing matches.</p>';
  $('#picker-count').textContent = `${ids.length} of ${state.recipeOf.size}`;
}

function renderItem(full) {
  const sec = $('#item');
  if (!state.selected) { sec.hidden = true; return; }
  sec.hidden = false;
  const { id, level } = state.selected;
  const it = item(id);
  const recipe = state.recipeOf.get(id);
  const idol = G.idolOf(recipe, state.db.items);
  if (full) {
    const up = idol.upgrader;
    const pSuccess = up.chance;
    const pDestroy = Math.max(0, 1 - Math.max(up.chance, 1 - up.break));
    const pDown = Math.max(0, 1 - pSuccess - pDestroy);
    const odds = [`<b class="ok">${pct(pSuccess)}</b> success`, pDown > 0 ? `<b class="warn">${pct(pDown)}</b> loses a level` : '', pDestroy > 0 ? `<b class="bad">${pct(pDestroy)}</b> destroyed` : ''].filter(Boolean).join(', ');
    $('#item-head').innerHTML = `
      ${icon(id, 'huge')}
      <div>
        <h2>${esc(it.name)} <small>${esc(id)}</small></h2>
        <p class="desc">${esc(it.description || '')}</p>
        <p class="meta">${esc(it.type.replace(/([a-z])([A-Z])/g, '$1 $2'))}${it.skill ? ` · ${esc(it.skill)}` : ''} · normal max quality ${it.maxQuality}${recipe.station ? ` · crafted at ${esc(state.db.stations[recipe.station] ? state.db.stations[recipe.station].name : recipe.station)}` : ''}</p>
        <p class="meta">Forge idol: ${icon(idol === it ? id : recipeIdolId(recipe))} <b>${esc(idol.name)}</b> — ${odds}. On destruction ${pct(up.return)} of the recoverable materials come back.</p>
      </div>`;
    $('#level').value = level;
    $('#steps').value = state.steps;
    $('#results').value = state.results;
  }
  renderOracle(it, recipe, idol);
  renderStats(it);
  renderCompareList('');
  renderCompare();
}

function recipeIdolId(recipe) { return recipe.resources.find((x) => x.upgrader).item; }
function pct(x) { return `${Math.round(x * 1000) / 10}%`; }
function num(x) { return Number.isInteger(x) ? String(x) : (Math.round(x * 10) / 10).toString(); }

// The slot state the predictions start from: the save's seeds, or none.
function slotSeed(id, targetLevel) {
  const key = G.slotKey(id, targetLevel);
  const c = state.character;
  if (c.seeds.has(key)) return { seed: c.seeds.get(key), source: 'save', key };
  if (!c.name) return { seed: null, source: 'none', key };
  return { seed: G.startSeed(c.name, key), source: 'name', key };
}

// renderOracle draws the attempt table: one row per step, assuming the
// steps before it succeeded, and the walk that follows the actual
// outcomes instead.
function renderOracle(it, recipe, idol) {
  const { id, level } = state.selected;
  const c = state.character;
  const noName = !c.name && c.seeds.size === 0;
  const rows = [];
  for (let n = 1; n <= state.steps; n++) {
    const target = level + n;
    const s = slotSeed(id, target);
    const cost = G.attemptCost(recipe, target);
    const costHtml = cost.map((r) => `<span class="res" title="${esc(nameOf(r.item))}">${icon(r.item, 'small')}${r.amount}</span>`).join(' ');
    let cells = '';
    if (s.seed === null) {
      cells = `<td colspan="${state.results}" class="muted">needs the character name</td>`;
    } else {
      let seed = s.seed;
      const skip = s.source === 'name' ? (state.earlier.get(target) || 0) : 0;
      for (let k = 0; k < skip; k++) seed = G.roll(seed).next;
      for (let k = 0; k < state.results; k++) {
        const r = G.roll(seed);
        const o = G.outcome(r.value, idol.upgrader);
        cells += `<td class="o-${o}"><b>${label(o)}</b><small>${r.value.toFixed(4)}</small></td>`;
        seed = r.next;
      }
    }
    const earlier = s.source === 'name' ? `<input type="number" min="0" value="${state.earlier.get(target) || 0}" data-earlier="${target}" title="attempts already made at this level by this character">` : (s.source === 'save' ? '<span class="tag">save</span>' : '');
    rows.push(`<tr><td>${n}</td><td>${target - 1} → <b>${target}</b>${target <= it.maxQuality ? ' <span class="tag" title="a normal station does this level with no roll">safe at station</span>' : ''}</td>${cells}<td>${earlier}</td><td class="cost">${costHtml}</td></tr>`);
  }
  const heads = Array.from({ length: state.results }, (_, i) => `<th>${['1st', '2nd', '3rd'][i]} attempt</th>`).join('');
  $('#oracle').innerHTML = `
    ${noName ? '<p class="status warn">Load a character or type its name: a slot with no stored seed starts from the name.</p>' : ''}
    <table class="oracle"><thead><tr><th>step</th><th>level</th>${heads}<th>slot</th><th>cost per attempt</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="muted">Rows after the first assume every earlier step succeeded. A level has its own slot, so a second copy of the item uses the 2nd attempt on every level the first copy reached. A slot marked <span class="tag">save</span> has its seed in the file. For one that has not, enter how many times this character has already tried that level and the row skips that many results.</p>
    ${renderPath(it, recipe, idol)}`;
}

function label(o) { return { success: 'Success', destroyed: 'Destroyed', downgrade: 'Level lost' }[o]; }

// renderPath walks attempt after attempt the way the game would, with
// every slot advancing as it is used, until the item breaks, the level
// reaches the end of the table, or the walk runs long.
function renderPath(it, recipe, idol) {
  const { id, level } = state.selected;
  const c = state.character;
  if (!c.name && c.seeds.size === 0) return '';
  const seeds = new Map(c.seeds);
  const used = new Map();
  let lv = level;
  const goal = level + state.steps;
  const spent = new Map();
  const add = (m, item, n) => m.set(item, (m.get(item) || 0) + n);
  const lines = [];
  let fate = '';
  let returned = [];
  for (let attempt = 1; attempt <= 200; attempt++) {
    if (lv >= goal) { fate = `reached level ${lv}`; break; }
    const target = lv + 1;
    const key = G.slotKey(id, target);
    let seed;
    if (seeds.has(key)) seed = seeds.get(key);
    else if (c.name) {
      seed = G.startSeed(c.name, key);
      for (let k = 0; k < (state.earlier.get(target) || 0); k++) seed = G.roll(seed).next;
    } else { fate = `level ${target} has no stored seed and no name to start from`; break; }
    const r = G.roll(seed);
    seeds.set(key, r.next);
    used.set(key, (used.get(key) || 0) + 1);
    const o = G.outcome(r.value, idol.upgrader);
    for (const x of G.attemptCost(recipe, target)) add(spent, x.item, x.amount);
    lines.push(`<li class="o-${o}"><span>${attempt}.</span> ${target - 1} → ${target}: <b>${label(o)}</b> <small>${r.value.toFixed(4)}</small></li>`);
    if (o === 'success') lv = target;
    else if (o === 'downgrade') lv = Math.max(0, target - 2);
    else { fate = `destroyed on attempt ${attempt}, going for level ${target}`; returned = G.breakReturn(recipe, target, idol.upgrader); break; }
    if (attempt === 200) fate = 'still going after 200 attempts';
  }
  const spentHtml = [...spent].map(([i, n]) => `<span class="res" title="${esc(nameOf(i))}">${icon(i, 'small')}${n}</span>`).join(' ');
  const retHtml = returned.map((x) => `<span class="res" title="${esc(nameOf(x.item))}">${icon(x.item, 'small')}${x.amount}</span>`).join(' ');
  return `
    <h3>If you keep going</h3>
    <p class="muted">Attempt by attempt from level ${level}, each slot advancing as it is used, stopping at level ${goal} or at destruction. This is the sequence the game will play out for this character.</p>
    <ol class="path">${lines.join('')}</ol>
    <p><b>${esc(fate)}.</b> Spent: ${spentHtml || 'nothing'}.${returned.length ? ` Returned on destruction: ${retHtml}.` : ''}</p>`;
}

// renderStats draws the item's stats across the levels the table covers.
function renderStats(it) {
  const { level } = state.selected;
  const levels = [];
  for (let q = level; q <= level + state.steps; q++) levels.push(q);
  const base = G.statsAt(it, level);
  const cols = levels.map((q) => G.statsAt(it, q));
  const rows = base.map((s, i) => {
    const cells = cols.map((col, j) => {
      const v = col[i].value;
      const d = v - s.value;
      const cls = d === 0 ? '' : (G.higherIsBetter(s.key) === d > 0 ? ' up' : ' down');
      return `<td class="${j === 0 ? 'now' : ''}${cls}">${num(v)}${s.unit}${j > 0 && d !== 0 ? `<small>${d > 0 ? '+' : ''}${num(d)}</small>` : ''}</td>`;
    }).join('');
    return `<tr><th>${esc(s.label)}</th>${cells}</tr>`;
  });
  const extras = [];
  if (it.resist && it.resist.length) extras.push(`Resistances: ${it.resist.map((r) => `${esc(r.mod.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())} to ${esc(G.damageLabel(r.type).toLowerCase())}`).join(', ')}`);
  if (it.setEffect) extras.push(`Set (${it.setSize} parts): ${esc(it.setEffect.name)}${it.setEffect.tooltip ? ` — ${esc(it.setEffect.tooltip.replace(/<[^>]+>/g, ''))}` : ''}`);
  if (it.equipEffect) extras.push(`Equipped: ${esc(it.equipEffect.name)}${it.equipEffect.tooltip ? ` — ${esc(it.equipEffect.tooltip.replace(/<[^>]+>/g, ''))}` : ''}`);
  $('#stats').innerHTML = `
    <table class="stats"><thead><tr><th>level</th>${levels.map((q, j) => `<th class="${j === 0 ? 'now' : ''}${q > it.maxQuality ? ' beyond' : ''}">${q}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="muted">Levels past ${it.maxQuality} are only reachable through the Forge of Potential. The per-level steps are the item's own; the game adds them for every level without a cap.</p>
    ${extras.length ? `<ul class="extras">${extras.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}`;
}

function renderCompareList(q) {
  const box = $('#cmp-list');
  if (!q) { box.innerHTML = ''; return; }
  const ids = [...state.recipeOf.keys()]
    .filter((id) => nameOf(id).toLowerCase().includes(q) || id.toLowerCase().includes(q))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .slice(0, 12);
  box.innerHTML = ids.map((id) => `<button class="chip" data-cmp="${esc(id)}">${icon(id)}<span>${esc(nameOf(id))}</span></button>`).join('') || '<span class="muted">nothing</span>';
}

function renderCompare() {
  const out = $('#cmp-table');
  if (!state.compare) { out.innerHTML = ''; $('#cmp-level').hidden = true; $('#cmp-clear').hidden = true; return; }
  $('#cmp-level').hidden = false;
  $('#cmp-clear').hidden = false;
  $('#cmp-level').value = state.compare.level;
  const a = item(state.selected.id);
  const b = item(state.compare.id);
  const sa = G.statsAt(a, state.selected.level);
  const sb = G.statsAt(b, state.compare.level);
  const keys = [];
  const seen = new Set();
  for (const s of [...sa, ...sb]) if (!seen.has(s.key)) { seen.add(s.key); keys.push(s); }
  const find = (list, k) => list.find((s) => s.key === k);
  const rows = keys.map((s) => {
    const va = find(sa, s.key);
    const vb = find(sb, s.key);
    let diff = '';
    if (va && vb) {
      const d = vb.value - va.value;
      const cls = d === 0 ? '' : (G.higherIsBetter(s.key) === d > 0 ? 'up' : 'down');
      diff = `<td class="${cls}">${d === 0 ? '=' : (d > 0 ? '+' : '') + num(d)}</td>`;
    } else diff = '<td></td>';
    return `<tr><th>${esc(s.label)}</th><td>${va ? num(va.value) + va.unit : '–'}</td><td>${vb ? num(vb.value) + vb.unit : '–'}</td>${diff}</tr>`;
  });
  out.innerHTML = `<table class="stats cmp"><thead><tr><th></th><th>${icon(state.selected.id)} ${esc(a.name)} ${state.selected.level}</th><th>${icon(state.compare.id)} ${esc(b.name)} ${state.compare.level}</th><th>B − A</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// ---------- the name finder ----------

// A fresh character's first roll on every slot comes from its name, so
// a name can be chosen for a long run of first-attempt successes on one
// item. Untested in game, as in Forge Oracle, where the idea comes from.
let finderRun = 0;
function runFinder() {
  if (!state.selected) { $('#find-out').textContent = 'Pick an item first.'; return; }
  const { id, level } = state.selected;
  const idol = G.idolOf(state.recipeOf.get(id), state.db.items).upgrader;
  const maxLen = parseInt($('#find-len').value, 10);
  const base = G.stableHash(id);
  const run = ++finderRun;
  const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LO = 'abcdefghijklmnopqrstuvwxyz';
  const best = [];
  const sizes = [];
  for (let len = 3; len <= maxLen; len++) sizes.push(26 ** len);
  const total = sizes.reduce((a, b) => a + b, 0);
  let len = 3, i = 0, done = 0;
  const out = $('#find-out');
  function streak(name) {
    const hn = G.stableHash(name);
    let n = 0;
    while (n < 30) {
      const key = (base + level + 1 + n) | 0;
      if (G.outcome(G.roll((hn + key) | 0).value, idol) !== 'success') break;
      n++;
    }
    return n;
  }
  function nameAt(len, i) {
    let s = '';
    for (let d = 0; d < len - 1; d++) { s = LO[i % 26] + s; i = Math.floor(i / 26); }
    return UP[i] + s;
  }
  function tick() {
    if (run !== finderRun) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 40) {
      if (len > maxLen) {
        out.innerHTML = `<p>${total.toLocaleString()} names tried for <b>${esc(nameOf(id))}</b> from level ${level}. Longest runs of first-attempt successes:</p><table class="stats"><tr><th>streak</th><th>name</th></tr>${best.map(([k, n]) => `<tr><td>${k}</td><td><a href="?name=${encodeURIComponent(n)}&item=${encodeURIComponent(id)}&level=${level}">${esc(n)}</a></td></tr>`).join('')}</table>`;
        return;
      }
      for (let c = 0; c < 2000 && i < 26 ** len; c++, i++, done++) {
        const n = nameAt(len, i);
        const k = streak(n);
        if (best.length < 10 || k > best[best.length - 1][0]) {
          best.push([k, n]);
          best.sort((x, y) => y[0] - x[0]);
          if (best.length > 10) best.pop();
        }
      }
      if (i >= 26 ** len) { len++; i = 0; }
    }
    out.textContent = `${Math.round((done / total) * 100)}% · best so far ${best.length ? best[0][0] + ' in a row (' + best[0][1] + ')' : '…'}`;
    setTimeout(tick, 0);
  }
  tick();
}

main().catch((e) => { $('#error').textContent = `Failed to load: ${e.message}`; $('#error').hidden = false; });
