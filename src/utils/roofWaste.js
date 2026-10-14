// Waste starts at 10% and rises only when the roof is harder to cut.
// A plain gable stays at 10%. Hips, valleys, extra facets, steep pitch,
// dormers, and specialty materials each add to that base.

export function roofWasteRecommendation(analysis) {
  const roof = analysis || {};
  const type = String(roof.roof_type || '').toLowerCase().replace(/_/g, ' ');
  const hipLf = Number(roof.hip_lf) || 0;
  const valleyLf = Number(roof.valley_lf) || 0;
  const facets = Number(roof.num_segments || roof.facet_count) || 0;
  const pitchNum = parseInt(String(roof.pitch || '').split('/')[0], 10) || 0;
  const dormers = Number(roof.dormer_count || roof.dormers) || (/dormer/.test(type) ? 1 : 0);
  const material = String(roof.roof_material || roof.material || roof.shingle_type || '').toLowerCase();

  let pct = 10;
  const reasons = [];

  const hasHip = hipLf > 0 || type.includes('hip');
  const hasValley = valleyLf > 0 || type.includes('valley');
  if (hasHip || hasValley) {
    pct += hasHip && hasValley ? 3 : 2;
    reasons.push(hasHip && hasValley ? 'hips and valleys' : hasHip ? 'hips' : 'valleys');
  }

  if (facets >= 8 || type.includes('complex')) {
    pct += 3;
    reasons.push(facets > 0 ? `${facets} facets` : 'many facets');
  } else if (facets >= 5) {
    pct += 2;
    reasons.push(`${facets} facets`);
  }

  if (pitchNum >= 9) {
    pct += 2;
    reasons.push(roof.pitch ? `${roof.pitch} pitch` : 'steep pitch');
  } else if (pitchNum >= 7) {
    pct += 1;
    reasons.push(roof.pitch ? `${roof.pitch} pitch` : 'steep pitch');
  }

  if (dormers > 0) {
    pct += 2;
    reasons.push(dormers === 1 ? 'dormer' : 'dormers');
  }

  if (/\b(slate|tile|wood|cedar|metal)\b/.test(material)) {
    pct += 2;
    reasons.push(material);
  }

  pct = Math.min(pct, 20);

  if (reasons.length === 0) {
    const shape = type.includes('hip') ? 'hip' : 'gable, simple';
    return { pct: 10, reason: `10% — ${shape}` };
  }

  return { pct, reason: `${pct}% — ${reasons.join(', ')}` };
}
