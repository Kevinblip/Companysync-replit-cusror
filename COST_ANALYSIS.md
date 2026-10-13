# Unit Economics Simulation — 5,000 Subscribers × $149 Business Plan

*Paper simulation, July 2026. No load testing; infrastructure/API COGS only. All features enabled.*

## Verdict

**Profitable in every scenario — but margin swings 45%→95% depending on BYOK adoption, and the heaviest ~15% of subscribers individually lose money.**

| Scenario | Platform COGS/mo | Gross profit/mo | Gross margin |
|---|---|---|---|
| Worst case — 0% BYOK (every tenant on platform keys) | $410,268 | $334,733 | **44.9%** |
| Realistic — 50% BYOK adoption | $223,254 | $521,746 | **70.0%** |
| As designed — 100% BYOK | $36,241 | $708,759 | **95.1%** |

Revenue: 5,000 × $149 = **$745,000 MRR**. Break-even subscriber count at worst-case blended costs: **~90 subscribers** — at 5,000, scale is not the risk; *usage mix and BYOK adoption* are.

## Cost model

Per-unit anchors are the platform's own internal estimates (`USAGE_UNIT_COSTS`): Lexi text $0.05/interaction, Sarah voice $0.10/min, SMS-AI $0.02, AI Estimator $0.08, Marcus $0.06, CrewCam photo analysis $0.12, image gen $0.04. Vendor pass-through at list price: Twilio SMS $0.0079/seg + ~$0.003 A2P, numbers $1.15/mo, voice $0.0085/min; Resend ~$0.0009/email; Google Geocoding $5/1k, Static Maps $2/1k, Street View $7/1k, Solar buildingInsights $10/1k; object storage ~$0.023/GB-mo. Fixed infra (hosting, DB, WebSocket voice capacity, cron overhead) estimated $6,000/mo at 5,000 tenants.

> **Conservatism note:** the internal anchors run 2–8× above current vendor list prices (e.g., a Lexi turn ≈ $0.006 at Gemini 2.5 Flash list; a Sarah minute ≈ $0.03–0.04 all-in vs the $0.10 anchor). Real worst-case COGS is plausibly $150–250k/mo (66–80% margin). Figures above are a deliberate ceiling.

## Per-subscriber profiles (platform-pays worst case)

| | Light (40%) | Typical (45%) | Heavy (15%) |
|---|---|---|---|
| AI (Lexi/Sarah/CrewCam/Estimator/Marcus/images) | $13.28 | $46.92 | $250.00 |
| Twilio (SMS + A2P + numbers + transfer minutes) | $2.75 | $8.11 | $34.10 |
| Google APIs (geocode/static/streetview/solar/aerial) | $0.26 | $0.98 | $3.16 |
| Email + storage | $0.30 | $1.25 | $4.98 |
| **Total COGS/sub** | **$16.59** | **$57.25** | **$292.24** |
| **P&L/sub** (after $4.62 Stripe + infra share) | **+$126.59** | **+$85.93** | **−$149.06** |
| AI interactions used (plan cap: 5,000/mo) | ~200 | ~610 | ~3,200 |

Heavy assumes a storm-season office running everything: 1,800 Lexi turns, 700 Sarah voice minutes, 500 CrewCam analyses, 2,500 SMS, 3 phone numbers, 60 GB photos.

- **Heavy subscribers are cross-subsidized.** Each loses ~$149/mo at internal-anchor costs. Gross profitability holds until **~41% of the base behaves "heavy"** (vs. 15% assumed) — comfortable headroom, but worth watching.
- **Single-tenant tail risk is uncapped:** 5,000 interactions at the priciest rate ($600) plus "unlimited" Sarah minutes (10,000 min ≈ $1,000) → one abusive/compromised tenant can burn **~$1,600/mo** against $149 collected.

## Top cost drivers (worst case, $/mo at 5,000 subs)

1. **Lexi text AI — $127,500** (31% of COGS)
2. **Sarah voice minutes — $92,250** (22%)
3. **CrewCam photo analysis — $60,900** (15%)
4. **Twilio messaging + numbers — $49,311** (12%)
5. **Stripe processing — $23,105** (6%) · Google APIs a distant $5,095

## Efficiency red flags

1. **Silent BYOK fallback, unmetered for paid plans.** `handleInvokeLLM` and Twilio/Resend senders quietly fall back to platform keys when a tenant hasn't configured their own. Only trials are hard-limited daily. The 45→95% margin swing lands wherever adoption happens to be — *invisibly*. No dashboard tracks platform-key spend per tenant.
2. **"Unlimited" SMS + voice minutes on the platform Twilio fallback** = uncapped telecom exposure per tenant.
3. **`checkAIUsage` fails open** on DB errors — a database hiccup disables the only spend gate.
4. **Unlimited PhotoSync storage** compounds forever (~$0.023/GB-mo, never shrinks). Minor today (~$2k/mo blended), linear growth with tenure.
5. **Cron fan-out scales linearly with tenants** (~14 jobs, several every 1–5 min scanning per company). Not a direct dollar cost, but the $6k infra line will not stay flat at 5,000 tenants without batching/sharding.
6. **A2P 10DLC at 5,000 tenants on one platform account** is an operational/compliance bottleneck (per-tenant campaign registration), separate from the per-message fees modeled here.

*Not modeled (pure upside): the 0.5% platform fee on tenant payment volume — e.g., 30% adoption at $150k/yr processed per company would add ~$94k/mo.*

## Recommendations

1. Meter platform-key usage per tenant and alert when monthly COGS for a tenant exceeds ~50% of their plan price; surface a BYOK nudge at that threshold.
2. Enforce the existing 5,000 AI-interaction cap for paid plans (count Sarah minutes against it), and put a soft ceiling (e.g., 1,500 min/mo) on platform-key voice.
3. Track BYOK adoption as a first-class metric — it is the single biggest lever on gross margin.
