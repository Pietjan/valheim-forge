// The game's own arithmetic, ported from assembly_valheim: the string
// hash, UnityEngine.Random, the Forge of Potential roll, what a level
// costs and what an item's stats are at a level. No DOM here, so it runs
// under node for the tests as it does in the page.
//
// Every integer is a C# int: 32 bits, wrapping. `| 0` keeps it so.

// StringExtensionMethods.GetStableHashCode.
export function stableHash(s) {
  let n = 5381 | 0;
  let n2 = 5381 | 0;
  for (let i = 0; i < s.length; i += 2) {
    const c = s.charCodeAt(i);
    if (c === 0) break;
    n = (Math.imul(n, 33) ^ c) | 0;
    if (i === s.length - 1 || s.charCodeAt(i + 1) === 0) break;
    n2 = (Math.imul(n2, 33) ^ s.charCodeAt(i + 1)) | 0;
  }
  return (n + Math.imul(n2, 1566083941)) | 0;
}

// UnityEngine.Random: xorshift128, seeded the way InitState does. Native
// code, so this is the sequence valheim-npc measured out of the running
// game rather than one found in a specification.
export function unityRandom(seed) {
  const M = 1812433253;
  let s0 = seed >>> 0;
  let s1 = (Math.imul(s0, M) + 1) >>> 0;
  let s2 = (Math.imul(s1, M) + 1) >>> 0;
  let s3 = (Math.imul(s2, M) + 1) >>> 0;
  function next() {
    let t = s0;
    t = (t ^ (t << 11)) >>> 0;
    t = (t ^ (t >>> 8)) >>> 0;
    s0 = s1; s1 = s2; s2 = s3;
    s3 = (s3 ^ (s3 >>> 19) ^ t) >>> 0;
    return s3;
  }
  return {
    // Random.value: the low 23 bits over 2^23-1, a float32.
    value() { return Math.fround((next() & 0x7fffff) / 8388607); },
    // Random.Range(int, int): the raw word modulo the span.
    rangeInt(min, max) {
      const span = (max - min) >>> 0;
      if (span === 0) return min;
      return (min + (next() % span)) | 0;
    },
  };
}

// The key of an item's slot at a target level, as
// InventoryGui.DoCrafting builds it: hash(prefab name) + level.
export function slotKey(itemId, level) {
  return (stableHash(itemId) + level) | 0;
}

// Player.GetItemUpgradeChance: one attempt at a slot. The seed is the
// one stored for the key, else hash(character name) + key. The roll is
// Random.value and the slot's next seed is Random.Range(0, 99999999).
export function roll(seed) {
  const r = unityRandom(seed);
  const value = r.value();
  const next = r.rangeInt(0, 99999999);
  return { value, next };
}

export function startSeed(playerName, key) {
  return (stableHash(playerName) + key) | 0;
}

// What one roll means with one idol. InventoryGui.DoCrafting compares in
// float32: success when the idol's chance is at or above the roll, else
// the item breaks when its break chance is at or above 1 - roll, else
// the item loses a level.
export function outcome(value, idol) {
  if (Math.fround(idol.chance) >= value) return 'success';
  if (Math.fround(idol.break) >= Math.fround(1 - value)) return 'destroyed';
  return 'downgrade';
}

// Piece.Requirement.GetAmount for one resource line at a quality level.
export function resourceAmount(res, quality) {
  if (quality <= 1) return res.amount;
  const num = quality >= 4 ? 4 + (quality - 4) / 2 : quality - 1;
  return Math.floor(num * res.perLevel + (res.upgrader ? res.amount : 0));
}

// What an attempt at a target level costs: every resource line with a
// non-zero amount, the idol among them.
export function attemptCost(recipe, level) {
  return recipe.resources
    .map((r) => ({ item: r.item, amount: resourceAmount(r, level), upgrader: !!r.upgrader, recover: r.recover }))
    .filter((r) => r.amount > 0);
}

// What comes back when the item breaks at a target level: for each
// recoverable line, the share the idol returns of what the item cost to
// craft plus what the last upgrade cost, rounded up.
export function breakReturn(recipe, level, idol) {
  if (!(idol.return > 0)) return [];
  return recipe.resources
    .filter((r) => r.recover)
    .map((r) => ({ item: r.item, amount: Math.ceil((resourceAmount(r, 1) + resourceAmount(r, level - 1)) * idol.return) }))
    .filter((r) => r.amount > 0);
}

// The idol a recipe spends, or null when the recipe is not one the Forge
// of Potential takes.
export function idolOf(recipe, items) {
  const r = recipe.resources.find((x) => x.upgrader);
  return r ? items[r.item] || null : null;
}

const WEAPON_TYPES = new Set(['OneHandedWeapon', 'TwoHandedWeapon', 'TwoHandedWeaponLeft', 'Bow', 'Torch']);
const ARMOR_TYPES = new Set(['Helmet', 'Chest', 'Legs', 'Shoulder']);
const AMMO_TYPES = new Set(['Ammo', 'AmmoNonEquipable']);

export function isWeapon(it) { return WEAPON_TYPES.has(it.type); }
export function isArmor(it) { return ARMOR_TYPES.has(it.type); }
export function isShield(it) { return it.type === 'Shield'; }
export function isAmmo(it) { return AMMO_TYPES.has(it.type); }

export const DAMAGE_ORDER = ['damage', 'blunt', 'slash', 'pierce', 'chop', 'pickaxe', 'fire', 'frost', 'lightning', 'poison', 'spirit'];

// The stats the game's tooltip shows for an item at a quality level,
// as an ordered list of {key, label, value, unit}. Each is the formula
// ItemDrop.ItemData uses: base + (quality - 1) * per level.
export function statsAt(it, quality) {
  const lv = Math.max(0, quality - 1);
  const out = [];
  const push = (key, label, value, unit) => out.push({ key, label, value, unit: unit || '' });
  if (isWeapon(it) || isAmmo(it) || it.type === 'Tool' || it.damage) {
    const types = DAMAGE_ORDER.filter((t) => (it.damage && it.damage[t]) || (it.damagePerLevel && it.damagePerLevel[t]));
    let total = 0;
    for (const t of types) {
      const v = ((it.damage && it.damage[t]) || 0) + ((it.damagePerLevel && it.damagePerLevel[t]) || 0) * lv;
      total += v;
      push('dmg.' + t, damageLabel(t), v);
    }
    if (types.length > 0) push('dmg.total', 'Total damage', total);
  }
  if (isArmor(it) || (it.armor && !isWeapon(it) && !isShield(it) && it.type !== 'Tool' && !isAmmo(it) && it.type !== 'Trinket' && it.type !== 'Utility')) {
    push('armor', 'Armor', it.armor + lv * (it.armorPerLevel || 0));
  }
  if ((isShield(it) || isWeapon(it)) && it.blockPower > 1) {
    push('block', 'Block armor', it.blockPower + lv * (it.blockPowerPerLevel || 0));
    const d = (it.deflection || 0) + lv * (it.deflectionPerLevel || 0);
    if (d > 1) push('deflect', 'Block force', d);
    if (it.parryBonus > 1) push('parry', 'Parry bonus', it.parryBonus, 'x');
  }
  if (isWeapon(it) || isAmmo(it)) {
    if (it.knockback > 0) push('knockback', 'Knockback', it.knockback);
    if (it.backstab > 1) push('backstab', 'Backstab', it.backstab, 'x');
    if (it.attackStamina > 0) push('stamina', 'Stamina use', it.attackStamina);
    if (it.attackEitr > 0) push('eitr', 'Eitr use', it.attackEitr);
    if (it.attackHealth > 0) push('health', 'Health use', it.attackHealth);
    if (it.drawStamina > 0) push('draw', 'Stamina hold', it.drawStamina, '/s');
  }
  if (it.useDurability) push('durability', 'Durability', it.durability + lv * (it.durabilityPerLevel || 0));
  push('weight', 'Weight', it.weight * (1 + lv * (it.weightPerLevel || 0)));
  if (it.movement) push('movement', 'Movement speed', it.movement * 100, '%');
  if (it.eitrRegen) push('eitrRegen', 'Eitr regeneration', it.eitrRegen * 100, '%');
  return out;
}

export function damageLabel(t) {
  return { damage: 'Damage', blunt: 'Blunt', slash: 'Slash', pierce: 'Pierce', chop: 'Chop', pickaxe: 'Pickaxe', fire: 'Fire', frost: 'Frost', lightning: 'Lightning', poison: 'Poison', spirit: 'Spirit' }[t] || t;
}

// Which stats improve when the number goes up. Weight and stamina use
// are the other way round.
export function higherIsBetter(key) {
  return !(key === 'weight' || key === 'stamina' || key === 'eitr' || key === 'health' || key === 'draw');
}
