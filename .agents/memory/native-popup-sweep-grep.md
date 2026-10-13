---
name: Sweeping native confirm()/alert() calls
description: Grep pattern pitfalls when replacing window.confirm/alert with custom dialogs
---

When asked to remove native `window.confirm()` / `window.alert()` / bare `confirm()` / `alert()` calls from a file, the two forms (`window.X(...)` and bare `X(...)`) can both appear in the same file — searching for only one form misses instances of the other.

**Why:** A `grep "window\.confirm|window\.alert"` search can report a file as "clean" while it still has bare `confirm(...)` / `alert(...)` calls (and vice versa), because JS code in this app mixes both call styles inconsistently even within one file.

**How to apply:** Verify with a pattern that catches both, e.g. `(^|[^.\w])confirm\(|(^|[^.\w])alert\(|window\.confirm|window\.alert`, and re-run it as a final check after finishing a "sweep" task — don't trust the first pass.
