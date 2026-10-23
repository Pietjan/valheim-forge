// Command forge-data reads Valheim's asset bundles and writes the site's
// data: every item with the stats the game computes per quality level,
// every recipe with what each level costs, the crafting stations, and
// one icon per item.
//
// The mapping is the game's own: ItemDrop.m_itemData.m_shared on the item
// prefab, Recipe assets referencing the prefab, CraftingStation on the
// station piece. Display names come out of the localization table the
// client ships in resources.assets.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pietjan/valheim-forge/internal/assets"
)

func main() {
	softRef := flag.String("softref", "", "the client's valheim_Data/StreamingAssets/SoftRef")
	dataDir := flag.String("data", "", "the client's valheim_Data (for resources.assets)")
	out := flag.String("out", "site", "output directory: data.json and icons/ go here")
	game := flag.String("game", "", "the game version the bundles are from, recorded in data.json")
	noIcons := flag.Bool("no-icons", false, "skip the icons")
	probeNames := flag.String("probe", "", "comma-separated prefab/asset names to dump instead of extracting")
	probeOut := flag.String("probe-out", "probe.txt", "where -probe writes")
	flag.Parse()
	if *softRef == "" {
		flag.Usage()
		os.Exit(2)
	}
	if *dataDir == "" {
		*dataDir = filepath.Dir(filepath.Dir(*softRef))
	}
	if err := run(*softRef, *dataDir, *out, *game, !*noIcons, *probeNames, *probeOut); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(softRef, dataDir, out, game string, icons bool, probeNames, probeOut string) error {
	started := time.Now()
	held, err := assets.Manifest(softRef)
	if err != nil {
		return err
	}
	// The bundles worth loading: items, recipes, stations and icons. One
	// bundle holds nearly all of it, but the manifest decides.
	want := map[string]bool{}
	for b, paths := range held {
		for _, p := range paths {
			switch {
			case strings.HasSuffix(p, ".prefab") && strings.Contains(p, "/Items/"),
				strings.HasSuffix(p, ".asset") && strings.Contains(p, "/Recipes/"),
				strings.HasSuffix(p, ".prefab") && strings.Contains(p, "/Pieces/"),
				strings.Contains(p, "/_icons/"):
				want[b] = true
			}
		}
	}
	var bundles []string
	for b := range want {
		bundles = append(bundles, filepath.Join(softRef, "Bundles", b))
	}
	sort.Strings(bundles)
	fmt.Printf("==> loading %d bundle(s): %v\n", len(bundles), bundles)
	env, err := assets.Load(bundles...)
	if err != nil {
		return err
	}
	fmt.Printf("    %d serialised files in %.0fs\n", len(env.Files), time.Since(started).Seconds())

	if probeNames != "" {
		names := map[string]bool{}
		for _, n := range strings.Split(probeNames, ",") {
			names[n] = true
		}
		listExternals(env)
		return probe(env, names, probeOut)
	}

	strings_, err := localization(filepath.Join(dataDir, "resources.assets"))
	if err != nil {
		return err
	}
	fmt.Printf("==> %d localized strings\n", len(strings_))

	x := extract(env, strings_)
	db := x.db
	fmt.Printf("==> %d items, %d recipes, %d stations\n", len(db.Items), len(db.Recipes), len(db.Stations))

	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	if icons {
		n, err := writeIcons(env, x, filepath.Join(out, "icons"))
		if err != nil {
			return err
		}
		fmt.Printf("==> %d icons\n", n)
	}
	db.Extracted = time.Now().Format("2006-01-02")
	db.Game = game
	if err := writeJSON(filepath.Join(out, "data.json"), db); err != nil {
		return err
	}
	fmt.Printf("==> done in %.0fs\n", time.Since(started).Seconds())
	return nil
}
