---
name: PWA controllerchange reload loop
description: Why an unconditional controllerchange->reload causes an infinite "flashing" loop on first visit, and the correct gate.
---

# PWA controllerchange reload loop ("flashing" page)

**Symptom:** A page (notably the public `/sign-contract-customer` signing link, but any route) "keeps flashing / glitching" for a first-time visitor. Browser console shows a repeating cycle: page loads → `[PWA] Service worker registered` → `[PWA] New service worker active — reloading for fresh code` → reload → repeat.

**Root cause:** The service worker's `activate` handler calls `self.clients.claim()`. On a visitor's **first ever** load the page starts *uncontrolled*; `clients.claim()` then makes the new SW take control, which fires a `controllerchange` event on that page. A `navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload())` handler that reloads *unconditionally* therefore reloads on this initial takeover — and the race repeats → endless loop.

**Rule / fix (client, in `src/main.jsx`):** Only reload on `controllerchange` when the user *explicitly opted into an update*. Track a module-scoped `pwaUpdateRequested` flag set to `true` ONLY in the "Update now" banner button click (right before posting `SKIP_WAITING`). The `controllerchange` handler returns early unless `pwaUpdateRequested` is true, plus a one-shot `refreshing` guard prevents duplicate reloads. Do NOT reload on the initial claim.

**Why:** The intended update UX is banner-driven: `install` deliberately does NOT `skipWaiting()`; the new SW waits; clicking "Update now" → `SKIP_WAITING` → `skipWaiting()` → activate → `controllerchange` → single reload. `clients.claim()` is still desirable (SW controls the page on first visit for caching) so `public/sw.js` is left unchanged — the gate belongs in the client, not the SW.

**How to apply:** Any time you wire `controllerchange` → reload alongside a SW that calls `clients.claim()`, gate the reload behind an explicit user-update flag. Recovery of already-stuck production clients after deploy works because `sw.js` serves navigations (index.html) and `.js`/`/src/` network-first, so the next reload fetches the fixed bundle and the loop stops.
