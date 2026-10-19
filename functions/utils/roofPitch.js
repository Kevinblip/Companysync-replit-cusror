/**
 * Predominant pitch is the area-weighted mode, not the mean.
 * A small dormer must not pull a 7/12 roof down to 6/12.
 * Each plane is binned to the nearest x/12 the rest of the estimator already uses.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function areaWeightedPitchMode(segments) {
  const bins = new Map();
  let tanWeighted = 0;
  let areaSum = 0;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const deg = num(seg?.pitchDegrees ?? seg?.tiltDegrees);
    const area = num(seg?.stats?.areaMeters2 ?? seg?.area);
    if (!(deg > 0) || !(area > 0)) continue;
    const rise = Math.tan((deg * Math.PI) / 180) * 12;
    const bin = Math.min(20, Math.max(1, Math.round(rise)));
    bins.set(bin, (bins.get(bin) || 0) + area);
    tanWeighted += (rise / 12) * area;
    areaSum += area;
  }
  if (!bins.size || !(areaSum > 0)) return null;
  const meanRise = (tanWeighted / areaSum) * 12;
  let best = null;
  for (const [rise, area] of bins) {
    const closer = best && Math.abs(area - best.area) <= 1e-6 && Math.abs(rise - meanRise) < Math.abs(best.rise - meanRise);
    if (!best || area > best.area + 1e-6 || closer) best = { rise, area };
  }
  return {
    label: `${best.rise}/12`,
    rise: best.rise,
    degrees: (Math.atan(best.rise / 12) * 180) / Math.PI,
    source: 'solar_segments_area_mode',
  };
}
