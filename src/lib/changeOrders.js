/**
 * Change orders.
 *
 * A change order is NOT a new kind of record. It is the existing supplement /
 * revision: a child estimate copied forward from a parent, linked by
 * `supplement_of` / `has_supplement_id`. A change order is simply a supplement
 * that carries the change-order flag, a reason, and an internal approval state.
 *
 * Two properties of that arrangement drive everything in this file:
 *
 *  1. A change order holds the FULL revised estimate, not just the new work.
 *     The copy-forward duplicates every line item and then the office edits it.
 *     So the amount a change order adds to the job is the DELTA against its
 *     parent, never its own total. Billing a change order's total on top of the
 *     original estimate charges the homeowner for the whole roof twice.
 *
 *  2. A saved line item's stored RCV is the authority (see estimateTotals.js).
 *     The diff compares stored money and never recomputes quantity x rate, or a
 *     carrier's intentionally rounded / $0 lines would read as repriced on every
 *     comparison.
 *
 * Approval is internal to the office — there is no customer signature step.
 */

import { resolveStoredRcv, lineQuantity, lineRate } from '@/utils/estimateTotals';

export const CHANGE_ORDER_PENDING = 'pending';
export const CHANGE_ORDER_APPROVED = 'approved';
export const CHANGE_ORDER_REJECTED = 'rejected';

/**
 * Change-order fields must be stripped when an estimate is copied forward.
 *
 * Without this, creating a change order FROM an approved change order would
 * copy the approval across and the new one would be born already approved and
 * already billable — signed off by someone who never saw it.
 */
export const CHANGE_ORDER_COPY_SKIP_FIELDS = [
  'is_change_order',
  'change_order_reason',
  'change_order_status',
  'change_order_approved_by',
  'change_order_approved_at',
  'change_order_rejected_by',
  'change_order_rejected_at',
];

/**
 * Chain-link fields, in BOTH directions, stripped on a copy-forward.
 *
 * `supplement_of` / `supplement_of_number` point UP at the parent and are
 * rewritten for the new child. `has_supplement*` point DOWN at a child and
 * belong to the estimate being copied FROM — a brand-new child has no children
 * of its own. Carrying them forward hands the new estimate a pointer to its
 * own sibling: the chain badge opens the wrong record and the Estimates list
 * renders a supplement count on an estimate that has no supplements. The
 * deeper the chain, the more of it is wrong.
 */
export const SUPPLEMENT_CHAIN_COPY_SKIP_FIELDS = [
  'has_supplement',
  'has_supplement_id',
  'has_supplement_number',
  'supplement_of',
  'supplement_of_number',
];

/**
 * Everything a copy-forward must drop: the parent's identity, its workflow
 * state, both directions of its chain links, and its change-order approval.
 */
export const SUPPLEMENT_COPY_SKIP_FIELDS = [
  'id',
  'estimate_number',
  'created_date',
  'created_at',
  'updated_at',
  'status',
  ...SUPPLEMENT_CHAIN_COPY_SKIP_FIELDS,
  ...CHANGE_ORDER_COPY_SKIP_FIELDS,
];

/**
 * The fields of a parent estimate that may be copied onto a new supplement or
 * change order. Used by BOTH creation paths (the Estimates list and the
 * estimate editor) so they cannot drift apart.
 *
 * The chain and change-order fields are not real columns, so a read hands them
 * back twice: flattened onto the row AND inside the `data` JSONB they were read
 * from. Stripping only the flattened copy would write the parent's child
 * pointer straight back through `data`, so `data` is filtered too.
 */
export function buildSupplementCopyData(estimate) {
  const skip = new Set(SUPPLEMENT_COPY_SKIP_FIELDS);
  const copy = Object.fromEntries(
    Object.entries(estimate || {}).filter(([key]) => !skip.has(key)),
  );
  if (copy.data && typeof copy.data === 'object' && !Array.isArray(copy.data)) {
    copy.data = Object.fromEntries(
      Object.entries(copy.data).filter(([key]) => !skip.has(key)),
    );
  }
  return copy;
}

/** True when this estimate was created as a change order. */
export function isChangeOrder(estimate) {
  return !!estimate?.is_change_order;
}

/**
 * A change order's approval state. Anything flagged as a change order without
 * an explicit state is pending — an unrecognized state is treated as pending
 * too, so a bad value can never read as approved and slip into an invoice.
 */
export function changeOrderStatus(estimate) {
  if (!isChangeOrder(estimate)) return null;
  const status = String(estimate.change_order_status || '').toLowerCase();
  if (status === CHANGE_ORDER_APPROVED) return CHANGE_ORDER_APPROVED;
  if (status === CHANGE_ORDER_REJECTED) return CHANGE_ORDER_REJECTED;
  return CHANGE_ORDER_PENDING;
}

export function isApprovedChangeOrder(estimate) {
  return changeOrderStatus(estimate) === CHANGE_ORDER_APPROVED;
}

export function isPendingChangeOrder(estimate) {
  return changeOrderStatus(estimate) === CHANGE_ORDER_PENDING;
}

/** Fields to write on the child when it is created as a change order. */
export function newChangeOrderFields(reason) {
  return {
    is_change_order: true,
    change_order_reason: String(reason || '').trim(),
    change_order_status: CHANGE_ORDER_PENDING,
    change_order_approved_by: '',
    change_order_approved_at: '',
    change_order_rejected_by: '',
    change_order_rejected_at: '',
  };
}

// The approve/reject decision is NOT stamped here. Approving raises what the
// homeowner is billed, so the approver's identity and timestamp are written
// server-side from the session by tenantGuard.enforceChangeOrderApproval() —
// the client only ever sends `change_order_status`.

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Dollars (or a numeric string) to integer cents. */
export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function centsToDollars(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

export function formatCents(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

/** Signed, e.g. "+$1,200.00" — used wherever a delta is shown. */
export function formatCentsSigned(cents) {
  const n = Math.round(Number(cents) || 0);
  if (n === 0) return '$0.00';
  return `${n > 0 ? '+' : '-'}$${(Math.abs(n) / 100).toFixed(2)}`;
}

/** An estimate's line items, tolerating both storage keys. */
export function estimateLineItems(estimate) {
  const items = estimate?.line_items || estimate?.items;
  return Array.isArray(items) ? items : [];
}

/** A saved line's authoritative money, in cents. Never recomputed from qty x rate. */
export function lineItemCents(item) {
  return toCents(resolveStoredRcv(item));
}

/**
 * The stored total of an estimate, in cents.
 *
 * Prefers the saved total (which already includes any discount and adjustment)
 * and only falls back to summing the lines when no total was ever stored.
 */
export function estimateTotalCents(estimate) {
  if (!estimate) return 0;
  const stored = estimate.total_amount ?? estimate.amount;
  if (stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored))) {
    return toCents(stored);
  }
  return estimateLineItems(estimate).reduce((sum, item) => sum + lineItemCents(item), 0);
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Identity of a line for diffing: its code plus its description.
 *
 * Neither alone is enough. Codes repeat across an estimate (several "RFG 240"
 * lines for different slopes) and descriptions repeat across codes. Lines that
 * share an identity are matched positionally within that group, so two
 * identical rows in the parent pair up with two identical rows in the child.
 */
function lineKey(item) {
  return `${normalizeText(item?.code)}\u0000${normalizeText(item?.description)}`;
}

function groupByKey(items) {
  const map = new Map();
  items.forEach((item, index) => {
    const key = lineKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ item, index });
  });
  return map;
}

/**
 * Compare a change order's line items against its parent's.
 *
 * Returns added / removed / repriced / unchanged plus the net delta in cents.
 * `netDeltaCents` is the line-level delta; a caller that needs the delta the
 * customer is actually billed should use `changeOrderDeltaCents`, which uses
 * the saved estimate totals so discounts and adjustments are included.
 */
export function diffLineItems(parentItems, childItems) {
  const parent = Array.isArray(parentItems) ? parentItems : [];
  const child = Array.isArray(childItems) ? childItems : [];

  const parentGroups = groupByKey(parent);
  const added = [];
  const repriced = [];
  const unchanged = [];
  const matchedParentIndexes = new Set();

  for (const childItem of child) {
    const group = parentGroups.get(lineKey(childItem));
    const match = group && group.length > 0 ? group.shift() : null;

    if (!match) {
      added.push(childItem);
      continue;
    }

    matchedParentIndexes.add(match.index);
    const beforeCents = lineItemCents(match.item);
    const afterCents = lineItemCents(childItem);
    const beforeQty = lineQuantity(match.item);
    const afterQty = lineQuantity(childItem);

    if (beforeCents !== afterCents || beforeQty !== afterQty) {
      repriced.push({
        item: childItem,
        previousItem: match.item,
        beforeCents,
        afterCents,
        deltaCents: afterCents - beforeCents,
        beforeQuantity: beforeQty,
        afterQuantity: afterQty,
        beforeRate: lineRate(match.item),
        afterRate: lineRate(childItem),
      });
    } else {
      unchanged.push(childItem);
    }
  }

  const removed = parent.filter((_, index) => !matchedParentIndexes.has(index));

  const addedCents = added.reduce((sum, item) => sum + lineItemCents(item), 0);
  const removedCents = removed.reduce((sum, item) => sum + lineItemCents(item), 0);
  const repricedCents = repriced.reduce((sum, row) => sum + row.deltaCents, 0);

  return {
    added,
    removed,
    repriced,
    unchanged,
    addedCents,
    removedCents,
    repricedCents,
    netDeltaCents: addedCents - removedCents + repricedCents,
    hasChanges: added.length > 0 || removed.length > 0 || repriced.length > 0,
  };
}

/** The full diff of a change order against its parent estimate. */
export function changeOrderDiff(changeOrder, parentEstimate) {
  return diffLineItems(estimateLineItems(parentEstimate), estimateLineItems(changeOrder));
}

/**
 * What a change order adds to the job, in cents.
 *
 * Uses the two saved estimate totals rather than the line diff, so a discount
 * or adjustment changed on the change order is reflected. Without a parent to
 * compare against there is no delta to bill — returning the change order's own
 * total there would bill the whole revised estimate a second time.
 */
export function changeOrderDeltaCents(changeOrder, parentEstimate) {
  if (!parentEstimate) return 0;
  return estimateTotalCents(changeOrder) - estimateTotalCents(parentEstimate);
}

// ---------------------------------------------------------------------------
// Invoicing
// ---------------------------------------------------------------------------

/** Index a pool of estimates by id for parent lookups. */
function indexById(estimates) {
  const byId = new Map();
  for (const est of estimates || []) {
    if (est?.id) byId.set(est.id, est);
  }
  return byId;
}

/**
 * The id of the original estimate at the top of an estimate's revision chain.
 *
 * A customer can have several unrelated estimates — two roofs, a roof and a
 * fence, last year's job and this year's. Each is its own chain. The root is
 * what tells those chains apart, and a change order may only ever be billed
 * against the chain it belongs to.
 */
export function chainRootId(estimate, byId) {
  let current = estimate;
  const seen = new Set();
  while (current?.supplement_of && byId.has(current.supplement_of)) {
    if (seen.has(current.id)) break; // corrupt cycle — stop rather than hang
    seen.add(current.id);
    current = byId.get(current.supplement_of);
  }
  return current?.id || null;
}

/**
 * The approved change orders among a pool of a customer's estimates, each
 * paired with its parent and the delta it contributes.
 *
 * Pending and rejected change orders are excluded: nobody has signed off on the
 * money yet, so it must not reach an invoice.
 *
 * `chainRoot` restricts the result to one revision chain. Callers billing a
 * specific estimate must pass it — otherwise a change order approved against
 * the customer's OTHER job would be added to this invoice.
 */
export function approvedChangeOrders(estimates, { chainRoot = null } = {}) {
  const pool = Array.isArray(estimates) ? estimates : [];
  const byId = indexById(pool);

  return pool
    .filter(isApprovedChangeOrder)
    .map((co) => {
      const parent = co.supplement_of ? byId.get(co.supplement_of) || null : null;
      return {
        changeOrder: co,
        parent,
        deltaCents: changeOrderDeltaCents(co, parent),
        diff: parent ? changeOrderDiff(co, parent) : null,
        chainRoot: chainRootId(co, byId),
      };
    })
    // A change order whose parent isn't in the pool has no comparable baseline,
    // so its delta is unknowable. Billing a guess is worse than billing nothing.
    .filter((row) => !!row.parent)
    .filter((row) => !chainRoot || row.chainRoot === chainRoot);
}

/** Total cents the approved change orders add to a job. */
export function approvedChangeOrderTotalCents(estimates, options) {
  return approvedChangeOrders(estimates, options).reduce((sum, row) => sum + row.deltaCents, 0);
}

/**
 * Invoice line items for one approved change order.
 *
 * Newly added scope is billed as its own real lines so the invoice reads like
 * work, not like an adjustment. Everything else the change order did (repricing
 * existing lines, removing scope, a changed discount) is folded into a single
 * balancing line, computed as the remainder, so the lines always sum to exactly
 * the delta no matter what was edited.
 */
export function changeOrderInvoiceLines(row) {
  const { changeOrder, deltaCents, diff } = row;
  const number = changeOrder?.estimate_number || 'change order';
  const label = `CO ${number}`;

  const lines = (diff?.added || []).map((item) =>
    toInvoiceLine({
      ...item,
      description: `[${label}] ${item.description || 'Added scope'}`,
      change_order_id: changeOrder.id,
    }),
  );

  const addedCents = lines.reduce((sum, item) => sum + lineItemCents(item), 0);
  const remainderCents = deltaCents - addedCents;

  if (remainderCents !== 0) {
    const reason = String(changeOrder?.change_order_reason || '').trim();
    lines.push(
      adjustmentLine(
        reason ? `Change order ${number} — ${reason}` : `Change order ${number} adjustment`,
        remainderCents,
        { change_order_id: changeOrder.id },
      ),
    );
  }

  return lines;
}

/**
 * Freeze a line's money onto the invoice.
 *
 * An invoice line is a snapshot, so the resolved RCV is written to both `rcv`
 * and `amount`: downstream consumers (QuickBooks sync, PDF builders) read
 * `amount`, and a line that only ever carried `rcv` would otherwise export as
 * undefined.
 */
function toInvoiceLine(item) {
  const dollars = centsToDollars(lineItemCents(item));
  return { ...item, rcv: dollars, amount: dollars };
}

function adjustmentLine(description, cents, extra = {}) {
  const amount = centsToDollars(cents);
  return {
    code: '',
    description,
    quantity: 1,
    unit: 'EA',
    rate: amount,
    rcv: amount,
    amount,
    ...extra,
  };
}

/**
 * Build the amount and line items for invoicing a job, given the base estimate
 * and the customer's full estimate pool.
 *
 * Two invariants hold on the way out:
 *
 *  - Only change orders from the BASE ESTIMATE'S OWN revision chain are
 *    included. A customer with two jobs must not have one job's approved change
 *    order billed onto the other job's invoice.
 *  - The returned lines always sum to exactly `totalCents`. A discount or
 *    adjustment saved on an estimate lives in its total, not in its lines, so a
 *    balancing line is emitted whenever the two disagree.
 */
export function buildInvoiceFromEstimates(baseEstimate, estimates) {
  const pool = Array.isArray(estimates) ? estimates : [];
  const byId = indexById(pool.some((e) => e?.id === baseEstimate?.id) ? pool : [...pool, baseEstimate]);
  const root = chainRootId(baseEstimate, byId);

  const rows = approvedChangeOrders(pool, { chainRoot: root });
  const baseCents = estimateTotalCents(baseEstimate);
  const changeOrderCents = rows.reduce((sum, row) => sum + row.deltaCents, 0);
  const totalCents = baseCents + changeOrderCents;

  const changeOrderLines = rows.flatMap(changeOrderInvoiceLines);
  const savedBaseLines = estimateLineItems(baseEstimate);

  let items = [];
  if (savedBaseLines.length > 0) {
    items = savedBaseLines.map(toInvoiceLine);
    const lineSum = items.reduce((sum, line) => sum + lineItemCents(line), 0);
    const remainder = baseCents - lineSum;
    if (remainder !== 0) {
      items.push(
        adjustmentLine(
          `${baseEstimate?.estimate_number || 'Estimate'} adjustment`,
          remainder,
        ),
      );
    }
    items.push(...changeOrderLines);
  } else if (changeOrderLines.length > 0) {
    // No saved lines to carry forward, but there is change-order detail worth
    // itemizing — stand the base up as one line so the invoice still balances.
    items = [
      adjustmentLine(`${baseEstimate?.estimate_number || 'Estimate'}`, baseCents),
      ...changeOrderLines,
    ];
  }
  // Otherwise this stays an amount-only invoice, exactly as it was before.

  return {
    baseCents,
    changeOrderCents,
    totalCents,
    chainRoot: root,
    changeOrders: rows,
    items,
  };
}

/**
 * Pick the estimate an invoice should be based on from a customer's pool.
 *
 * Change orders are excluded as candidates because their totals already contain
 * the base scope; the newest ordinary estimate with money on it is the baseline
 * and the approved change orders are then added as deltas.
 *
 * The "has money on it" test deliberately reads `total_amount` only, matching
 * the selection the invoice dialog has always made — widening it here would
 * silently change which estimate existing customers get billed from.
 */
export function pickBaseEstimate(estimates) {
  const pool = (Array.isArray(estimates) ? estimates : []).filter(
    (est) => !isChangeOrder(est) && Number(est?.total_amount) > 0,
  );
  if (pool.length === 0) return null;
  return pool
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_date || b.created_at || 0) -
        new Date(a.created_date || a.created_at || 0),
    )[0];
}
