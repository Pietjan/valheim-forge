package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/pietjan/valheim-forge/internal/assets"
)

// probe writes the decoded tree of every MonoBehaviour on the named
// prefabs and assets, for reading a layout before writing an extractor.
func probe(env *assets.Env, names map[string]bool, out string) error {
	fh, err := os.Create(out)
	if err != nil {
		return err
	}
	defer fh.Close()
	enc := json.NewEncoder(fh)
	enc.SetIndent("", " ")
	for _, cab := range env.Order {
		f := env.Files[cab]
		for _, id := range f.Order {
			o := f.Objects[id]
			if o.ClassID != 114 {
				continue
			}
			t := env.Tree(cab, id)
			if t == nil {
				continue
			}
			name := assets.AsString(t["m_Name"])
			if name == "" {
				name = env.Name(cab, t["m_GameObject"])
			}
			if !names[name] {
				continue
			}
			fields := assets.TopFields(f, o)
			keys := make([]string, 0, len(fields))
			for k := range fields {
				keys = append(keys, k)
			}
			fmt.Fprintf(fh, "=== %s (%s #%d) fields=%v\n", name, cab, id, keys)
			if err := enc.Encode(t); err != nil {
				return err
			}
		}
	}
	return nil
}

// listExternals prints what each loaded file points at outside itself.
func listExternals(env *assets.Env) {
	for _, cab := range env.Order {
		f := env.Files[cab]
		fmt.Printf("%s: %d objects\n", cab, len(f.Order))
		for i, x := range f.Externals {
			fmt.Printf("    ext %d: %s\n", i+1, x.Path)
		}
	}
}

// listAssets prints every sprite, font and texture in the loaded files,
// for choosing what the site borrows from the game's own UI.
func listAssets(env *assets.Env) {
	for _, cab := range env.Order {
		f := env.Files[cab]
		for _, id := range f.Order {
			o := f.Objects[id]
			var kind string
			switch o.ClassID {
			case 213:
				kind = "sprite"
			case 128:
				kind = "font"
			case 28:
				kind = "texture"
			default:
				continue
			}
			t := env.Tree(cab, id)
			if t == nil {
				continue
			}
			extra := ""
			if kind == "texture" {
				extra = fmt.Sprintf(" %dx%d", assets.AsInt64(t["m_Width"]), assets.AsInt64(t["m_Height"]))
			}
			if kind == "font" {
				extra = fmt.Sprintf(" %d bytes", len(assets.AsList(t["m_FontData"])))
			}
			fmt.Printf("%s %s %s%s\n", kind, cab, assets.AsString(t["m_Name"]), extra)
		}
	}
}

// scanLevelled lists, for every item, what hangs off its attacks that
// reads the item's quality: a SpawnAbility whose instance cap is the
// weapon level, an Aoe with damage per level, a status effect with a
// duration or damage per item level.
func scanLevelled(env *assets.Env) {
	for _, cab := range env.Order {
		f := env.Files[cab]
		for _, id := range f.Order {
			o := f.Objects[id]
			if o.ClassID != 114 {
				continue
			}
			if !assets.TopFields(f, o)["m_itemData"] {
				continue
			}
			t := env.Tree(cab, id)
			name := env.Name(cab, t["m_GameObject"])
			shared := assets.AsMap(assets.AsMap(t["m_itemData"])["m_shared"])
			report := func(what string, m map[string]any, keys ...string) {
				var parts []string
				for _, k := range keys {
					if v, ok := m[k]; ok {
						parts = append(parts, fmt.Sprintf("%s=%v", k, v))
					}
				}
				fmt.Printf("%s: %s %s\n", name, what, strings.Join(parts, " "))
			}
			for _, se := range []string{"m_attackStatusEffect", "m_equipStatusEffect", "m_consumeStatusEffect"} {
				st, _ := env.TreeOf(cab, shared[se])
				if st == nil {
					continue
				}
				if assets.AsFloat(st["m_ttlPerItemLevel"]) != 0 || st["m_damagePerLevel"] != nil {
					report(se+" "+assets.AsString(st["m_Name"]), st, "m_ttlPerItemLevel", "m_ttl", "m_absorbDamage", "m_absorbDamagePerSkillLevel", "m_damagePerLevel")
				}
			}
			for _, ak := range []string{"m_attack", "m_secondaryAttack"} {
				a := assets.AsMap(shared[ak])
				for _, pk := range []string{"m_attackProjectile", "m_spawnOnHit", "m_spawnOnTrigger"} {
					ref, ok := env.Deref(cab, a[pk])
					if !ok {
						continue
					}
					// the prefab's components
					pt := env.Tree(ref.Cab, ref.ID)
					for _, c := range assets.AsList(pt["m_Component"]) {
						ct, cref := env.TreeOf(ref.Cab, assets.AsMap(c)["component"])
						if ct == nil {
							continue
						}
						_ = cref
						if ct["m_setMaxInstancesFromWeaponLevel"] != nil {
							report(ak+"."+pk+" SpawnAbility", ct, "m_setMaxInstancesFromWeaponLevel", "m_maxSpawned")
						}
						if dpl := assets.AsMap(ct["m_damagePerLevel"]); dpl != nil && ct["m_useAttackSettings"] != nil {
							nz := map[string]any{}
							for k, v := range dpl {
								if assets.AsFloat(v) != 0 {
									nz[k] = v
								}
							}
							if len(nz) > 0 {
								fmt.Printf("%s: %s.%s Aoe %v\n", name, ak, pk, nz)
							}
						}
						// a projectile's own spawn on hit
						if sref, ok := env.Deref(ref.Cab, ct["m_spawnOnHit"]); ok && ct["m_gravity"] != nil {
							st := env.Tree(sref.Cab, sref.ID)
							for _, c2 := range assets.AsList(st["m_Component"]) {
								ct2, _ := env.TreeOf(sref.Cab, assets.AsMap(c2)["component"])
								if ct2 == nil {
									continue
								}
								if ct2["m_setMaxInstancesFromWeaponLevel"] != nil {
									report(ak+"."+pk+".spawnOnHit SpawnAbility", ct2, "m_setMaxInstancesFromWeaponLevel", "m_maxSpawned")
								}
								if dpl := assets.AsMap(ct2["m_damagePerLevel"]); dpl != nil && ct2["m_useAttackSettings"] != nil {
									nz := map[string]any{}
									for k, v := range dpl {
										if assets.AsFloat(v) != 0 {
											nz[k] = v
										}
									}
									if len(nz) > 0 {
										fmt.Printf("%s: %s.%s.spawnOnHit Aoe %v\n", name, ak, pk, nz)
									}
								}
							}
						}
					}
				}
			}
		}
	}
}
