---
name: No require() inside vite plugin ESM code paths
description: Bare require('x') in vite-*-plugin.js throws "Dynamic require of x is not supported" only at call time — features look built but fail in dev.
---

# No bare `require()` in vite plugin files

The vite-*-plugin.js files are ESM bundled by esbuild when vite loads the config. A bare `require('crypto')` (or any module) inside a handler does NOT fail at startup — it throws `Dynamic require of "crypto" is not supported` only when that code path executes. The feature looks fully built and even passes syntax checks, but the flow 500s in dev.

**Why:** esbuild shims `require` with a throwing stub in ESM output. Top-level `import crypto from 'crypto'` (already present in vite-functions-plugin.js) or the existing `nodeRequire = createRequire(import.meta.url)` both work.

**How to apply:** when adding server code to any vite plugin, use the module's top-level imports or `nodeRequire(...)`, never bare `require(...)`. Smoke-test the actual code path (e.g. forged-session HTTP hit), not just module load — call-time-only failures hide behind green syntax checks.
