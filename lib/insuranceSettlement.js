// Policy funding is separate from repair pricing, line-item ACV and cash received.
export const settlementFields = [
  ['roof_age_years', 'Roof age', 'years'],
  ['roof_payout_percent', 'Roof surfacing payout schedule', 'percent'],
  ['roof_rcv', 'Roof replacement cost (carrier scope)', 'money'],
  ['roof_schedule_reduction', 'Less: limited roof settlement reduction', 'deduction'],
  ['roof_payable', 'Roof payable under schedule', 'money'],
  ['payable_loss_amount', 'Carrier payable loss before code allowance / deductible', 'money'],
  ['code_upgrade_allowance', 'Code allowance — paid when incurred / subject to policy', 'money'],
  ['deductible', 'Less: policy deductible', 'deduction'],
  ['reported_check_amount', 'Settlement payment stated by carrier (not verified received)', 'money'],
  ['recoverable_depreciation', 'Eligible recoverable depreciation stated separately', 'money'],
  ['nonrecoverable_depreciation', 'Non-recoverable depreciation stated separately', 'money'],
];

export const insuranceSettlementSchema = {
  type: 'object',
  description: 'Carrier settlement summary, separate from contractor repair line items. Omit unknown fields; never guess.',
  properties: {
    basis: { type: 'string', description: 'Exact policy settlement basis, e.g. limited roof surfacing payment schedule.' },
    source_reference: { type: 'string', description: 'Page / section where the settlement figures are stated.' },
    ...Object.fromEntries(settlementFields.map(([key, label]) => [key, { type: 'number', description: label }])),
    conditions: { type: 'array', items: { type: 'string' }, description: 'Payment / recovery conditions explicitly stated in the document.' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Conflicting figures, scope differences, or ambiguity in the carrier document; identify the sections.' },
  },
};

export const insuranceSettlementPrompt = `
Extract insurance_settlement ONLY if this document actually describes carrier policy/payment terms.
Read the settlement letter AND all recap/summary pages, not just work-item tables.
Capture limited loss / roof surfacing payment schedules: roof age, payout percentage,
roof RCV BEFORE the schedule deduction, the full schedule reduction (sum house and garage
schedule adjustments once), and roof payable AFTER it. The percentage is roof-specific,
not a discount on all work. A policy schedule reduction is NOT ordinary recoverable depreciation.
Extract payable_loss_amount, code_upgrade_allowance, deductible, reported_check_amount,
and recoverable/non-recoverable depreciation ONLY where explicitly stated.
Keep negative policy schedule adjustments and deductibles OUT of repair line_items;
preserve all genuine repair line-item RCV including tax without repricing them.
Do NOT subtract code allowances twice or add them to a check that already includes them.
Distinguish "paid when incurred" allowance from amounts actually included in a stated check.
Use the settlement letter's stated payment as reported_check_amount, not as proof money was received.
Unknown amounts must be OMITTED, never invented, defaulted to zero, or calculated as guaranteed payments.
Record source_reference and explicit conditions (invoices, permits, deadlines, repairs).
If the letter's check differs from the ACV recap, or includes an allowance shown as $0 ACV /
paid when incurred elsewhere, preserve the stated figures and flag that conflict in warnings.
Flag personal-property/contents amounts that may be outside the contractor's repair scope.
Do not treat the gap between the repair estimate and stated check as a final customer balance.
When several coverage summaries are printed (Coverage A - Dwelling, Coverage A - Other Structures, Coverage B, and similar), return every one in coverage_summaries with its name and RCV. Do not keep only the first summary.
`;

export function isInsuranceSettlementAdjustment(item) {
  const description = String(item?.description || '').trim();
  return /\blimited\s+loss\s+settlement\b|\bapplication\s+of\s+(?:roof\s+)?surfacing\b|\broof\s+surfacing\s+(?:payment\s+)?(?:schedule|table)\b/i.test(description) ||
    /^(?:less[:\s-]*)?(?:policy\s+|insured'?s?\s+)?deductible\b/i.test(description);
}

export function settlementFromDocument(value, items = []) {
  const settlement = normalizeInsuranceSettlement(value);
  let reduction = 0;
  let deductible;
  for (const item of items) {
    if (!isInsuranceSettlementAdjustment(item)) continue;
    const raw = item.rcv ?? item.amount;
    if (raw === null || raw === undefined || raw === '') continue;
    const amount = Math.abs(Number(raw));
    if (!Number.isFinite(amount)) continue;
    if (/\bdeductible\b/i.test(item.description)) deductible = amount;
    else reduction += cents(amount);
  }
  if (!settlement && !reduction && deductible === undefined) return null;
  return normalizeInsuranceSettlement({
    basis: 'Policy adjustments reported in carrier document',
    ...(reduction ? { roof_schedule_reduction: reduction / 100 } : {}),
    ...(deductible !== undefined ? { deductible } : {}),
    ...settlement,
  });
}

const money = value => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = value => typeof value === 'string' ? value.trim().slice(0, 600) : '';
const messages = values => Array.isArray(values) ? values.map(text).filter(Boolean).slice(0, 20) : [];
const cents = value => Math.round(value * 100);

export function normalizeInsuranceSettlement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {
    basis: text(value.basis),
    source_reference: text(value.source_reference),
    conditions: messages(value.conditions),
    warnings: messages(value.warnings),
  };
  for (const [key, , kind] of settlementFields) {
    const raw = value[key];
    if (raw === null || raw === undefined || raw === '' || !['number', 'string'].includes(typeof raw)) continue;
    let number = Number(typeof raw === 'string' ? raw.replace(/[$,\s]/g, '') : raw);
    if (kind === 'deduction') number = Math.abs(number);
    if (!Number.isFinite(number) || number < 0 || (kind === 'percent' && number > 100)) continue;
    result[key] = kind === 'money' || kind === 'deduction' ? cents(number) / 100 : number;
  }
  return result.basis || result.conditions.length || result.warnings.length ||
    settlementFields.some(([key]) => result[key] !== undefined) ? result : null;
}

function coverageName(entry) {
  return String(entry?.name || entry?.coverage || entry?.basis || '').trim();
}

function coverageCents(entry) {
  const raw = entry?.rcv ?? entry?.coverage_rcv ?? entry?.roof_rcv ?? entry?.payable_loss_amount ?? entry?.reported_check_amount;
  if (raw === null || raw === undefined || raw === '') return 0;
  const number = typeof raw === 'string' ? Number(String(raw).replace(/[$,\s]/g, '')) : Number(raw);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

function isDwellingCoverage(name) {
  return /\bdwelling\b/i.test(name) && !/\bother\s+structures\b/i.test(name);
}

function coverageEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nested = raw.settlement && typeof raw.settlement === 'object' ? raw.settlement : raw;
  const name = coverageName(raw) || coverageName(nested);
  const rcvCents = coverageCents(raw) || coverageCents(nested);
  if (!name && rcvCents <= 0 && !normalizeInsuranceSettlement(nested)) return null;
  return { name: name || 'Coverage summary', rcvCents, settlement: nested };
}

export function selectCoverageSettlement({ coverages = [], settlement = null, settlements = [] } = {}) {
  const combined = [];
  for (const coverage of coverages || []) combined.push(coverageEntry(coverage));
  for (const item of settlements || []) combined.push(coverageEntry(item));
  if (settlement) combined.push(coverageEntry(settlement));
  const entries = [];
  for (const entry of combined) {
    if (!entry) continue;
    const key = `${entry.name.toLowerCase()}|${entry.rcvCents}`;
    if (entries.some((existing) => `${existing.name.toLowerCase()}|${existing.rcvCents}` === key)) continue;
    entries.push(entry);
  }
  if (!entries.length) return { settlement: null, warning: '', coverages: [], chosen: null, summedRcv: 0 };

  const dwellings = entries.filter((entry) => isDwellingCoverage(entry.name));
  const ranked = [...(dwellings.length ? dwellings : entries)].sort((left, right) => right.rcvCents - left.rcvCents);
  const chosen = ranked[0];
  const summedRcv = entries.reduce((sum, entry) => sum + entry.rcvCents, 0) / 100;
  let warning = '';
  if (entries.length > 1) {
    const others = entries.filter((entry) => entry !== chosen);
    const reason = dwellings.length ? 'Dwelling' : 'largest';
    warning = `Several coverage summaries were found. Using ${chosen.name} (${money(chosen.rcvCents / 100)}), the ${reason} coverage. Other coverages: ${others.map((entry) => `${entry.name} ${money(entry.rcvCents / 100)}`).join('; ')}. All coverages sum to ${money(summedRcv)}. Other coverages were not added to the repair lines.`;
  }
  const selected = normalizeInsuranceSettlement({
    ...chosen.settlement,
    basis: chosen.settlement?.basis || chosen.name,
    warnings: [...(chosen.settlement?.warnings || []), warning].filter(Boolean),
  });
  return {
    settlement: selected,
    warning,
    coverages: entries.map((entry) => ({ name: entry.name, rcv: entry.rcvCents / 100 })),
    chosen: { name: chosen.name, rcv: chosen.rcvCents / 100 },
    summedRcv,
  };
}

export function getInsuranceSettlementSummary(value, repairTotal) {
  const settlement = normalizeInsuranceSettlement(value);
  if (!settlement) return null;
  const rows = settlementFields.filter(([key]) => settlement[key] !== undefined).map(([key, label, kind]) => ({
    key, label, value: settlement[key],
    display: kind === 'percent' ? `${settlement[key]}%` : kind === 'years' ? `${settlement[key]} years` :
      `${kind === 'deduction' ? '-' : ''}${money(settlement[key])}`,
  }));
  const warnings = [...settlement.warnings];
  if (settlement.roof_payout_percent !== undefined && settlement.roof_payout_percent < 100) {
    warnings.push('The limited roof schedule is a policy coverage reduction, not ordinary recoverable depreciation.');
  }
  if ([settlement.roof_rcv, settlement.roof_schedule_reduction, settlement.roof_payable].every(v => v !== undefined) &&
      Math.abs(cents(settlement.roof_rcv) - cents(settlement.roof_schedule_reduction) - cents(settlement.roof_payable)) > 2) {
    warnings.push('The carrier roof cost, schedule reduction and roof payable do not reconcile. Review the source.');
  }
  if ([settlement.payable_loss_amount, settlement.code_upgrade_allowance, settlement.deductible, settlement.reported_check_amount].every(v => v !== undefined) &&
      Math.abs(cents(settlement.payable_loss_amount) + cents(settlement.code_upgrade_allowance) -
        cents(settlement.deductible) - cents(settlement.reported_check_amount)) > 2) {
    warnings.push('The carrier payable loss, code allowance, deductible and stated check do not reconcile. Review the source.');
  }
  if (settlement.reported_check_amount === undefined) {
    warnings.push('No settlement payment is stated here. Do not infer a guaranteed insurance payment.');
  }
  const total = Number(repairTotal);
  if (repairTotal !== null && repairTotal !== undefined && repairTotal !== '' &&
      Number.isFinite(total) && total >= 0 && settlement.reported_check_amount !== undefined) {
    const gap = (cents(total) - cents(settlement.reported_check_amount)) / 100;
    rows.push({ key: 'comparison_gap', label: 'Repair cost less stated check — comparison only, NOT amount due', value: gap, display: money(gap) });
  }
  return {
    settlement, rows, warnings: [...new Set(warnings)],
    notice: 'Repair prices are unchanged. Carrier-stated funds are not verified payments. Conditional allowances and recoverable amounts are not guaranteed or added again to the stated check. Scope differences and future approved funds may change the customer responsibility.',
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function insuranceSettlementHtml(value, repairTotal) {
  const summary = getInsuranceSettlementSummary(value, repairTotal);
  if (!summary) return '';
  return `<section style="margin:24px 0;padding:18px;border:1px solid #cbd5e1;break-inside:avoid;color:#1e293b">
    <h3>Insurance Settlement — as reported by carrier</h3>
    <p>${escapeHtml(summary.settlement.basis)}</p>
    ${summary.settlement.source_reference ? `<p>Source: ${escapeHtml(summary.settlement.source_reference)}</p>` : ''}
    <table style="width:100%">${summary.rows.map(row => `<tr><td>${escapeHtml(row.label)}</td><td style="text-align:right">${escapeHtml(row.display)}</td></tr>`).join('')}</table>
    ${summary.settlement.conditions.map(condition => `<p>Condition: ${escapeHtml(condition)}</p>`).join('')}
    ${summary.warnings.map(warning => `<p style="color:#92400e">Review: ${escapeHtml(warning)}</p>`).join('')}
    <p style="font-size:12px">${escapeHtml(summary.notice)}</p>
  </section>`;
}

export function appendInsuranceSettlementPdf(doc, value, repairTotal) {
  const summary = getInsuranceSettlementSummary(value, repairTotal);
  if (!summary) return;
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  let y;
  const newPage = () => {
    doc.addPage();
    y = 22;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(30, 58, 138);
    doc.text('Insurance Settlement - as reported by carrier', 20, y);
    y += 10;
  };
  const paragraph = (content, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(40, 40, 40);
    for (const line of doc.splitTextToSize(String(content), width - 40)) {
      if (y > height - 28) {
        newPage();
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(9);
        doc.setTextColor(40, 40, 40);
      }
      doc.text(line, 20, y);
      y += 5;
    }
    y += 3;
  };
  newPage();
  if (summary.settlement.basis) paragraph(summary.settlement.basis, true);
  if (summary.settlement.source_reference) paragraph(`Source: ${summary.settlement.source_reference}`);
  for (const row of summary.rows) paragraph(`${row.label}: ${row.display}`, row.key === 'reported_check_amount');
  for (const condition of summary.settlement.conditions) paragraph(`Condition: ${condition}`);
  for (const warning of summary.warnings) paragraph(`REVIEW: ${warning}`);
  paragraph(summary.notice);
}
