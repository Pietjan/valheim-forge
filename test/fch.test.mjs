// The character reader against a save written the way the game writes
// one (PlayerProfile.SavePlayerToDisk, Player.Save, Inventory.Save and
// ItemData.Save, at the current versions), so every field the reader
// skips is a field the writer put there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../site/fch.js';
import { stableHash, slotKey } from '../site/game.js';

class Writer {
  constructor() { this.parts = []; this.enc = new TextEncoder(); }
  push(n, fn) { const b = new Uint8Array(n); fn(new DataView(b.buffer)); this.parts.push(b); }
  u8(x) { this.push(1, (v) => v.setUint8(0, x)); }
  bool(x) { this.u8(x ? 1 : 0); }
  u16(x) { this.push(2, (v) => v.setUint16(0, x, true)); }
  i32(x) { this.push(4, (v) => v.setInt32(0, x, true)); }
  i64(x) { this.push(8, (v) => v.setBigInt64(0, BigInt(x), true)); }
  f32(x) { this.push(4, (v) => v.setFloat32(0, x, true)); }
  str(s) { const b = this.enc.encode(s); let n = b.length; do { let c = n & 0x7f; n >>= 7; if (n) c |= 0x80; this.u8(c); } while (n); this.parts.push(b); }
  bytes(b) { this.i32(b.length); this.parts.push(b); }
  vec3() { this.f32(0); this.f32(0); this.f32(0); }
  strFloats(n) { this.i32(n); for (let i = 0; i < n; i++) { this.str('k' + i); this.f32(i); } }
  strs(list) { this.i32(list.length); for (const s of list) this.str(s); }
  done() { const n = this.parts.reduce((a, b) => a + b.length, 0); const out = new Uint8Array(n); let p = 0; for (const b of this.parts) { out.set(b, p); p += b.length; } return out; }
}

function item(w, id, quality, stack, equipped) {
  let flags = 0x40; // has prefab
  if (equipped) flags |= 2;
  if (quality !== 1) flags |= 4;
  if (stack !== 1) flags |= 8;
  flags |= 0x20; // crafter
  flags |= 0x80; // custom data
  w.i32(10000);
  w.u8(1); w.u8(2); w.u8(0);
  w.u8(flags);
  if (flags & 4) w.u16(quality);
  if (flags & 8) w.u16(stack);
  w.i64(42); w.str('Thor');
  w.i32(stableHash(id));
  w.u8(1); w.str('k'); w.str('v');
  w.u8(0); // cheat byte, item version 110
}

function playerData(seeds) {
  const w = new Writer();
  w.i32(34); // PostLaunch
  w.f32(25); w.f32(25); w.f32(75); // max health, health, max stamina
  w.f32(100); // time since death
  w.str('GP_Eikthyr'); w.f32(0);
  // inventory
  w.i32(110); w.u16(3);
  item(w, 'SwordBronze', 5, 1, true);
  item(w, 'Wood', 1, 50, false);
  item(w, 'ArmorBronzeChest', 1, 1, false);
  w.strs(['$item_sword_bronze']); // known recipes
  w.i32(1); w.str('$piece_forge'); w.i32(2); // stations
  w.strs(['$item_bronze', '$item_wood']); // materials
  w.strs(['tutorial']); // shown tutorials
  w.strs(['invrows']); // uniques
  w.strs(['TrophyBoar']); // trophies
  w.strs(['Meadows', 'BlackForest']); // biomes
  w.i32(1); w.str('key'); w.str('text'); // known texts
  w.str('Beard1'); w.str('Hair2');
  w.vec3(); w.vec3();
  w.i32(0); // player model
  w.i32(2); w.str('Sausages'); w.f32(10); w.str('Bread'); w.f32(5); // food
  w.i32(2); w.i32(2); w.i32(1); w.f32(30); w.f32(0.5); w.i32(6); w.f32(20); w.f32(0); // skills
  w.i32(1); w.str('cd'); w.str('v'); w.f32(50); w.f32(10); w.f32(0); // custom data, stamina, max eitr, eitr
  w.bytes(new Uint8Array([1, 2, 3, 4, 5])); // build menu blob
  w.i32(1); w.i32(123); w.i32(4); // pseudo counters
  w.i32(seeds.length);
  for (const [k, s] of seeds) { w.i32(k); w.i32(s); }
  return w.done();
}

function profile(seeds) {
  const w = new Writer();
  w.i32(47); // CheatCleanSlate
  w.i32(3); w.i32(2); // stat count, worlds
  for (let i = 0; i < 2; i++) {
    w.f32(1); w.f32(2); w.f32(3);
    w.strFloats(1); w.strFloats(2); w.strFloats(0);
    w.i32(2); w.strFloats(1); w.strFloats(3);
    w.strFloats(1); w.strFloats(1); w.strFloats(0); w.strFloats(2); w.strFloats(1);
  }
  w.bool(false); // first spawn
  w.i32(1); // world data
  w.i64(999); w.bool(true); w.vec3(); w.bool(false); w.vec3(); w.bool(true); w.vec3(); w.vec3();
  w.bool(true); w.bytes(new Uint8Array(16));
  w.str('Thor'); w.i64(42); w.str('seed');
  w.bool(false); w.i64(1700000000);
  w.bool(true); w.bytes(playerData(seeds));
  return w.done();
}

async function fch(seeds) {
  const p = profile(seeds);
  const w = new Writer();
  w.bytes(p);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', p));
  w.bytes(digest);
  return w.done();
}

test('reads name, id, inventory and the seed table from a version 47 save', async () => {
  const k1 = slotKey('SwordBronze', 6);
  const k2 = slotKey('ArmorBronzeChest', 5);
  const p = await parse(await fch([[k1, 123456], [k2, 7]]));
  assert.equal(p.version, 47);
  assert.equal(p.playerDataVersion, 34);
  assert.equal(p.name, 'Thor');
  assert.equal(p.playerId, '42');
  assert.equal(p.checksumOk, true);
  assert.equal(p.trailing, undefined);
  assert.equal(p.pseudoCounters, 1);
  assert.deepEqual([...p.seeds], [[k1, 123456], [k2, 7]]);
  assert.equal(p.items.length, 3);
  assert.equal(p.items[0].hash, stableHash('SwordBronze'));
  assert.equal(p.items[0].quality, 5);
  assert.equal(p.items[0].equipped, true);
  assert.equal(p.items[1].stack, 50);
  assert.ok(p.knownRecipes.has('$item_sword_bronze'));
});

test('a damaged checksum is reported, not fatal', async () => {
  const b = await fch([]);
  b[b.length - 1] ^= 0xff;
  const p = await parse(b);
  assert.equal(p.checksumOk, false);
  assert.equal(p.name, 'Thor');
});
