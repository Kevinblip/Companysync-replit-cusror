import { describe, it, expect, beforeAll } from 'vitest';
import {
  CHANGE_ORDER_APPROVED,
  CHANGE_ORDER_REJECTED,
  CHANGE_ORDER_PENDING,
  CHANGE_ORDER_COPY_SKIP_FIELDS,
  newChangeOrderFields,
  isChangeOrder,
  changeOrderStatus,
  isApprovedChangeOrder,
  toCents,
  centsToDollars,
  formatCentsSigned,
  estimateTotalCents,
  diffLineItems,
  changeOrderDiff,
  changeOrderDeltaCents,
  approvedChangeOrders,
  approvedChangeOrderTotalCents,
  changeOrderInvoiceLines,
  buildInvoiceFromEstimates,
  pickBaseEstimate,
  lineItemCents,
} from '@/lib/changeOrders';

const item = (code, description, rcv, quantity = 1, rate = rcv) => ({
  code,
  description,
  quantity,
  rate,
  rcv,
});

const baseEstimate = {
  id: 'est-1',
  estimate_number: 'EST-0001',
  customer_id: 'cust-1',
  created_date: '2026-01-01T00:00:00Z',
  total_amount: 10000,
  items: [
    item('RFG 240', 'Laminated shingle', 6000, 30, 200),
    item('RFG DRIP', 'Drip edge', 1000, 200, 5),
    item('RFG RIDGC', 'Ridge cap', 3000, 60, 50),
  ],
};

// A change order carries the FULL revised estimate: the parent's lines plus
// the change, which is exactly why only its delta may ever be billed.
const approvedCo = {
  id: 'est-2',
  estimate_number: 'EST-0002',
  customer_id: 'cust-1',
  created_date: '2026-02-01T00:00:00Z',
  supplement_of: 'est-1',
  supplement_of_number: 'EST-0001',
  is_change_order: true,
  change_order_reason: 'Homeowner added two skylights',
  change_order_status: CHANGE_ORDER_APPROVED,
  change_order_approved_by: 'office@example.com',
  change_order_approved_at: '2026-02-02T15:00:00Z',
  total_amount: 11500,
  items: [
    item('RFG 240', 'Laminated shingle', 6000, 30, 200),
    item('RFG DRIP', 'Drip edge', 1000, 200, 5),
    item('RFG RIDGC', 'Ridge cap', 3000, 60, 50),
    item('RFG SKY', 'Skylight', 1500, 2, 750),
  ],
};

describe('change order flags and state', () => {
  it('flags a new change order as pending with its reason', () => {
    const fields = newChangeOrderFields('  Upgraded to architectural shingle  ');
    expect(fields.is_change_order).toBe(true);
    expect(fields.change_order_status).toBe(CHANGE_ORDER_PENDING);
    expect(fields.change_order_reason).toBe('Upgraded to architectural shingle');
    expect(fields.change_order_approved_by).toBe('');
  });

  it('treats a plain supplement as not a change order', () => {
    const supplement = { id: 's1', supplement_of: 'est-1', estimate_number: 'EST-0009' };
    expect(isChangeOrder(supplement)).toBe(false);
    expect(changeOrderStatus(supplement)).toBeNull();
    expect(isApprovedChangeOrder(supplement)).toBe(false);
  });

  it('defaults a flagged change order with no state to pending', () => {
    expect(changeOrderStatus({ is_change_order: true })).toBe(CHANGE_ORDER_PENDING);
  });

  it('treats an unrecognized state as pending, never approved', () => {
    expect(changeOrderStatus({ is_change_order: true, change_order_status: 'signed' })).toBe(
      CHANGE_ORDER_PENDING,
    );
    expect(isApprovedChangeOrder({ is_change_order: true, change_order_status: 'signed' })).toBe(false);
  });

  it('strips approval state from the copy-forward field set', () => {
    // Without this, a change order created from an approved change order would
    // inherit the approval and be billable before anyone looked at it.
    for (const field of Object.keys(newChangeOrderFields('x'))) {
      expect(CHANGE_ORDER_COPY_SKIP_FIELDS).toContain(field);
    }
  });
});

describe('money', () => {
  it('converts through integer cents without float drift', () => {
    expect(toCents(1234.565)).toBe(123457);
    expect(toCents('99.99')).toBe(9999);
    expect(toCents(null)).toBe(0);
    expect(centsToDollars(123457)).toBe(1234.57);
  });

  it('sums 0.1 + 0.2 style values exactly', () => {
    const cents = [0.1, 0.2].reduce((sum, n) => sum + toCents(n), 0);
    expect(cents).toBe(30);
    expect(centsToDollars(cents)).toBe(0.3);
  });

  it('formats a delta with an explicit sign', () => {
    expect(formatCentsSigned(150000)).toBe('+$1500.00');
    expect(formatCentsSigned(-2550)).toBe('-$25.50');
    expect(formatCentsSigned(0)).toBe('$0.00');
  });

  it('uses the stored total, falling back to the lines only when absent', () => {
    expect(estimateTotalCents(baseEstimate)).toBe(1000000);
    expect(estimateTotalCents({ items: [item('A', 'a', 100), item('B', 'b', 250)] })).toBe(35000);
  });

  it('honours a stored $0 line instead of recomputing quantity x rate', () => {
    // A carrier line intentionally zeroed out must stay at zero.
    expect(lineItemCents({ code: 'X', description: 'Waived', quantity: 10, rate: 50, rcv: 0 })).toBe(0);
  });
});

describe('line item diff', () => {
  it('reports added, removed and repriced lines with a net delta', () => {
    const parent = [
      item('A', 'Shingles', 5000),
      item('B', 'Drip edge', 1000),
      item('C', 'Gutter', 800),
    ];
    const child = [
      item('A', 'Shingles', 5000),
      item('B', 'Drip edge', 1400, 2, 700),
      item('D', 'Skylight', 900),
    ];

    const diff = diffLineItems(parent, child);
    expect(diff.added.map((i) => i.code)).toEqual(['D']);
    expect(diff.removed.map((i) => i.code)).toEqual(['C']);
    expect(diff.repriced).toHaveLength(1);
    expect(diff.repriced[0].item.code).toBe('B');
    expect(diff.repriced[0].beforeCents).toBe(100000);
    expect(diff.repriced[0].afterCents).toBe(140000);
    expect(diff.repriced[0].deltaCents).toBe(40000);
    expect(diff.unchanged.map((i) => i.code)).toEqual(['A']);
    // +900 added, -800 removed, +400 repriced
    expect(diff.netDeltaCents).toBe(50000);
    expect(diff.hasChanges).toBe(true);
  });

  it('does not report an unchanged estimate as changed', () => {
    const diff = changeOrderDiff({ items: baseEstimate.items }, baseEstimate);
    expect(diff.hasChanges).toBe(false);
    expect(diff.netDeltaCents).toBe(0);
  });

  it('pairs duplicate lines positionally instead of collapsing them', () => {
    const parent = [item('A', 'Slope', 1000), item('A', 'Slope', 1000)];
    const child = [item('A', 'Slope', 1000), item('A', 'Slope', 1200)];
    const diff = diffLineItems(parent, child);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.repriced).toHaveLength(1);
    expect(diff.netDeltaCents).toBe(20000);
  });

  it('matches lines whose description differs only by case and spacing', () => {
    const parent = [item('A', 'Ridge  Cap', 1000)];
    const child = [item('a', 'ridge cap', 1000)];
    expect(diffLineItems(parent, child).hasChanges).toBe(false);
  });

  it('treats a quantity change at the same price as repriced, not unchanged', () => {
    const parent = [item('A', 'Shingles', 5000, 25, 200)];
    const child = [item('A', 'Shingles', 5000, 30, 166.67)];
    const diff = diffLineItems(parent, child);
    expect(diff.repriced).toHaveLength(1);
    expect(diff.repriced[0].beforeQuantity).toBe(25);
    expect(diff.repriced[0].afterQuantity).toBe(30);
    expect(diff.netDeltaCents).toBe(0);
  });
});

describe('change order delta', () => {
  it('is the difference against the parent, not the change order total', () => {
    expect(changeOrderDeltaCents(approvedCo, baseEstimate)).toBe(150000);
  });

  it('is zero when the parent is unknown, so nothing is billed on a guess', () => {
    expect(changeOrderDeltaCents(approvedCo, null)).toBe(0);
  });

  it('handles a change order that reduces the job', () => {
    const reduced = { ...approvedCo, total_amount: 8500 };
    expect(changeOrderDeltaCents(reduced, baseEstimate)).toBe(-150000);
  });
});

describe('invoicing', () => {
  const pendingCo = {
    ...approvedCo,
    id: 'est-3',
    estimate_number: 'EST-0003',
    change_order_status: CHANGE_ORDER_PENDING,
    change_order_approved_by: '',
    change_order_approved_at: '',
    total_amount: 12000,
  };
  const rejectedCo = {
    ...approvedCo,
    id: 'est-4',
    estimate_number: 'EST-0004',
    change_order_status: CHANGE_ORDER_REJECTED,
    total_amount: 20000,
  };
  const plainSupplement = {
    id: 'est-5',
    estimate_number: 'EST-0005',
    customer_id: 'cust-1',
    created_date: '2026-04-01T00:00:00Z',
    supplement_of: 'est-1',
    supplement_of_number: 'EST-0001',
    total_amount: 14000,
    items: baseEstimate.items,
  };

  const pool = [baseEstimate, approvedCo, pendingCo, rejectedCo, plainSupplement];

  it('picks the newest ordinary estimate as the billing baseline', () => {
    // Not the change order, whose total already contains the base scope, and
    // not the plain supplement either — those keep their existing behavior.
    const picked = pickBaseEstimate([baseEstimate, approvedCo, pendingCo]);
    expect(picked.id).toBe('est-1');
  });

  it('includes only approved change orders', () => {
    const rows = approvedChangeOrders(pool);
    expect(rows.map((r) => r.changeOrder.id)).toEqual(['est-2']);
    expect(approvedChangeOrderTotalCents(pool)).toBe(150000);
  });

  it('excludes a pending change order from the money', () => {
    expect(approvedChangeOrderTotalCents([baseEstimate, pendingCo])).toBe(0);
  });

  it('excludes a rejected change order from the money', () => {
    expect(approvedChangeOrderTotalCents([baseEstimate, rejectedCo])).toBe(0);
  });

  it('ignores a plain supplement entirely', () => {
    expect(approvedChangeOrders([baseEstimate, plainSupplement])).toEqual([]);
    expect(approvedChangeOrderTotalCents([baseEstimate, plainSupplement])).toBe(0);
  });

  it('skips an approved change order whose parent is missing rather than guessing', () => {
    expect(approvedChangeOrders([approvedCo])).toEqual([]);
  });

  it('bills the base plus the approved delta, never the change order total', () => {
    const built = buildInvoiceFromEstimates(baseEstimate, pool);
    expect(built.baseCents).toBe(1000000);
    expect(built.changeOrderCents).toBe(150000);
    expect(built.totalCents).toBe(1150000);
    // The naive mistake — base + the change order's own total — would be this.
    expect(built.totalCents).not.toBe(1000000 + 1150000);
  });

  it('attaches the added scope as real lines that sum to exactly the delta', () => {
    const rows = approvedChangeOrders(pool);
    const lines = changeOrderInvoiceLines(rows[0]);
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('[CO EST-0002] Skylight');
    expect(lines.reduce((sum, l) => sum + lineItemCents(l), 0)).toBe(rows[0].deltaCents);
  });

  it('adds a balancing line when repricing or a discount moved the total', () => {
    // Same added skylight, but the total moved by more than the added line, so
    // the remainder must appear or the invoice would not add up.
    const withDiscountChange = { ...approvedCo, total_amount: 11000 };
    const rows = approvedChangeOrders([baseEstimate, withDiscountChange]);
    const lines = changeOrderInvoiceLines(rows[0]);
    expect(lines).toHaveLength(2);
    expect(lines[1].description).toContain('Change order EST-0002');
    expect(lines.reduce((sum, l) => sum + lineItemCents(l), 0)).toBe(100000);
    expect(rows[0].deltaCents).toBe(100000);
  });

  it('carries the base line items through alongside the change order lines', () => {
    const built = buildInvoiceFromEstimates(baseEstimate, pool);
    expect(built.items).toHaveLength(baseEstimate.items.length + 1);
    expect(built.items.at(-1).change_order_id).toBe('est-2');
  });

  it('produces just the base estimate when there are no change orders', () => {
    const built = buildInvoiceFromEstimates(baseEstimate, [baseEstimate, plainSupplement]);
    expect(built.totalCents).toBe(1000000);
    expect(built.changeOrders).toEqual([]);
    expect(built.items).toHaveLength(baseEstimate.items.length);
  });

  it('leaves an amount-only estimate amount-only, as it billed before', () => {
    const noLines = { id: 'est-9', estimate_number: 'EST-0009', total_amount: 4200, items: [] };
    const built = buildInvoiceFromEstimates(noLines, [noLines]);
    expect(built.totalCents).toBe(420000);
    expect(built.items).toEqual([]);
  });

  it('ignores estimates with no total_amount when picking the baseline', () => {
    // The invoice dialog has always required a positive total_amount; widening
    // that would silently change which estimate existing customers bill from.
    const noTotal = { id: 'x', estimate_number: 'EST-X', created_date: '2027-01-01', items: [item('A', 'a', 500)] };
    expect(pickBaseEstimate([baseEstimate, noTotal]).id).toBe('est-1');
  });
});

describe('multiple jobs for one customer', () => {
  // Two unrelated roofs for the same homeowner. Each is its own revision chain,
  // and the change order approved on the old job must never land on the new
  // job's invoice.
  const oldJob = {
    id: 'job-a',
    estimate_number: 'EST-1000',
    customer_id: 'cust-1',
    created_date: '2025-01-01T00:00:00Z',
    total_amount: 5000,
    items: [item('A', 'Old roof', 5000)],
  };
  const oldJobCo = {
    id: 'job-a-co',
    estimate_number: 'EST-1001',
    customer_id: 'cust-1',
    created_date: '2025-02-01T00:00:00Z',
    supplement_of: 'job-a',
    supplement_of_number: 'EST-1000',
    is_change_order: true,
    change_order_status: CHANGE_ORDER_APPROVED,
    total_amount: 5800,
    items: [item('A', 'Old roof', 5000), item('B', 'Chimney flashing', 800)],
  };
  const newJob = {
    id: 'job-b',
    estimate_number: 'EST-2000',
    customer_id: 'cust-1',
    created_date: '2026-06-01T00:00:00Z',
    total_amount: 9000,
    items: [item('C', 'New roof', 9000)],
  };
  const newJobCo = {
    id: 'job-b-co',
    estimate_number: 'EST-2001',
    customer_id: 'cust-1',
    created_date: '2026-07-01T00:00:00Z',
    supplement_of: 'job-b',
    supplement_of_number: 'EST-2000',
    is_change_order: true,
    change_order_status: CHANGE_ORDER_APPROVED,
    total_amount: 9600,
    items: [item('C', 'New roof', 9000), item('D', 'Gutter guards', 600)],
  };

  const pool = [oldJob, oldJobCo, newJob, newJobCo];

  it('bills only the change orders from the base estimate\'s own chain', () => {
    const built = buildInvoiceFromEstimates(newJob, pool);
    expect(built.changeOrders.map((r) => r.changeOrder.id)).toEqual(['job-b-co']);
    expect(built.changeOrderCents).toBe(60000);
    expect(built.totalCents).toBe(960000);
    // The bug this guards: +$800 from the OTHER job leaking onto this invoice.
    expect(built.totalCents).not.toBe(960000 + 80000);
  });

  it('bills the other job\'s chain independently', () => {
    const built = buildInvoiceFromEstimates(oldJob, pool);
    expect(built.changeOrders.map((r) => r.changeOrder.id)).toEqual(['job-a-co']);
    expect(built.totalCents).toBe(580000);
  });

  it('follows a chain up through several revisions to its root', () => {
    const secondCo = {
      id: 'job-b-co2',
      estimate_number: 'EST-2002',
      customer_id: 'cust-1',
      created_date: '2026-08-01T00:00:00Z',
      supplement_of: 'job-b-co',
      supplement_of_number: 'EST-2001',
      is_change_order: true,
      change_order_status: CHANGE_ORDER_APPROVED,
      total_amount: 10100,
      items: [...newJobCo.items, item('E', 'Ridge vent', 500)],
    };
    const built = buildInvoiceFromEstimates(newJob, [...pool, secondCo]);
    expect(built.changeOrders.map((r) => r.changeOrder.id).sort()).toEqual(['job-b-co', 'job-b-co2']);
    // +$600 then +$500 on top of the $9,000 base.
    expect(built.totalCents).toBe(1010000);
  });
});

describe('invoice lines always reconcile to the invoice total', () => {
  it('emits a balancing line when a discount lives in the total, not the lines', () => {
    // $10,000 of lines but a $9,000 saved total — a 10% discount the line items
    // know nothing about. Without a balancing line the invoice would not add up.
    const discounted = { ...baseEstimate, total_amount: 9000 };
    const built = buildInvoiceFromEstimates(discounted, [discounted]);
    const lineSum = built.items.reduce((sum, l) => sum + lineItemCents(l), 0);
    expect(lineSum).toBe(built.totalCents);
    expect(built.items.at(-1).description).toContain('adjustment');
  });

  it('reconciles base lines and change order lines together', () => {
    const discounted = { ...baseEstimate, total_amount: 9000 };
    const co = { ...approvedCo, total_amount: 10200 };
    const built = buildInvoiceFromEstimates(discounted, [discounted, co]);
    const lineSum = built.items.reduce((sum, l) => sum + lineItemCents(l), 0);
    expect(built.totalCents).toBe(1020000);
    expect(lineSum).toBe(built.totalCents);
  });

  it('writes an explicit amount on every line so exports never see undefined', () => {
    const built = buildInvoiceFromEstimates(baseEstimate, [baseEstimate, approvedCo]);
    for (const line of built.items) {
      expect(typeof line.amount).toBe('number');
      expect(Number.isFinite(line.amount)).toBe(true);
      expect(toCents(line.amount)).toBe(lineItemCents(line));
    }
  });

  it('itemizes a change order even when the base estimate saved no lines', () => {
    const noLines = { id: 'nl', estimate_number: 'EST-0100', total_amount: 5000, items: [] };
    const co = {
      id: 'nl-co',
      estimate_number: 'EST-0101',
      supplement_of: 'nl',
      is_change_order: true,
      change_order_status: CHANGE_ORDER_APPROVED,
      total_amount: 5750,
      items: [item('S', 'Skylight', 750)],
    };
    const built = buildInvoiceFromEstimates(noLines, [noLines, co]);
    expect(built.totalCents).toBe(575000);
    const lineSum = built.items.reduce((sum, l) => sum + lineItemCents(l), 0);
    expect(lineSum).toBe(built.totalCents);
  });
});

// ---------------------------------------------------------------------------
// Server-side approval authorization
//
// Approving a change order raises what a homeowner is billed, so the gate is
// enforced in the shared tenant guard used by BOTH the dev and prod entity
// APIs — not just by hiding a button.
// ---------------------------------------------------------------------------
describe('change order approval authorization (server guard)', () => {
  let enforce;
  beforeAll(async () => {
    ({ enforceChangeOrderApproval: enforce } = await import('../../lib/tenantGuard.cjs'));
  });

  const co = {
    id: 'co-1',
    company_id: 'comp-1',
    is_change_order: true,
    change_order_status: 'pending',
  };
  // Only consulted on the owner-bypass path.
  const poolOwnedBy = (email) => ({
    query: async () => ({ rows: [{ created_by: email }] }),
  });
  const rep = {
    authenticated: true,
    email: 'rep@example.com',
    isAdministrator: false,
    administratorCompanyIds: new Set(),
  };
  const admin = {
    authenticated: true,
    email: 'boss@example.com',
    isAdministrator: true,
    administratorCompanyIds: new Set(['comp-1']),
  };

  it('blocks a non-admin from approving', async () => {
    const res = await enforce(rep, 'estimates', { change_order_status: 'approved' }, co, poolOwnedBy('someone@else.com'), 'test');
    expect(res.blocked).toBe(true);
  });

  it('blocks a non-admin approving through the nested data JSONB', async () => {
    // change_order_* are not real columns, so they land in `data` — the
    // smuggling path has to be closed too.
    const res = await enforce(rep, 'estimates', { data: { change_order_status: 'approved' } }, co, poolOwnedBy('someone@else.com'), 'test');
    expect(res.blocked).toBe(true);
  });

  it('blocks an admin of a DIFFERENT company', async () => {
    const otherAdmin = { ...admin, administratorCompanyIds: new Set(['comp-2']) };
    const res = await enforce(otherAdmin, 'estimates', { change_order_status: 'approved' }, co, poolOwnedBy('x@y.com'), 'test');
    expect(res.blocked).toBe(true);
  });

  it('lets an administrator of the owning company approve', async () => {
    const res = await enforce(admin, 'estimates', { change_order_status: 'approved' }, co, poolOwnedBy('x@y.com'), 'test');
    expect(res.blocked).toBe(false);
    expect(res.body.change_order_status).toBe('approved');
  });

  it('lets the company owner approve even without an admin staff profile', async () => {
    const owner = { authenticated: true, email: 'owner@example.com', isAdministrator: false, administratorCompanyIds: new Set() };
    const res = await enforce(owner, 'estimates', { change_order_status: 'approved' }, co, poolOwnedBy('OWNER@example.com'), 'test');
    expect(res.blocked).toBe(false);
    expect(res.body.change_order_approved_by).toBe('owner@example.com');
  });

  it('stamps the approver from the session, ignoring the client-supplied identity', async () => {
    const res = await enforce(
      admin,
      'estimates',
      { change_order_status: 'approved', change_order_approved_by: 'ceo@example.com', change_order_approved_at: '1999-01-01' },
      co,
      poolOwnedBy('x@y.com'),
      'test',
    );
    expect(res.blocked).toBe(false);
    expect(res.body.change_order_approved_by).toBe('boss@example.com');
    expect(res.body.change_order_approved_at).not.toBe('1999-01-01');
    expect(Number.isNaN(Date.parse(res.body.change_order_approved_at))).toBe(false);
  });

  it('refuses to record a decision it cannot attribute to anyone', async () => {
    // The auth-loading race: the identity has not resolved yet. An approval
    // naming nobody looks reviewed but is not.
    const anonymous = { ...admin, email: '' };
    const res = await enforce(anonymous, 'estimates', { change_order_status: 'approved' }, co, poolOwnedBy('x@y.com'), 'test');
    expect(res.blocked).toBe(true);
  });

  it('clears the opposite decision when the state flips', async () => {
    const approved = { ...co, change_order_status: 'approved', change_order_approved_by: 'boss@example.com' };
    const res = await enforce(admin, 'estimates', { change_order_status: 'rejected' }, approved, poolOwnedBy('x@y.com'), 'test');
    expect(res.blocked).toBe(false);
    expect(res.body.change_order_rejected_by).toBe('boss@example.com');
    expect(res.body.change_order_approved_by).toBe('');
  });

  it('normalizes an unrecognized status to pending rather than trusting it', async () => {
    const res = await enforce(admin, 'estimates', { change_order_status: 'signed' }, co, poolOwnedBy('x@y.com'), 'test');
    expect(res.body.change_order_status).toBe('pending');
    expect(res.body.change_order_approved_by).toBe('');
  });

  it('lets a rep save an estimate that merely echoes the unchanged status', async () => {
    // The editor spreads the whole record back on save; that must not 403.
    const res = await enforce(rep, 'estimates', { estimate_title: 'Edited', change_order_status: 'pending' }, co, poolOwnedBy('x@y.com'), 'test');
    expect(res.blocked).toBe(false);
    expect(res.body.estimate_title).toBe('Edited');
  });

  it('ignores non-estimate entities entirely', async () => {
    const res = await enforce(rep, 'customers', { change_order_status: 'approved' }, { id: 'c', company_id: 'comp-1' }, poolOwnedBy('x@y.com'), 'test');
    expect(res.blocked).toBe(false);
  });

  it('blocks rather than allowing when the owner lookup fails', async () => {
    const brokenPool = { query: async () => { throw new Error('db down'); } };
    const res = await enforce(rep, 'estimates', { change_order_status: 'approved' }, co, brokenPool, 'test');
    expect(res.blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Creation and legacy-route coverage
//
// Gating only the update path would be a speed bump: anyone able to create an
// estimate could POST one that is already approved, and the legacy direct
// routes resolve no caller at all.
// ---------------------------------------------------------------------------
describe('change order creation cannot be born approved', () => {
  let sanitize;
  let reject;
  beforeAll(async () => {
    ({ sanitizeChangeOrderOnCreate: sanitize, rejectChangeOrderDecision: reject } =
      await import('../../lib/tenantGuard.cjs'));
  });

  const rep = { authenticated: true, email: 'rep@example.com', isAdministrator: false, administratorCompanyIds: new Set() };

  it('forces a POSTed approved change order back to pending', () => {
    const out = sanitize(rep, 'estimates', {
      is_change_order: true,
      change_order_status: 'approved',
      change_order_approved_by: 'boss@example.com',
      change_order_approved_at: '2026-01-01',
      total_amount: 9999,
    }, 'test');
    expect(out.change_order_status).toBe('pending');
    expect(out.change_order_approved_by).toBe('');
    expect(out.change_order_approved_at).toBe('');
    expect(out.total_amount).toBe(9999); // unrelated fields untouched
  });

  it('closes the nested data JSONB route on create too', () => {
    const out = sanitize(rep, 'estimates', {
      is_change_order: true,
      data: { change_order_status: 'approved', change_order_approved_by: 'x@y.com', estimate_note: 'keep me' },
    }, 'test');
    expect(out.change_order_status).toBe('pending');
    expect(out.data.change_order_status).toBeUndefined();
    expect(out.data.change_order_approved_by).toBeUndefined();
    expect(out.data.estimate_note).toBe('keep me');
  });

  it('leaves a normal estimate create completely alone', () => {
    const body = { estimate_title: 'Roof', total_amount: 100 };
    expect(sanitize(rep, 'estimates', body, 'test')).toBe(body);
  });

  it('lets a restore replay a real historical decision', () => {
    const service = { authenticated: true, viaServiceToken: true, email: 'service' };
    const body = { is_change_order: true, change_order_status: 'approved', change_order_approved_by: 'boss@example.com' };
    expect(sanitize(service, 'estimates', body, 'test').change_order_status).toBe('approved');
  });

  it('refuses a decision on the unauthenticated legacy direct route', () => {
    const existing = { id: 'co-1', company_id: 'comp-1', change_order_status: 'pending' };
    expect(reject('estimates', { change_order_status: 'approved' }, existing, 'direct').blocked).toBe(true);
    expect(reject('estimates', { data: { change_order_status: 'approved' } }, existing, 'direct').blocked).toBe(true);
  });

  it('still lets the legacy direct route save unrelated estimate edits', () => {
    const existing = { id: 'co-1', company_id: 'comp-1', change_order_status: 'pending' };
    expect(reject('estimates', { estimate_title: 'Renamed', change_order_status: 'pending' }, existing, 'direct').blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Post-approval mutation
//
// An approval is a decision about a SPECIFIC amount. If the total or the line
// items can be edited afterwards, approval stops being a money permission —
// the homeowner gets billed a number nobody signed off on.
// ---------------------------------------------------------------------------
describe('approved change orders cannot quietly grow', () => {
  let enforce;
  let reject;
  let sanitize;
  beforeAll(async () => {
    ({
      enforceChangeOrderApproval: enforce,
      rejectChangeOrderDecision: reject,
      sanitizeChangeOrderOnCreate: sanitize,
    } = await import('../../lib/tenantGuard.cjs'));
  });

  const approvedCo = {
    id: 'co-1',
    company_id: 'comp-1',
    is_change_order: true,
    change_order_status: 'approved',
    change_order_approved_by: 'boss@example.com',
    change_order_approved_at: '2026-01-01T00:00:00.000Z',
    total_amount: 1000,
    line_items: [{ code: 'RFG', description: 'Shingles', rcv: 1000 }],
  };
  const pendingCo = { id: 'co-2', company_id: 'comp-1', is_change_order: true, change_order_status: 'pending', total_amount: 500 };
  const pool = { query: async () => ({ rows: [{ created_by: 'owner@example.com' }] }) };
  const rep = { authenticated: true, email: 'rep@example.com', isAdministrator: false, administratorCompanyIds: new Set() };
  const admin = { authenticated: true, email: 'boss@example.com', isAdministrator: true, administratorCompanyIds: new Set(['comp-1']) };

  it('reverts to pending when a rep raises the total after approval', async () => {
    const res = await enforce(rep, 'estimates', { total_amount: 50000 }, approvedCo, pool, 'test');
    expect(res.blocked).toBe(false);
    expect(res.body.change_order_status).toBe('pending');
    expect(res.body.change_order_approved_by).toBe('');
    expect(res.body.change_order_approved_at).toBe('');
    expect(res.body.total_amount).toBe(50000); // the edit itself is allowed
  });

  it('reverts when the line items are rewritten', async () => {
    const res = await enforce(rep, 'estimates', {
      line_items: [{ code: 'RFG', description: 'Shingles', rcv: 1000 }, { code: 'XTR', description: 'Extra', rcv: 4000 }],
    }, approvedCo, pool, 'test');
    expect(res.body.change_order_status).toBe('pending');
  });

  it('reverts when the amount is smuggled through the nested data JSONB', async () => {
    const res = await enforce(rep, 'estimates', { data: { total_amount: 50000 } }, approvedCo, pool, 'test');
    expect(res.body.change_order_status).toBe('pending');
    expect(res.body.data.change_order_status).toBeUndefined();
  });

  it('reverts when the change order is re-pointed at a different parent', async () => {
    const res = await enforce(rep, 'estimates', { supplement_of: 'other-job-estimate' }, approvedCo, pool, 'test');
    expect(res.body.change_order_status).toBe('pending');
  });

  it('leaves the approval alone for edits that cost nothing', async () => {
    const res = await enforce(rep, 'estimates', { notes: 'Called the homeowner', total_amount: 1000 }, approvedCo, pool, 'test');
    expect(res.body.change_order_status).toBeUndefined(); // untouched, not restamped
    expect(res.body.notes).toBe('Called the homeowner');
  });

  it('does not disturb a pending change order being edited normally', async () => {
    const res = await enforce(rep, 'estimates', { total_amount: 900 }, pendingCo, pool, 'test');
    expect(res.body.change_order_status).toBeUndefined();
  });

  it('lets an admin change the amount and approve the new one in a single write', async () => {
    const res = await enforce(admin, 'estimates', { total_amount: 2000, change_order_status: 'approved' }, approvedCo, pool, 'test');
    expect(res.blocked).toBe(false);
    expect(res.body.change_order_status).toBe('approved');
    expect(res.body.change_order_approved_by).toBe('boss@example.com');
    expect(res.body.total_amount).toBe(2000);
  });

  it('refuses a post-approval amount change on the unauthenticated direct route', () => {
    expect(reject('estimates', { total_amount: 50000 }, approvedCo, 'direct').blocked).toBe(true);
    expect(reject('estimates', { data: { line_items: [] } }, approvedCo, 'direct').blocked).toBe(true);
  });

  it('still lets the direct route edit a pending change order and a plain estimate', () => {
    expect(reject('estimates', { total_amount: 900 }, pendingCo, 'direct').blocked).toBe(false);
    expect(reject('estimates', { total_amount: 900 }, { id: 'e-1', company_id: 'comp-1', total_amount: 100 }, 'direct').blocked).toBe(false);
  });

  it('will not let a sync import land an already-approved change order', () => {
    const out = sanitize(null, 'estimates', {
      id: 'co-x', is_change_order: true, change_order_status: 'approved',
      change_order_approved_by: 'nobody@example.com', total_amount: 5000,
    }, 'syncEntityBatch');
    expect(out.change_order_status).toBe('pending');
    expect(out.change_order_approved_by).toBe('');
  });
});
