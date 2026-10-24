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
  if (state.selected && u.searchParams.get('to')) state.planTo = { id: state.selected.id, to: clampLevel(u.searchParams.get('to')) };
  if (u.searchParams.get('cmp') && state.recipeOf.has(u.searchParams.get('cmp'))) {
    state.compare = { id: u.searchParams.get('cmp'), level: clampLevel(u.searchParams.get('cmplevel') || '1') };
  }
  $('#game-version').textContent = state.db.game ? `game ${state.db.game}, data from ${state.db.extracted}` : `data from ${state.db.extracted}`;
  bind();
  renderAll();
  const on = $('#picker .on');
  if (on) on.scrollIntoView({ block: 'center' });
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
// a requirement slot: the icon with the amount in its corner
function res(id, amount) { return `<span class="res" title="${esc(nameOf(id))}">${icon(id, 'small')}<em>${amount}</em></span>`; }

function category(it) {
  if (G.isWeapon(it) || G.isAmmo(it)) return 'weapons';
  if (G.isArmor(it) || it.type === 'Trinket' || it.type === 'Utility') return 'armor';
  if (G.isShield(it)) return 'shields';
  return 'other';
}

// ---------- events ----------

function bind() {
  const box = $('#charbox');
  const file = $('#file');
  $('#load').addEventListener('click', () => file.click());
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
  box.addEventListener('dragleave', () => box.classList.remove('over'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); file.value = ''; });
  $('#name').addEventListener('input', (e) => { state.character.name = e.target.value; if (state.character.fromSave) { state.character.fromSave = false; } renderCharacter(false); renderItem(); });
  $('#forget').addEventListener('click', () => { state.character = { name: '', seeds: new Map(), items: [], fromSave: false, file: '' }; $('#name').value = ''; $('#file-status').hidden = true; renderAll(); });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value.trim().toLowerCase(); renderPicker(); });
  $('#category').addEventListener('change', (e) => { state.category = e.target.value; renderPicker(); });
  $('#picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    select(b.dataset.pick, state.selected && state.selected.id === b.dataset.pick ? state.selected.level : item(b.dataset.pick).maxQuality);
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
    else if (t.id === 'plan-to') { state.planTo = { id: state.selected.id, to: clampLevel(t.value) }; renderPlan(); }
    else if (t.id === 'cmp-level') { if (state.compare) { state.compare.level = clampLevel(t.value); renderCompare(); } }
  });
  $('#item').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmp]');
    if (b) { state.compare = { id: b.dataset.cmp, level: state.compare ? state.compare.level : state.selected.level }; $('#cmp-search').value = ''; renderCompareList(''); renderCompare(); return; }
    if (e.target.id === 'cmp-clear') { state.compare = null; renderCompare(); }
  });
  $('#find').addEventListener('click', relay);
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
  status.hidden = false;
  status.textContent = `Reading ${f.name}…`;
  status.className = 'status';
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const p = await parseFch(bytes);
    state.character = { name: p.name, seeds: p.seeds, items: p.items, fromSave: true, file: f.name, playerId: p.playerId, version: p.version, checksumOk: p.checksumOk, knownRecipes: p.knownRecipes, trailing: p.trailing };
    $('#name').value = p.name;
    let msg = `${f.name} · version ${p.version} · ${p.seeds.size} slot${p.seeds.size === 1 ? '' : 's'} stored`;
    if (p.checksumOk === false) msg += ' · checksum mismatch: damaged or edited';
    if (p.trailing) msg += ` · ${p.trailing} unread bytes: format changed?`;
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
  $('#load').hidden = c.fromSave;
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
    <div class="sub"><h3>In the inventory</h3>${chips.length ? `<div class="chips">${chips.join('')}</div>` : '<p class="muted">No forge-able items carried.</p>'}</div>
    <div class="sub"><h3>Attempted slots</h3>${slots.length ? `<div class="chips">${slots.join('')}</div>` : '<p class="muted">None yet.</p>'}</div>`;
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
    return `<button class="rowitem${on}" data-pick="${esc(id)}" title="${esc(id)}">${icon(id)}<span class="n">${esc(it.name)}</span><span class="q">${esc(it.type.replace(/([a-z])([A-Z])/g, '$1 $2'))} · max ${it.maxQuality}</span></button>`;
  }).join('') || '<p class="muted">Nothing matches.</p>';
  $('#picker-count').textContent = `${ids.length} of ${state.recipeOf.size}`;
}

function renderItem(full) {
  const sec = $('#item');
  const ph = $('#placeholder');
  if (!state.selected) { sec.hidden = true; if (ph) ph.hidden = false; return; }
  sec.hidden = false;
  if (ph) ph.hidden = true;
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
      <span class="slot">${icon(id, 'huge')}</span>
      <div>
        <h2>${esc(it.name)} <small>${esc(id)}</small></h2>
        <p class="desc">${esc(it.description || '')}</p>
        <p class="meta">${esc(it.type.replace(/([a-z])([A-Z])/g, '$1 $2'))}${it.skill ? ` · ${esc(it.skill)}` : ''} · max quality ${it.maxQuality}${recipe.station ? ` · ${esc(state.db.stations[recipe.station] ? state.db.stations[recipe.station].name : recipe.station)}` : ''}</p>
        <p class="meta">${res(recipeIdolId(recipe), G.attemptCost(recipe, level).reduce((a, r) => a + r.amount, 0) || 1)} <b>${esc(idol.name)}</b> per attempt · ${odds} · ${pct(up.return)} of the crafting materials returned on destruction</p>
      </div>`;
    $('#level').value = level;
    $('#steps').value = state.steps;
    $('#results').value = state.results;
  }
  renderOracle(it, recipe, idol);
  renderPlan();
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
    let cells = '';
    if (s.seed === null) {
      cells = `<td colspan="${state.results}" class="muted">needs a name</td>`;
    } else {
      let seed = s.seed;
      const skip = s.source === 'name' ? (state.earlier.get(target) || 0) : 0;
      for (let k = 0; k < skip; k++) seed = G.roll(seed).next;
      for (let k = 0; k < state.results; k++) {
        const r = G.roll(seed);
        const o = G.outcome(r.value, idol.upgrader);
        cells += `<td class="o-${o}"><b>${label(o)}</b><small>${Math.round(r.value * 100)}%</small></td>`;
        seed = r.next;
      }
    }
    const earlier = s.source === 'name' ? `<input type="number" min="0" value="${state.earlier.get(target) || 0}" data-earlier="${target}" title="attempts already made at this level by this character">` : (s.source === 'save' ? '<span class="tag" title="seed stored in the save">save</span>' : '');
    rows.push(`<tr><td>${n}</td><td>${target - 1} → <b>${target}</b>${target <= it.maxQuality ? ' <span class="tag" title="a normal station reaches this level without a roll">station</span>' : ''}</td>${cells}<td>${earlier}</td></tr>`);
  }
  const heads = Array.from({ length: state.results }, (_, i) => `<th>${['1st', '2nd', '3rd'][i]} attempt</th>`).join('');
  $('#oracle').innerHTML = `
    ${noName ? '<p class="status warn">Load a character or type its name first.</p>' : ''}
    <div class="scroll"><table class="oracle"><thead><tr><th>step</th><th>level</th>${heads}<th title="attempts this character already made at this level; a slot marked save has its seed in the file">tried</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
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
    lines.push(`<li class="o-${o}"><span>${attempt}.</span> ${target - 1} → ${target}: <b>${label(o)}</b> <small>${Math.round(r.value * 100)}%</small></li>`);
    if (o === 'success') lv = target;
    else if (o === 'downgrade') lv = Math.max(0, target - 2);
    else { fate = `destroyed on attempt ${attempt}, going for level ${target}`; returned = G.breakReturn(recipe, target, idol.upgrader); break; }
    if (attempt === 200) fate = 'still going after 200 attempts';
  }
  const spentHtml = [...spent].map(([i, n]) => res(i, n)).join('');
  const retHtml = returned.map((x) => res(x.item, x.amount)).join('');
  return `
    <h3 title="attempt after attempt as the game would play it, every slot advancing as it is used">If you keep going</h3>
    <ol class="path">${lines.join('')}</ol>
    <p class="summary"><b>${esc(fate)}.</b> ${spentHtml ? `Spent ${spentHtml}` : ''}${returned.length ? ` Returned ${retHtml}` : ''}</p>`;
}

// renderStats draws the item's stats across the levels the table covers.
function renderStats(it) {
  const { level } = state.selected;
  const base = G.statsAt(it, level);
  const head = base.map((s) => `<th>${esc(s.label)}</th>`).join('');
  const rows = [];
  for (let q = level; q <= level + state.steps; q++) {
    const stats = G.statsAt(it, q);
    const now = q === level;
    const cells = stats.map((s, i) => {
      const d = s.value - base[i].value;
      const cls = d === 0 ? '' : (G.higherIsBetter(s.key) === d > 0 ? ' up' : ' down');
      return `<td class="${cls}">${num(s.value)}${s.unit}${!now && d !== 0 ? `<small>${d > 0 ? '+' : ''}${num(d)}</small>` : ''}</td>`;
    }).join('');
    rows.push(`<tr class="${now ? 'now' : ''}"><th class="${q > it.maxQuality ? 'beyond' : ''}"${q > it.maxQuality ? ' title="forge only"' : ''}>${q}</th>${cells}</tr>`);
  }
  const extras = [];
  if (it.resist && it.resist.length) extras.push(`Resistances: ${it.resist.map((r) => `${esc(r.mod.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())} to ${esc(G.damageLabel(r.type).toLowerCase())}`).join(', ')}`);
  if (it.setEffect) extras.push(`Set (${it.setSize} parts): ${esc(it.setEffect.name)}${it.setEffect.tooltip ? ` — ${esc(it.setEffect.tooltip.replace(/<[^>]+>/g, ''))}` : ''}`);
  if (it.equipEffect) extras.push(`Equipped: ${esc(it.equipEffect.name)}${it.equipEffect.tooltip ? ` — ${esc(it.equipEffect.tooltip.replace(/<[^>]+>/g, ''))}` : ''}`);
  $('#stats').innerHTML = `
    <div class="scroll"><table class="stats"><thead><tr><th>level</th>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
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
  const lvl = $('#cmp-level');
  if (!state.compare) { out.innerHTML = ''; lvl.hidden = true; lvl.parentElement.hidden = true; $('#cmp-clear').hidden = true; return; }
  lvl.hidden = false;
  lvl.parentElement.hidden = false;
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
  out.innerHTML = `<div class="scroll"><table class="stats cmp"><thead><tr><th></th><th>${icon(state.selected.id)} ${esc(a.name)} ${state.selected.level}</th><th>${icon(state.compare.id)} ${esc(b.name)} ${state.compare.level}</th><th>B − A</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ---------- the relay ----------

// The target level the plan aims for: kept per item, defaulting to
// four past the current level.
function planTarget() {
  const { id, level } = state.selected;
  if (state.planTo && state.planTo.id === id && state.planTo.to > level) return state.planTo.to;
  return level + 4;
}

function renderPlan() {
  $('#plan-to').value = planTarget();
  relay();
}

// A relay of characters: from the current level, whoever's next
// attempts succeed for the most levels in a row takes the item that
// far, then the next one. The character in hand runs on its real
// slots; the rest are fresh names, every capitalised name of the chosen
// length, scanned in the background. No copy is ever lost.
let relayRun = 0;
function relay() {
  const { id, level } = state.selected;
  const to = planTarget();
  const recipe = state.recipeOf.get(id);
  const idol = G.idolOf(recipe, state.db.items).upgrader;
  const idolId = recipeIdolId(recipe);
  const c = state.character;
  const maxLen = parseInt($('#find-len').value, 10);
  const run = ++relayRun;
  const out = $('#plan');
  const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LO = 'abcdefghijklmnopqrstuvwxyz';
  const mine = c.name ? { name: c.name, seeds: c.seeds, skip: state.earlier, mine: true } : null;
  const legs = [];
  let cur = level;
  let best = null;
  let len = 3, i = 0;
  function nameAt(len, i) {
    let s = '';
    for (let d = 0; d < len - 1; d++) { s = LO[i % 26] + s; i = Math.floor(i / 26); }
    return UP[i] + s;
  }
  function startLeg() {
    best = mine ? { ...mine, run: G.runFrom(mine.seeds, mine.name, id, cur + 1, to, idol, mine.skip) } : null;
    if (best && best.run === 0) best = null;
    len = 3; i = 0;
  }
  function finish(note) {
    const idols = legs.reduce((a, l) => a + l.run, 0);
    const rows = legs.map((l) => `<tr><td><a class="chip" href="?name=${encodeURIComponent(l.name)}&item=${encodeURIComponent(id)}&level=${l.from}&to=${to}"><span>${esc(l.name)}</span></a>${l.mine ? ' <span class="tag">in hand</span>' : ''}</td><td>${l.from} → <b>${l.from + l.run}</b></td><td>${res(idolId, l.run)}</td></tr>`).join('');
    out.innerHTML = `
      <p class="summary"><b>${legs.length}</b> character${legs.length === 1 ? '' : 's'}, ${res(idolId, idols)} no copy lost${note ? `, ${esc(note)}` : ''}.</p>
      <div class="scroll"><table class="relay"><thead><tr><th>who</th><th>levels</th><th>idols</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted">A character can only upgrade an item it has crafted once, and the item changes hands between them; the second part follows from the code and has not been tried in game.</p>`;
  }
  function tick() {
    if (run !== relayRun) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 40) {
      if (cur >= to) { finish(); return; }
      if (len > maxLen) {
        if (!best) { finish(`nobody succeeds at level ${cur + 1}`); return; }
        legs.push({ name: best.name, mine: !!best.mine, from: cur, run: best.run });
        cur += best.run;
        if (cur >= to) { finish(); return; }
        startLeg();
        continue;
      }
      for (let k = 0; k < 2000 && i < 26 ** len; k++, i++) {
        const name = nameAt(len, i);
        const n = G.runFrom(null, name, id, cur + 1, to, idol, null);
        if (n > 0 && (!best || n > best.run)) best = { name, run: n };
        if (best && best.run >= to - cur) { len = maxLen + 1; break; }
      }
      if (i >= 26 ** len) { len++; i = 0; }
    }
    out.textContent = `working out level ${cur + 1}…`;
    setTimeout(tick, 0);
  }
  startLeg();
  tick();
}

main().catch((e) => { $('#error').textContent = `Failed to load: ${e.message}`; $('#error').hidden = false; });
