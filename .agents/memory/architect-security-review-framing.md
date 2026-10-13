---
name: Architect declines security-exploit-framed reviews
description: The architect/code-review subagent content-policy declines diffs described in attack/exploit terms; what to do instead.
---

# Architect declines security-exploit-framed reviews

**Rule:** When asking the architect to review a security fix, avoid attack-narrative framing ("attacker", "exploit", step-by-step intrusion chains). If it still declines after ~2 neutral rewrites, stop retrying — it can decline on the diff content itself.

**Why:** During a tenant-isolation fix review, 4 attempts (including fully neutral "validation helpers" phrasing) all returned "declined due to content policy". Retrying wastes time.

**How to apply:** Fall back to a structured manual review: enumerate every route/alias that can write the protected record type, check guard ordering vs existing strips, check the update/bulk paths, and verify with unit + live E2E tests. Document findings in the final report and note the review was blocked.
