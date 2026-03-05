# Phantom Paste

A zero-knowledge, self-hosted ephemeral pastebin. Paste text in, get a self-destructing link. The server never sees your plaintext.

## Features

- **Zero-knowledge encryption** — XSalsa20-Poly1305 (tweetnacl) in the browser. The encryption key lives in the URL fragment (`#key`), which is never sent to the server.
- **Self-destructing** — Time-based (1 hour, 1 day, 7 days) and/or view-count (1 view, 5 views). Whichever limit hits first wins.
- **Syntax highlighting** — Auto-detect or manual language selection via highlight.js
- **Markdown rendering** — Full markdown support with marked.js
- **Typing animation** — Pastes type out character by character on view
- **Terminal aesthetic** — Dark theme, monospace, green accents
- **No build step** — Vanilla JS frontend, single HTML page
- **Tiny footprint** — ~15MB Docker image (multi-stage Go build)

## How It Works

1. You paste content into the browser
2. Browser generates a random 256-bit key and encrypts your text client-side
3. Encrypted blob is sent to the server and stored in SQLite
4. You get a link like `https://your-host:3693/p/abc123#encryption-key`
5. The `#encryption-key` fragment is **never sent to the server** — only someone with the full link can decrypt
6. When the paste expires (time or views), the ciphertext is wiped from the database

## Quick Start

```bash
docker compose up -d
```

Open `http://localhost:3693`

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3693` | HTTP port |
| `PHANTOM_TOKEN` | _(empty)_ | If set, requires this token as `X-Phantom-Token` header or `?token=` query param |

## Tech Stack

- **Backend:** Go (net/http, no framework)
- **Database:** SQLite with WAL mode
- **Encryption:** tweetnacl secretbox (XSalsa20-Poly1305)
- **Frontend:** Vanilla JS + highlight.js + marked.js (CDN)
- **Container:** Multi-stage Docker (golang:1.22-alpine → alpine:3.19)

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/paste` | Create paste. Body: `{"cipher": "...", "expires_in": "1h\|1d\|7d", "max_views": 0\|1\|5}` |
| `GET` | `/api/paste/{id}` | Fetch paste. Increments view count. Returns `{"cipher": "...", "destroyed": false}` |

## Why tweetnacl instead of Web Crypto API?

The Web Crypto API (`crypto.subtle`) requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) (HTTPS or localhost). For a self-hosted tool on a LAN, that means either self-signed certs with browser warnings or a reverse proxy with Let's Encrypt. tweetnacl is a pure JavaScript implementation that works over plain HTTP with equivalent security (XSalsa20-Poly1305 authenticated encryption).

## License

MIT
