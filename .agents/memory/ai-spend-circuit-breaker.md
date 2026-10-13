---
name: AI spend circuit breaker
description: Dollar-based platform AI spend gate ($150 warn / $200 hard stop) layered on checkAIUsage.
---

Rule: the AI gate blocks on month-to-date **dollar** spend, summed over the SAME feature set the gate covers (AI_USAGE_FEATURES) — never over all SubscriptionUsage events. SMS/voice have their own caps; blocking AI because of SMS spend is wrong and BYOK Gemini wouldn't remediate it.

**Why:** per-feature unit costs vary 6× ($0.02–$0.12), so interaction-count caps alone allowed $6k/mo worst case against a $299 sub. Code-review round caught an initial version that summed all features, which would have let SMS spend block AI.

**How to apply:**
- Thresholds live as AI_SPEND_WARN_USD / AI_SPEND_HARD_CAP_USD in vite-functions-plugin.js and are mirrored in SubscriptionUsage.jsx banners — change both in lockstep.
- Once-per-month notice idempotency uses deterministic SpendNotice ids + `ON CONFLICT (id, entity_type)` (generic_entities PK is composite — plain `ON CONFLICT (id)` errors).
- Warning email releases its claim on send failure (trial-nurture lesson); hard-stop notice is claim-first.
- staff_profiles has NO is_deleted column in dev — the older cost-alert cron query that references it silently fails there.
- Smoke test: scripts/test-spend-circuit-breaker.cjs (imports the plugin module directly, no server needed).
