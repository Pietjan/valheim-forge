package main

import (
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/pietjan/valheim-forge/internal/assets"
	"github.com/pietjan/valheim-forge/unity/texture"
)

// The sprites are packed into atlas pages, so writing one is a decode of
// its page and a crop. This is the extractor valheim-npc's unity-icons
// is, checked there against a Python extractor to the pixel.

// renderData is where one sprite sits in its atlas page.
type renderData struct {
	texture  int64
	x, y     float64 // in texture pixels, y up; fractional in the atlas
	w, h     float64
	settings uint32
}

// writeIcons writes one icon per item and station, named for the prefab.
func writeIcons(env *assets.Env, x *extracted, dir string) (int, error) {
	// sprite -> the names drawn with it; several share one.
	wanted := map[assets.Ref][]string{}
	missing := map[string]bool{}
	for name, ref := range x.icons {
		if x.db.Items[name] == nil && x.db.Stations[name] == nil {
			continue // pruned
		}
		wanted[ref] = append(wanted[ref], name)
		missing[name] = true
	}
	written, err := writeSprites(env, wanted, dir)
	if err != nil {
		return len(written), err
	}
	for name := range written {
		delete(missing, name)
	}
	if len(missing) > 0 {
		names := make([]string, 0, len(missing))
		for n := range missing {
			names = append(names, n)
		}
		sort.Strings(names)
		fmt.Printf("    %d icons did not resolve: %v\n", len(names), names[:min(10, len(names))])
		for _, n := range names {
			if it := x.db.Items[n]; it != nil {
				it.Icon = false
			}
			if st := x.db.Stations[n]; st != nil {
				st.Icon = false
			}
		}
	}
	return len(written), nil
}

// writeSprites writes every sprite something asked for, one PNG per name
// asking, and reports which names it wrote.
func writeSprites(env *assets.Env, wanted map[assets.Ref][]string, dir string) (map[string]bool, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	written := map[string]bool{}
	for _, cab := range env.Order {
		f := env.Files[cab]
		// The atlas: sprite render-data key -> where the sprite is.
		atlas := map[string]renderData{}
		for _, id := range f.Order {
			o := f.Objects[id]
			// The atlas class as this reader numbers it; 687 is its
			// documented id and 687078895 how the type tree carries it.
			if o.ClassID != 687 && o.ClassID != 687078895 {
				continue
			}
			t := env.Tree(cab, id)
			for _, e := range assets.AsList(t["m_RenderDataMap"]) {
				em := assets.AsMap(e)
				atlas[keyOf(assets.AsMap(em["first"]))] = readRenderData(assets.AsMap(em["second"]))
			}
		}
		pages := map[int64]*image.NRGBA{}
		page := func(id int64) (*image.NRGBA, error) {
			if img, ok := pages[id]; ok {
				return img, nil
			}
			t := env.Tree(cab, id)
			if t == nil {
				return nil, fmt.Errorf("no texture %d", id)
			}
			img, err := texture.Decode(t, env.Resolver())
			if err != nil {
				return nil, err
			}
			pages[id] = img
			return img, nil
		}
		for _, id := range f.Order {
			o := f.Objects[id]
			if o.ClassID != 213 {
				continue
			}
			names := wanted[assets.Ref{Cab: cab, ID: id}]
			if len(names) == 0 {
				continue
			}
			t := env.Tree(cab, id)
			if t == nil {
				continue
			}
			rd := readRenderData(assets.AsMap(t["m_RD"]))
			if rd.texture == 0 {
				rd = atlas[keyOf(assets.AsMap(t["m_RenderDataKey"]))]
			}
			if rd.texture == 0 {
				continue
			}
			img, err := page(rd.texture)
			if err != nil {
				return written, fmt.Errorf("sprite %v: %w", names, err)
			}
			crop := cropSprite(img, rd)
			for _, name := range names {
				fh, err := os.Create(filepath.Join(dir, name+".png"))
				if err != nil {
					return written, err
				}
				if err := png.Encode(fh, crop); err != nil {
					fh.Close()
					return written, err
				}
				fh.Close()
				written[name] = true
			}
		}
	}
	return written, nil
}

func readRenderData(rd map[string]any) renderData {
	tex := assets.AsMap(rd["texture"])
	r := assets.AsMap(rd["textureRect"])
	return renderData{
		texture:  assets.AsInt64(tex["m_PathID"]),
		x:        assets.AsFloat(r["x"]),
		y:        assets.AsFloat(r["y"]),
		w:        assets.AsFloat(r["width"]),
		h:        assets.AsFloat(r["height"]),
		settings: assets.AsUint32(rd["settingsRaw"]),
	}
}

// keyOf is a render data key as a string: the GUID's four words and the id.
func keyOf(k map[string]any) string {
	g := assets.AsMap(k["first"])
	return fmt.Sprintf("%v-%v-%v-%v-%v", g["data[0]"], g["data[1]"], g["data[2]"], g["data[3]"], k["second"])
}

// cropSprite cuts the sprite out of its page. The rect is in texture
// coordinates with y up and fractional edges; each edge rounds to the
// nearest pixel, and the page is an image with y down. The packing
// rotation in settingsRaw (bits 2-5) is undone.
func cropSprite(page *image.NRGBA, rd renderData) *image.NRGBA {
	h := page.Rect.Dy()
	x0, x1 := int(math.Round(rd.x)), int(math.Round(rd.x+rd.w))
	y0, y1 := int(math.Round(rd.y)), int(math.Round(rd.y+rd.h))
	r := image.Rect(x0, h-y1, x1, h-y0)
	out := image.NewNRGBA(image.Rect(0, 0, r.Dx(), r.Dy()))
	draw.Draw(out, out.Rect, page, r.Min, draw.Src)
	switch (rd.settings >> 2) & 0xf {
	case 1: // flip horizontal
		out = flipH(out)
	case 2: // flip vertical
		out = flipV(out)
	case 3: // rotate 180
		out = flipH(flipV(out))
	case 4: // rotate 90
		out = rotate90(out)
	}
	return out
}

func flipH(img *image.NRGBA) *image.NRGBA {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	out := image.NewNRGBA(img.Rect)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out.SetNRGBA(w-1-x, y, img.NRGBAAt(x, y))
		}
	}
	return out
}

func flipV(img *image.NRGBA) *image.NRGBA {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	out := image.NewNRGBA(img.Rect)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out.SetNRGBA(x, h-1-y, img.NRGBAAt(x, y))
		}
	}
	return out
}

func rotate90(img *image.NRGBA) *image.NRGBA {
	w, h := img.Rect.Dx(), img.Rect.Dy()
	out := image.NewNRGBA(image.Rect(0, 0, h, w))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out.SetNRGBA(y, w-1-x, img.NRGBAAt(x, y))
		}
	}
	return out
}
