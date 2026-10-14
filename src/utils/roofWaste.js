/**
 * Roof waste floor is 10%. Complexity can raise it. A rep override replaces
 * the applied percent and is stored next to the recommendation.
 */

export function resolveRoofWaste({
  pitchVal = 0,
  numSegments = 0,
  hipLf = 0,
  valleyLf = 0,
  overridePct = null,
} = {}) {
  const pitch = Number(pitchVal) || 0;
  const segments = Number(numSegments) || 0;
  const hip = Number(hipLf) || 0;
  const valley = Number(valleyLf) || 0;

  let recommended = 10;
  let reason = 'Simple Gable';
  if (pitch >= 10 || segments > 10) {
    recommended = 15;
    reason = pitch >= 10 ? 'Steep Pitch (10/12+)' : 'Complex Roof (>10 Facets)';
  } else if ((pitch >= 7 && pitch <= 9) || hip > 0 || (valley > 0 && pitch !== 4)) {
    recommended = 12;
    reason = hip > 0 ? 'Hip/Valley Present' : (valley > 0 ? 'Hip/Valley Present' : 'Standard Pitch (7-9/12)');
  }
  recommended = Math.max(10, recommended);

  const overrideNum = overridePct == null || overridePct === '' ? null : Number(overridePct);
  const override = Number.isFinite(overrideNum) ? Math.max(10, overrideNum) : null;

  return {
    waste_percentage: override == null ? recommended : override,
    waste_recommended_pct: recommended,
    waste_reason: reason,
    waste_override_pct: override,
  };
}
