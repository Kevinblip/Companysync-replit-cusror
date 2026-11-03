# Meta Pixel + CAPI tracking (CompanySync)

## What ships in the app

- **Pixel ID:** `2301170120401803` (browser Pixel in `index.html`)
- **GTM:** `GTM-M9MP4R78` via `ss.getcompanysync.com` (Stape loader; CAPI tags on Stape are optional)
- **Direct CAPI:** `lib/metaCapi.cjs` using `META_CAPI_TOKEN` (no-op if unset). Never required for signup/billing success.

## Events

| Funnel step | Browser (Pixel) | Server (CAPI) | Dedup key |
|---|---|---|---|
| Public page view | `PageView` (+ SPA `PageViewTracker`) | — | — |
| Pricing / plan view | `ViewContent` (content_name=plan) | — | — |
| New trial signup | `CompleteRegistration` + `StartTrial` | same names | `trial_signup_<companyId>` (+ `_st` for StartTrial) |
| First paid SaaS invoice | — | `Subscribe` + `Purchase` | `subinv_<invoiceId>` / MarketingConversion `firstpaid_<companyId>` |

## Attribution

On signup / auto-provision the client sends UTMs + `fbclid` / `gclid` + `_fbp` / `_fbc` from cookies. Server merges IP + UA and stores additive JSON under `companies.data.marketing_attribution`. CAPI hashes email/phone (SHA-256), sets `external_id` = company id, and forwards fbp/fbc/IP/UA.

## Values

Meta `value` and in-app plan copy use display prices from `src/config/planPricing.js` / `lib/planPricing.cjs`: **$99 / $199 / $399**. Stripe Price IDs are **not** changed by this work — customers are still charged whatever those Price objects currently bill.

## Skips

- Stripe Connect / homeowner payments (`event.account` set)
- `$0` trial invoices
- Missing `META_CAPI_TOKEN` → CAPI silently no-ops

## Env (preview / prod — set by ops, not this PR)

- `META_CAPI_TOKEN` — Meta Conversion API access token for Pixel `2301170120401803`
- Optional: `META_PIXEL_ID` override (defaults to the Pixel above)
