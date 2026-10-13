---
name: Triple email/HTML renderer paths must stay in sync
description: Invoice/estimate emails are rendered by THREE independent code paths; editing only one silently breaks the others
---

# Invoice/estimate emails have three independent renderers

The same email (e.g. invoice email with the "How to Pay" / alternative-payment block:
Cash App / Venmo / Zelle / Check / Cash) is rendered by THREE separate, hand-duplicated code paths:

1. **Dev (Vite plugin):** `vite-functions-plugin.js` — `sendInvoiceEmail` (runs in the dev workspace via `/api/functions/invoke`).
2. **Deployed Replit app (production):** `db/prod-integrations.cjs` — `sendInvoiceEmailProd`, dispatched from `prod-server.cjs` `/api/functions/invoke` → `prodIntegrations.handleFunctionInvoke`. **This is what the published app actually runs.**
3. **Base44 serverless (Deno):** `functions/sendInvoiceEmail.ts`.

**Why this matters:** a feature added to only one path looks fixed in dev but is missing in the
published app (or vice-versa). A real incident: alternative payment options saved fine and showed in
dev, but never appeared in invoice emails on the *published* site because `sendInvoiceEmailProd`
never queried `CompanySetting` and had no payment-options HTML at all.

**How to apply:** Any change to invoice/estimate email content must be applied to ALL THREE renderers.
When debugging "works in dev, broken in prod" email issues, check `db/prod-integrations.cjs` first —
the deployed app uses it, NOT the Vite plugin. Production changes require a **republish** to take effect.

**Settings lookup:** payment settings live in `generic_entities` as `entity_type='CompanySetting'`
keyed by `company_id`. The invoice email resolves company_id from the invoice row, so the saved
CompanySetting.company_id must equal the invoice's company_id (YICN uses `loc_mmdvp1h5_e8i9eb`).
