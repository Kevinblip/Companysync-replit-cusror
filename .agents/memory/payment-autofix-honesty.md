---
name: Payment auto-fix honesty
description: Lessons from the "linked 11 orphaned payments" false-success in the payments Auto-Fix All feature
---

# Payment auto-fix honesty

**Rules:**
1. Fix/repair summaries must count *successful* operations, never the pre-selection row count — "linked N" when some rows hit `no_invoice_found` is a false success the user will catch.
2. The UI banner detection and the backend fixer must key on the SAME field. Balances are summed by `invoice_id`; `invoice_number` is just a display label. A banner keyed on blank `invoice_number` while the fixer keys on blank `invoice_id` makes them disagree forever.
3. Payments whose customer has NO invoice at all are permanently unfixable by auto-link — the summary must name them and tell the user to create an invoice first (returned in `unfixable[]`; frontend shows warning/info toast).
4. Any `UPDATE payments ... FROM invoices` backfill must scope BOTH sides to the tenant (`p.company_id = $1 AND i.company_id = $1`) or a corrupted cross-tenant invoice_id leaks another company's invoice number.
5. The prod inline `fixPaymentDataCorruption` handler now requires session auth + staff_profiles membership (or companies.created_by owner) for the target company — keep that when touching it; the dev copy lives in vite-functions-plugin.js and must stay in lockstep.
6. Auto-link is safe only with one explicit, unique invoice-number match or exactly one open same-customer invoice whose remaining balance can absorb the received payment; never choose “most recent.” Duplicate invoice numbers, invalid amounts, and ambiguous/no-balance matches must remain manual.
7. Calculate an invoice’s remaining balance from received payments, not `amount_paid` (which may be stale precisely when Auto-Fix runs); pending/void/refunded/failed payments are not money received.

**How to apply:** whenever adding/altering bulk fix-up endpoints for payments/invoices, or any "Auto-Fix" style feature: honest counts, matching detection criteria UI↔server, tenant-scoped joins, session-derived authorization.
