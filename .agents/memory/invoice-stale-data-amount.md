---
name: Invoice frontend `amount` is stale
description: Invoice objects expose a frozen `amount` from the legacy `data` JSONB; use `total_amount` for balances/status, never `inv.amount`.
---

# Invoice `inv.amount` is stale — use `total_amount`

Invoice objects returned to the frontend carry an `amount` field that is a frozen
snapshot spread from the row's legacy Base44 `data` JSONB. It is NOT a live column
and never updates. Always compute balance-owed and status from `total_amount` and
`amount_paid` instead.

- App-created invoices: the stale `amount` happens to equal `total_amount`, so bugs
  using `inv.amount` stay hidden.
- Imported/migrated invoices: the stale `amount` holds the original total while the
  canonical `total_amount` is 0 (no stored line-item total). Anything keying off
  `inv.amount` then shows phantom balances and the invoice can never reach "paid"
  (paid requires `total_amount > 0`), so it gets stuck forever in any
  outstanding / overdue / follow-up list.

**Rule:** balance owed = `Number(inv.total_amount) - Number(inv.amount_paid)`,
clamped with `Math.max(0, …)`. Status: `paid` only when `total_amount > 0 &&
amount_paid >= total_amount`. Never use `inv.amount` for invoices.

**Why:** a "stuck / not synced" Outstanding-Invoices report was caused entirely by
imported zero-total invoices surfacing via the stale `amount`. Switching to
`total_amount` cleared the phantoms while keeping real debt.

**How to apply:** any new invoice list, sum, or status calc must read `total_amount`.
Estimates are different — they legitimately use `est.amount`. This is invoices only.
