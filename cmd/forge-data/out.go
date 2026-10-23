package main

import (
	"encoding/json"
	"os"
)

func writeJSON(path string, db *DB) error {
	b, err := json.Marshal(db)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}
