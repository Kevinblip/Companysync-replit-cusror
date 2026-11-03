# Base44 / companysync.io CTA UTM pass-through

Marketing pages on **companysync.io** (and any Base44-hosted landing) should keep campaign params when linking into the app signup.

## Required query params on signup CTAs

Point “Start free trial” / plan buttons at:

`https://getcompanysync.com/Signup?plan=<basic|business|enterprise>&utm_source=...&utm_medium=...&utm_campaign=...&utm_content=...&utm_term=...&fbclid=...&gclid=...`

Rules:

1. Preserve the visitor’s existing query string (especially `fbclid`, `gclid`, and all `utm_*`).
2. Always set `plan=` to the clicked tier.
3. Prefer absolute links to `getcompanysync.com` (not a Base44-relative path that drops params).

## In-app capture

`src/lib/analytics.js` reads those params (+ `_fbp` / `_fbc` cookies) on first visit and re-sends them on `/api/signup` and `/api/local/auto-provision` so Meta CAPI can attribute the trial.

## Price copy on marketing sites (as of 2026-11-04)

- **companysync.io/pricing** — already shows **$99 / $199 / $399**
- **companysync.io/compare/vs-hubspot** — still shows **Starting Price $59/mo** (needs Base44 edit)
- **COST_ANALYSIS.md** (this repo, internal) — still models **$149** Business MRR (docs only; not customer-facing)
- App transactional emails / default client templates — no hardcoded SaaS plan prices found
- Stripe Price objects still seed/charge **$59 / $149 / $299** (IDs unchanged in this PR); display vs charge diverge until ops creates new Prices
