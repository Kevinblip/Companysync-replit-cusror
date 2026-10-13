/**
 * Unit tests for the Scope of Work checklist helpers.
 *
 * These import the SAME pure helpers that BuildSchedule.jsx uses to generate,
 * merge, toggle, and measure the per-build checklist, so any regression in the
 * production logic is caught here.
 *
 * Helpers under test (src/lib/scopeOfWork.js):
 *   - normalizeLabel            (near-duplicate collapsing)
 *   - estimateItemsToScopeItems (estimate line items → check items)
 *   - templateItemsForJobTypes  (standard steps per job type, custom override)
 *   - mergeScopeItems           (preserve completed/photos on refresh)
 *   - toggleScopeItem           (toggle + who/when stamp)
 *   - scopeProgress             (completion gate math)
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCOPE_TEMPLATES,
  normalizeLabel,
  makeScopeItem,
  estimateItemsToScopeItems,
  templateItemsForJobTypes,
  mergeScopeItems,
  toggleScopeItem,
  scopeProgress,
  punchProgress,
  buildScopeItems,
  punchListItems,
  isPunchItem,
  PUNCH_CATEGORY,
} from '@/lib/scopeOfWork';

describe('normalizeLabel', () => {
  it('collapses case, punctuation, and spacing so near-duplicates match', () => {
    expect(normalizeLabel('Install Drip Edge')).toBe('install drip edge');
    expect(normalizeLabel('  install   drip-edge!! ')).toBe('install drip edge');
    expect(normalizeLabel('Install Drip Edge')).toBe(normalizeLabel('install drip-edge'));
  });
  it('handles empty / nullish input', () => {
    expect(normalizeLabel('')).toBe('');
    expect(normalizeLabel(null)).toBe('');
    expect(normalizeLabel(undefined)).toBe('');
  });
});

describe('estimateItemsToScopeItems', () => {
  it('converts line items to estimate-category check items with source refs', () => {
    const estimate = {
      id: 'est_1',
      estimate_number: 'EST-100',
      items: [
        { code: 'RFG240', description: 'Laminated shingles', quantity: 30, unit: 'SQ' },
        { code: 'RFG-DRIP', description: 'Drip edge', quantity: 200, unit: 'LF' },
      ],
    };
    const out = estimateItemsToScopeItems(estimate);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      label: 'Laminated shingles',
      category: 'estimate',
      source_ref: 'RFG240',
      source_estimate_id: 'est_1',
      source_estimate_number: 'EST-100',
      completed: false,
    });
    expect(Array.isArray(out[0].photo_urls)).toBe(true);
  });

  it('dedupes duplicate descriptions and skips blank ones', () => {
    const estimate = {
      id: 'est_2',
      items: [
        { description: 'Drip edge' },
        { description: 'drip  edge' }, // duplicate after normalize
        { description: '' }, // blank → skipped
        { description: '   ' }, // whitespace → skipped
        { code: 'X99' }, // no description but has code → used as label
      ],
    };
    const out = estimateItemsToScopeItems(estimate);
    expect(out.map((i) => i.label)).toEqual(['Drip edge', 'X99']);
  });

  it('returns [] for a missing or itemless estimate', () => {
    expect(estimateItemsToScopeItems(null)).toEqual([]);
    expect(estimateItemsToScopeItems({ id: 'x' })).toEqual([]);
    expect(estimateItemsToScopeItems({ id: 'x', items: [] })).toEqual([]);
  });
});

describe('templateItemsForJobTypes', () => {
  it('uses built-in defaults and includes the "all structures" garage safeguard for Roof Install', () => {
    const out = templateItemsForJobTypes(['Roof Install']);
    const labels = out.map((i) => i.label);
    expect(labels.length).toBe(DEFAULT_SCOPE_TEMPLATES['Roof Install'].length);
    expect(labels.some((l) => /ALL structures/i.test(l))).toBe(true);
    expect(out.every((i) => i.category === 'template')).toBe(true);
    expect(out[0].source_ref).toBe('Roof Install');
  });

  it('dedupes overlapping steps across multiple job types', () => {
    const out = templateItemsForJobTypes(['Roof Install', 'Roof Replacement']);
    const norms = out.map((i) => normalizeLabel(i.label));
    expect(new Set(norms).size).toBe(norms.length); // no dupes
  });

  it('prefers a company custom template over the default for that job type', () => {
    const custom = { Gutters: ['Custom step A', 'Custom step B'] };
    const out = templateItemsForJobTypes(['Gutters'], custom);
    expect(out.map((i) => i.label)).toEqual(['Custom step A', 'Custom step B']);
  });

  it('accepts a single job-type string and unknown types gracefully', () => {
    expect(templateItemsForJobTypes('Gutters').length).toBe(DEFAULT_SCOPE_TEMPLATES.Gutters.length);
    expect(templateItemsForJobTypes(['NotARealType'])).toEqual([]);
  });
});

describe('mergeScopeItems', () => {
  it('preserves completed state, photos, notes, and id when refreshing', () => {
    const existing = [
      {
        id: 'keep-1',
        label: 'Drip edge',
        category: 'estimate',
        completed: true,
        completed_by: 'boss@yicn.com',
        completed_at: '2026-06-01T00:00:00.000Z',
        photo_urls: ['https://x/photo.jpg'],
        notes: 'looked good',
        created_at: '2026-05-01T00:00:00.000Z',
      },
    ];
    const generated = [makeScopeItem({ label: 'drip  edge', category: 'template' })];
    const merged = mergeScopeItems(existing, generated);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'keep-1',
      completed: true,
      completed_by: 'boss@yicn.com',
      photo_urls: ['https://x/photo.jpg'],
      notes: 'looked good',
    });
  });

  it('keeps manual items that are not part of the generated set', () => {
    const existing = [makeScopeItem({ label: 'Move the RV out of the driveway', category: 'manual' })];
    const generated = [makeScopeItem({ label: 'Install field shingles', category: 'template' })];
    const merged = mergeScopeItems(existing, generated);
    const labels = merged.map((i) => i.label);
    expect(labels).toContain('Move the RV out of the driveway');
    expect(labels).toContain('Install field shingles');
  });

  it('does not create duplicates across estimate and template sources', () => {
    const generated = [
      makeScopeItem({ label: 'Install drip edge', category: 'estimate' }),
      makeScopeItem({ label: 'install DRIP edge', category: 'template' }),
    ];
    const merged = mergeScopeItems([], generated);
    expect(merged).toHaveLength(1);
    expect(merged[0].category).toBe('estimate'); // first one wins
  });

  it('drops stale UNCOMPLETED estimate/template items when the source changes', () => {
    const existing = [
      makeScopeItem({ label: 'Old estimate line', category: 'estimate' }),
      makeScopeItem({ label: 'Old template step', category: 'template' }),
    ];
    const generated = [makeScopeItem({ label: 'New estimate line', category: 'estimate' })];
    const merged = mergeScopeItems(existing, generated);
    expect(merged.map((i) => i.label)).toEqual(['New estimate line']);
  });

  it('keeps an unmatched COMPLETED item (real work / photo proof) even if no longer generated', () => {
    const existing = [
      {
        ...makeScopeItem({ label: 'Extra decking replaced', category: 'estimate' }),
        completed: true,
        photo_urls: ['https://x/deck.jpg'],
      },
    ];
    const generated = [makeScopeItem({ label: 'Install field shingles', category: 'template' })];
    const merged = mergeScopeItems(existing, generated);
    const labels = merged.map((i) => i.label);
    expect(labels).toContain('Extra decking replaced');
    expect(labels).toContain('Install field shingles');
  });

  it('is safe with empty inputs', () => {
    expect(mergeScopeItems()).toEqual([]);
    expect(mergeScopeItems(null, null)).toEqual([]);
  });

  it('NEVER drops punch items on a regeneration, even uncompleted ones', () => {
    // Punch items are staff-entered close-out work and are never produced by
    // estimateItemsToScopeItems / templateItemsForJobTypes. If the merge treated
    // them like stale estimate rows, "Refresh from estimate" would silently
    // delete the whole punch list.
    const existing = [
      makeScopeItem({ label: 'Old estimate line', category: 'estimate' }),
      makeScopeItem({ label: 'Touch up paint on the fascia', category: PUNCH_CATEGORY }),
      makeScopeItem({ label: 'Replace bent downspout elbow', category: PUNCH_CATEGORY }),
    ];
    const generated = [makeScopeItem({ label: 'New estimate line', category: 'estimate' })];
    const merged = mergeScopeItems(existing, generated);
    const labels = merged.map((i) => i.label);

    expect(labels).toContain('Touch up paint on the fascia');
    expect(labels).toContain('Replace bent downspout elbow');
    expect(labels).toContain('New estimate line');
    expect(labels).not.toContain('Old estimate line'); // stale estimate row still drops
    expect(punchListItems(merged)).toHaveLength(2);
  });

  it('never lets a generated build item absorb a punch item that shares its label', () => {
    // "Final walkthrough with the homeowner" is a standard template step AND a
    // plausible punch item. If the merge deduped them, the punch row would be
    // rewritten as a template row: it would vanish from the punch list and, if
    // incomplete, reopen the build's progress badge and completion gate.
    const punchItem = {
      ...makeScopeItem({ label: 'Final walkthrough with the homeowner', category: PUNCH_CATEGORY }),
      completed: false,
      photo_urls: ['https://x/walk.jpg'],
      notes: 'homeowner wants the gutter re-checked',
    };
    const existing = [
      { ...makeScopeItem({ label: 'Install field shingles', category: 'template' }), completed: true },
      punchItem,
    ];
    const generated = [
      makeScopeItem({ label: 'Install field shingles', category: 'template' }),
      makeScopeItem({ label: 'Final walkthrough with the homeowner', category: 'template' }),
    ];
    const merged = mergeScopeItems(existing, generated);

    // Two distinct rows: the generated build step AND the staff punch item.
    const walkthroughs = merged.filter(
      (i) => normalizeLabel(i.label) === normalizeLabel('Final walkthrough with the homeowner'),
    );
    expect(walkthroughs).toHaveLength(2);
    expect(walkthroughs.filter(isPunchItem)).toHaveLength(1);

    const survivingPunch = merged.find((i) => i.id === punchItem.id);
    expect(survivingPunch).toBeTruthy();
    expect(survivingPunch.category).toBe(PUNCH_CATEGORY);
    expect(survivingPunch.photo_urls).toEqual(['https://x/walk.jpg']);
    expect(survivingPunch.notes).toBe('homeowner wants the gutter re-checked');

    // The still-open punch item must not drag build progress backwards.
    expect(punchProgress(merged)).toMatchObject({ total: 1, done: 0, remaining: 1 });
  });

  it('dedupes punch items against each other but not against build scope', () => {
    const existing = [
      makeScopeItem({ label: 'Touch up fascia paint', category: PUNCH_CATEGORY }),
      makeScopeItem({ label: 'touch up  FASCIA paint!', category: PUNCH_CATEGORY }),
    ];
    const merged = mergeScopeItems(existing, []);
    expect(punchListItems(merged)).toHaveLength(1);
  });
});

describe('punch list separation', () => {
  const items = [
    { id: 'a', label: 'Tear off', category: 'estimate', completed: true },
    { id: 'b', label: 'Magnet sweep', category: 'template', completed: true },
    { id: 'c', label: 'Move the RV', category: 'manual', completed: true },
    { id: 'd', label: 'Touch up fascia paint', category: PUNCH_CATEGORY, completed: false },
    { id: 'e', label: 'Reseal pipe boot', category: PUNCH_CATEGORY, completed: true },
  ];

  it('splits build scope from punch items', () => {
    expect(buildScopeItems(items).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(punchListItems(items).map((i) => i.id)).toEqual(['d', 'e']);
    expect(isPunchItem({ category: PUNCH_CATEGORY })).toBe(true);
    expect(isPunchItem({ category: 'manual' })).toBe(false);
    expect(isPunchItem({})).toBe(false); // no category defaults to manual/build work
  });

  it('counts punch progress separately from build scope progress', () => {
    const scope = scopeProgress(items);
    const punch = punchProgress(items);
    expect(scope).toMatchObject({ total: 3, done: 3, remaining: 0, allDone: true });
    expect(punch).toMatchObject({ total: 2, done: 1, remaining: 1, allDone: false });
    expect(punch.incompleteLabels).toEqual(['Touch up fascia paint']);
  });

  it('an open punch item does NOT reopen a finished build (soft completion gate)', () => {
    // The gate in BuildSchedule warns on scopeProgress().remaining > 0. A punch
    // item raised after the crew finished must not make that fire.
    const p = scopeProgress(items);
    expect(p.remaining).toBe(0);
    expect(p.allDone).toBe(true);
    expect(p.incompleteLabels).toEqual([]);
    expect(p.percent).toBe(100);
  });

  it('a punch-only checklist reports no build scope at all', () => {
    const punchOnly = [{ label: 'Fix gutter pitch', category: PUNCH_CATEGORY, completed: false }];
    expect(scopeProgress(punchOnly)).toMatchObject({ total: 0, remaining: 0, allDone: false });
    expect(punchProgress(punchOnly)).toMatchObject({ total: 1, remaining: 1 });
  });

  it('punch progress is empty when there are no punch items', () => {
    const noPunch = [{ label: 'Tear off', category: 'estimate', completed: false }];
    expect(punchProgress(noPunch)).toMatchObject({ total: 0, done: 0, remaining: 0, allDone: false });
    expect(punchProgress([])).toMatchObject({ total: 0, allDone: false });
    expect(punchListItems(null)).toEqual([]);
    expect(buildScopeItems(null)).toEqual([]);
  });
});

describe('toggleScopeItem', () => {
  it('toggles completion and stamps who/when, then clears on untoggle', () => {
    const items = [makeScopeItem({ label: 'Magnet sweep', category: 'template' })];
    const id = items[0].id;
    const user = { email: 'crew@yicn.com' };

    const afterCheck = toggleScopeItem(items, id, user);
    expect(afterCheck[0].completed).toBe(true);
    expect(afterCheck[0].completed_by).toBe('crew@yicn.com');
    expect(afterCheck[0].completed_at).toBeTruthy();

    const afterUncheck = toggleScopeItem(afterCheck, id, user);
    expect(afterUncheck[0].completed).toBe(false);
    expect(afterUncheck[0].completed_by).toBe('');
    expect(afterUncheck[0].completed_at).toBe('');
  });

  it('leaves other items untouched', () => {
    const items = [
      makeScopeItem({ label: 'A' }),
      makeScopeItem({ label: 'B' }),
    ];
    const out = toggleScopeItem(items, items[1].id, {});
    expect(out[0].completed).toBe(false);
    expect(out[1].completed).toBe(true);
  });
});

describe('scopeProgress (completion gate math)', () => {
  it('counts done/remaining and lists exactly the unchecked labels', () => {
    const items = [
      { label: 'Tear off', completed: true },
      { label: 'Roof over the garage', completed: false },
      { label: 'Cleanup', completed: false },
    ];
    const p = scopeProgress(items);
    expect(p.total).toBe(3);
    expect(p.done).toBe(1);
    expect(p.remaining).toBe(2);
    expect(p.allDone).toBe(false);
    expect(p.incompleteLabels).toEqual(['Roof over the garage', 'Cleanup']);
    expect(p.percent).toBe(33);
  });

  it('reports allDone only when every item is checked', () => {
    expect(scopeProgress([{ completed: true }, { completed: true }]).allDone).toBe(true);
    expect(scopeProgress([]).allDone).toBe(false); // empty is not "all done"
    expect(scopeProgress([]).remaining).toBe(0);
  });
});
