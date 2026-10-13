/**
 * lib/assistantSettingsHelpers.cjs
 *
 * Shared predicates for AssistantSettings row classification and canonical
 * selection.  Used by:
 *   - scripts/dedup-assistant-settings.cjs  (one-shot DB cleanup script)
 *   - prod-server.cjs  (/api/admin/dedup-assistant-settings endpoint)
 *   - scripts/test-sarah-row-isolation.cjs  (test)
 *
 * Keep in lockstep with the ESM mirror in src/utils/assistantSettingsRecord.js
 * (the frontend utility that shares the same logic).
 *
 * SarahSettings saves assistant_name='sarah' as the stable discriminator.
 * Legacy 'alex' rows (from old SarahSettings saves) are handled in the
 * frontend load path via backward-compat detection; they are NOT classified
 * as Sarah rows here so a custom Alex assistant is never clobbered.
 */

'use strict';

const EDIT_GRACE_MS = 5000;

// Names that belong to the Sarah phone-receptionist persona.
// Only 'sarah' and '' (empty/absent) are the stable discriminators.
// 'alex' is NOT included — a company may have a distinct custom assistant
// named Alex that must never be treated as Sarah's settings row.
const SARAH_PERSONA_NAMES = new Set(['sarah', '']);

function ts(v) {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Returns true if this row belongs to the Lexi assistant.
 * Lexi rows are ALWAYS preserved and never considered for Sarah dedup.
 */
function isLexiRow(row) {
  return String(row?.assistant_name || '').trim().toLowerCase() === 'lexi';
}

/**
 * Returns true if this row belongs to the Sarah phone-receptionist persona:
 * assistant_name is 'sarah', empty string, or absent/null.
 * Any other name (alex, marcus, custom_bot, …) is a distinct third assistant.
 */
function isSarahRow(row) {
  const name = String(row?.assistant_name || '').trim().toLowerCase();
  return SARAH_PERSONA_NAMES.has(name);
}

/**
 * Returns true when a row was substantively edited after it was first created.
 * An untouched row (updated within EDIT_GRACE_MS of creation) is the signature
 * of a blank default-create race and is safe to delete if it loses the
 * canonical race.
 */
function wasEditedAfterCreation(row) {
  const created = ts(row?.created_date);
  const updated = ts(row?.updated_date);
  return created > 0 && updated > created + EDIT_GRACE_MS;
}

/**
 * Pick the canonical Sarah-persona row from a list of AssistantSettings rows.
 * Only considers rows where isSarahRow() is true (never lexi, never marcus/custom).
 * Returns null when no Sarah row exists.
 *
 * Mirrors pickCanonicalSettings() in src/utils/assistantSettingsRecord.js.
 */
function pickCanonicalSarahRow(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(
    (r) => r && !isLexiRow(r) && isSarahRow(r)
  );
  if (list.length === 0) return null;
  return [...list].sort((a, b) => {
    const editedDiff = (wasEditedAfterCreation(b) ? 1 : 0) - (wasEditedAfterCreation(a) ? 1 : 0);
    if (editedDiff !== 0) return editedDiff;
    return ts(b.updated_date) - ts(a.updated_date);
  })[0];
}

/**
 * Identify Sarah-persona rows that are safe to delete as stale duplicates.
 * A row is deletable when ALL of the following are true:
 *   - It is a Sarah row (isSarahRow)
 *   - It is not the canonical row
 *   - It was never edited after creation (wasEditedAfterCreation returns false)
 * Lexi rows and other named assistant rows (marcus, alex-custom, …) are NEVER
 * returned here.
 */
function identifyDeletableDuplicates(rows, canonical) {
  if (!canonical) return [];
  return rows.filter(
    (r) =>
      r &&
      r.id !== canonical.id &&
      !isLexiRow(r) &&
      isSarahRow(r) &&
      !wasEditedAfterCreation(r)
  );
}

/**
 * SQL clause fragment for the atomic DELETE safety check.
 * This ensures a Sarah-persona row that was edited between our SELECT and the
 * DELETE is NOT removed.  Apply as additional WHERE predicates.
 *
 * The NOT ILIKE 'lexi' guard is belt-and-suspenders; the !isLexiRow check in
 * identifyDeletableDuplicates already excludes them before we get here.
 */
const DELETE_SAFETY_WHERE_SQL = `
  AND COALESCE(data->>'assistant_name', '') NOT ILIKE 'lexi'
  AND COALESCE(data->>'assistant_name', '') = ANY($sarahNamesParam)
  AND (
    created_date IS NULL
    OR updated_date IS NULL
    OR updated_date <= created_date + interval '5 seconds'
  )`;

// The $sarahNamesParam placeholder above is illustrative; callers substitute
// the actual param index.  The concrete array to pass is exported below.
const SARAH_PERSONA_NAMES_ARRAY = Array.from(SARAH_PERSONA_NAMES);

module.exports = {
  isLexiRow,
  isSarahRow,
  wasEditedAfterCreation,
  pickCanonicalSarahRow,
  identifyDeletableDuplicates,
  SARAH_PERSONA_NAMES_ARRAY,
};
