---
name: Stripe invoice webhook idempotency
description: Durable rules for recording invoice payments and notifying company staff when Stripe delivers duplicate or partially processed events.
---

Stripe Checkout webhooks are at-least-once and can be concurrent. A payment reference must be recorded once under a transaction-scoped lock, and invoice balances should be recomputed from eligible payment rows rather than incremented from the invoice snapshot.

**Why:** a retry after a partial failure can otherwise duplicate money, or a concurrent payment can overwrite a newer balance. Gating only the first delivery also misses notification recovery when the payment was committed before the process failed.

**How to apply:** use the invoice owner's company for recipient lookup, use a deterministic payment/admin key for bell/email/SMS deduplication, send ACH company alerts only after the pending payment transitions to completed, and keep customer receipts separate.

Production secret changes require a republish before the running VM can verify Stripe signatures; test the live endpoint after publishing rather than assuming the new secret is already loaded.

**Why:** an environment secret can be present in Replit while the currently running deployment still rejects signed webhooks because it started before the secret was added.

**How to apply:** after adding or rotating `STRIPE_WEBHOOK_SECRET`, publish/restart the production build, then send a signed no-charge/reconciliation-safe probe and verify the response before replaying payments.