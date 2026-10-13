/**
 * Fail-closed CompanySync ↔ HOVER siding benchmark.
 *
 * This module deliberately does not produce one aggregate "accuracy" score.
 * Each comparable field keeps its own signed/absolute difference, uncertainty,
 * and discrepancy cause. No comparison is emitted until the uploaded report is
 * verified as a HOVER siding report for the same property.
 */

export const SIDING_BENCHMARK_VERSION = '1.0.0';

export const SIDING_DISCREPANCY_CAUSES = Object.freeze({
  EVIDENCE_COVERAGE: 'evidence_coverage',
  CLASSIFICATION: 'classification',
  SCALE: 'scale',
  GEOMETRY: 'geometry',
  ESTIMATE_CONVERSION: 'estimate_conversion',
  MISSING_REFERENCE: 'missing_reference',
});

const ADDRESS_REPLACEMENTS = Object.freeze({
  road: 'rd',
  street: 'st',
  avenue: 'ave',
  boulevard: 'blvd',
  drive: 'dr',
  lane: 'ln',
  court: 'ct',
  circle: 'cir',
  highway: 'hwy',
  parkway: 'pkwy',
  place: 'pl',
  terrace: 'ter',
  trail: 'trl',
  way: 'way',
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
});

function finiteOrNull(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  if (value == null) return null;
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function normalizeTokens(value) {
  let normalized = String(value || '').toLowerCase();
  for (const [word, abbreviation] of Object.entries(ADDRESS_REPLACEMENTS)) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'g'), abbreviation);
  }
  return normalized.replace(/[^a-z0-9]/g, '');
}

function addressText(property) {
  if (typeof property === 'string') return property;
  return String(
    property?.address
    || property?.property_address
    || property?.full_address
    || '',
  );
}

function streetText(property) {
  if (typeof property === 'object' && property) {
    const explicit = property.street_address || property.address_line_1 || property.street;
    if (explicit) return String(explicit);
  }
  return addressText(property).split(',')[0] || '';
}

function cityText(property) {
  if (typeof property === 'object' && property?.city) return String(property.city);
  const parts = addressText(property).split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[1] : '';
}

function stateText(property) {
  if (typeof property === 'object' && property?.state) return String(property.state);
  const match = addressText(property).match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
  return match?.[1] || '';
}

function postalCode(property) {
  if (typeof property === 'object' && property) {
    const explicit = property.postal_code || property.zip || property.zip_code;
    if (explicit) return String(explicit).match(/\d{5}/)?.[0] || '';
  }
  const matches = addressText(property).match(/\b\d{5}\b/g) || [];
  // A five-digit house number can precede the postal code. The ZIP is the last
  // five-digit token in a conventional printed US property address.
  return matches[matches.length - 1] || '';
}

function propertyId(property) {
  if (!property || typeof property !== 'object') return '';
  return String(
    property.property_id
    || property.hover_property_id
    || property.report_property_id
    || '',
  ).trim();
}

export function normalizeSidingBenchmarkAddress(value) {
  const property = typeof value === 'string' ? { address: value } : (value || {});
  return {
    street: normalizeTokens(streetText(property)),
    city: normalizeTokens(cityText(property)),
    state: normalizeTokens(stateText(property)),
    postal_code: postalCode(property),
    property_id: propertyId(property),
    display_address: addressText(property).trim(),
  };
}

/**
 * Verify the printed HOVER property identity before any measurements are scored.
 * The HOVER property ID must be present in the report. CompanySync does not
 * normally know that vendor ID, but when it does, the two values must agree.
 */
export function matchSidingBenchmarkProperty(subjectProperty, reportProperty) {
  const subject = normalizeSidingBenchmarkAddress(subjectProperty);
  const report = normalizeSidingBenchmarkAddress(reportProperty);
  const evidence = {
    subject,
    report,
    checks: {
      report_property_id_present: !!report.property_id,
      street_match: !!subject.street && subject.street === report.street,
      city_match: !!subject.city && !!report.city && subject.city === report.city,
      state_match: !!subject.state && !!report.state && subject.state === report.state,
      postal_code_match:
        !!subject.postal_code
        && !!report.postal_code
        && subject.postal_code === report.postal_code,
      property_id_match:
        !subject.property_id
        || !report.property_id
        || subject.property_id === report.property_id,
    },
  };

  if (!subject.street || !report.street || !report.property_id) {
    return {
      status: 'unknown',
      reason: !report.property_id
        ? 'property_identity_unverified'
        : 'property_address_missing',
      evidence,
    };
  }

  const requiredAddressPartsPresent =
    !!subject.city
    && !!subject.state
    && !!subject.postal_code
    && !!report.city
    && !!report.state
    && !!report.postal_code;
  if (!requiredAddressPartsPresent) {
    return { status: 'unknown', reason: 'property_identity_unverified', evidence };
  }

  const mismatch =
    !evidence.checks.street_match
    || !evidence.checks.city_match
    || !evidence.checks.state_match
    || !evidence.checks.postal_code_match
    || !evidence.checks.property_id_match;
  if (mismatch) {
    return { status: 'mismatch', reason: 'property_identity_mismatch', evidence };
  }

  return { status: 'matched', reason: null, evidence };
}

function canonicalUncertaintyPct(graph) {
  const coverage = graph?.coverage || {};
  if (coverage.status === 'complete' && Number(coverage.confidence) >= 0.85) return 10;
  if (coverage.status === 'review_required') return 15;
  return 20;
}

function canonicalGraphCompleteness(graph) {
  if (!graph?.version || !graph?.totals) return 'missing';
  const detailedCollections = [
    graph.wall_facets,
    graph.opening_groups,
    graph.opening_components,
    graph.trim_edges,
  ];
  return detailedCollections.every(Array.isArray) && graph.coverage
    ? 'complete'
    : 'partial';
}

function referenceUncertaintyPct(report) {
  const explicit = finiteOrNull(report?.uncertainty_pct);
  if (explicit != null) return Math.max(0, explicit);
  return report?.extraction_method === 'manual' || report?.extraction_method === 'structured'
    ? 5
    : 10;
}

function makeMetric({
  key,
  label,
  unit,
  canonicalValue,
  referenceValue,
  discrepancyCause,
  canonicalUncertaintyPct: canonicalPct,
  referenceUncertaintyPct: referencePct,
  notes = [],
}) {
  const canonical = finiteOrNull(canonicalValue);
  const reference = finiteOrNull(referenceValue);
  if (canonical == null || reference == null) {
    return {
      key,
      label,
      unit,
      canonical_value: canonical,
      hover_value: reference,
      comparable: false,
      signed_difference: null,
      absolute_difference: null,
      signed_percent_difference: null,
      absolute_percent_difference: null,
      uncertainty: null,
      severity: 'not_comparable',
      discrepancy_cause: reference == null
        ? SIDING_DISCREPANCY_CAUSES.MISSING_REFERENCE
        : discrepancyCause,
      notes,
    };
  }

  const signed = canonical - reference;
  const absolute = Math.abs(signed);
  const signedPct = reference === 0 ? null : (signed / Math.abs(reference)) * 100;
  const combinedUncertainty = (
    Math.abs(canonical) * canonicalPct / 100
    + Math.abs(reference) * referencePct / 100
  );
  const severity =
    absolute <= combinedUncertainty
      ? 'within_uncertainty'
      : absolute <= combinedUncertainty * 1.5
        ? 'check'
        : 'disagree';

  return {
    key,
    label,
    unit,
    canonical_value: round(canonical),
    hover_value: round(reference),
    comparable: true,
    signed_difference: round(signed),
    absolute_difference: round(absolute),
    signed_percent_difference: round(signedPct),
    absolute_percent_difference: round(signedPct == null ? null : Math.abs(signedPct)),
    uncertainty: {
      canonical_pct: canonicalPct,
      hover_pct: referencePct,
      combined_absolute: round(combinedUncertainty),
    },
    severity,
    discrepancy_cause: discrepancyCause,
    notes,
  };
}

function sum(values) {
  const usable = values.map(finiteOrNull).filter((value) => value != null);
  return usable.length ? usable.reduce((total, value) => total + value, 0) : null;
}

function componentCountFromCanonical(graph) {
  const hasGroups = Array.isArray(graph?.opening_groups);
  const hasComponents = Array.isArray(graph?.opening_components);
  if (!hasGroups && !hasComponents) return null;
  const groups = hasGroups ? graph.opening_groups : [];
  const components = hasComponents ? graph.opening_components : [];
  const groupsWithComponents = new Set(components.map((component) => component.group_id).filter(Boolean));
  return components.length + groups.filter((group) => !groupsWithComponents.has(group.id)).length;
}

function componentCountFromHover(measurements) {
  if (Array.isArray(measurements?.opening_components)) {
    return measurements.opening_components.length;
  }
  const explicit = finiteOrNull(measurements?.opening_components_count);
  if (explicit != null) return explicit;
  if (Array.isArray(measurements?.rough_openings)) {
    return sum(measurements.rough_openings.map((opening) => opening.component_count || 1));
  }
  return null;
}

function category(key, label, cause, metrics, details = {}) {
  return {
    key,
    label,
    discrepancy_cause: cause,
    metrics,
    details,
    severity: metrics.some((metric) => metric.severity === 'disagree')
      ? 'disagree'
      : metrics.some((metric) => metric.severity === 'check')
        ? 'check'
        : metrics.some((metric) => metric.comparable)
          ? 'within_uncertainty'
          : 'not_comparable',
  };
}

/**
 * Compare the canonical graph against a verified, same-property HOVER siding
 * report. `accuracy_score` and calibration payloads intentionally do not exist.
 */
export function benchmarkSidingMeasurements({
  subjectProperty,
  canonicalGraph,
  hoverReport,
} = {}) {
  const provider = String(hoverReport?.provider || '').trim().toLowerCase();
  const reportCategory = String(
    hoverReport?.report_category || hoverReport?.category || '',
  ).trim().toLowerCase();
  const identity = matchSidingBenchmarkProperty(subjectProperty, hoverReport?.property);
  const blockers = [];
  const canonicalGraphStatus = canonicalGraphCompleteness(canonicalGraph);

  if (provider !== 'hover') blockers.push('source_not_hover');
  if (!['siding', 'complete_measurements'].includes(reportCategory)) {
    blockers.push(
      reportCategory === 'roof'
        ? 'roof_report_not_siding_benchmark'
        : 'source_not_siding_report',
    );
  }
  if (identity.status !== 'matched') blockers.push(identity.reason);
  if (canonicalGraphStatus === 'missing') blockers.push('canonical_graph_missing');

  if (blockers.length) {
    return {
      version: SIDING_BENCHMARK_VERSION,
      scoreable: false,
      status: identity.status === 'mismatch' ? 'property_mismatch' : 'not_scoreable',
      blockers: [...new Set(blockers.filter(Boolean))],
      identity,
      categories: [],
      calibration_allowed: false,
      aggregate_accuracy_score: null,
      canonical_graph_status: canonicalGraphStatus,
    };
  }

  const measurements = hoverReport.measurements || {};
  const totals = canonicalGraph.totals || {};
  const coverage = canonicalGraph.coverage || {};
  const canonicalPct = canonicalUncertaintyPct(canonicalGraph);
  const hoverPct = referenceUncertaintyPct(hoverReport);
  const metric = (input) => makeMetric({
    ...input,
    canonicalUncertaintyPct: canonicalPct,
    referenceUncertaintyPct: hoverPct,
  });

  const canonicalFacets = Array.isArray(canonicalGraph.wall_facets)
    ? canonicalGraph.wall_facets.filter((facet) => !facet.is_unknown)
    : null;
  const hoverFacets = Array.isArray(measurements.wall_facets) ? measurements.wall_facets : null;
  const canonicalGroups = Array.isArray(canonicalGraph.opening_groups)
    ? canonicalGraph.opening_groups
    : null;
  const hoverOpenings = Array.isArray(measurements.rough_openings)
    ? measurements.rough_openings
    : null;
  const hoverRoughOpeningCount =
    finiteOrNull(measurements.rough_openings_count)
    ?? (hoverOpenings?.length ? hoverOpenings.length : null);
  const hoverDeduction =
    finiteOrNull(measurements.opening_deduction_sqft)
    ?? finiteOrNull(measurements.opening_area_sqft);
  const hoverJChannel =
    finiteOrNull(measurements.j_channel_lf)
    ?? finiteOrNull(measurements.opening_perimeter_lf);
  const hoverNetSiding = finiteOrNull(measurements.net_siding_area_sqft);
  const hoverStarter =
    finiteOrNull(measurements.trim?.level_starter_lf)
    ?? finiteOrNull(measurements.level_starter_lf);
  const hoverCoveredFaces =
    finiteOrNull(measurements.coverage?.covered_face_count)
    ?? (Array.isArray(measurements.coverage?.covered_faces)
      ? measurements.coverage.covered_faces.length
      : null);

  const categories = [
    category(
      'wall_facets',
      'Canonical wall facets',
      SIDING_DISCREPANCY_CAUSES.GEOMETRY,
      [
        metric({
          key: 'wall_facet_count',
          label: 'Wall facets',
          unit: 'EA',
          canonicalValue: canonicalFacets?.length,
          referenceValue: hoverFacets?.length || measurements.wall_facets_count,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.GEOMETRY,
        }),
        metric({
          key: 'siding_facade_area_sqft',
          label: 'Gross siding-clad wall area',
          unit: 'ft²',
          canonicalValue: totals.siding_facade_area_sqft,
          referenceValue:
            measurements.gross_siding_facade_area_sqft
            ?? measurements.facade_area_sqft,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.SCALE,
          notes: ['HOVER “Facades” includes openings and is compared to CompanySync’s pre-opening siding facade. It is never substituted for net siding.'],
        }),
      ],
      { companysync: canonicalFacets, hover: hoverFacets },
    ),
    category(
      'rough_opening_assemblies',
      'Rough-opening assemblies',
      SIDING_DISCREPANCY_CAUSES.CLASSIFICATION,
      [
        metric({
          key: 'rough_opening_count',
          label: 'Rough-opening assemblies',
          unit: 'EA',
          canonicalValue: canonicalGroups?.length,
          referenceValue: hoverRoughOpeningCount,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.CLASSIFICATION,
        }),
      ],
      { companysync: canonicalGroups, hover: hoverOpenings },
    ),
    category(
      'opening_components',
      'Individual opening components',
      SIDING_DISCREPANCY_CAUSES.CLASSIFICATION,
      [
        metric({
          key: 'opening_component_count',
          label: 'Individual opening components',
          unit: 'EA',
          canonicalValue: componentCountFromCanonical(canonicalGraph),
          referenceValue: componentCountFromHover(measurements),
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.CLASSIFICATION,
          notes: ['Mulled units are components; rough openings remain the deduction authority.'],
        }),
      ],
      {
        companysync: canonicalGraph.opening_components || null,
        hover: measurements.opening_components || null,
      },
    ),
    category(
      'opening_deductions',
      'Opening deductions',
      SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION,
      [
        metric({
          key: 'opening_deduction_sqft',
          label: 'Siding opening deduction',
          unit: 'ft²',
          canonicalValue: totals.opening_deduction_sqft,
          referenceValue: hoverDeduction,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION,
          notes: ['CompanySync applies its selected small-opening-in-waste rule; HOVER reports gross opening area.'],
        }),
      ],
    ),
    category(
      'j_channel',
      'J-channel perimeter',
      SIDING_DISCREPANCY_CAUSES.GEOMETRY,
      [
        metric({
          key: 'j_channel_lf',
          label: 'Opening perimeter / J-channel',
          unit: 'LF',
          canonicalValue: totals.j_channel_lf,
          referenceValue: hoverJChannel,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.GEOMETRY,
        }),
      ],
    ),
    category(
      'net_siding',
      'Net siding',
      SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION,
      [
        metric({
          key: 'net_siding_area_sqft',
          label: 'Net siding area',
          unit: 'ft²',
          canonicalValue: totals.net_siding_area_sqft,
          referenceValue: hoverNetSiding,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION,
          notes: ['Missing report values remain unavailable; they are never treated as zero.'],
        }),
      ],
    ),
    category(
      'trim',
      'Trim',
      SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION,
      [
        metric({
          key: 'level_starter_lf',
          label: 'Level starter',
          unit: 'LF',
          canonicalValue: totals.starter_strip_lf,
          referenceValue: hoverStarter,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.ESTIMATE_CONVERSION,
        }),
      ],
      { hover: measurements.trim || null },
    ),
    category(
      'coverage',
      'Evidence coverage',
      SIDING_DISCREPANCY_CAUSES.EVIDENCE_COVERAGE,
      [
        metric({
          key: 'covered_face_count',
          label: 'Covered elevations',
          unit: 'EA',
          canonicalValue: Array.isArray(coverage.covered_faces) ? coverage.covered_faces.length : null,
          referenceValue: hoverCoveredFaces,
          discrepancyCause: SIDING_DISCREPANCY_CAUSES.EVIDENCE_COVERAGE,
        }),
      ],
      {
        companysync: coverage,
        hover: measurements.coverage || null,
      },
    ),
  ];

  return {
    version: SIDING_BENCHMARK_VERSION,
    scoreable: true,
    status: canonicalGraphStatus === 'complete' ? 'compared' : 'partial_comparison',
    blockers: [],
    identity,
    categories,
    summary: {
      within_uncertainty: categories.filter((item) => item.severity === 'within_uncertainty').length,
      check: categories.filter((item) => item.severity === 'check').length,
      disagree: categories.filter((item) => item.severity === 'disagree').length,
      not_comparable: categories.filter((item) => item.severity === 'not_comparable').length,
    },
    calibration_allowed: false,
    aggregate_accuracy_score: null,
    canonical_graph_status: canonicalGraphStatus,
  };
}

export default benchmarkSidingMeasurements;