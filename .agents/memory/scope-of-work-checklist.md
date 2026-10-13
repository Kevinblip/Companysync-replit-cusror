---
name: Scope of Work / job-completion checklist
description: Product decisions & merge rule behind the Build Schedule per-job checklist that prevents crews forgetting parts of a job.
---

# Scope of Work checklist (Build Schedule)

A per-build checklist lives inline as `scope_of_work` (array) on the BuildSchedule
generic entity, alongside `scope_estimate_id` / `scope_generated_at`. Pure helpers
in `src/lib/scopeOfWork.js`; all wiring in `src/pages/BuildSchedule.jsx`. No server
handler — plain generic-entity CRUD + client helpers.

## Locked product decisions (keep future work consistent with these)
- Checklist is generated from BOTH the linked estimate's line items AND standard
  per-job-type templates (deduped/normalized together).
- Completion gate is **soft**: marking a build "Completed" WARNs and lists unchecked
  items and requires a "Complete anyway" confirmation. It is NOT a hard block.
  **Why:** owner asked for a safety net, not a wall (a real build missed the garage
  roof); crews must still be able to close out jobs.
- Photo proof per item is optional and stored as **URLs** (via Core.UploadFile),
  never base64.
- Default templates for "Roof Install"/"Roof Replacement" intentionally include a
  "Roof over ALL structures on the property (house + garage + additions)" line —
  that's the exact miss this feature exists to prevent. Don't drop it.

## mergeScopeItems keep-rule (non-obvious)
On regenerate, unmatched existing items are kept ONLY if they are `category:'manual'`
OR already `completed`. Uncompleted estimate/template items that are no longer
generated are dropped as **stale**.
**Why:** switching the source estimate or job type would otherwise leave orphaned
unchecked items that nag forever in the completion warning. Completed items are kept
because they represent real work + photo proof.
**How to apply:** if you change generation/merge, preserve this rule (and its tests
in `src/__tests__/scopeOfWork.test.js`) or the completion warning regresses.

## Estimate auto-pick order
Deterministic: accepted/approved > sent > draft, then most recent. Owner can override
the picked estimate in the dialog before generating.
