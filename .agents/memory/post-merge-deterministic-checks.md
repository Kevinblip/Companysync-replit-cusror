---
name: Post-merge deterministic checks
description: Why post-merge setup is limited to fast non-network validation.
---

Keep the automatic post-merge hook limited to idempotent, deterministic checks that do not require a running app or mutate database fixtures. Run HTTP/database smoke tests through their focused workflows instead.

**Why:** merge setup runs alongside workflow reconciliation; temporary servers and database fixture sweeps can contend for startup or database locks and make unrelated merges time out.

**How to apply:** before adding a merge-hook check, verify it has no live-server dependency, no external I/O, and no shared database mutation. Keep the timeout as a guard, not a substitute for bounded work.