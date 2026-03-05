package main

import "net/http"

func withToken(token string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			provided := r.Header.Get("X-Phantom-Token")
			if provided == "" {
				provided = r.URL.Query().Get("token")
			}
			if provided != token {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}
		next(w, r)
	}
}
