/**
 * Itemized openings are a measured area. A 10/15/20/25 snap is only the
 * allowance used when no opening was actually measured. Applying that snap
 * to a photo schedule is what printed "Opening Deduction 15%" on a house
 * whose windows and doors already had areas.
 */
export function applyMeasuredOpeningDeduction(data) {
  const source = data || {};
  const detectedW = source.windows_count ?? source.window_assemblies_count ?? 0;
  const detectedD = source.doors_count ?? 0;
  const detectedGD = source.garage_door_count ?? 0;
  const backendGross = Number(source.gross_wall_area_sqft) || 0;
  const backendDeduction = Number(source.opening_deduction_sqft ?? source.opening_deduct_sqft) || 0;
  if (!(backendGross > 0 && backendDeduction > 0 && (detectedW + detectedD + detectedGD) > 0)) {
    return null;
  }
  const rawPct = (backendDeduction / backendGross) * 100;
  const itemized = (Array.isArray(source.openings_detail) && source.openings_detail.length > 0)
    || Number(source.measurement_graph?.totals?.opening_area_total_sqft) > 0
    || Number(source.measurement_graph?.counts?.rough_openings) > 0
    || source.opening_deduction_basis === 'measured';
  const snappedPct = Math.max(10, Math.min(25, Math.round(rawPct / 5) * 5));
  source.opening_deduction_basis = itemized ? 'measured' : 'allowance';
  source.opening_deduction_pct = itemized ? Math.round(rawPct * 10) / 10 : snappedPct;
  source._photo_detected_windows = detectedW;
  source._photo_detected_doors = detectedD;
  source._photo_detected_garage_doors = detectedGD;
  source._photo_detected_opening_pct = Math.round(rawPct * 10) / 10;
  source._photo_detected_snapped_pct = itemized ? null : snappedPct;
  return { rawPct, snappedPct, measured: itemized };
}

export function openingDeductionLabel(measurements = {}) {
  const sqft = Number(measurements.opening_deduction_sqft ?? measurements.opening_deduct_sqft) || 0;
  const areaTotal = Number(measurements.measurement_graph?.totals?.opening_area_total_sqft) || sqft;
  const measured = measurements.opening_deduction_basis === 'measured'
    || (Array.isArray(measurements.openings_detail) && measurements.openings_detail.length > 0);
  if (measured && areaTotal > 0) return `${Math.round(areaTotal).toLocaleString()} sqft measured`;
  const pct = Number(measurements.opening_deduction_pct) || 0;
  return pct > 0 ? `${pct}% (windows/doors)` : '—';
}
