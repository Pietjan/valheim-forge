// The game arithmetic against values from valheim-npc's Go port of
// UnityEngine.Random, which was itself verified against the running
// game: the same seeds produce the same rolls and the same next seeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stableHash, slotKey, startSeed, roll, outcome, resourceAmount, breakReturn, statsAt } from '../site/game.js';

test('stable hash and roll sequence match the Go port', () => {
  const cases = [
    ['Thor', 'Hammer', 4, 200814288, 882397065, [[0.804255, 75760334], [0.037611, 45181875], [0.762818, 55417254]]],
    ['Pietjan', 'SwordBronze', 5, 995331036, -1011001939, [[0.966246, 34434030], [0.166043, 56304360], [0.903269, 4449149]]],
    ['Björn Ødegård', 'ArmorDeepNorthMediumChest', 7, -1997224459, 2001670068, [[0.116426, 27389684], [0.082835, 15391550], [0.358306, 89192718]]],
  ];
  for (const [name, item, level, key, seed0, draws] of cases) {
    assert.equal(slotKey(item, level), key);
    let seed = startSeed(name, key);
    assert.equal(seed, seed0);
    for (const [value, next] of draws) {
      const r = roll(seed);
      assert.equal(r.value.toFixed(6), value.toFixed(6));
      assert.equal(r.next, next);
      seed = r.next;
    }
  }
});

test('hash wraps like a C# int', () => {
  assert.equal(stableHash(''), 5381 + Math.imul(5381, 1566083941) | 0);
  assert.equal(typeof stableHash('x'), 'number');
  assert.ok(Number.isInteger(stableHash('SwordBronze')));
});

test('outcome follows the idol, compared in float32', () => {
  const idol = { chance: 0.65, break: 1, return: 0.35 };
  assert.equal(outcome(Math.fround(0.65), idol), 'success');
  assert.equal(outcome(Math.fround(0.6500001), idol), 'destroyed');
  assert.equal(outcome(0.9, idol), 'destroyed');
  const soft = { chance: 0.65, break: 0.1, return: 0.5 };
  assert.equal(outcome(0.7, soft), 'downgrade');
  assert.equal(outcome(0.95, soft), 'destroyed');
});

test('resource amounts follow Piece.Requirement.GetAmount', () => {
  const bronze = { amount: 8, perLevel: 4, upgrader: false };
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((q) => resourceAmount(bronze, q)), [8, 4, 8, 16, 18, 20, 22]);
  const idol = { amount: 1, perLevel: 0, upgrader: true };
  assert.deepEqual([1, 2, 5, 9].map((q) => resourceAmount(idol, q)), [1, 1, 1, 1]);
  const recipe = { resources: [{ item: 'Wood', amount: 2, perLevel: 1, recover: true }, { item: 'Bronze', ...bronze, recover: true }, { item: 'Idol', ...idol, recover: false }] };
  // Breaking on the way to level 5: ceil((cost at 1 + cost at 4) * 0.35).
  assert.deepEqual(breakReturn(recipe, 5, { return: 0.35 }), [{ item: 'Wood', amount: Math.ceil((2 + 4) * 0.35) }, { item: 'Bronze', amount: Math.ceil((8 + 16) * 0.35) }]);
});

test('stats add the per-level step without a cap', () => {
  const sword = { type: 'OneHandedWeapon', damage: { slash: 35 }, damagePerLevel: { slash: 6 }, blockPower: 12, deflection: 20, deflectionPerLevel: 5, parryBonus: 2, knockback: 40, backstab: 3, attackStamina: 8, useDurability: true, durability: 200, durabilityPerLevel: 50, weight: 0.8, movement: -0.05, maxQuality: 4 };
  const at = (q) => Object.fromEntries(statsAt(sword, q).map((s) => [s.key, s.value]));
  assert.equal(at(1)['dmg.slash'], 35);
  assert.equal(at(4)['dmg.slash'], 53);
  assert.equal(at(9)['dmg.slash'], 83);
  assert.equal(at(9).durability, 600);
  assert.equal(at(3).deflect, 30);
  assert.equal(at(3).weight, 0.8);
});
