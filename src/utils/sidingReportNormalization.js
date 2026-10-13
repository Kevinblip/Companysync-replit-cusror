/**
 * HOVER's printed "Facades" area includes openings. It is valid for a
 * pre-opening facade comparison, but never for a net siding material quantity.
 */

function positiveFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Single consumer contract for canonical siding measurements.
 * When a graph exists, consumers must not silently fall back to legacy scalar
 * fields: an inconsistent/incomplete graph is evidence for review, not license
 * to manufacture precise quantities.
 */
export function resolveCanonicalSidingContract(measurements = {}, wastePct = 0) {
  const source = measurements || {};
  const graph = source.measurement_graph || null;
  const totals = graph?.totals || null;
  const coverage = graph?.coverage || null;
  const reconciliation = graph?.reconciliation || null;
  const normalizedWastePct = Math.max(0, Number(wastePct) || 0);
  const netSqft = finiteNonNegative(totals?.net_siding_area_sqft);
  const issues = [];

  if (graph) {
    if (!totals || netSqft == null) issues.push('missing_canonical_totals');
    if (reconciliation?.consistent !== true) issues.push('reconciliation_failed');
    if (coverage?.review_required === true) issues.push('coverage_review_required');
  }

  const supported = !!graph
    && netSqft != null
    && reconciliation?.consistent === true;
  const precise = supported && coverage?.review_required !== true;
  const billableBaseSqft = graph ? (netSqft ?? 0) : resolveBillableSidingAreaSqft(source);

  return {
    graph,
    graph_present: !!graph,
    supported,
    precise,
    review_required: !!graph && (!supported || coverage?.review_required === true),
    issues,
    base_net_siding_area_sqft: billableBaseSqft,
    waste_pct: normalizedWastePct,
    waste_multiplier: 1 + normalizedWastePct / 100,
    billable_siding_area_sqft: billableBaseSqft * (1 + normalizedWastePct / 100),
    billable_siding_squares: (billableBaseSqft / 100) * (1 + normalizedWastePct / 100),
    totals,
    coverage,
    reconciliation,
  };
}

export function isHoverSidingReport(report = {}) {
  const source = report || {};
  const provider = String(source.report_provider || source.provider || '')
    .trim()
    .toLowerCase();
  return provider === 'hover' || provider.startsWith('hover ') || provider.startsWith('hover-');
}

/**
 * Normalize a report for estimate conversion without discarding the original
 * facade value that the HOVER benchmark needs.
 */
export function normalizeSidingReportForEstimate(report = {}) {
  const normalized = { ...(report || {}) };

  if (isHoverSidingReport(normalized)) {
    const explicitNetSqft = positiveFinite(normalized.net_siding_area_sqft);
    normalized.wall_area_sqft = explicitNetSqft;
    normalized.wall_area_sq = explicitNetSqft == null ? null : explicitNetSqft / 100;
    return normalized;
  }

  if (!positiveFinite(normalized.wall_area_sqft) && !positiveFinite(normalized.wall_area_sq)) {
    const facadeSqft = positiveFinite(normalized.facade_area_sqft);
    if (facadeSqft != null) {
      normalized.wall_area_sqft = facadeSqft;
      normalized.wall_area_sq = facadeSqft / 100;
    }
  }

  return normalized;
}

/**
 * Resolve the only area that may become siding material line items. A saved
 * canonical graph is authoritative; otherwise HOVER requires an explicitly
 * printed post-opening net siding area.
 */
export function resolveBillableSidingAreaSqft(measurements = {}) {
  const source = measurements || {};
  const graphNetSqft = positiveFinite(source.measurement_graph?.totals?.net_siding_area_sqft);
  if (graphNetSqft != null) return graphNetSqft;

  if (isHoverSidingReport(source)) {
    return positiveFinite(source.net_siding_area_sqft) || 0;
  }

  return positiveFinite(source.wall_area_sqft)
    || positiveFinite(source.wall_area_sq) * 100
    || 0;
}

/**
 * A facade-only HOVER report is still useful benchmark evidence even though it
 * cannot produce a base siding material line item.
 */
export function hasSidingReportEvidence(report = {}) {
  const source = report || {};
  return resolveBillableSidingAreaSqft(source) > 0
    || (isHoverSidingReport(source)
      && (positiveFinite(source.gross_siding_facade_area_sqft) != null
        || positiveFinite(source.facade_area_sqft) != null));
}

/**
 * A HOVER Complete Measurements report can contain either roof-only or siding
 * data. The merge importer must route reports with siding tables to the
 * fail-closed siding extractor instead of the roof-only path.
 */
export function classifySidingDocumentImport(classification) {
  const source = classification || {};
  const documentType = typeof source === 'string'
    ? source
    : source.document_type || source.type || '';
  const normalizedType = String(documentType).trim().toLowerCase();

  // A carrier or contractor estimate may contain an Exterior/Siding section,
  // siding quantities, and even a siding table. That does not make it a
  // siding *measurement* report. Pricing it from our measurement price list
  // loses the document's RC, depreciation and ACV columns entirely.
  //
  // Keep explicitly-priced documents ahead of the generic "has siding"
  // signal. The classifier prompt makes this distinction, but the routing
  // must remain safe even when an LLM returns both fields.
  if (normalizedType.includes('insurance')) return 'insurance_estimate';
  if (normalizedType.includes('contractor')) return 'contractor_estimate';

  if (
    source.has_siding_measurements === true
    || normalizedType.includes('siding')
    || (normalizedType.includes('hover') && normalizedType.includes('complete'))
  ) {
    return 'siding_measurement';
  }
  if (normalizedType.includes('hover')) return 'hover_measurement';
  return 'unknown';
}