---
name: Backup/restore engine
description: Security invariants and response-shape gotchas for the company backup + restore feature (createDailyBackup/createCompleteBackup/restore*).
---

# Backup / restore engine

Shared engine lives module-level in `vite-functions-plugin.js` (collectCompanyBackupData + restoreBackupIntoCompany, both exported). Handlers in the shared `functionHandlers` registry serve dev AND prod (do NOT mirror to prod-server); both dispatchers pass `req`.

## Restore is money/data-critical — non-negotiable invariants
- **Single transaction** (pool.connect + BEGIN/COMMIT/ROLLBACK); any row error rolls back the whole restore.
- **Upsert preserves original `id`** (dedicated `ON CONFLICT (id)`, generic `ON CONFLICT (id, entity_type)`) so cross-entity references survive.
- **Cross-tenant hijack guard is mandatory.** `id` is a GLOBAL primary key. Forcing `company_id = target` only stops writing *into* other tenants; it does NOT stop a crafted uploaded backup from naming another tenant's row id and reassigning/overwriting it. Every `DO UPDATE` MUST carry an ownership guard: dedicated `WHERE <table>.company_id = EXCLUDED.company_id`, generic `WHERE generic_entities.company_id = $3`. Foreign-id conflicts then silently skip instead of being stolen.
- **Strip `base44_id` on restore.** It has a GLOBAL unique constraint; a stale value collides with a *different* existing row (realistic after delete + Base44 re-sync) and aborts the entire transaction. The primary `id` is what preserves refs, so dropping base44_id is safe.
- **staff_profiles.is_super_admin forced false** (no global escalation). Deliberately KEEP is_administrator as-is — forcing it false would lock a company out of its own admin.
- **Company row is UPDATE-only, column-whitelisted**, excluding all billing/limits (subscription_plan, stripe_*, max_users, *_credits_*, features_enabled, trial_end_date) — restore must never escalate a plan.
- **Denylist** CompleteBackup + BackupSettings (never restore the backup machinery itself).

**Why:** public estimate links needed HMAC signing because UUIDs leak; the same leak enables backup-id hijacking. Regression test: `scripts/test-backup-restore.mjs` (dev DB round-trip, 24 assertions incl. hijack + base44_id + billing protection).

## invoke() response shape (recurring footgun — bit createBackup AND restore)
`base44.functions.invoke` = invokeLocalFunction: **never rejects**. The `/api/functions/invoke` endpoint wraps as `{ data: handlerResult }`; on handler throw the client returns `{ error, data: {} }`. So frontend mutations MUST: (1) `if (result.error) throw` (else a failed restore shows "Restored undefined records" + reloads), and (2) read `result.data.total_restored` / `result.data.total_records`, NOT `result.total_restored`.

## Listing backups (prod "No backups yet" bug)
Each CompleteBackup row carries the company's ENTIRE dataset in `data.backup_data` (multi-MB). **Never list backups via the generic entity API** — filter() returns every payload, and the deployment's 32MB response cap makes the request fail silently, so the UI shows "No backups yet" while backups exist and the cron works. List via the `listCompanyBackups` handler (metadata-only SQL projection, no backup_data); fetch ONE full backup by id only when downloading/restoring. Auth must allow the frontend's *active* company (staff_profiles membership OR companies.created_by), not just caller.company_id — multi-location users list a company other than their home one.

## Durability (survive DB loss)
Every backup is mirrored off-DB to object storage private dir (`.private/backups/{companyId}/{backupId}.json`) via best-effort mirrorBackupToObjectStorage (never throws). restoreFromCompleteBackup falls back to the mirror via `storage_key` when the DB copy is empty. Residual limit: if the DB row itself (holding storage_key) is gone, there's no bucket-listing recovery — and self-service recovery after TOTAL Postgres loss is impossible anyway because auth/sessions/companies live in that same Postgres. Serviceable scenario = partial data wipe with infra tables intact.
