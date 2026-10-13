# Scope of Work / Job Completion Checklist

Each build can carry a per-job checklist so crews/owner never forget part of a job (this exists because a real build once missed the garage roof). It is stored inline on the `BuildSchedule` entity — no new server handler — via `data` JSONB fields: `scope_of_work` (array of items) plus `scope_estimate_id` / `scope_generated_at`.

- **Pure helpers**: `src/lib/scopeOfWork.js` (unit-tested in `src/__tests__/scopeOfWork.test.js`). Wiring lives in `src/pages/BuildSchedule.jsx`.
- **Generated from BOTH sources**: the linked estimate's line items AND standard per-job-type templates (`DEFAULT_SCOPE_TEMPLATES`), normalized and deduped together. Roof Install/Replacement templates intentionally include a "Roof over ALL structures on the property (house + garage + additions)" line.
- **Custom templates (optional)**: a company may override any job type by saving a `ScopeTemplate` generic entity (`{ company_id, job_type, items:[...] }`); defaults work out of the box with no setup.
- **Estimate auto-pick**: deterministic — accepted/approved > sent > draft, then most recent. The owner can override the picked estimate before generating.
- **Soft completion gate**: marking a build "Completed" WARNs and lists unchecked items and requires a "Complete anyway" confirmation — it is NOT a hard block. Each row shows a `done/total` progress badge.
- **Photo proof (optional)** per item, uploaded via `Core.UploadFile` and stored as URLs (never base64).
- **Regenerate/merge rule**: re-generating preserves completed state / photos / notes / id for items whose label still matches; unmatched existing items are kept only if they are manual additions OR already completed. Uncompleted estimate/template items no longer in scope are dropped as stale (so the warning never nags about work that is no longer part of the job).
