---
name: Lexi tool handlers (multi-surface lockstep)
description: Lexi tool behavior must be applied across all live handler surfaces or one surface silently diverges; manage_entity changes need six sites.
---

# Lexi tool handlers — keep all surfaces in lockstep
Lexi's tool logic is duplicated across six live surfaces: four CJS/plugin handlers (dev text, dev voice, prod text, prod voice) **plus** `functions/lexiChat.ts` and `functions/lexiBridgeAPI.ts`. Any behavioral change — normalizer, privilege guard, schema fix — must be applied in all six or the affected surface silently diverges with no error at deploy time.

**Why:** Dev runs vite plugins; production runs CJS files; Deno functions serve their own live paths. Missing a surface produces a silent no-op or crash only visible in that specific entry point.

**How to apply:** Before shipping any manage_entity or tool change, grep for the tool name across all six surfaces. If an import is needed (e.g. `isExpenseEntity`, `normalizeGenericEntityData`) it must be present in every file that calls it — a missing import throws a ReferenceError only at runtime under the affected call path.

# Generic-entity schema normalization (manage_entity writes)
`manage_entity` inserts whatever field names the LLM invents straight into `generic_entities`; aliases, missing fields, and wrong JSON types can otherwise crash any page that assumes its entity schema.
**Rule:** normalize Expense, CustomerNote, Document, Communication, and Workflow schemas at EVERY manage_entity generic create AND update path via the shared CJS normalizer and its TS mirror; keep both mirrors and all six handlers in lockstep. Canonicalize singular/plural aliases too, especially `note` → `CustomerNote`, so AI writes do not fork invisible entity types.
**Why:** prompt instructions do not constrain tool JSON reliably, and old rows may already contain aliases. Shared server normalization prevents new malformed records while defensive rendering keeps legacy rows from taking down a page.
**How to apply:** create paths pass `{ applyDefaults: true }`; update paths normalize the FULL merged object (fetch-merge-normalize, not a shallow patch) so updates heal legacy aliases. Renderers must still type-check strings and validate dates before `.replace`, `.toString`, or `format(new Date(...))`.

# Canonical tool set (all 4 handlers verified in sync)
get_crm_data, get_calendar_events, create_calendar_event, create_task, create_lead,
create_customer, send_email, send_sms, manage_entity, assign_inspection,
get_storm_alerts, find_subcontractors, add_staff_member, get_activity_log,
get_financial_summary, add_note, get_photosync_jobs, add_family_commission_member,
get_staff_sales_summary, scan_check (text handlers), save_memory, plus the 4 Gmail inbox tools:
read_emails, get_email, reply_to_email, mark_email_read

# save_memory (personal preference auto-save)
- Present in ALL FOUR handlers. Writes generic_entities AIMemory (explicit id, data JSONB with company_id, user_email, key, value, importance 1-10, category, is_active:true, source:'lexi_auto').
- category is force-remapped away from 'company'/'estimator_calibration'/'job_calibration' — a user must never be able to plant a company-wide or calibration memory via chat.
- user_email MUST come from the authenticated session (dev text: authz.caller.email; prod text: caller.email; voice: session-verified userEmail) — client body params.userEmail is a forgeable teammate-poisoning vector; both text handleLexiChat copies now derive effectiveEmail session-first.
- e2e: scripts/test-lexi-save-memory.cjs (forged session + deliberately forged body userEmail; asserts row lands under session email).

# Gmail inbox tools (owner-connected OAuth)
- All 4 Gmail tools resolve the company's token via a shared per-file `getGmailTokenForCompany*` helper (users table gmail_* columns, auto-refresh); if not connected every tool returns `{ error: 'Gmail is not connected.' }` and the prompt tells the user to connect in Settings.
- Connect is owner-only (companies.created_by check) via the `connectGmailForLexi` function handler (registered once, serves dev+prod) returning `{ authUrl }`; `/api/gmail-auth` (GET, session-authed, 302→Google) and `/api/gmail-callback` are HTTP routes that MUST be mirrored in vite-functions-plugin.js AND prod-server.cjs (route mirroring rule, unlike functionHandlers).
- OAuth state is HMAC-signed with GOOGLE_CLIENT_SECRET, 10-min expiry.

# Parameter parity — keep these aligned across all 4
- `get_crm_data`: supports optional `filters` object (city/state/status/assigned_to/lead_source) for leads; city/state for customers. Non-filterable types (invoices, tasks, staff, etc.) fall through to count+sample path.
- `create_calendar_event`: supports email_reminder_minutes, sms_reminder_minutes, browser_reminder_minutes; handler inserts into calendar_events columns send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes (columns exist in shared PostgreSQL).

# "Lexi lies" = created rows are INVISIBLE, not missing — set assigned_to to the creator
A frequent "Lexi claims she did it but nothing shows up" report is NOT a failed tool call — the row IS persisted, but a default "Mine" view filters it out. Calendar.jsx defaults `calendarViewMode='mine'` and (before fix) showed only `assigned_to === user.email`; tasks/leads "mine" counts filter the same way. Any Lexi create-tool that leaves `assigned_to` NULL produces rows that are hidden even from the admin who asked for them.
**Rule:** every Lexi create-tool that writes an ownable entity (calendar_events, tasks, …) must set `assigned_to` to the creator's email (or resolved assignee) — the DEV handlers already did this; PROD (`prod-server.cjs`) was the lockstep gap for `create_calendar_event` (assigned_to NULL) and `create_task` (NULL unless specified). 
**Defense in depth:** a "Mine" filter should also surface UNASSIGNED rows the user created: `assigned_to === me || (!assigned_to && created_by === me)` — recovers already-orphaned rows without a prod data migration, without leaking delegated-to-others rows.

# Privilege escalation: hardening add_staff_member is NOT enough
Admin rights are granted by the `staff_profiles` columns `is_administrator` / `is_super_admin`, AND in several code paths by `role IN ('admin','owner')`. The generic `manage_entity` CRUD tool maps `StaffProfile`/`staff` → `staff_profiles` and (before this fix) accepted arbitrary columns, so Lexi could create/update a staff row with `is_administrator=true` (or `role='admin'`) even though the dedicated `add_staff_member` tool force-sets non-admin.

**Rule:** Any generic/CRUD AI tool that can target `staff_profiles` must block staff create/update/delete entirely (list is fine) — do NOT rely on field-stripping alone, because the `role='admin'/'owner'` path also escalates. Staff creation must go only through the hardened `add_staff_member` (which forces `is_administrator=false`); role/admin changes are UI-only.

**How to apply:** In every Lexi `manage_entity` handler, guard the resolved table: if it's `staff_profiles` (or entity name normalizes to staff) and the action is not `list`, return a friendly "can't manage staff directly" error.

# Assigning a rep/owner to a lead/customer via manage_entity
Lexi must put rep assignments on the REAL field, not notes. The `manage_entity` handlers (dev `vite-functions-plugin.js`, prod `prod-server.cjs` — lockstep) resolve `entity_data.assigned_to`: if it's a name (no `@`), look it up in `staff_profiles` by `full_name` (exact match preferred, else ILIKE — escape `%`/`_`/`\`), scoped by company_id; then sync `assigned_to_users = [email]` when a real email is set. The "Assigned To" UI uses `assigned_to` (scalar) + `assigned_to_users` (text[]) on the `leads`/`customers` tables.
**Why:** users ask Lexi "assign Brian to this lead"; without resolution she dumps the name into notes (or writes a raw non-email string into `assigned_to`, which the UI can't match).
**How to apply:** zero matches OR >1 ambiguous match must return a tool error (so Lexi asks the user / lists candidates) — never write the raw name. The prompt rule alone is insufficient; the server-side guard is the source of truth. Same first name can match multiple staff (e.g. two "Brian"s), so ambiguity handling is required, not optional.

# Minor conventions for these handlers
- `get_activity_log` limit must be clamped both ends: `Math.max(1, Math.min(limit||20, 50))` (negative/0 otherwise yields empty slice).
- `add_note` writes a `CustomerNote` generic_entity (`source_type` 'lexi'/'lexi_voice'); validate any directly-supplied `customer_id`/`lead_id` against the caller's company (use `id::text = $1` to avoid int-cast errors) before insert, else you get orphan/misattributed notes.
