package main

import (
	"log"
	"net/http"
	"os"
	"time"
)

func main() {
	db, err := NewStore("data/phantom.db")
	if err != nil {
		log.Fatal("failed to open database:", err)
	}
	defer db.Close()

	// Background reaper: clean expired pastes every 60 seconds
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			n, err := db.ReapExpired()
			if err != nil {
				log.Println("reaper error:", err)
			} else if n > 0 {
				log.Printf("reaper: destroyed %d expired paste(s)", n)
			}
		}
	}()

	token := os.Getenv("PHANTOM_TOKEN")

	mux := http.NewServeMux()

	h := &Handler{store: db}

	mux.HandleFunc("POST /api/paste", withToken(token, h.CreatePaste))
	mux.HandleFunc("GET /api/paste/{id}", withToken(token, h.GetPaste))

	// Serve static files, but route /p/{id} to index.html for client-side routing
	fs := http.FileServer(http.Dir("static"))
	mux.HandleFunc("GET /p/{id}", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "static/index.html")
	})
	mux.Handle("GET /", fs)

	port := os.Getenv("PORT")
	if port == "" {
		port = "3693"
	}

	log.Printf("phantom-paste listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
