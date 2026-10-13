---
name: Hidden features registry
description: How intentionally-hidden-but-not-deleted UI features are gated app-wide.
---

# Hidden features registry

Features that are intentionally hidden (but kept in the code for later) are gated
behind boolean flags in `src/config/hiddenFeatures.js` (`HIDDEN_FEATURES` object,
`true` = shown, `false` = hidden). Consumers import `{ HIDDEN_FEATURES }` and gate
with positive-show checks: JSX `{HIDDEN_FEATURES.FLAG && (...)}` for declarative
UI, and an `if (HIDDEN_FEATURES.FLAG) { ... }` guard for imperatively-built DOM
(e.g. Google Maps custom controls created via createElement + controls.push).

**Why:** A non-technical user asked to hide several AI Estimator map elements
without deleting them, and to have a single place that records what's hidden so
they can re-enable later. This registry is that single place; it's also documented
in `replit.md` under "Hidden Features Registry".

**How to apply:** When asked to hide (not remove) a feature, add a flag here
(default `false`), gate the feature with a positive-show check, and add a doc line
to `replit.md`. To re-enable, flip the flag to `true` — no other code changes.