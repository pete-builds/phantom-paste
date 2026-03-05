package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

type Paste struct {
	ID        string    `json:"id"`
	Cipher    string    `json:"cipher"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at,omitempty"`
	MaxViews  int       `json:"max_views,omitempty"`
	ViewCount int       `json:"view_count"`
	Destroyed bool      `json:"destroyed"`
}

func NewStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL")
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS pastes (
		id TEXT PRIMARY KEY,
		cipher TEXT NOT NULL,
		created_at DATETIME NOT NULL DEFAULT (datetime('now')),
		expires_at DATETIME,
		max_views INTEGER DEFAULT 0,
		view_count INTEGER DEFAULT 0,
		destroyed INTEGER DEFAULT 0
	)`)
	if err != nil {
		return nil, err
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func generateID() (string, error) {
	b := make([]byte, 12)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Store) Create(cipher string, expiresAt time.Time, maxViews int) (string, error) {
	id, err := generateID()
	if err != nil {
		return "", err
	}

	var expiry *time.Time
	if !expiresAt.IsZero() {
		expiry = &expiresAt
	}

	_, err = s.db.Exec(
		`INSERT INTO pastes (id, cipher, expires_at, max_views) VALUES (?, ?, ?, ?)`,
		id, cipher, expiry, maxViews,
	)
	if err != nil {
		return "", err
	}

	return id, nil
}

func (s *Store) Get(id string) (*Paste, error) {
	p := &Paste{}
	var expiresAt sql.NullTime
	var destroyed int

	err := s.db.QueryRow(
		`SELECT id, cipher, created_at, expires_at, max_views, view_count, destroyed FROM pastes WHERE id = ?`,
		id,
	).Scan(&p.ID, &p.Cipher, &p.CreatedAt, &expiresAt, &p.MaxViews, &p.ViewCount, &destroyed)
	if err != nil {
		return nil, err
	}

	p.Destroyed = destroyed == 1
	if expiresAt.Valid {
		p.ExpiresAt = expiresAt.Time
	}

	// Check if expired by time
	if !p.ExpiresAt.IsZero() && time.Now().After(p.ExpiresAt) {
		s.Destroy(id)
		p.Destroyed = true
		return p, nil
	}

	// Check if destroyed
	if p.Destroyed {
		return p, nil
	}

	// Increment view count
	p.ViewCount++
	_, err = s.db.Exec(`UPDATE pastes SET view_count = ? WHERE id = ?`, p.ViewCount, id)
	if err != nil {
		return nil, err
	}

	// Check if max views reached
	if p.MaxViews > 0 && p.ViewCount >= p.MaxViews {
		s.Destroy(id)
		// Still return the paste this one last time, but mark as destroyed after
		if p.ViewCount > p.MaxViews {
			p.Destroyed = true
		}
	}

	return p, nil
}

func (s *Store) Destroy(id string) error {
	_, err := s.db.Exec(`UPDATE pastes SET destroyed = 1, cipher = '' WHERE id = ?`, id)
	return err
}

func (s *Store) ReapExpired() (int64, error) {
	result, err := s.db.Exec(
		`UPDATE pastes SET destroyed = 1, cipher = '' WHERE destroyed = 0 AND expires_at IS NOT NULL AND expires_at < datetime('now')`,
	)
	if err != nil {
		return 0, err
	}
	n, _ := result.RowsAffected()

	// Delete pastes destroyed more than 24 hours ago
	_, err = s.db.Exec(
		`DELETE FROM pastes WHERE destroyed = 1 AND created_at < datetime('now', '-1 day')`,
	)
	if err != nil {
		fmt.Println("reaper cleanup error:", err)
	}

	return n, nil
}
