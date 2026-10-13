/**
 * Where should a document (estimate, proposal, ...) send you when you click the
 * customer name on it?
 *
 * The subject of an estimate or proposal is not always a Customer. It is often
 * still a Lead, and a lot of older records only ever stored the name — no
 * customer_id, no lead_id. Linking straight to the customer page with a bare
 * name dead-ends on "Customer not found" for anyone who isn't a customer yet.
 *
 * Resolution order, strongest evidence first:
 *   1. customer_id  — an explicit link to a customer record, open it
 *   2. a name       — hand it to CustomerProfile, which searches customers AND
 *                     leads together. Any lead_id rides along as a hint, used
 *                     only if the name matches nobody (converting a lead leaves
 *                     a dead lead_id behind but creates a customer of the same
 *                     name, so the name is the better evidence of the two).
 *   3. lead_id      — no name at all, but an explicit link to a lead
 *
 * Names are NEVER resolved to a record here. Only CustomerProfile can do that,
 * because it is the one place that sees both customers and leads, and duplicate
 * names are common in real books — two "Linda Hall" records, the same person
 * entered twice, a customer and a lead who share a name. Opening the wrong file
 * shows the wrong invoices, payments and history, so when a name is not
 * decisive the user is asked which one was meant.
 */

export function normalizeName(value) {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Every record in `list` whose name normalizes to the same thing as `name`. */
export function findNameMatches(name, list = []) {
  const key = normalizeName(name);
  if (!key) return [];
  return (list || []).filter(r => r?.id && normalizeName(r?.name) === key);
}

export function resolveContactTarget(record) {
  if (!record) return null;

  if (record.customer_id) {
    return { page: 'CustomerProfile', params: { id: record.customer_id } };
  }

  const rawName = (record.customer_name || '').trim();
  if (rawName) {
    const params = { name: rawName };
    if (record.lead_id) params.lead_id = record.lead_id;
    return { page: 'CustomerProfile', params };
  }

  if (record.lead_id) {
    return { page: 'LeadProfile', params: { id: record.lead_id } };
  }

  return null;
}

/**
 * Keep only true name matches out of a loose (ILIKE) search, tagged by kind and
 * deduplicated. A loose search for "Yolanda" also returns "Yolanda Homes"; only
 * an exact normalized match counts as the same person.
 *
 * groups: [{ kind: 'customer', rows: [...] }, { kind: 'lead', rows: [...] }]
 */
export function collectNameCandidates(name, groups) {
  const key = normalizeName(name);
  if (!key) return [];
  const out = [];
  const seen = new Set();
  for (const group of groups || []) {
    for (const row of group?.rows || []) {
      if (!row?.id || normalizeName(row.name) !== key) continue;
      const dedupeKey = `${group.kind}:${row.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ id: row.id, name: row.name, kind: group.kind });
    }
  }
  return out;
}

/**
 * What should the profile page do with the records that match a name?
 *   'open'   — exactly one record, go straight to it
 *   'choose' — more than one, ask which; never guess
 *   'none'   — nobody by that name
 */
export function classifyNameCandidates(candidates) {
  const list = (candidates || []).filter(c => c?.id);
  if (list.length === 0) return { action: 'none', candidates: [] };
  if (list.length === 1) {
    const only = list[0];
    return {
      action: 'open',
      target: {
        page: only.kind === 'lead' ? 'LeadProfile' : 'CustomerProfile',
        params: { id: only.id },
      },
      candidates: list,
    };
  }
  return { action: 'choose', candidates: list };
}

/** Build the query string for a resolved target. */
export function contactTargetQuery(target) {
  if (!target) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(target.params || {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
