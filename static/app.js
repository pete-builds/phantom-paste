// Phantom Paste — Client-side encryption + UI logic
// Uses tweetnacl secretbox (XSalsa20-Poly1305) — works over plain HTTP

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Crypto (tweetnacl secretbox) ---

function generateKey() {
    const key = nacl.randomBytes(nacl.secretbox.keyLength); // 32 bytes
    return {
        key,
        encoded: bytesToBase64url(key)
    };
}

function importKey(encoded) {
    return base64urlToBytes(encoded);
}

function encrypt(plaintext, key) {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes
    const message = new TextEncoder().encode(plaintext);
    const box = nacl.secretbox(message, nonce, key);
    // Prepend nonce to ciphertext
    const combined = new Uint8Array(nonce.length + box.length);
    combined.set(nonce);
    combined.set(box, nonce.length);
    return bytesToBase64(combined);
}

function decrypt(cipherB64, key) {
    const combined = base64ToBytes(cipherB64);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const box = combined.slice(nacl.secretbox.nonceLength);
    const message = nacl.secretbox.open(box, nonce, key);
    if (!message) return null; // decryption failed
    return new TextDecoder().decode(message);
}

// --- Base64 helpers ---

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function bytesToBase64url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    return base64ToBytes(b64 + padding);
}

// --- UI State ---

let selectedExpiry = '1d';
let selectedViews = 0;
let countdownInterval = null;

// --- Button Groups ---

function setupButtonGroups() {
    $$('#expiry-group .btn-option').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#expiry-group .btn-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedExpiry = btn.dataset.value;
        });
    });

    $$('#views-group .btn-option').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('#views-group .btn-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedViews = parseInt(btn.dataset.value);
        });
    });
}

// --- Create Paste ---

async function createPaste() {
    const content = $('#content').value.trim();
    if (!content) return;

    const btn = $('#create-btn');
    btn.disabled = true;
    btn.querySelector('.btn-text').textContent = 'ENCRYPTING...';

    try {
        const { key, encoded: keyStr } = generateKey();
        const syntax = $('#syntax').value;

        // Prepend syntax hint as metadata
        const payload = syntax ? `<!--syntax:${syntax}-->\n${content}` : content;
        const cipher = encrypt(payload, key);

        const resp = await fetch('/api/paste', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cipher,
                expires_in: selectedExpiry,
                max_views: selectedViews
            })
        });

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || 'failed to create paste');
        }

        const { id } = await resp.json();
        const link = `${location.origin}/p/${id}#${keyStr}`;

        showLinkView(link, selectedExpiry, selectedViews);
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.querySelector('.btn-text').textContent = 'CREATE PHANTOM';
    }
}

function showLinkView(link, expiry, views) {
    $('#create-view').classList.add('hidden');
    $('#link-view').classList.remove('hidden');
    $('#link-view').classList.add('fade-in');
    $('#share-link').value = link;

    const meta = [];
    const expiryLabels = { '1h': '1 hour', '1d': '1 day', '7d': '7 days' };
    if (expiry) meta.push(`expires in ${expiryLabels[expiry] || expiry}`);
    if (views > 0) meta.push(`burns after ${views} view${views > 1 ? 's' : ''}`);
    $('#link-meta').textContent = meta.join(' // ') || 'default 7-day expiry';
}

// --- View Paste ---

async function viewPaste(id, keyStr) {
    try {
        const resp = await fetch(`/api/paste/${id}`);
        if (!resp.ok) {
            if (resp.status === 404) {
                showDestroyed();
                return;
            }
            throw new Error('failed to fetch paste');
        }

        const data = await resp.json();

        if (data.destroyed) {
            showDestroyed();
            return;
        }

        const key = importKey(keyStr);
        const plaintext = decrypt(data.cipher, key);

        if (plaintext === null) {
            // Decryption failed — wrong key
            showDestroyed();
            return;
        }

        // Extract syntax hint
        let syntax = '';
        let content = plaintext;
        const syntaxMatch = plaintext.match(/^<!--syntax:(\w+)-->\n/);
        if (syntaxMatch) {
            syntax = syntaxMatch[1];
            content = plaintext.slice(syntaxMatch[0].length);
        }

        showPasteView(content, syntax, data);
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function showPasteView(content, syntax, meta) {
    $('#create-view').classList.add('hidden');
    $('#view-paste').classList.remove('hidden');
    $('#view-paste').classList.add('fade-in');

    // Meta bar
    const metaParts = [];
    if (meta.expires_at) {
        metaParts.push(`<span class="countdown" id="countdown"></span>`);
    }
    if (meta.max_views > 0) {
        metaParts.push(`<span class="view-count">view <span class="current">${meta.view_count}</span>/${meta.max_views}</span>`);
    }
    $('#paste-meta').innerHTML = metaParts.join('<span style="color:var(--text-dim)"> | </span>');

    // Start countdown
    if (meta.expires_at) {
        updateCountdown(new Date(meta.expires_at));
        countdownInterval = setInterval(() => updateCountdown(new Date(meta.expires_at)), 1000);
    }

    // Render content
    const output = $('#paste-output');

    if (syntax === 'markdown') {
        output.classList.add('markdown-body');
        output.innerHTML = marked.parse(content);
        // Highlight code blocks within markdown
        output.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
    } else {
        // Typing animation then highlight
        typeContent(output, content, syntax);
    }
}

function typeContent(container, content, syntax) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    if (syntax) code.className = `language-${syntax}`;
    pre.appendChild(code);
    container.appendChild(pre);

    const cursor = document.createElement('span');
    cursor.className = 'typing-cursor';

    // For short pastes, type character by character
    // For long pastes, type in chunks
    const isLong = content.length > 500;
    const chunkSize = isLong ? 20 : 1;
    const delay = isLong ? 5 : 15;

    let i = 0;

    function type() {
        if (i < content.length) {
            const chunk = content.slice(i, i + chunkSize);
            code.textContent += chunk;
            i += chunkSize;

            // Keep cursor at end
            if (code.parentNode.contains(cursor)) code.parentNode.removeChild(cursor);
            code.parentNode.appendChild(cursor);

            // Scroll to bottom
            container.scrollTop = container.scrollHeight;

            requestAnimationFrame(() => setTimeout(type, delay));
        } else {
            // Done typing — remove cursor, apply highlighting
            if (cursor.parentNode) cursor.parentNode.removeChild(cursor);
            if (syntax && syntax !== 'plaintext') {
                hljs.highlightElement(code);
            }
        }
    }

    type();
}

function updateCountdown(expiresAt) {
    const el = $('#countdown');
    if (!el) return;

    const now = new Date();
    const diff = expiresAt - now;

    if (diff <= 0) {
        el.textContent = 'EXPIRED';
        el.classList.add('urgent');
        clearInterval(countdownInterval);
        setTimeout(() => showDestroyed(), 2000);
        return;
    }

    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    if (hours > 0) {
        el.textContent = `${hours}h ${mins}m ${secs}s remaining`;
    } else if (mins > 0) {
        el.textContent = `${mins}m ${secs}s remaining`;
    } else {
        el.textContent = `${secs}s remaining`;
        el.classList.add('urgent');
    }
}

function showDestroyed() {
    $$('#create-view, #link-view, #view-paste').forEach(el => el.classList.add('hidden'));
    $('#destroyed-view').classList.remove('hidden');
    $('#destroyed-view').classList.add('fade-in');
    clearInterval(countdownInterval);
}

// --- Copy ---

function setupCopy() {
    $('#copy-btn').addEventListener('click', () => {
        const link = $('#share-link').value;
        // clipboard API also requires secure context, fallback to execCommand
        const input = $('#share-link');
        input.select();
        input.setSelectionRange(0, 99999);
        document.execCommand('copy');
        const btn = $('#copy-btn');
        btn.textContent = 'COPIED';
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--accent)';
        setTimeout(() => {
            btn.textContent = 'COPY';
        }, 2000);
    });
}

// --- Router ---

function route() {
    const path = location.pathname;
    const match = path.match(/^\/p\/([A-Za-z0-9_-]+)$/);

    if (match) {
        const id = match[1];
        const keyStr = location.hash.slice(1);
        if (!keyStr) {
            showDestroyed();
            return;
        }
        viewPaste(id, keyStr);
    }
    // else: show create view (default)
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
    setupButtonGroups();
    setupCopy();

    $('#create-btn').addEventListener('click', createPaste);
    $('#new-btn').addEventListener('click', () => {
        window.location.href = '/';
    });

    // Ctrl/Cmd+Enter to submit
    $('#content').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            createPaste();
        }
    });

    route();
});
