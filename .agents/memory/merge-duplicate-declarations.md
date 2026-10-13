---
name: Task merges duplicating helpers in shared plugin files
description: Two parallel tasks adding the same helper to a big plugin file breaks vite config load with duplicate top-level declarations
---

# Task merges can duplicate top-level helpers

**Rule:** When two parallel project tasks each add a similar helper to the same huge module (vite-functions-plugin.js and friends), the merge can land BOTH copies. Duplicate top-level `function` declarations make esbuild reject the whole vite config, so the dev server fails at boot — the symptom is "Start application failed" with `The symbol "X" has already been declared`.

**Why:** Task agents work in isolated environments and don't see each other's in-flight additions; the platform merge is textual, not semantic (this happened with two 80%-usage-nudge implementations from adjacent tasks).

**How to apply:** On a post-merge boot failure, grep the named symbol for multiple declarations, diff the copies, and keep the superset implementation (check call-site signatures — the two copies may have different arg lists, so consolidate call sites too). When planning tasks, flag overlapping helpers in shared plugin files as an explicit dependency instead of letting them run in parallel.
