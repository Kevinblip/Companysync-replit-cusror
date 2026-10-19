// Billable siding material for the estimator. A confident vinyl or aluminum
// read is used as-is. A missing or low-confidence read prices as vinyl so the
// rep is not stopped on a confirm step. The summary dropdown can still change it.

import { sidingMaterial } from '../lib/sidingCatalogPricing.js';

export const SIDING_MATERIAL_CONFIDENCE_FLOOR = 80;

function confidencePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 0 && number <= 1) return Math.round(number * 1000) / 10;
  return number;
}

export function readSidingMaterialConfidence(measurements) {
  if (!measurements || typeof measurements !== 'object') return null;
  return confidencePercent(
    measurements.siding_material_confidence ?? measurements.material_confidence,
  );
}

/**
 * @returns {{ material: 'vinyl'|'aluminum', source: string, lowConfidence: boolean, detected: string|null }}
 */
export function resolveBillableSidingMaterial(measurements, override) {
  const selected = sidingMaterial(override);
  if (selected) {
    return { material: selected, source: 'selected', lowConfidence: false, detected: selected };
  }
  const detected = sidingMaterial(measurements?.siding_material);
  const confidence = readSidingMaterialConfidence(measurements);
  const lowConfidence = confidence != null && confidence < SIDING_MATERIAL_CONFIDENCE_FLOOR;
  if (!detected || lowConfidence) {
    return {
      material: 'vinyl',
      source: detected ? 'default_low_confidence' : 'default_missing',
      lowConfidence: true,
      detected: detected || null,
    };
  }
  return { material: detected, source: 'detected', lowConfidence: false, detected };
}

/**
 * Reasons that already stop siding lines from being priced. The caller shows
 * the message in a banner. Overridable reasons can be priced after the rep
 * accepts the warning.
 */
export function describeSidingPricingBlock({
  priceListLoading = false,
  measurements = null,
  roofSq = 0,
  graphPresent = false,
  graphSupported = true,
  graphIssues = [],
  ignoreOverridable = false,
} = {}) {
  const blocks = [];
  if (priceListLoading) {
    blocks.push({
      code: 'price_list_loading',
      overridable: false,
      message: 'The price list is still loading, so siding lines were not priced.',
    });
  }
  if (measurements?.sanity_review_required === true) {
    blocks.push({
      code: 'sanity_check',
      overridable: true,
      message: 'Sanity check failed: photo siding and the footprint differ by more than 25%, so siding was not priced.',
    });
  }
  if (graphPresent && graphSupported === false) {
    const detail = (graphIssues || []).filter(Boolean).join(', ');
    blocks.push({
      code: 'sanity_check',
      overridable: false,
      message: detail
        ? `Sanity check failed (${detail}), so siding was not priced.`
        : 'Sanity check failed, so siding was not priced.',
    });
  }
  const sidingSq = Number(measurements?.wall_area_sq) || 0;
  const roof = Number(roofSq) || 0;
  if (roof > 0 && sidingSq > roof * 4) {
    blocks.push({
      code: 'siding_over_roof',
      overridable: true,
      message: `Siding (${sidingSq.toFixed(1)} SQ) is more than 4× the roof (${roof.toFixed(1)} SQ), so pricing is held.`,
    });
  }
  return blocks.find((block) => !(ignoreOverridable && block.overridable)) || null;
}
