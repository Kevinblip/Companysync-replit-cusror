/**
 * Siding waste starts at Kevin's 10% floor and steps up for openings,
 * corners, and gables. A rep override is stored beside the recommendation
 * so the PDF can show both. The floor still applies to an override.
 */

export function calculateSidingWaste({
  openingCount = 0,
  outsideCorners = 0,
  insideCorners = 0,
  gableAreaSqft = 0,
  overridePct = null,
} = {}) {
  let recommended = 10;
  const reasons = ['10% floor'];
  const openings = Number(openingCount) || 0;
  const corners = (Number(outsideCorners) || 0) + (Number(insideCorners) || 0);
  const gable = Number(gableAreaSqft) || 0;

  if (openings >= 12) {
    recommended += 3;
    reasons.push(`${openings} openings`);
  } else if (openings >= 6) {
    recommended += 2;
    reasons.push(`${openings} openings`);
  }
  if (corners >= 8) {
    recommended += 2;
    reasons.push(`${corners} corners`);
  } else if (corners > 4) {
    recommended += 1;
    reasons.push(`${corners} corners`);
  }
  if (gable > 0) {
    recommended += 2;
    reasons.push('gables');
  }
  if (reasons.length === 1) reasons.push('simple walls');
  recommended = Math.min(18, Math.max(10, recommended));

  const overrideNum = overridePct == null || overridePct === '' ? null : Number(overridePct);
  const override = Number.isFinite(overrideNum) ? Math.max(10, overrideNum) : null;
  const applied = override == null ? recommended : override;

  return {
    recommended_pct: recommended,
    applied_pct: applied,
    override_pct: override,
    reason: `${reasons.join(', ')} → ${recommended}%`,
  };
}
