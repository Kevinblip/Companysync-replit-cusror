// Canonical AssistantSettings row selection + duplicate self-healing.
//
// Why this exists: a company can have MULTIPLE AssistantSettings rows:
//   - QuickSetup intentionally creates TWO rows (assistant_name 'lexi' and
//     'sarah'). The lexi row is NOT a duplicate — never delete it here.
//   - A settings page saving before its load resolved can create a stray
//     defaults-only row that silently shadows the real tuned config. On
//     July 24 this made YICN's outbound calls introduce the company as
//     "Companysync" instead of "YICN Roofing".
//   - A company may also have rows for OTHER named assistants (marcus, alex,
//     custom names). These must NEVER be selected or deleted here — Sarah
//     settings pages only manage sarah/empty rows.
//
// Rule (kept in lockstep with the server-side phone-path loaders in
// prod-server.cjs, vite-twilio-ws-plugin.js, db/prod-integrations.cjs):
//   1. Only consider Sarah rows (assistant_name 'sarah', empty, or null).
//      Lexi rows and other named assistant rows are always left untouched.
//   2. Prefer a row that was actually edited after creation (maintained =
//      the real config).
//   3. Otherwise fall back to the most recently updated row.

const EDIT_GRACE_MS = 5000;

function ts(v) {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function isLexiRow(row) {
  return String(row?.assistant_name || "").trim().toLowerCase() === "lexi";
}

// Stable discriminator for the Sarah phone-receptionist persona.
// 'alex' is intentionally NOT included — a company may have a distinct custom
// assistant named Alex that must never be treated as Sarah's settings row.
// SarahSettings now saves assistant_name='sarah' for new/updated rows.
// Legacy 'alex' rows are handled via backward-compat in the SarahSettings
// load path and migrated to 'sarah' on the next save.
const SARAH_PERSONA_NAMES = new Set(["sarah", ""]);

// Returns true for rows that belong to the Sarah phone persona:
// assistant_name is 'sarah', empty string, or absent/null.
// Any other name (alex, marcus, custom names) is a distinct assistant.
export function isSarahRow(row) {
  const name = String(row?.assistant_name || "").trim().toLowerCase();
  return SARAH_PERSONA_NAMES.has(name);
}

export function wasEditedAfterCreation(row) {
  if (!row) return false;
  const created = ts(row.created_date);
  const updated = ts(row.updated_date);
  return created > 0 && updated > created + EDIT_GRACE_MS;
}

// Returns the canonical Sarah settings row, or null if none exists
// (callers then create a fresh row rather than hijacking Lexi's or
// another assistant's row).
// ONLY considers rows where assistant_name is 'sarah', empty, or null.
// Rows for other named assistants (marcus, alex, etc.) are ignored.
export function pickCanonicalSettings(rows) {
  const list = (Array.isArray(rows) ? rows.filter(Boolean) : []).filter(
    (r) => !isLexiRow(r) && isSarahRow(r)
  );
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => {
    const editedDiff = (wasEditedAfterCreation(b) ? 1 : 0) - (wasEditedAfterCreation(a) ? 1 : 0);
    if (editedDiff !== 0) return editedDiff;
    return ts(b.updated_date) - ts(a.updated_date);
  });
  return sorted[0];
}

// Save paths must preserve the invariant of one non-Lexi Sarah settings row
// per company. Always re-read before creating so a save that beats the page's
// initial load updates the existing row instead of creating stale defaults.
// A failed read must fail the save; it must never fall through to create.
export async function upsertSarahSettings(entityApi, companyId, patch = {}) {
  if (!entityApi?.filter || !entityApi?.update || !entityApi?.create) {
    throw new Error("AssistantSettings entity API is unavailable");
  }
  if (!companyId) {
    throw new Error("Company is required to save assistant settings");
  }

  const rows = await entityApi.filter({ company_id: companyId }, "-updated_date", 50);
  const canonical = pickCanonicalSettings(rows);
  const payload = {
    ...patch,
    company_id: companyId,
    assistant_name: "sarah",
  };

  if (canonical?.id) {
    const updated = await entityApi.update(canonical.id, payload);
    return { record: updated || { ...canonical, ...payload }, created: false };
  }

  const created = await entityApi.create(payload);
  return { record: created, created: true };
}

// Deletes stray accidental-duplicate rows other than the canonical one.
// STRICT safety rules — this must never destroy real config:
//   - Lexi rows are always preserved (separate assistant, by design).
//   - Other named assistant rows (marcus, alex, custom) are always preserved.
//   - Only Sarah rows (assistant_name 'sarah', empty, or null) that were
//     NEVER edited after creation are deletable: an untouched row is by
//     definition the output of a blind default-create (the dupe signature).
//     Any row a human ever maintained is kept, even if it lost the canonical
//     race.
// Failures are swallowed (the server-side ordering rule still protects
// call paths).
export async function healDuplicateSettings(entityApi, rows, canonical) {
  if (!canonical || !Array.isArray(rows) || rows.length <= 1) return 0;
  let removed = 0;
  for (const row of rows) {
    if (
      row &&
      row.id &&
      row.id !== canonical.id &&
      !isLexiRow(row) &&
      isSarahRow(row) &&
      !wasEditedAfterCreation(row)
    ) {
      try {
        await entityApi.delete(row.id);
        removed += 1;
        console.log(`[AssistantSettings] Removed duplicate settings row ${row.id} (kept ${canonical.id})`);
      } catch (e) {
        console.warn(`[AssistantSettings] Could not remove duplicate row ${row.id}:`, e?.message);
      }
    }
  }
  return removed;
}
