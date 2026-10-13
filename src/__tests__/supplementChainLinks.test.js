import { describe, it, expect, beforeAll } from 'vitest';
import {
  buildSupplementCopyData,
  SUPPLEMENT_CHAIN_COPY_SKIP_FIELDS,
  newChangeOrderFields,
} from '@/lib/changeOrders';

/**
 * A supplement chain is only useful if every link points where it claims.
 *
 * Both creation paths (the Estimates list and the estimate editor) copy the
 * parent forward, rewrite the upward link and then stamp the downward link on
 * the parent. The copy therefore has to drop BOTH directions of the parent's
 * links — if it keeps `has_supplement_id`, the new child is born pointing at
 * its own sibling.
 *
 * `createSupplement` below mirrors exactly what both pages do, so the chain is
 * exercised the way the app builds it.
 */
function createSupplement(store, parentId, { number, asChangeOrder = false, reason = '' } = {}) {
  const parent = store.get(parentId);
  const copyData = buildSupplementCopyData(parent);

  const child = {
    ...copyData,
    id: `est-${number}`,
    estimate_number: number,
    status: 'draft',
    supplement_of: parent.id,
    supplement_of_number: parent.estimate_number || '',
    ...(asChangeOrder ? newChangeOrderFields(reason) : {}),
  };
  store.set(child.id, child);

  store.set(parent.id, {
    ...parent,
    has_supplement: true,
    has_supplement_id: child.id,
    has_supplement_number: number,
  });

  return child;
}

/** What the Estimates list counts as an estimate's supplements. */
function supplementCount(store, id) {
  return [...store.values()].filter((e) => e.supplement_of === id).length;
}

function newStore() {
  const store = new Map();
  store.set('est-EST-0001', {
    id: 'est-EST-0001',
    estimate_number: 'EST-0001',
    company_id: 'comp-1',
    customer_id: 'cust-1',
    status: 'approved',
    total_amount: 10000,
    created_at: '2026-01-01T00:00:00Z',
    items: [{ code: 'RFG 240', description: 'Shingles', rcv: 10000 }],
  });
  return store;
}

describe('supplement copy-forward drops both directions of the chain', () => {
  it('never copies a downward chain field onto the child', () => {
    const parent = {
      id: 'p1',
      estimate_number: 'EST-0001',
      total_amount: 100,
      has_supplement: true,
      has_supplement_id: 'sibling-1',
      has_supplement_number: 'EST-0002',
      supplement_of: 'older',
      supplement_of_number: 'EST-0000',
    };
    const copy = buildSupplementCopyData(parent);
    for (const field of SUPPLEMENT_CHAIN_COPY_SKIP_FIELDS) {
      expect(copy[field]).toBeUndefined();
    }
    expect(copy.total_amount).toBe(100);
  });

  it('strips the chain out of the nested data JSONB too', () => {
    // Chain fields are not real columns, so a read hands them back both
    // flattened and inside `data` — and a copied `data` is written straight
    // back to the column.
    const parent = {
      id: 'p1',
      estimate_number: 'EST-0001',
      has_supplement_id: 'sibling-1',
      data: {
        has_supplement: true,
        has_supplement_id: 'sibling-1',
        has_supplement_number: 'EST-0002',
        supplement_of: 'older',
        change_order_status: 'approved',
        roof_notes: 'keep me',
      },
    };
    const copy = buildSupplementCopyData(parent);
    expect(copy.has_supplement_id).toBeUndefined();
    expect(copy.data.has_supplement).toBeUndefined();
    expect(copy.data.has_supplement_id).toBeUndefined();
    expect(copy.data.has_supplement_number).toBeUndefined();
    expect(copy.data.supplement_of).toBeUndefined();
    expect(copy.data.change_order_status).toBeUndefined();
    expect(copy.data.roof_notes).toBe('keep me');
  });
});

describe('a three-deep supplement chain stays honest', () => {
  it('links each estimate to its own child, never to a sibling', () => {
    const store = newStore();
    const second = createSupplement(store, 'est-EST-0001', { number: 'EST-0002' });
    const third = createSupplement(store, second.id, { number: 'EST-0003', asChangeOrder: true, reason: 'Added skylights' });

    const first = store.get('est-EST-0001');
    const mid = store.get(second.id);
    const last = store.get(third.id);

    // Upward links
    expect(mid.supplement_of).toBe(first.id);
    expect(last.supplement_of).toBe(mid.id);
    expect(last.supplement_of_number).toBe('EST-0002');

    // Downward links — each points at its OWN child
    expect(first.has_supplement_id).toBe(mid.id);
    expect(first.has_supplement_number).toBe('EST-0002');
    expect(mid.has_supplement_id).toBe(last.id);
    expect(mid.has_supplement_number).toBe('EST-0003');

    // The bug: the third estimate inheriting the second's pointer to itself.
    expect(last.has_supplement_id).toBeUndefined();
    expect(last.has_supplement_number).toBeUndefined();
    expect(last.has_supplement).toBeUndefined();
  });

  it('does not show a supplement badge or count on the newest estimate', () => {
    const store = newStore();
    const second = createSupplement(store, 'est-EST-0001', { number: 'EST-0002' });
    const third = createSupplement(store, second.id, { number: 'EST-0003' });

    expect(supplementCount(store, third.id)).toBe(0);
    expect(!!store.get(third.id).has_supplement).toBe(false);
    expect(supplementCount(store, 'est-EST-0001')).toBe(1);
    expect(supplementCount(store, second.id)).toBe(1);
  });

  it('walks the whole chain from the root without looping or skipping', () => {
    const store = newStore();
    const second = createSupplement(store, 'est-EST-0001', { number: 'EST-0002' });
    createSupplement(store, second.id, { number: 'EST-0003' });
    createSupplement(store, 'est-EST-0003', { number: 'EST-0004' });

    const walked = [];
    const seen = new Set();
    let cur = store.get('est-EST-0001');
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      walked.push(cur.estimate_number);
      cur = cur.has_supplement_id ? store.get(cur.has_supplement_id) : null;
    }
    expect(walked).toEqual(['EST-0001', 'EST-0002', 'EST-0003', 'EST-0004']);
  });

  it('keeps the child a fresh draft rather than inheriting approval', () => {
    const store = newStore();
    const second = createSupplement(store, 'est-EST-0001', { number: 'EST-0002', asChangeOrder: true, reason: 'Skylights' });
    const third = createSupplement(store, second.id, { number: 'EST-0003', asChangeOrder: true, reason: 'Gutters' });
    expect(third.status).toBe('draft');
    expect(third.change_order_status).toBe('pending');
    expect(third.change_order_reason).toBe('Gutters');
  });
});

// ---------------------------------------------------------------------------
// Cleanup for rows written before the fix
// ---------------------------------------------------------------------------
describe('chain link cleanup', () => {
  let plan;
  beforeAll(async () => {
    ({ planSupplementChainRepairs: plan } = await import('../../scripts/cleanup-supplement-chain-links.cjs'));
  });

  const row = (id, number, data = {}, created_at = '2026-01-01T00:00:00Z') => ({
    id,
    estimate_number: number,
    created_at,
    data,
  });

  it('leaves a sound three-deep chain completely alone', () => {
    const rows = [
      row('a', 'EST-0001', { has_supplement: true, has_supplement_id: 'b', has_supplement_number: 'EST-0002' }),
      row('b', 'EST-0002', { supplement_of: 'a', has_supplement: true, has_supplement_id: 'c', has_supplement_number: 'EST-0003' }),
      row('c', 'EST-0003', { supplement_of: 'b' }),
    ];
    expect(plan(rows)).toEqual([]);
  });

  it('clears an inherited pointer at a sibling', () => {
    const rows = [
      row('a', 'EST-0001', { has_supplement: true, has_supplement_id: 'b', has_supplement_number: 'EST-0002' }),
      row('b', 'EST-0002', { supplement_of: 'a', has_supplement: true, has_supplement_id: 'c', has_supplement_number: 'EST-0003' }),
      // Born from b, but inherited a's pointer to b — its own sibling's slot.
      row('c', 'EST-0003', { supplement_of: 'b', has_supplement: true, has_supplement_id: 'b', has_supplement_number: 'EST-0002' }),
    ];
    const repairs = plan(rows);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].id).toBe('c');
    expect(repairs[0].action).toBe('clear');
    expect(repairs[0].has_supplement).toBe(false);
    expect(repairs[0].has_supplement_id).toBe('');
  });

  it('repoints a row that really does have a child', () => {
    const rows = [
      row('a', 'EST-0001', { has_supplement: true, has_supplement_id: 'stale', has_supplement_number: 'EST-9999' }),
      row('b', 'EST-0002', { supplement_of: 'a' }, '2026-02-01T00:00:00Z'),
      row('c', 'EST-0003', { supplement_of: 'a' }, '2026-03-01T00:00:00Z'),
    ];
    const repairs = plan(rows);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].action).toBe('repoint');
    expect(repairs[0].has_supplement_id).toBe('c'); // newest real child
    expect(repairs[0].has_supplement_number).toBe('EST-0003');
  });

  it('clears a pointer at a record that no longer exists', () => {
    const rows = [row('a', 'EST-0001', { has_supplement: true, has_supplement_id: 'deleted-1' })];
    const repairs = plan(rows);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].action).toBe('clear');
  });

  it('ignores estimates with no downward link at all', () => {
    const rows = [row('a', 'EST-0001', {}), row('b', 'EST-0002', { supplement_of: 'a' })];
    expect(plan(rows)).toEqual([]);
  });

  it('is idempotent — a repaired chain plans no further work', () => {
    const rows = [
      row('a', 'EST-0001', { has_supplement: true, has_supplement_id: 'b', has_supplement_number: 'EST-0002' }),
      row('b', 'EST-0002', { supplement_of: 'a', has_supplement: true, has_supplement_id: 'c', has_supplement_number: 'EST-0003' }),
      row('c', 'EST-0003', { supplement_of: 'b', has_supplement: true, has_supplement_id: 'b' }),
    ];
    const first = plan(rows);
    expect(first).toHaveLength(1);

    const repaired = rows.map((r) => {
      const fix = first.find((f) => f.id === r.id);
      if (!fix) return r;
      const data = { ...r.data, has_supplement: fix.has_supplement };
      delete data.has_supplement_id;
      delete data.has_supplement_number;
      return { ...r, data };
    });
    expect(plan(repaired)).toEqual([]);
  });
});
