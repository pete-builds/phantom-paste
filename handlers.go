package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type Handler struct {
	store *Store
}

type CreateRequest struct {
	Cipher    string `json:"cipher"`
	ExpiresIn string `json:"expires_in"` // "1h", "1d", "7d", or ""
	MaxViews  int    `json:"max_views"`  // 0 = unlimited
}

type CreateResponse struct {
	ID string `json:"id"`
}

type PasteResponse struct {
	ID        string `json:"id"`
	Cipher    string `json:"cipher,omitempty"`
	ExpiresAt string `json:"expires_at,omitempty"`
	MaxViews  int    `json:"max_views,omitempty"`
	ViewCount int    `json:"view_count"`
	Destroyed bool   `json:"destroyed"`
}

func (h *Handler) CreatePaste(w http.ResponseWriter, r *http.Request) {
	var req CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid json"}`, http.StatusBadRequest)
		return
	}

	if req.Cipher == "" {
		http.Error(w, `{"error":"cipher is required"}`, http.StatusBadRequest)
		return
	}

	// Cap cipher size at 1MB
	if len(req.Cipher) > 1_000_000 {
		http.Error(w, `{"error":"paste too large (max 1MB)"}`, http.StatusRequestEntityTooLarge)
		return
	}

	var expiresAt time.Time
	switch req.ExpiresIn {
	case "1h":
		expiresAt = time.Now().Add(1 * time.Hour)
	case "1d":
		expiresAt = time.Now().Add(24 * time.Hour)
	case "7d":
		expiresAt = time.Now().Add(7 * 24 * time.Hour)
	case "":
		// No time expiry — will rely on max_views or default 7d
		if req.MaxViews == 0 {
			expiresAt = time.Now().Add(7 * 24 * time.Hour) // default 7 day expiry
		}
	default:
		http.Error(w, `{"error":"invalid expires_in (use 1h, 1d, 7d)"}`, http.StatusBadRequest)
		return
	}

	id, err := h.store.Create(req.Cipher, expiresAt, req.MaxViews)
	if err != nil {
		log.Println("create error:", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(CreateResponse{ID: id})
}

func (h *Handler) GetPaste(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, `{"error":"missing id"}`, http.StatusBadRequest)
		return
	}

	paste, err := h.store.Get(id)
	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		log.Println("get error:", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	resp := PasteResponse{
		ID:        paste.ID,
		ViewCount: paste.ViewCount,
		MaxViews:  paste.MaxViews,
		Destroyed: paste.Destroyed,
	}

	if !paste.Destroyed {
		resp.Cipher = paste.Cipher
	}

	if !paste.ExpiresAt.IsZero() {
		resp.ExpiresAt = paste.ExpiresAt.UTC().Format(time.RFC3339)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
