---
name: Color Visualizer save (updated_at, honest DB writes)
description: Why saved color visualizations silently vanished — wrong timestamp column + a log-only try/catch that returned success anyway.
---

## The bug
The `generateColorVisualization` / `deleteColorVisualization` handlers persisted to `customers`/`leads` via raw SQL that set `updated_date=NOW()`. Those tables have **`updated_at`, not `updated_date`** (that column name only exists on `generic_entities`). Every UPDATE threw `column "updated_date" does not exist`.

The throw was caught by a try/catch that **only `console.error`'d and then returned `{ success: true }` anyway**. So the AI image generated and stored fine (object storage + `public/uploads`), the UI toasted "Visualization saved!", but nothing was linked to the customer → panel always showed "No color visualizations yet". Orphaned images can't be recovered (no customer/color link); user must regenerate after the fix.

**Why it hid for so long:** the earlier 404 (wrong model name) masked this second bug — you couldn't reach the save path until the model name was fixed.

## The rules
- `customers` and `leads` dedicated tables use `updated_at`. Only `generic_entities` uses `updated_date`. Don't copy `updated_date` into a customers/leads UPDATE.
- **A DB write wrapped in a log-only try/catch lies to the UI.** For a persist that the user is told "saved", check `result.rowCount` and return `{ success:false, error }` on 0 rows or on throw. A 0-row UPDATE (id/company_id mismatch) is just as much a failure as an exception.
- Read path is fine: dev `vite-db-plugin.js` genericGet/genericFilter returns dedicated-table rows with the `data` JSONB BOTH nested (`customer.data.color_visualizations`) AND spread to top-level for non-column keys (`customer.color_visualizations`). The panel reads `entity.data.color_visualizations` — works.
- Frontend invalidation: panel is passed `queryKey={['customer', customerId]}` while the query key is `['customer', customerId, customerNameFromUrl]`; TanStack Query v5 `invalidateQueries` prefix-matches, so the shorter key still refetches. Fine.
- Handler is shared dev+prod via prod-integrations `getFunctionHandlers` — one edit covers both, but **prod only picks it up on republish**.

## The upgrade (interactive homeowner share link + hybrid AI cost)
There are now **two** generate paths that must stay in lockstep on prompt, cap, and metering:
- `generateColorVisualization` — contractor, session-authed.
- `generateColorVisualizationPublic` — anonymous homeowner via a **share link**, authed by an **HMAC token only** (`createHmac('sha256', SESSION_SECRET).update('colorviz:'+entityId)`, base64url, `timingSafeEqual` with a length guard). No session.
- Plus a **public GET route** that IS mirrored in `prod-server.cjs` (unlike handlers, which aren't) — the one place you must edit prod too.

**Authorize by the entity row, never the client.** `authorizeColorVizEntity(req, entityType, entityId)` derives `companyId` from the customer/lead row and checks membership (companies.created_by / staff_profiles, super-admin bypass). Fixed an IDOR where generate/share/delete trusted a client-supplied `companyId`.

**Per-link cap is atomic, reserve-before-spend.** The 10-try cap is enforced by `UPDATE ... SET uses=uses+1 WHERE uses < cap RETURNING` **before** the paid Gemini call, so parallel clicks can't each spend. Refund via `decrementUse` (GREATEST(...,0)) on **every** failure path after the reserve. The response's remaining-tries count must increase only when that refund succeeds; returning the pre-refund count at the cap leaves the UI blocked even though the database allows another try.

**Hybrid metering rule (BYOK = free):** `getCompanyGeminiKeyInfo(companyId) -> {key, isOwn}`. If `isOwn` (company brought its own key): skip `checkAIUsage`, log `'ai_byok'` (NOT in `AI_USAGE_FEATURES` → doesn't count toward the plan limit, cost 0, logged only for visibility). Else: `checkAIUsage` gate then log `'ai'` (IS in `AI_USAGE_FEATURES` → counts, $0.04). `checkAIUsage` is a **pure SUM read**; `logUsageEvent` is the **only** recorder — never let both record or you double-count. Meter the **subscriber (owner)**, not the anonymous homeowner.

**Known bounded gap:** homeowner `colorScheme` values are free-text interpolated into the prompt (prompt-injectable), but impact is capped at 10 tries/link and still metered — not worth duplicating the palette server-side.
