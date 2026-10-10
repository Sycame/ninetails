// Package docs serves the OpenAPI description of the API and a self-hosted Swagger UI.
// Everything is embedded: no CDN, so it works offline like the rest of Ninetails.
package docs

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed openapi.json
var spec []byte

//go:embed swaggerui
var ui embed.FS

// Register mounts GET /openapi.json, /docs and /docs/ on mux. These routes need no login: the
// spec describes the API, it exposes no data. "Try it out" still sends the token you authorize with.
func Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /openapi.json", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(spec)
	})

	sub, _ := fs.Sub(ui, "swaggerui")
	files := http.StripPrefix("/docs/", http.FileServerFS(sub))
	mux.Handle("GET /docs/", files)
	mux.HandleFunc("GET /docs", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/docs/", http.StatusMovedPermanently)
	})
}
