---
name: Contract e-sign — freeze wording + required fields + Completed status
description: How the "doc you edit = doc they sign" guarantee, per-field required toggles, and reliable Completed status are wired across dev/prod for the contract e-signature flow.
---

# Contract e-signature: freeze, fields, and Completed status

Three owner complaints and their real root causes (all fixed):

## 1. "Can't mark fields required vs optional"
**Root cause:** `src/pages/ContractFieldEditor.jsx` (a complete field manager WITH a Required
checkbox, field types, filled-by) was **orphaned** — registered in `pages.config.js` but
nothing ever navigated to it. The feature existed; it was just unreachable.
**Fix / how to apply:** reach it via a "Fields" button on every template card in
`ContractTemplates.jsx` → `navigate(createPageUrl('ContractFieldEditor')+'?templateId='+id)`.
Field data path: ContractFieldEditor saves `ContractTemplate.fillable_fields` →
`createSessionMutation` copies `selectedTemplate.fillable_fields` into the session →
get-signing-session (falls back to template list if session's is empty) →
`sign-contract-customer.jsx` already enforces `field.required`. Contingency has no PDF, so
ContractFieldEditor must render a graceful non-PDF panel when `!template.original_file_url`.

## 2. "Signed contracts don't show Completed"
**Root cause:** duplicate `signing_sessions` rows for one contract; only the token row got
marked completed. **Fix:** after marking completed, a sibling-propagation UPDATE marks
duplicate rows completed too — keyed by `id::text`/`base44_session_id` linkage, company-scoped,
`WHERE status NOT IN ('completed','declined')` (never flip a declined dup). Plus display-time
dedupe in `ContractSigning.jsx` (group by `base44_session_id ?? id`, keep most-advanced status)
so legacy dups collapse without a prod data migration (prod DB is read-only to the agent).

## 3. "Editing warranty wording (e.g. siding years) doesn't save/take effect"
**Root cause A (edit didn't persist visually):** `EditableBlock` in `ContractEditor.jsx` had
`useEffect(..., [])` — the uncontrolled `contentEditable` never re-synced when DB content
loaded **asynchronously after mount**, so the owner saw DEFAULT_CONTENT and a Save clobbered
the DB with defaults. **Fix:** deps `[value]`, keep the `innerText !== value` guard (onChange
fires only on blur, so no caret jump).
**Root cause B (edit didn't reach the signed doc):** wording lives in the
`ContractEditorContent` silo (per-company `data.content` = `JSON.stringify(blocks)`); a sent
contract must not change if the template is later edited.

## Freeze mechanism — `resolveSessionHtml(pool, s, sessionData)`
Added `signing_sessions.html_content TEXT` (runtime `ALTER ... IF NOT EXISTS` in both
`db/schema.js` and `db/prod-db.cjs`). Helper is **byte-identical in `vite-signing-plugin.js`
(dev) and `prod-server.cjs` (prod)** — keep them in lockstep. Order: existing snapshot →
`ContractTemplate.html_content` → contingency silo → backfill (`UPDATE ... WHERE html_content
IS NULL`, idempotent) so it freezes at first read. Called on send (freeze) and returned by
get-signing-session (replaces prod's old always-live silo lookup).

**Why the guards matter (both required by architect):**
- Silo fallback must match `name.includes('contingency')` **AND `!s.original_file_url`** — the
  earlier `'contract'` match would freeze contingency text into an uploaded PDF template named
  e.g. "Roofing Contract" and render it INSTEAD of the PDF, permanently via backfill.
- Only accept **JSON-block-shaped** content (`isJsonBlocks`): `ContractHtmlRenderer`
  `JSON.parse`s and silently falls back to hardcoded YICN DEFAULT_CONTENT on non-JSON → wrong
  company's legal text. Handle content-as-object by stringifying before the check.

**Descoped (not among the 3 complaints):** company-ownership check on send-signing-link;
customer signed-copy email on completion.
