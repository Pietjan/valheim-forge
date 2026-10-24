package main

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/pietjan/valheim-forge/internal/assets"
)

// DB is what the site loads: the game's items, recipes and stations with
// their names already in English.
type DB struct {
	Game      string              `json:"game,omitempty"`
	Extracted string              `json:"extracted"`
	Items     map[string]*Item    `json:"items"`
	Recipes   []*Recipe           `json:"recipes"`
	Stations  map[string]*Station `json:"stations"`
}

// Item is ItemDrop.ItemData.SharedData, the part of it the forge and the
// comparison need. Per-level stats are the base and the step, which is
// how the game stores them: the value at quality q is base + (q-1)*step.
type Item struct {
	Name           string  `json:"name"`
	Description    string  `json:"desc,omitempty"`
	Type           string  `json:"type"`
	Icon           bool    `json:"icon,omitempty"`
	MaxQuality     int     `json:"maxQuality"`
	Weight         float64 `json:"weight"`
	WeightPerLevel float64 `json:"weightPerLevel,omitempty"`
	MaxStack       int     `json:"stack,omitempty"`
	Value          int     `json:"value,omitempty"`
	Teleportable   bool    `json:"teleportable"`
	DLC            string  `json:"dlc,omitempty"`

	Skill               string             `json:"skill,omitempty"`
	Damage              map[string]float64 `json:"damage,omitempty"`
	DamagePerLevel      map[string]float64 `json:"damagePerLevel,omitempty"`
	Knockback           float64            `json:"knockback,omitempty"`
	Backstab            float64            `json:"backstab,omitempty"`
	AttackStamina       float64            `json:"attackStamina,omitempty"`
	AttackEitr          float64            `json:"attackEitr,omitempty"`
	AttackHealth        float64            `json:"attackHealth,omitempty"`
	DrawStamina         float64            `json:"drawStamina,omitempty"`
	SecondaryStamina    float64            `json:"secondaryStamina,omitempty"`
	SecondaryMultiplier float64            `json:"secondaryMultiplier,omitempty"`
	TamedOnly           bool               `json:"tamedOnly,omitempty"`

	Armor              float64 `json:"armor,omitempty"`
	ArmorPerLevel      float64 `json:"armorPerLevel,omitempty"`
	BlockPower         float64 `json:"blockPower,omitempty"`
	BlockPowerPerLevel float64 `json:"blockPowerPerLevel,omitempty"`
	Deflection         float64 `json:"deflection,omitempty"`
	DeflectionPerLevel float64 `json:"deflectionPerLevel,omitempty"`
	ParryBonus         float64 `json:"parryBonus,omitempty"`
	ParryAdrenaline    float64 `json:"parryAdrenaline,omitempty"`

	UseDurability      bool    `json:"useDurability,omitempty"`
	Durability         float64 `json:"durability,omitempty"`
	DurabilityPerLevel float64 `json:"durabilityPerLevel,omitempty"`
	CanRepair          bool    `json:"canRepair,omitempty"`

	Movement    float64  `json:"movement,omitempty"`
	EitrRegen   float64  `json:"eitrRegen,omitempty"`
	Resistances []Resist `json:"resist,omitempty"`
	SetName     string   `json:"setName,omitempty"`
	SetSize     int      `json:"setSize,omitempty"`
	SetEffect   *Effect  `json:"setEffect,omitempty"`
	EquipEffect *Effect  `json:"equipEffect,omitempty"`

	Food        float64 `json:"food,omitempty"`
	FoodStamina float64 `json:"foodStamina,omitempty"`
	FoodEitr    float64 `json:"foodEitr,omitempty"`
	FoodBurn    float64 `json:"foodBurn,omitempty"`
	FoodRegen   float64 `json:"foodRegen,omitempty"`

	// Upgrader is set on the idols: what a Forge of Potential attempt
	// paid with this item rolls against.
	Upgrader *Upgrader `json:"upgrader,omitempty"`

	// What else reads the item's level: a summoning staff's cap on
	// summons (SpawnAbility.m_setMaxInstancesFromWeaponLevel), and an
	// attack status effect whose duration or damage grows per level
	// (SE_Shield, SE_React).
	SummonsPerLevel      bool               `json:"summonsPerLevel,omitempty"`
	EffectName           string             `json:"effectName,omitempty"`
	EffectTTL            float64            `json:"effectTTL,omitempty"`
	EffectTTLPerLevel    float64            `json:"effectTTLPerLevel,omitempty"`
	EffectDamagePerLevel map[string]float64 `json:"effectDamagePerLevel,omitempty"`
}

// Resist is one entry of m_damageModifiers.
type Resist struct {
	Type     string `json:"type"`
	Modifier string `json:"mod"`
}

// Effect is a status effect by name, with its tooltip where it has one.
type Effect struct {
	Name    string `json:"name"`
	Tooltip string `json:"tooltip,omitempty"`
}

// Upgrader is the "Upgrader (Refinement Forge)" block of SharedData.
type Upgrader struct {
	// Chance succeeds when the roll is at or below it.
	Chance float64 `json:"chance"`
	// Break destroys the item when it is at or above 1 - roll; otherwise
	// a failed attempt drops the item one level.
	Break float64 `json:"break"`
	// Return is the share of the ingredients handed back when it breaks.
	Return float64 `json:"return"`
	Steps  int     `json:"steps"`
}

// Recipe is a Recipe asset: what crafting or upgrading an item costs.
type Recipe struct {
	ID              string     `json:"id"`
	Item            string     `json:"item"`
	Amount          int        `json:"amount"`
	Station         string     `json:"station,omitempty"`
	RepairStation   string     `json:"repairStation,omitempty"`
	MinStationLevel int        `json:"minStationLevel"`
	OnlyUpgrade     bool       `json:"onlyUpgrade,omitempty"`
	OneIngredient   bool       `json:"oneIngredient,omitempty"`
	Resources       []Resource `json:"resources"`
}

// Resource is one Piece.Requirement.
type Resource struct {
	Item     string `json:"item"`
	Amount   int    `json:"amount"`
	PerLevel int    `json:"perLevel"`
	Upgrader bool   `json:"upgrader,omitempty"`
	Recover  bool   `json:"recover"`
}

// Station is a CraftingStation component on a piece.
type Station struct {
	Name     string `json:"name"`
	Upgrader bool   `json:"upgrader,omitempty"`
	Icon     bool   `json:"icon,omitempty"`
}

var itemTypes = map[int64]string{
	0: "None", 1: "Material", 2: "Consumable", 3: "OneHandedWeapon", 4: "Bow",
	5: "Shield", 6: "Helmet", 7: "Chest", 9: "Ammo", 10: "Customization",
	11: "Legs", 12: "Hands", 13: "Trophy", 14: "TwoHandedWeapon", 15: "Torch",
	16: "Misc", 17: "Shoulder", 18: "Utility", 19: "Tool", 20: "Attach_Atgeir",
	21: "Fish", 22: "TwoHandedWeaponLeft", 23: "AmmoNonEquipable", 24: "Trinket",
}

var skillTypes = map[int64]string{
	0: "", 1: "Swords", 2: "Knives", 3: "Clubs", 4: "Polearms", 5: "Spears",
	6: "Blocking", 7: "Axes", 8: "Bows", 9: "ElementalMagic", 10: "BloodMagic",
	11: "Unarmed", 12: "Pickaxes", 13: "WoodCutting", 14: "Crossbows",
	100: "Jump", 101: "Sneak", 102: "Run", 103: "Swim", 104: "Fishing",
	105: "Cooking", 106: "Farming", 107: "Crafting", 108: "Dodge", 110: "Ride",
}

var damageTypes = map[int64]string{
	1: "blunt", 2: "slash", 4: "pierce", 8: "chop", 0x10: "pickaxe", 0x20: "fire",
	0x40: "frost", 0x80: "lightning", 0x100: "poison", 0x200: "spirit",
	0x400: "damage", 0x800: "nonPlayer", 0x1F: "physical", 0x3E0: "elemental",
}

var damageModifiers = []string{
	"Normal", "Resistant", "Weak", "Immune", "Ignore", "VeryResistant",
	"VeryWeak", "SlightlyResistant", "SlightlyWeak",
}

// iconRef is where an item's or station's sprite lives, kept for the
// icon pass.
type iconRef struct {
	owner string
	ref   assets.Ref
}

type extracted struct {
	db    *DB
	icons map[string]assets.Ref // prefab name -> sprite
}

// extract walks every loaded file for the components the site needs.
func extract(env *assets.Env, strs map[string]string) *extracted {
	db := &DB{Items: map[string]*Item{}, Stations: map[string]*Station{}}
	x := &extracted{db: db, icons: map[string]assets.Ref{}}
	// Owner GameObject -> prefab name, for resolving a recipe's item and
	// station references, which point at the component, not the object.
	itemOf := map[assets.Ref]string{}
	stationOf := map[assets.Ref]string{}
	type pending struct {
		cab  string
		tree map[string]any
	}
	var recipes []pending
	dup := 0
	for _, cab := range env.Order {
		f := env.Files[cab]
		for _, id := range f.Order {
			o := f.Objects[id]
			if o.ClassID != 114 {
				continue
			}
			fields := assets.TopFields(f, o)
			switch {
			case fields["m_itemData"]:
				t := env.Tree(cab, id)
				if t == nil {
					continue
				}
				name := env.Name(cab, t["m_GameObject"])
				if name == "" {
					continue
				}
				if _, seen := db.Items[name]; seen {
					dup++
					continue
				}
				item, icon := readItem(env, cab, t, strs)
				db.Items[name] = item
				itemOf[assets.Ref{Cab: cab, ID: id}] = name
				if icon.ID != 0 {
					x.icons[name] = icon
					item.Icon = true
				}
			case fields["m_resources"] && fields["m_item"] && fields["m_minStationLevel"]:
				t := env.Tree(cab, id)
				if t != nil {
					recipes = append(recipes, pending{cab, t})
				}
			case fields["m_upgrader"] && fields["m_craftRequireRoof"]:
				t := env.Tree(cab, id)
				if t == nil {
					continue
				}
				name := env.Name(cab, t["m_GameObject"])
				if name == "" {
					continue
				}
				st := &Station{
					Name:     localize(strs, assets.AsString(t["m_name"])),
					Upgrader: assets.AsBool(t["m_upgrader"]),
				}
				db.Stations[name] = st
				stationOf[assets.Ref{Cab: cab, ID: id}] = name
				if r, ok := env.Deref(cab, t["m_icon"]); ok {
					x.icons[name] = r
					st.Icon = true
				}
			}
		}
	}
	if dup > 0 {
		fmt.Fprintf(os.Stderr, "    %d item prefabs share a name with an earlier one and were skipped\n", dup)
	}
	for _, p := range recipes {
		t := p.tree
		if !assets.AsBool(t["m_enabled"]) {
			continue
		}
		itemRef, ok := env.Deref(p.cab, t["m_item"])
		if !ok {
			continue
		}
		itemName := itemOf[itemRef]
		if itemName == "" {
			continue
		}
		r := &Recipe{
			ID:              assets.AsString(t["m_Name"]),
			Item:            itemName,
			Amount:          int(assets.AsInt64(t["m_amount"])),
			MinStationLevel: int(assets.AsInt64(t["m_minStationLevel"])),
			OnlyUpgrade:     assets.AsBool(t["m_noCraftOnlyUpgrade"]),
			OneIngredient:   assets.AsBool(t["m_requireOnlyOneIngredient"]),
		}
		if ref, ok := env.Deref(p.cab, t["m_craftingStation"]); ok {
			r.Station = stationOf[ref]
		}
		if ref, ok := env.Deref(p.cab, t["m_repairStation"]); ok {
			r.RepairStation = stationOf[ref]
		}
		for _, rr := range assets.AsList(t["m_resources"]) {
			m := assets.AsMap(rr)
			ref, ok := env.Deref(p.cab, m["m_resItem"])
			if !ok {
				continue
			}
			res := Resource{
				Item:     itemOf[ref],
				Amount:   int(assets.AsInt64(m["m_amount"])),
				PerLevel: int(assets.AsInt64(m["m_amountPerLevel"])),
				Upgrader: assets.AsBool(m["m_upgraderResource"]),
				Recover:  assets.AsBool(m["m_recover"]),
			}
			if res.Item == "" {
				continue
			}
			r.Resources = append(r.Resources, res)
		}
		db.Recipes = append(db.Recipes, r)
	}
	prune(db)
	sort.Slice(db.Recipes, func(i, j int) bool {
		if db.Recipes[i].Item != db.Recipes[j].Item {
			return db.Recipes[i].Item < db.Recipes[j].Item
		}
		return db.Recipes[i].ID < db.Recipes[j].ID
	})
	return x
}

// readItem reads one ItemDrop's shared data. The second result is its
// first icon, the one the inventory draws at every quality.
func readItem(env *assets.Env, cab string, t map[string]any, strs map[string]string) (*Item, assets.Ref) {
	data := assets.AsMap(t["m_itemData"])
	s := assets.AsMap(data["m_shared"])
	f := func(k string) float64 { return assets.AsFloat(s[k]) }
	i := func(k string) int { return int(assets.AsInt64(s[k])) }
	b := func(k string) bool { return assets.AsBool(s[k]) }
	item := &Item{
		Name:               strings.TrimSpace(localize(strs, assets.AsString(s["m_name"]))),
		Description:        localize(strs, assets.AsString(s["m_description"])),
		Type:               itemTypes[assets.AsInt64(s["m_itemType"])],
		MaxQuality:         i("m_maxQuality"),
		Weight:             f("m_weight"),
		WeightPerLevel:     f("m_scaleWeightByQuality"),
		MaxStack:           i("m_maxStackSize"),
		Value:              i("m_value"),
		Teleportable:       b("m_teleportable"),
		DLC:                assets.AsString(s["m_dlc"]),
		Skill:              skillTypes[assets.AsInt64(s["m_skillType"])],
		Damage:             damages(assets.AsMap(s["m_damages"])),
		DamagePerLevel:     damages(assets.AsMap(s["m_damagesPerLevel"])),
		Knockback:          f("m_attackForce"),
		Backstab:           f("m_backstabBonus"),
		TamedOnly:          b("m_tamedOnly"),
		Armor:              f("m_armor"),
		ArmorPerLevel:      f("m_armorPerLevel"),
		BlockPower:         f("m_blockPower"),
		BlockPowerPerLevel: f("m_blockPowerPerLevel"),
		Deflection:         f("m_deflectionForce"),
		DeflectionPerLevel: f("m_deflectionForcePerLevel"),
		ParryBonus:         f("m_timedBlockBonus"),
		ParryAdrenaline:    f("m_perfectBlockAdrenaline"),
		UseDurability:      b("m_useDurability"),
		Durability:         f("m_maxDurability"),
		DurabilityPerLevel: f("m_durabilityPerLevel"),
		CanRepair:          b("m_canBeReparied"),
		Movement:           f("m_movementModifier"),
		EitrRegen:          f("m_eitrRegenModifier"),
		SetName:            assets.AsString(s["m_setName"]),
		SetSize:            i("m_setSize"),
		Food:               f("m_food"),
		FoodStamina:        f("m_foodStamina"),
		FoodEitr:           f("m_foodEitr"),
		FoodBurn:           f("m_foodBurnTime"),
		FoodRegen:          f("m_foodRegen"),
	}
	if item.Type == "" {
		item.Type = fmt.Sprintf("Type%d", assets.AsInt64(s["m_itemType"]))
	}
	if a := assets.AsMap(s["m_attack"]); a != nil {
		item.AttackStamina = assets.AsFloat(a["m_attackStamina"])
		item.AttackEitr = assets.AsFloat(a["m_attackEitr"])
		item.AttackHealth = assets.AsFloat(a["m_attackHealth"])
		item.DrawStamina = assets.AsFloat(a["m_drawStaminaDrain"])
	}
	if a := assets.AsMap(s["m_secondaryAttack"]); a != nil && assets.AsString(a["m_attackAnimation"]) != "" {
		item.SecondaryStamina = assets.AsFloat(a["m_attackStamina"])
		item.SecondaryMultiplier = assets.AsFloat(a["m_damageMultiplier"])
	}
	for _, m := range assets.AsList(s["m_damageModifiers"]) {
		mm := assets.AsMap(m)
		mod := int(assets.AsInt64(mm["m_modifier"]))
		if mod <= 0 || mod >= len(damageModifiers) || mod == 4 {
			continue
		}
		item.Resistances = append(item.Resistances, Resist{
			Type:     damageTypes[assets.AsInt64(mm["m_type"])],
			Modifier: damageModifiers[mod],
		})
	}
	item.SetEffect = effect(env, cab, s["m_setStatusEffect"], strs)
	item.EquipEffect = effect(env, cab, s["m_equipStatusEffect"], strs)
	levelled(env, cab, s, item, strs)
	// The upgrader block exists on every item; it only means something on
	// the ones a recipe spends as the upgrader resource, so it is kept on
	// all of them and the site reads it off the idol a recipe names.
	item.Upgrader = &Upgrader{
		Chance: f("m_upgradeChance"),
		Break:  f("m_breakChance"),
		Return: f("m_breakReturnIngreientsAmount"),
		Steps:  i("m_successUpgradeSteps"),
	}
	var icon assets.Ref
	if icons := assets.AsList(s["m_icons"]); len(icons) > 0 {
		icon, _ = env.Deref(cab, icons[0])
	}
	return item, icon
}

// damages keeps the non-zero entries of a DamageTypes.
func damages(m map[string]any) map[string]float64 {
	out := map[string]float64{}
	for k, v := range m {
		x := assets.AsFloat(v)
		if x != 0 {
			out[strings.TrimPrefix(k, "m_")] = x
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// effect reads a StatusEffect reference's name and tooltip.
func effect(env *assets.Env, cab string, ref any, strs map[string]string) *Effect {
	t, _ := env.TreeOf(cab, ref)
	if t == nil {
		return nil
	}
	e := &Effect{
		Name:    localize(strs, assets.AsString(t["m_name"])),
		Tooltip: localize(strs, assets.AsString(t["m_tooltip"])),
	}
	if e.Name == "" {
		e.Name = assets.AsString(t["m_Name"])
	}
	return e
}

// prune keeps what a recipe reaches: the items made, the items spent and
// the stations used, and the upgrader station, which no recipe names
// because it takes every recipe. The rest of the item table is creature attacks,
// hair styles and the like, which the forge never sees. The upgrader
// block stays only on the idols, where it decides something.
func prune(db *DB) {
	keepItem := map[string]bool{}
	keepStation := map[string]bool{}
	idol := map[string]bool{}
	for _, r := range db.Recipes {
		keepItem[r.Item] = true
		keepStation[r.Station] = true
		keepStation[r.RepairStation] = true
		for _, res := range r.Resources {
			keepItem[res.Item] = true
			if res.Upgrader {
				idol[res.Item] = true
			}
		}
	}
	for name, it := range db.Items {
		if !keepItem[name] {
			delete(db.Items, name)
			continue
		}
		if !idol[name] {
			it.Upgrader = nil
		}
	}
	for name, st := range db.Stations {
		if !keepStation[name] && !st.Upgrader {
			delete(db.Stations, name)
		}
	}
}

// levelled reads what hangs off an item's attack that scales with its
// quality: the projectile's SpawnAbility, and the attack status effect.
func levelled(env *assets.Env, cab string, shared map[string]any, item *Item, strs map[string]string) {
	for _, ak := range []string{"m_attack", "m_secondaryAttack"} {
		a := assets.AsMap(shared[ak])
		ref, ok := env.Deref(cab, a["m_attackProjectile"])
		if !ok {
			continue
		}
		pt := env.Tree(ref.Cab, ref.ID)
		for _, c := range assets.AsList(pt["m_Component"]) {
			ct, _ := env.TreeOf(ref.Cab, assets.AsMap(c)["component"])
			if ct != nil && assets.AsBool(ct["m_setMaxInstancesFromWeaponLevel"]) {
				item.SummonsPerLevel = true
			}
		}
	}
	st, _ := env.TreeOf(cab, shared["m_attackStatusEffect"])
	if st == nil {
		return
	}
	ttlPer := assets.AsFloat(st["m_ttlPerItemLevel"])
	dmg := damages(assets.AsMap(st["m_damagePerLevel"]))
	if ttlPer == 0 && dmg == nil {
		return
	}
	item.EffectName = localize(strs, assets.AsString(st["m_name"]))
	item.EffectTTL = assets.AsFloat(st["m_ttl"])
	item.EffectTTLPerLevel = ttlPer
	item.EffectDamagePerLevel = dmg
}
