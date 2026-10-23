// Command valheim-forge serves the site. The page, its data and the icons
// are embedded at build time, so the binary is the whole deployment;
// -dir serves a directory instead, for working on the page.
package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"

	valheimforge "github.com/pietjan/valheim-forge"
)

func main() {
	addr := flag.String("addr", ":2480", "address to listen on")
	dir := flag.String("dir", "", "serve this directory instead of the embedded site")
	flag.Parse()

	var root fs.FS
	if *dir != "" {
		root = os.DirFS(*dir)
	} else {
		sub, err := fs.Sub(valheimforge.Site, "site")
		if err != nil {
			log.Fatal(err)
		}
		root = sub
	}
	if _, err := fs.Stat(root, "data.json"); err != nil {
		log.Fatalf("no data.json in the site: run `make data` first (%v)", err)
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServerFS(root))
	fmt.Printf("valheim-forge on http://localhost%s\n", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
