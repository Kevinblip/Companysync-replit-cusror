const MONEY_TOLERANCE_CENTS = 1;

export const SECTION_ONLY_TOTAL_PROMPT = `
SECTION-ONLY TOTALS (Xactimate / State Farm and other carrier PDFs):
Some sections print a total and no itemized work lines. Examples: "Totals: Right Elevation $6,106.20", "Rear $5,572.37", "Left $5,952.35".
- If a section has itemized work lines, extract those lines. Set section_totals[].item_count to the number of those lines. Do NOT also extract that section's Totals or Subtotal row.
- If a section has a printed total and ZERO itemized work lines, do NOT drop that money. Add a section_totals entry with item_count 0, the section name, and rcv equal to the printed section total. Also add one line_items row for it: description "Totals: <section name>", quantity 1, unit "LS", rate and rcv equal to that total.
- Skip grand summary rows. Do not turn "Replacement Cost Value", "ACV", "Deductible", overhead, profit, tax, "Total Materials", or "Total Labor" into line items.
- document_rcv_total is the summary grand Replacement Cost Value (RCV), before deductible. It is not the ACV and not the net payment.
`;

function cents(value) {
  const number = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100);
}

function money(centsValue) {
  return (centsValue / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function label(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function rowRcvCents(item) {
  const direct = cents(item?.rcv ?? item?.amount);
  if (direct != null) return direct;
  const rate = Number(item?.rate);
  const qty = Number(item?.quantity);
  if (Number.isFinite(rate) && Number.isFinite(qty)) return Math.round(rate * qty * 100);
  return 0;
}

function isGrandSummaryRow(item) {
  const description = String(item?.description || '').trim();
  return /^(replacement cost value|rcv total|grand total|net claim|net estimate|actual cash value|acv total|less deductible|deductible|total materials|total labor|total equipment|total tax)\b/i.test(description);
}

function isSectionTotalRow(item) {
  return /\b(subtotals?|totals?)\b/i.test(String(item?.description || ''));
}

function sectionName(section) {
  return String(section?.name || section?.description || '').trim();
}

function sectionItemCount(section) {
  if (Array.isArray(section?.line_items)) return section.line_items.length;
  const count = section?.item_count ?? section?.itemCount;
  const number = Number(count);
  return Number.isFinite(number) ? number : 0;
}

function matchesSection(item, name) {
  const desc = label(item?.description);
  const section = label(name);
  if (!desc || !section) return false;
  return desc === section
    || desc === `totals ${section}`
    || desc === `total ${section}`
    || desc === `${section} total`
    || desc === `${section} totals`
    || desc === `${section} subtotal`;
}

function sectionOnlyLine(name, rcvCents) {
  const dollars = rcvCents / 100;
  const description = /^totals?:/i.test(name) ? name : `Totals: ${name}`;
  return {
    description,
    quantity: 1,
    unit: 'LS',
    rate: dollars,
    rcv: dollars,
    acv: dollars,
    depreciation_percent: 0,
    section_only_total: true,
  };
}

function pricedWorkLines(items) {
  return items.filter((item) => !isGrandSummaryRow(item) && !isSectionTotalRow(item) && rowRcvCents(item) !== 0);
}

function rollupEqualsWork(item, workLines) {
  if (!isSectionTotalRow(item)) return false;
  const workCents = workLines.reduce((sum, line) => sum + rowRcvCents(line), 0);
  return workCents > 0 && Math.abs(rowRcvCents(item) - workCents) <= MONEY_TOLERANCE_CENTS;
}

export function includeSectionOnlyTotals({
  lineItems = [],
  sectionTotals = [],
  sections = [],
} = {}) {
  const addedSectionLines = [];

  if (Array.isArray(sections) && sections.length > 0) {
    const merged = [];
    for (const section of sections) {
      const children = Array.isArray(section?.line_items) ? section.line_items.filter((item) => !isGrandSummaryRow(item)) : [];
      const work = pricedWorkLines(children);
      if (work.length > 0) {
        merged.push(...children.filter((item) => !isSectionTotalRow(item) || !rollupEqualsWork(item, work)));
        continue;
      }
      const totalCents = cents(section?.section_rcv ?? section?.rcv ?? section?.total_rcv);
      const name = sectionName(section);
      if (!name || totalCents == null || totalCents <= 0) continue;
      const line = sectionOnlyLine(name, totalCents);
      merged.push(line);
      addedSectionLines.push(line);
    }
    return { lineItems: merged, addedSectionLines };
  }

  const kept = [];
  const incoming = Array.isArray(lineItems) ? lineItems : [];
  const work = pricedWorkLines(incoming);
  for (const item of incoming) {
    if (isGrandSummaryRow(item)) continue;
    if (rollupEqualsWork(item, work)) continue;
    kept.push(item);
  }

  for (const section of Array.isArray(sectionTotals) ? sectionTotals : []) {
    if (sectionItemCount(section) > 0) {
      const name = sectionName(section);
      for (let index = kept.length - 1; index >= 0; index -= 1) {
        if (matchesSection(kept[index], name) && isSectionTotalRow(kept[index])) kept.splice(index, 1);
      }
      continue;
    }
    const name = sectionName(section);
    const totalCents = cents(section?.rcv ?? section?.section_rcv ?? section?.total_rcv);
    if (!name || totalCents == null || totalCents <= 0) continue;
    if (kept.some((item) => matchesSection(item, name))) continue;
    const line = sectionOnlyLine(name, totalCents);
    kept.push(line);
    addedSectionLines.push(line);
  }

  return { lineItems: kept, addedSectionLines };
}

export function importedRcvGap({ lineItems = [], documentRcv } = {}) {
  const importedCents = (Array.isArray(lineItems) ? lineItems : []).reduce((sum, item) => sum + rowRcvCents(item), 0);
  const documentCents = cents(documentRcv);
  const hasDocumentTotal = documentCents != null && documentCents > 0;
  const gapCents = hasDocumentTotal ? documentCents - importedCents : null;
  const matches = !hasDocumentTotal || Math.abs(gapCents) <= MONEY_TOLERANCE_CENTS;
  let warning = null;
  if (!matches) {
    const direction = gapCents > 0 ? 'short' : 'over';
    warning = `Import total does not match the document. Imported RCV is ${money(importedCents)}. The document Replacement Cost Value is ${money(documentCents)}. The estimate is ${direction} by ${money(Math.abs(gapCents))}.`;
  }
  return {
    importedRcv: importedCents / 100,
    documentRcv: hasDocumentTotal ? documentCents / 100 : null,
    gap: gapCents == null ? null : gapCents / 100,
    matches,
    warning,
  };
}
