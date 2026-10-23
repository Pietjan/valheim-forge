// A character file (.fch), read the way the game reads it:
// PlayerProfile.LoadPlayerFromDisk around Player.Load, field for field,
// gated on the same version numbers. Nothing is searched for; every
// byte is accounted for on the way to the upgrade seeds at the end.
//
// The file is [int32 n][n bytes of profile][int32 64][SHA-512]. The
// profile holds the stats, the per-world points, the name and id, and
// then the player data as one length-prefixed blob, which is what
// Player.Load reads.

const PLAYER = {
  Stats: 28, MapData: 29, DeathPoint: 30, Stats2: 38, FirstSpawn: 40,
  CallToArms: 42, AbandonedDN: 44, DeepNorth: 46, CheatCleanSlate: 47,
};
const PDATA = {
  Original: 2, SkinHair: 4, SkinHairColor: 5, Uniques: 6, MaxHealth: 7, FirstSpawn: 8,
  Trophies: 9, MaxStamina: 10, PlayerModel: 11, Food: 12, BurnRate: 13, Food2: 14,
  Stations: 15, FoodStamina: 16, Skills: 17, KnownBiomes: 18, RemoveTutorials: 19,
  TimeSinceDeath: 20, ReAddTutorials: 21, KnownTexts: 22, GuardianPower: 23,
  GuardianPowerCooldown: 24, FoodTime: 25, EitrStamina: 26, AshlandMaterials: 27,
  MovedFirstSpawn: 28, BogWitch: 29, AbandonedDN: 31, ChunkedSaves: 32, ChunkedNorth: 33,
  PostLaunch: 34,
};
const ITEM = {
  Quality: 101, Variant: 102, CrafterID: 103, CustomData: 104, WorldLevel: 105,
  PickedUp: 106, AbandonedDN: 107, Smaller: 108, ChunksNCheats: 109, NewCheats: 110,
};

// A .NET BinaryReader over a buffer.
class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
    this.utf8 = new TextDecoder('utf-8');
  }
  need(n) { if (this.p + n > this.b.length) throw new Error(`save ends early at byte ${this.p}`); }
  u8() { this.need(1); return this.b[this.p++]; }
  bool() { return this.u8() !== 0; }
  u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  i32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  i64() { this.need(8); const x = this.v.getBigInt64(this.p, true); this.p += 8; return x; }
  f32() { this.need(4); const x = this.v.getFloat32(this.p, true); this.p += 4; return x; }
  bytes(n) { this.need(n); const x = this.b.subarray(this.p, this.p + n); this.p += n; return x; }
  // BinaryReader.ReadString: a 7-bit encoded length, then UTF-8.
  str() {
    let len = 0, shift = 0, b;
    do { b = this.u8(); len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    return this.utf8.decode(this.bytes(len));
  }
  byteArray() { return this.bytes(this.i32()); }
  vec3() { return [this.f32(), this.f32(), this.f32()]; }
  // ZPackage.ReadNumItems: one byte, or two with the high bit set.
  numItems() { let n = this.u8(); if (n & 0x80) n = ((n & 0x7f) << 8) | this.u8(); return n; }
  skipStrings() { const n = this.i32(); for (let i = 0; i < n; i++) this.str(); }
  skipStringFloats() { const n = this.i32(); for (let i = 0; i < n; i++) { this.str(); this.f32(); } }
}

// parse reads a .fch into {name, playerId, version, playerDataVersion,
// seeds (Map int32 key -> int32 seed), items [{hash, quality, stack,
// equipped, crafterName}], knownRecipes (Set of $names), checksumOk}.
export async function parse(bytes) {
  const outer = new Reader(bytes);
  const n = outer.i32();
  const profile = outer.bytes(n);
  let checksumOk = null;
  try {
    const hashLen = outer.i32();
    const stored = outer.bytes(hashLen);
    if (hashLen === 64 && globalThis.crypto && crypto.subtle) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', profile));
      checksumOk = digest.every((x, i) => x === stored[i]);
    }
  } catch (e) {
    checksumOk = false;
  }
  const out = parseProfile(new Reader(profile));
  out.checksumOk = checksumOk;
  return out;
}

function parseProfile(r) {
  const version = r.i32();
  if (version < PLAYER.Stats) throw new Error(`character version ${version} is older than this reader knows`);
  if (version > PLAYER.CheatCleanSlate) throw new Error(`character version ${version} is newer than this reader knows (game updated?)`);
  if (version >= PLAYER.DeepNorth || version === PLAYER.AbandonedDN) {
    const statCount = r.i32();
    const worlds = r.i32();
    for (let i = 0; i < worlds; i++) {
      for (let j = 0; j < statCount; j++) r.f32();
      r.skipStringFloats(); // known worlds
      r.skipStringFloats(); // known world keys
      r.skipStringFloats(); // known commands
      const enemies = r.i32();
      for (let k = 0; k < enemies; k++) r.skipStringFloats();
      r.skipStringFloats(); // item pickups
      r.skipStringFloats(); // item crafts
      r.skipStringFloats(); // pickables
      r.skipStringFloats(); // food eaten
      r.skipStringFloats(); // pieces placed
    }
  } else if (version >= PLAYER.Stats2) {
    const n = r.i32();
    for (let i = 0; i < n; i++) r.f32();
  } else {
    r.i32(); r.i32(); r.i32(); r.i32();
  }
  if (version >= PLAYER.FirstSpawn) r.bool();
  const worldCount = r.i32();
  for (let i = 0; i < worldCount; i++) {
    r.i64();
    r.bool(); r.vec3();
    r.bool(); r.vec3();
    if (version >= PLAYER.DeathPoint) { r.bool(); r.vec3(); }
    r.vec3();
    if (version >= PLAYER.MapData && r.bool()) r.byteArray();
  }
  const name = r.str();
  const playerId = r.i64();
  r.str(); // start seed
  if (version >= PLAYER.Stats2) {
    r.bool(); // used cheats
    r.i64(); // date created
    if (version < PLAYER.DeepNorth && version !== PLAYER.AbandonedDN) {
      r.skipStringFloats(); r.skipStringFloats(); r.skipStringFloats();
      if (version >= PLAYER.CallToArms) { r.skipStringFloats(); r.skipStringFloats(); r.skipStringFloats(); }
    }
  }
  const out = { version, name, playerId: playerId.toString(), seeds: new Map(), items: [], knownRecipes: new Set(), playerDataVersion: 0, pseudoCounters: 0 };
  if (r.bool()) {
    const data = r.byteArray();
    parsePlayerData(new Reader(data), out);
  }
  return out;
}

function parsePlayerData(r, out) {
  const v = r.i32();
  out.playerDataVersion = v;
  if (v > PDATA.PostLaunch) throw new Error(`player data version ${v} is newer than this reader knows (game updated?)`);
  if (v >= PDATA.MaxHealth) r.f32();
  r.f32(); // health
  if (v >= PDATA.MaxStamina) r.f32();
  if (v >= PDATA.FirstSpawn && v < PDATA.MovedFirstSpawn) r.bool();
  if (v >= PDATA.TimeSinceDeath) r.f32();
  if (v >= PDATA.GuardianPower) r.str();
  if (v >= PDATA.GuardianPowerCooldown) r.f32();
  if (v === PDATA.Original) { r.i64(); r.u32(); }
  parseInventory(r, out);
  const recipes = r.i32();
  for (let i = 0; i < recipes; i++) out.knownRecipes.add(r.str());
  if (v < PDATA.Stations) r.skipStrings();
  else { const n = r.i32(); for (let i = 0; i < n; i++) { r.str(); r.i32(); } }
  r.skipStrings(); // known materials
  if (v < PDATA.RemoveTutorials || v >= PDATA.ReAddTutorials) r.skipStrings();
  if (v >= PDATA.Uniques) r.skipStrings();
  if (v >= PDATA.Trophies) r.skipStrings();
  if (v >= PDATA.ChunkedNorth || v === PDATA.AbandonedDN) r.skipStrings();
  else if (v >= PDATA.KnownBiomes) { const n = r.i32(); for (let i = 0; i < n; i++) r.i32(); }
  if (v >= PDATA.KnownTexts) { const n = r.i32(); for (let i = 0; i < n; i++) { r.str(); r.str(); } }
  if (v >= PDATA.SkinHair) { r.str(); r.str(); }
  if (v >= PDATA.SkinHairColor) { r.vec3(); r.vec3(); }
  if (v >= PDATA.PlayerModel) r.i32();
  if (v >= PDATA.Food) {
    const n = r.i32();
    for (let i = 0; i < n; i++) {
      if (v >= PDATA.Food2) {
        r.str();
        if (v >= PDATA.FoodTime) r.f32();
        else { r.f32(); if (v >= PDATA.FoodStamina) r.f32(); }
      } else {
        r.str();
        for (let k = 0; k < 6; k++) r.f32();
        if (v >= PDATA.BurnRate) r.f32();
      }
    }
  }
  if (v >= PDATA.Skills) {
    const sv = r.i32();
    const n = r.i32();
    for (let i = 0; i < n; i++) { r.i32(); r.f32(); if (sv >= 2) r.f32(); }
  }
  if (v >= PDATA.EitrStamina) {
    const n = r.i32();
    for (let i = 0; i < n; i++) { r.str(); r.str(); }
    r.f32(); r.f32(); r.f32();
  }
  if (v >= PDATA.ChunkedNorth || v === PDATA.AbandonedDN) r.byteArray(); // build menu
  if (v >= PDATA.PostLaunch) {
    let n = r.i32();
    out.pseudoCounters = n;
    for (let i = 0; i < n; i++) { r.i32(); r.i32(); }
    n = r.i32();
    for (let i = 0; i < n; i++) {
      const key = r.i32();
      const seed = r.i32();
      out.seeds.set(key, seed);
    }
  }
  if (r.p !== r.b.length) out.trailing = r.b.length - r.p;
}

// Inventory.Load, then ItemDrop.ItemData.Load per item. Only the item's
// prefab hash and quality matter here, but every field is read so the
// stream stays aligned.
function parseInventory(r, out) {
  const iv = r.i32();
  if (iv >= ITEM.Smaller) {
    const n = r.u16();
    for (let i = 0; i < n; i++) {
      const it = {};
      r.i32(); // durability * 100
      r.u8(); r.u8(); // grid pos
      it.worldLevel = r.u8();
      const f = r.u8();
      it.equipped = (f & 2) !== 0;
      it.quality = (f & 4) ? r.u16() : 1;
      it.stack = (f & 8) ? r.u16() : 1;
      if (f & 0x10) r.i32();
      if (f & 0x20) { r.i64(); it.crafterName = r.str(); }
      it.hash = (f & 0x40) ? r.i32() : 0;
      const custom = (f & 0x80) ? r.numItems() : 0;
      for (let k = 0; k < custom; k++) { r.str(); r.str(); }
      if (iv >= ITEM.ChunksNCheats || iv === ITEM.AbandonedDN) r.u8();
      if (it.hash !== 0) out.items.push(it);
    }
    return;
  }
  // The pre-1.0.20 layout, by name.
  const n = r.i32();
  for (let i = 0; i < n; i++) {
    const it = { name: r.str() };
    it.stack = r.i32();
    r.f32();
    r.i32(); r.i32();
    it.equipped = r.bool();
    it.quality = iv >= ITEM.Quality ? r.i32() : 1;
    if (iv >= ITEM.Variant) r.i32();
    if (iv >= ITEM.CrafterID) { r.i64(); it.crafterName = r.str(); }
    if (iv >= ITEM.CustomData) { const c = r.i32(); for (let k = 0; k < c; k++) { r.str(); r.str(); } }
    it.worldLevel = iv >= ITEM.WorldLevel ? r.i32() : 0;
    if (iv >= ITEM.PickedUp) r.bool();
    if (iv >= ITEM.ChunksNCheats || iv === ITEM.AbandonedDN) r.u8();
    out.items.push(it);
  }
}
