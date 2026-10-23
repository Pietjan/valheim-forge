// Package valheimforge holds the site for the server to embed: Go's
// embed cannot reach up a directory, so the file lives at the root.
package valheimforge

import "embed"

// Site is the page, its data and whatever icons were extracted.
//
//go:embed site
var Site embed.FS
