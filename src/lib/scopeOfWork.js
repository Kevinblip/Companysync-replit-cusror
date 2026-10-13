// Scope of Work checklist helpers.
//
// A build's checklist is stored as a `scope_of_work` array directly on the
// BuildSchedule entity (JSONB). Each item is generated from either the linked
// estimate's line items, a standard per-job-type template, or added manually.
// These helpers are pure (no network / no React) so they can be unit tested.

// Built-in standard steps per job type. A company can override any job type by
// saving a ScopeTemplate entity ({ company_id, job_type, items: [...] }); the
// defaults below are what every company starts with out of the box.
export const DEFAULT_SCOPE_TEMPLATES = {
  'Roof Install': [
    'Protect landscaping & lay down tarps',
    'Tear off old roofing down to the deck',
    'Inspect & replace any damaged decking',
    'Install drip edge',
    'Install ice & water shield (valleys & eaves)',
    'Install underlayment / felt',
    'Install starter strip',
    'Install field shingles',
    'Install ridge vent / ridge cap',
    'Flash all penetrations & replace pipe boots',
    'Install step & wall flashing',
    'Roof over ALL structures on the property (house + garage + additions)',
    'Magnet sweep the whole property for nails',
    'Full cleanup & haul away all debris',
    'Final walkthrough with the homeowner',
  ],
  'Roof Replacement': [
    'Protect landscaping & lay down tarps',
    'Tear off old roofing down to the deck',
    'Inspect & replace any damaged decking',
    'Install drip edge',
    'Install ice & water shield (valleys & eaves)',
    'Install underlayment / felt',
    'Install starter strip',
    'Install field shingles',
    'Install ridge vent / ridge cap',
    'Flash all penetrations & replace pipe boots',
    'Install step & wall flashing',
    'Roof over ALL structures on the property (house + garage + additions)',
    'Magnet sweep the whole property for nails',
    'Full cleanup & haul away all debris',
    'Final walkthrough with the homeowner',
  ],
  'Roof Repair': [
    'Confirm the exact repair area & scope',
    'Photograph the damage before starting',
    'Complete the repair',
    'Check surrounding shingles & flashing',
    'Photograph the completed repair',
    'Cleanup & magnet sweep',
  ],
  'Siding': [
    'Protect landscaping',
    'Tear off old siding',
    'Inspect & repair sheathing / wrap',
    'Install house wrap',
    'Install siding on ALL elevations',
    'Install trim, J-channel & corners',
    'Reinstall fixtures & accessories',
    'Cleanup & magnet sweep',
    'Final walkthrough with the homeowner',
  ],
  'Gutters': [
    'Confirm measurements',
    'Remove old gutters (if applicable)',
    'Install gutters & downspouts',
    'Check slope & water drainage',
    'Cleanup',
  ],
  'Windows': [
    'Confirm window sizes & count',
    'Remove old windows',
    'Install & flash new windows',
    'Insulate & seal',
    'Install interior/exterior trim',
    'Cleanup & final walkthrough',
  ],
  'Inspection': [
    'Inspect roof & exterior',
    'Photograph all sides & every roof section',
    'Document all damage found',
    'Review findings with the homeowner',
  ],
  'Emergency Repair': [
    'Make the site safe',
    'Add temporary protection (tarp / board-up)',
    'Photograph the damage',
    'Document everything for insurance',
    'Schedule the permanent repair',
  ],
  'Other': [
    'Confirm scope with the customer',
    'Complete the work',
    'Cleanup',
    'Final walkthrough with the homeowner',
  ],
};

// The punch list is the same checklist machinery as the build scope, stored in
// the same `scope_of_work` array, but it is COUNTED SEPARATELY: punch items are
// close-out work added after the crew is done, so they must never make finished
// build work look unfinished (see scopeProgress / punchProgress below).
export const PUNCH_CATEGORY = 'punch';

export const SCOPE_CATEGORY_LABELS = {
  estimate: 'From the estimate',
  template: 'Standard steps',
  manual: 'Added manually',
  punch: 'Punch list',
};

export function isPunchItem(item) {
  return (item?.category || 'manual') === PUNCH_CATEGORY;
}

// The build's own scope of work (everything that is not a punch item).
export function buildScopeItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((i) => !isPunchItem(i));
}

// Just the punch list.
export function punchListItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((i) => isPunchItem(i));
}

// Normalize a label so near-duplicates collapse (case / punctuation / spacing).
export function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function genId() {
  return (
    'sow_' +
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36).slice(-4)
  );
}

export function makeScopeItem({
  label,
  category = 'manual',
  source_ref = '',
  source_estimate_id = '',
  source_estimate_number = '',
}) {
  return {
    id: genId(),
    label: String(label || '').trim(),
    category,
    source_ref: source_ref || '',
    source_estimate_id: source_estimate_id || '',
    source_estimate_number: source_estimate_number || '',
    completed: false,
    completed_by: '',
    completed_at: '',
    photo_urls: [],
    notes: '',
    created_at: new Date().toISOString(),
  };
}

// Turn an estimate's line items into scope items (deduped within the estimate).
export function estimateItemsToScopeItems(estimate) {
  if (!estimate || !Array.isArray(estimate.items)) return [];
  const num =
    estimate.estimate_number ||
    estimate.number ||
    estimate.claim_number ||
    '';
  const seen = new Set();
  const out = [];
  for (const it of estimate.items) {
    const label = String(it?.description || it?.name || it?.code || '').trim();
    if (!label) continue;
    const norm = normalizeLabel(label);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(
      makeScopeItem({
        label,
        category: 'estimate',
        source_ref: it?.code || '',
        source_estimate_id: estimate.id || '',
        source_estimate_number: num,
      }),
    );
  }
  return out;
}

// Build template items for the selected job types (deduped across types).
export function templateItemsForJobTypes(jobTypes = [], customTemplates = {}) {
  const types = Array.isArray(jobTypes) ? jobTypes : jobTypes ? [jobTypes] : [];
  const seen = new Set();
  const out = [];
  for (const jt of types) {
    const labels =
      (customTemplates && Array.isArray(customTemplates[jt]) && customTemplates[jt]) ||
      DEFAULT_SCOPE_TEMPLATES[jt] ||
      [];
    for (const label of labels) {
      const clean = String(label || '').trim();
      const norm = normalizeLabel(clean);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(makeScopeItem({ label: clean, category: 'template', source_ref: jt }));
    }
  }
  return out;
}

// Merge freshly generated items with the existing checklist, preserving the
// completed state / photos / notes / id of any item whose label already exists.
// Unmatched existing items are kept ONLY when they are staff-entered (manual or
// punch) or already completed (real work / photo proof worth keeping) — this
// drops stale uncompleted estimate/template items when the source estimate or
// job type changes, so the completion warning never nags about work no longer
// in scope.
//
// Punch items are held completely OUT of that matching. They are staff-entered
// close-out work that is never produced by an estimate or a template, so:
//   - they are never absorbed by a generated row that happens to share their
//     label (that would silently reclassify the punch item as build scope and
//     reopen the build's progress badge and completion gate), and
//   - they always survive a regeneration, even uncompleted, so "Refresh from
//     estimate" can never delete the punch list.
export function mergeScopeItems(existing = [], generated = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const generatedList = Array.isArray(generated) ? generated : [];

  const existingPunch = existingList.filter(isPunchItem);
  const existingScope = existingList.filter((i) => !isPunchItem(i));

  const existingByNorm = new Map();
  for (const item of existingScope) {
    const norm = normalizeLabel(item.label);
    if (norm && !existingByNorm.has(norm)) existingByNorm.set(norm, item);
  }

  const result = [];
  const usedNorms = new Set();

  for (const gen of generatedList) {
    const norm = normalizeLabel(gen.label);
    if (!norm || usedNorms.has(norm)) continue;
    usedNorms.add(norm);
    const prior = existingByNorm.get(norm);
    if (prior) {
      result.push({
        ...gen,
        id: prior.id || gen.id,
        completed: !!prior.completed,
        completed_by: prior.completed_by || '',
        completed_at: prior.completed_at || '',
        photo_urls: Array.isArray(prior.photo_urls) ? prior.photo_urls : [],
        notes: prior.notes || gen.notes || '',
        created_at: prior.created_at || gen.created_at,
      });
    } else {
      result.push(gen);
    }
  }

  // Keep unmatched existing build items only when they are manual additions or
  // already completed (real work / photos worth keeping). Uncompleted
  // estimate/template items that are no longer generated are dropped as stale.
  for (const item of existingScope) {
    const norm = normalizeLabel(item.label);
    if (!norm || usedNorms.has(norm)) continue;
    const keep = item.category === 'manual' || !!item.completed;
    if (!keep) continue;
    usedNorms.add(norm);
    result.push(item);
  }

  // Punch items always survive, unconditionally. They are only deduped against
  // each other — never against generated build scope.
  const punchNorms = new Set();
  for (const item of existingPunch) {
    const norm = normalizeLabel(item.label);
    if (!norm || punchNorms.has(norm)) continue;
    punchNorms.add(norm);
    result.push(item);
  }

  return result;
}

// Toggle a single item's completed state, stamping who/when.
export function toggleScopeItem(items = [], id, user) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item.id !== id) return item;
    const nowCompleted = !item.completed;
    return {
      ...item,
      completed: nowCompleted,
      completed_by: nowCompleted ? user?.email || user?.full_name || 'staff' : '',
      completed_at: nowCompleted ? new Date().toISOString() : '',
    };
  });
}

// Progress over the BUILD scope only. Punch items are deliberately excluded so
// that a punch item raised after the crew finished does not reopen the build's
// progress badge or trip the "some work isn't checked off yet" completion gate.
// Use punchProgress() for the punch list.
export function scopeProgress(items = []) {
  const list = buildScopeItems(items);
  const total = list.length;
  const done = list.filter((i) => i.completed).length;
  const incomplete = list.filter((i) => !i.completed);
  return {
    total,
    done,
    remaining: total - done,
    incompleteLabels: incomplete.map((i) => i.label),
    allDone: total > 0 && done === total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

// Progress over the punch list only. Same shape as scopeProgress so callers can
// render it with the same badge/indicator logic.
export function punchProgress(items = []) {
  const list = punchListItems(items);
  const total = list.length;
  const done = list.filter((i) => i.completed).length;
  const incomplete = list.filter((i) => !i.completed);
  return {
    total,
    done,
    remaining: total - done,
    incompleteLabels: incomplete.map((i) => i.label),
    allDone: total > 0 && done === total,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}
