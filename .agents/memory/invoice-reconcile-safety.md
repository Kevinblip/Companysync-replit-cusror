---
name: Invoice reconcile safety rules
description: Money-critical invariants for the Data Health invoice reconcile / CSV-backfill feature.
---

# Invoice reconcile safety rules

The Data Health "upload-and-reconcile" flow backfills missing invoice totals from
original CRM CSV exports and reconciles invoice status from payments. Because it
writes money fields on the live tenant, it carries hard invariants:

- **Apply is fail-closed.** A non-dry-run `reconcileInvoiceData` call must carry an
  explicit `approvedIds` array; without it, write NOTHING. An empty array is valid
  (applies nothing). The apply loop AND the `ReconciliationRun` audit snapshot must
  both use the approved subset — never the full preview.
  **Why:** per-item admin approval is the safety bar; an implicit "apply all" would
  let a stray call rewrite every previewed total.

- **CSV total beats payment-estimation, but never clobbers itemized invoices.** Only
  write a total when `csvTotal > 0 AND (currentTotal === 0 OR (differs AND no line
  items))`. Tag CSV-sourced writes (`total_source:'csv'`) so they're distinguishable
  from estimated ones.
  **Why:** itemized invoices already have an authoritative total; overwriting it from
  a stale export corrupts real data.

- **Split payments are NOT duplicates.** Duplicate detection groups by normalized
  invoice + amount + EXACT date. Same amount on DIFFERENT dates (legit installments)
  must never be flagged. Only same invoice+amount+same-date counts.

- **Tests use synthetic fixtures only.** `src/__tests__/csvReconcile.test.js` must
  build CSVs inline with fake names/amounts — never read the real `attached_assets`
  exports or hardcode real customer names/financials (PII).

**How to apply:** dev handler lives in `vite-functions-plugin.js` (`reconcileInvoiceData`);
prod auto-mirrors via `db/prod-integrations.cjs` `getFunctionHandlers()` (no prod-server
dup). Pure CSV helpers are in `src/utils/csvReconcile.js`; UI in `src/pages/DataHealth.jsx`.
