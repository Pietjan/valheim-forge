package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pietjan/valheim-forge/internal/assets"
)

// The page is drawn with the game's own interface: the wood panels, the
// item slots, the buttons, the braided dividers and the two fonts. They
// come out of the UI atlas and the font bundle, named here as the game
// names them, into site/ui/ beside the icons and under the same rule.

var uiSprites = []string{
	// panels
	"woodpanel_512x512", "woodpanel_400_tileable", "woodpanel_highres", "woodpanel_crafting", "woodpanel_info",
	"panel_bkg_128", "panel_interior_bkg_128", "panel_border_128", "panel_separator", "crafting_panel_bkg",
	"inv_bkg", "chest_bkg", "tabletop", "skill_bkg", "sunken", "bottom_Darken", "top_darken", "gradient",
	// slots and selection
	"item_background", "item_background_sunken", "item_bkg", "item_bkgh", "item_bkgl", "selection_frame",
	// controls
	"button", "button_highlight", "button_pressed", "button_disabled", "button_small", "button_small_highlight",
	"button_tab", "button_tab_selected", "button_tab_hover", "text_field", "text_field_highlight", "checkbox", "checkbox_marker",
	// ornament and icons
	"BraidLineHorisontalMedium", "BraidLineHorisontalMediumFat", "BraidKnotMedium", "BraidLineHorisontalMediumHalfL", "BraidLineHorisontalMediumHalfR",
	"upgrade-arrow", "craft_icon", "craft_icon_32", "repair", "weight_icon", "mapicon_upgradestation", "hammer_icon",
	"warning_icon", "piece_upgrade", "x_no", "check_yes", "exclamation_mark", "bar_gradient", "health_icon_walknut_small",
}

var uiFonts = []string{"Norse", "Norsebold", "AveriaSerifLibre-Regular", "AveriaSerifLibre-Bold", "AveriaSerifLibre-Italic", "AveriaSerifLibre-Light"}

// spriteInfo is what the stylesheet needs to slice a sprite: its size
// and the 9-slice border the game set on it, in pixels.
type spriteInfo struct {
	W      int    `json:"w"`
	H      int    `json:"h"`
	Border [4]int `json:"border"` // left, top, right, bottom
}

// writeUI pulls the sprites and fonts out of the UI bundles.
func writeUI(softRef string, held map[string][]string, dir string) error {
	want := map[string]bool{}
	for b, paths := range held {
		for _, p := range paths {
			if strings.HasSuffix(p, "UIAtlas.spriteatlas") || strings.Contains(p, "/Fonts/Norse/") || strings.Contains(p, "/Fonts/Averia_Serif_Libre/") {
				want[b] = true
			}
		}
	}
	var bundles []string
	for b := range want {
		bundles = append(bundles, filepath.Join(softRef, "Bundles", b))
	}
	if len(bundles) == 0 {
		return fmt.Errorf("no UI atlas or font bundle in the manifest; the game's asset layout has moved")
	}
	env, err := assets.Load(bundles...)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	wantSprite := map[string]bool{}
	for _, n := range uiSprites {
		wantSprite[n] = true
	}
	wantFont := map[string]bool{}
	for _, n := range uiFonts {
		wantFont[n] = true
	}
	wanted := map[assets.Ref][]string{}
	info := map[string]spriteInfo{}
	fonts := 0
	for _, cab := range env.Order {
		f := env.Files[cab]
		for _, id := range f.Order {
			o := f.Objects[id]
			switch o.ClassID {
			case 213:
				t := env.Tree(cab, id)
				name := assets.AsString(t["m_Name"])
				if !wantSprite[name] || info[name].W != 0 {
					continue
				}
				r := assets.AsMap(t["m_Rect"])
				b := assets.AsMap(t["m_Border"])
				info[name] = spriteInfo{
					W: int(assets.AsFloat(r["width"])), H: int(assets.AsFloat(r["height"])),
					Border: [4]int{int(assets.AsFloat(b["x"])), int(assets.AsFloat(b["w"])), int(assets.AsFloat(b["z"])), int(assets.AsFloat(b["y"]))},
				}
				wanted[assets.Ref{Cab: cab, ID: id}] = []string{name}
			case 128:
				t := env.Tree(cab, id)
				name := assets.AsString(t["m_Name"])
				if !wantFont[name] {
					continue
				}
				data := fontBytes(t["m_FontData"])
				if len(data) == 0 {
					continue
				}
				ext := ".ttf"
				if bytes.HasPrefix(data, []byte("OTTO")) {
					ext = ".otf"
				}
				if err := os.WriteFile(filepath.Join(dir, name+ext), data, 0o644); err != nil {
					return err
				}
				fonts++
			}
		}
	}
	written, err := writeSprites(env, wanted, dir)
	if err != nil {
		return err
	}
	for name := range info {
		if !written[name] {
			delete(info, name)
		}
	}
	b, err := json.Marshal(info)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "sprites.json"), b, 0o644); err != nil {
		return err
	}
	fmt.Printf("==> %d UI sprites, %d fonts\n", len(written), fonts)
	return nil
}

// fontBytes is a Font's m_FontData however the tree decoded it.
func fontBytes(v any) []byte {
	switch x := v.(type) {
	case []byte:
		return x
	case []any:
		out := make([]byte, len(x))
		for i, e := range x {
			out[i] = byte(assets.AsInt64(e))
		}
		return out
	}
	return nil
}
