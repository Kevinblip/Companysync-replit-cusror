---
name: React Query key collisions across pages
description: Generic entity query keys are shared app-wide; pages caching partial datasets poison other pages for 3 minutes.
---

Many pages cache entity lists under generic keys like `['communications', companyId]`, `['payments', companyId]` — but with DIFFERENT limits/filters (Dashboard fetches only the 50 newest communications; Activity 100; Leads 1000). The global query client sets `staleTime: 3 min`, so any page that reuses one of these keys silently renders whichever partial subset another page cached last — no refetch happens.

**Why:** This caused the Rep Performance page to show "Interactions: 1" in production — it reused `['communications', companyId]` right after Dashboard cached its 50-row subset there.

**How to apply:** Any page that needs a FULL dataset must namespace its query keys (e.g. `['rep-performance', 'communications', companyId]`). Conversely, don't "fix" it by raising the shared key's limit — that poisons small pages with 10k-row payloads. When a page shows mysteriously tiny/stale counts, check who else writes to the same query key before suspecting the server.

**Dashboard-specific rule:** Never let a viewport-dependent fetch limit feed a KPI query. A mobile cap can make a legitimate total look exactly like the cap (for example, two capped entity lists adding to a suspicious round number); use a complete dataset or server-side aggregates, and isolate dashboard keys from warmup caches.

**Second flavor — degraded SHAPE, not just partial rows:** the Dashboard prefetch (`useFastQuery.js` `useDashboardPrefetch`) seeds shared keys via `queryClient.setQueryData` with a hardcoded field projection. Any field the projection omits (e.g. staff `full_name`/`user_email`) is silently missing for every consumer of that key for 3 minutes → "blank rows" bugs that look like CSS (TeamChat dialog showed empty names; user asked if the text was white). If a page renders blanks only after visiting the Dashboard first, suspect the prefetch projection before styling. Keep the projection a superset of what consumers read, and strip `undefined` values so absent columns don't clobber data-JSONB values.

Related data-accuracy gotchas found in the same fix:
- `assigned_to` in prod mixes rep emails, alternate emails, AND display names (a rep's full display name); match against a lowercase identity set (user_email, email, full_name, name), never exact email only.
- `communications` table has NO `assigned_to` column (only `created_by` + lead/customer links).
- Period-range helpers that end at `new Date(y, m+1, 0)` (midnight) silently drop the whole last day; always use `23,59,59,999`. Fixed in both RepPerformance and CommissionTracking — keep mirrored.
