-- Unique invoice numbers per company.
--
-- DO NOT APPLY THIS FILE while any company still has two invoices with the
-- same number. It is not executed by db/schema.js or db/prod-db.cjs on
-- startup. Running it against the live YICN tenant today would fail because
-- Chad Sohl (inv_1781649945868_w1midi5ea) and Beverly Owens-Jackson
-- (inv_1782911040494_xaui6rds8) both use INV-2026-0385.
--
-- Check first, read-only, and never against production from a laptop script
-- unless you intend to:
--
--   node scripts/check-duplicate-invoice-numbers.cjs
--
-- That command prints the SQL and does not connect. Repair every listed
-- duplicate (give one invoice a new number, and move payments by invoice id)
-- before applying this index.
--
-- Apply by hand, outside a transaction. CREATE INDEX CONCURRENTLY cannot run
-- inside a BEGIN block:
--
--   psql "$DATABASE_URL" -f db/migrations/20261017_invoice_number_unique.sql
--
-- Blank and NULL numbers stay allowed. Comparison is case-insensitive so
-- "inv-2026-0385" and "INV-2026-0385" cannot both exist in one company.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_invoices_company_invoice_number
  ON invoices (company_id, lower(btrim(invoice_number)))
  WHERE invoice_number IS NOT NULL AND btrim(invoice_number) <> '';
