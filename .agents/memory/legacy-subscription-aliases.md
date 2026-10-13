---
name: Legacy subscription aliases
description: Feature-gating compatibility rules for historical paid subscription names.
---

Treat `lifetime`, `legacy`, and `unlimited` as full-access Enterprise equivalents. Treat `professional` as a Business equivalent. Lower historical aliases such as `starter` and `freelance` remain Basic equivalents.

**Why:** Active production customers can retain historical plan names. If one shared feature gate recognizes only the current plan names, valid features disappear after publishing even when other navigation logic correctly treats the customer as fully entitled.

**How to apply:** Any subscription-based menu, route, API, or capability gate must use the shared normalized feature-access logic rather than recreating a partial plan-name hierarchy.