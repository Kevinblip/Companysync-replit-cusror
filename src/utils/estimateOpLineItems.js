import { resolveStoredRcv } from './estimateTotals.js';

export const OP_LINE_CODE = 'O&P';

const roundCents = (value) => Math.round((Number(value) || 0) * 100) / 100;

const hasNumber = (value) => (
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isFinite(Number(value))
);

/**
 * O&P rows are roll-up rows in an Xactimate-style estimate. Their rate is
 * intentionally zero; the calculated amount lives in RCV, just like an
 * imported Xactimate "Add'l Overhead" or "Add'l Profit" row.
 */
export function getOpLineType(item = {}) {
  const code = String(item.code || '').trim().toUpperCase();
  const description = String(item.description || item.name || '').trim().toLowerCase();

  if (code === OP_LINE_CODE || code === 'OHP') {
    if (description.includes('profit') && !description.includes('overhead')) return 'profit';
    if (description.includes('overhead') && !description.includes('profit')) return 'overhead';
    return 'combined';
  }

  if (/\bo\s*&\s*p\b|\boverhead\s*(?:&|and)\s*profit\b/.test(description)) return 'combined';
  if (/\badd(?:'|’)?l?\s+overhead\b|general\s+contractor\s+overhead\b/.test(description)) return 'overhead';
  if (/\badd(?:'|’)?l?\s+profit\b|general\s+contractor\s+profit\b/.test(description)) return 'profit';

  return null;
}

export function isOverheadProfitLine(item = {}) {
  return getOpLineType(item) !== null;
}

/**
 * The carrier's per-line calculation uses the line base plus line tax as the
 * O&P base. Overhead and profit are rounded independently to cents before they
 * are combined. This matters: rounding the combined 20% amount produces a
 * different answer on many carrier lines.
 */
export function calculatePerLineOverheadProfit(item = {}, {
  overheadPct = 10,
  profitPct = 10,
  taxRate = 0,
} = {}) {
  const base = roundCents(
    hasNumber(item.op_base_rcv) ? item.op_base_rcv : resolveStoredRcv(item)
  );
  const tax = roundCents(
    hasNumber(item.op_tax_amount)
      ? item.op_tax_amount
      : hasNumber(item.tax)
        ? item.tax
        : base * (Number(taxRate) || 0) / 100
  );
  const taxableBase = base + tax;
  const overhead = roundCents(taxableBase * (Number(overheadPct) || 0) / 100);
  const profit = roundCents(taxableBase * (Number(profitPct) || 0) / 100);
  const op = roundCents(overhead + profit);
  const rcv = roundCents(taxableBase + op);
  const depreciationPercent = Number(item.depreciation_percent) || 0;

  return {
    base,
    tax,
    overhead,
    profit,
    op,
    rcv,
    acv: roundCents(rcv * (1 - depreciationPercent / 100)),
  };
}

export function hasPerLineOverheadProfit(item = {}) {
  return hasNumber(item.op_base_rcv) || hasNumber(item.op_amount);
}

/**
 * Persist the carrier-style per-line values while retaining the original base
 * so changing templates or reopening the estimate never compounds O&P.
 */
export function applyPerLineOverheadProfit(items = [], {
  overheadPct = 10,
  profitPct = 10,
  taxRate = 0,
} = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const detailItems = sourceItems.filter(item => !isOverheadProfitLine(item));
  const updated = detailItems.map((item, index) => {
    const financials = calculatePerLineOverheadProfit(item, {
      overheadPct,
      profitPct,
      taxRate,
    });

    return {
      ...item,
      line: index + 1,
      op_base_rcv: financials.base,
      op_tax_amount: financials.tax,
      overhead_amount: financials.overhead,
      profit_amount: financials.profit,
      op_amount: financials.op,
      op_overhead_pct: Number(overheadPct) || 0,
      op_profit_pct: Number(profitPct) || 0,
      rcv: financials.rcv,
      amount: financials.rcv,
      acv: financials.acv,
    };
  });

  return {
    items: updated,
    base: roundCents(updated.reduce((sum, item) => sum + (Number(item.op_base_rcv) || 0), 0)),
    tax: roundCents(updated.reduce((sum, item) => sum + (Number(item.op_tax_amount) || 0), 0)),
    overhead: roundCents(updated.reduce((sum, item) => sum + (Number(item.overhead_amount) || 0), 0)),
    profit: roundCents(updated.reduce((sum, item) => sum + (Number(item.profit_amount) || 0), 0)),
    op: roundCents(updated.reduce((sum, item) => sum + (Number(item.op_amount) || 0), 0)),
  };
}

export function removePerLineOverheadProfit(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    if (!hasPerLineOverheadProfit(item)) return { ...item, line: index + 1 };

    const base = roundCents(item.op_base_rcv);
    const depreciationPercent = Number(item.depreciation_percent) || 0;
    return {
      ...item,
      line: index + 1,
      rcv: base,
      amount: base,
      acv: roundCents(base * (1 - depreciationPercent / 100)),
      op_base_rcv: undefined,
      op_tax_amount: undefined,
      overhead_amount: undefined,
      profit_amount: undefined,
      op_amount: undefined,
      op_overhead_pct: undefined,
      op_profit_pct: undefined,
    };
  });
}

// A deliberate estimate-level rate edit replaces explicit O&P rollups and
// uses the saved line bases, never quantity × rate on untouched carrier lines.
export function updateEstimateOverheadProfit(items = [], {
  overheadPct = 0,
  profitPct = 0,
  format = {},
} = {}) {
  const detailItems = removePerLineOverheadProfit(
    items.filter(item => !isOverheadProfitLine(item)),
  ).map(item => ({ ...item, overhead_profit: undefined }));
  const formatHasOp = format.show_overhead_profit === true || format.show_op_column === true;
  return formatHasOp
    ? applyPerLineOverheadProfit(detailItems, {
        overheadPct,
        profitPct,
        taxRate: Number(format.tax_rate) || 0,
      }).items
    : detailItems;
}

export function getOverheadProfitBase(items = []) {
  return roundCents(
    (Array.isArray(items) ? items : [])
      .filter(item => !isOverheadProfitLine(item) && String(item.code || '').trim().toUpperCase() !== 'TAX')
      .reduce((sum, item) => (
        sum + (hasNumber(item.op_base_rcv) ? Number(item.op_base_rcv) : resolveStoredRcv(item))
      ), 0)
  );
}

function makeOpLine(type, percent, base, line) {
  const amount = roundCents(base * (Number(percent) || 0) / 100);
  const label = type === 'overhead' ? 'Overhead' : 'Profit';

  return {
    line,
    code: OP_LINE_CODE,
    description: `Add'l ${label} (${Number(percent).toFixed(2).replace(/\.00$/, '')}% General)`,
    quantity: 1,
    unit: 'EA',
    rate: 0,
    rcv: amount,
    acv: amount,
    amount,
    depreciation: 0,
    depreciation_percent: 0,
    is_overhead_profit: true,
    op_component: type,
    op_percent: Number(percent) || 0,
  };
}

/**
 * Add any missing O&P components while preserving already-imported,
 * component-specific rows. A legacy combined O&P row is replaced by the
 * standard two-row representation.
 */
export function addOrReplaceOverheadProfitLineItems(items = [], {
  overheadPct = 10,
  profitPct = 10,
} = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const existingTypes = sourceItems.map(getOpLineType).filter(Boolean);
  const hasCombined = existingTypes.includes('combined');
  const hasOverhead = existingTypes.includes('overhead');
  const hasProfit = existingTypes.includes('profit');

  if (!hasCombined && hasOverhead && hasProfit) {
    return { items: sourceItems, base: getOverheadProfitBase(sourceItems), added: [] };
  }

  const retained = hasCombined
    ? sourceItems.filter(item => getOpLineType(item) !== 'combined')
    : sourceItems.slice();
  const base = getOverheadProfitBase(retained);
  const added = [];

  if (!hasOverhead && Number(overheadPct) > 0) {
    added.push(makeOpLine('overhead', overheadPct, base, retained.length + added.length + 1));
  }
  if (!hasProfit && Number(profitPct) > 0) {
    added.push(makeOpLine('profit', profitPct, base, retained.length + added.length + 1));
  }

  return {
    items: [...retained, ...added].map((item, index) => ({ ...item, line: index + 1 })),
    base,
    added,
  };
}