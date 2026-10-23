# valheim-forge

The Forge of Potential, read ahead of time. Drop a character file on the
page and it shows, for any item the forge takes, every upcoming roll for
that character, what each level adds to the item's stats, what each
attempt costs, what happens if you keep going, and how the item compares
with any other at any level. With icons. The save never leaves the
browser.

A rebuild of [papptimus's Forge Oracle](https://github.com/papptimus/Forge-Oracle),
which found and verified the seed mechanics, on top of the game's own
code and asset bundles rather than a hand-kept item list.

## Running it

```bash
make reference   # decompile the game into reference/ (Docker, valheim-npc beside this checkout)
make data        # items, recipes, stations and icons out of the asset bundles into site/
make run         # http://localhost:2480
```

`make data` reads the Steam client on the Windows side of WSL (see the
`valheim_data` variable in the Makefile). It writes `site/data.json`,
which is committed, and `site/icons/`, which is Iron Gate's art and is
not. `make build` embeds the whole site in one binary; the Dockerfile
packages that.

## How it is put together

```
cmd/forge-data      reads the asset bundles: ItemDrop, Recipe and CraftingStation
                    components, the localization table, the icon atlas
cmd/valheim-forge   serves site/, embedded or from disk
internal/assets     the loaded bundles as one environment, so a reference
                    from a recipe into an item prefab resolves
unity/              UnityFS archives, serialised files with type trees, BC7
                    textures: copied from valheim-npc, where they were written
site/game.js        the game's arithmetic: the string hash, UnityEngine.Random,
                    the roll, what a level costs, what the stats are at a level
site/fch.js         the character file, read field for field as Player.Load does
site/app.js         the page
test/               node tests: the RNG against valheim-npc's game-verified Go
                    port, the reader against a save written the way the game
                    writes one
```

## What the game does

Read out of `assembly_valheim` 1.0.20, `InventoryGui.DoCrafting` and
`Player.GetItemUpgradeChance`:

1. The slot is `hash(item prefab name) + target level`, using the game's
   string hash. The seed is the one the character has stored for that
   slot, else `hash(character name) + slot`.
2. `Random.InitState(seed)`; the roll is `Random.value`; the slot's next
   seed is `Random.Range(0, 99999999)`, stored before the roll is judged.
3. If the idol's success chance is at or above the roll, the item goes up
   a level. Else if the idol's break chance is at or above `1 - roll`, the
   item is destroyed and the idol's return share of the recoverable
   materials comes back. Else the item loses a level.
4. Every attempt pays the recipe's per-level amounts for the target level
   plus the idol, succeed or fail.

Every idol in the current data has success 0.65, break 1 and return 0.35.
The page reads those off the idol a recipe names rather than assuming
them.

## Not verified here

The roll math is bit-identical to valheim-npc's Go port, which was traced
out of the running game, and matches Forge Oracle's recorded attempts.
The reader was checked against real version 46 saves to the last byte;
the version 47 layout (the seed table) follows the decompiled code and a
save written by the test, not yet a save the game wrote. The name finder
is the same untested idea as in Forge Oracle.
