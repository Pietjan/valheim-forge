package main

import (
	"encoding/json"
	"fmt"
	"os"

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
