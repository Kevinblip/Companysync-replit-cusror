/**
 * Shared mapping between map compass controls and the canonical siding faces.
 * Compass labels describe the outward-facing wall direction; the photo workflow
 * calls the street-facing elevation "front", which is the south-facing wall in
 * the canonical graph.
 */
export const FACADE_BY_COMPASS = {
  N: { compass: 'N', label: 'North', azimuth: 0 },
  E: { compass: 'E', label: 'East', azimuth: 90 },
  S: { compass: 'S', label: 'South', azimuth: 180 },
  W: { compass: 'W', label: 'West', azimuth: 270 },
};

export function facadeForCompass(compass) {
  return FACADE_BY_COMPASS[String(compass || '').trim().toUpperCase()] || null;
}

export function normalizeFacade(face) {
  const value = String(face || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'right' || value.startsWith('right_') || value === 'right_side' || value === 'east') return 'right_side';
  if (value === 'left' || value.startsWith('left_') || value === 'left_side' || value === 'west') return 'left_side';
  if (value === 'rear' || value.startsWith('rear_') || value === 'back' || value.startsWith('back_') || value === 'north') return 'back';
  if (value === 'front' || value.startsWith('front_') || value === 'south') return 'front';
  return null;
}

export function facadeAzimuth(face) {
  const canonical = normalizeFacade(face);
  return ({ front: 180, right_side: 90, back: 0, left_side: 270 })[canonical] ?? null;
}

function angularDifference(a, b) {
  const difference = Math.abs(((a - b) % 360 + 360) % 360);
  return difference > 180 ? 360 - difference : difference;
}

/**
 * Resolve a semantic facet only from an explicit, trusted face-to-azimuth map.
 * Polygon ordering/shape alone cannot establish which physical wall is "front".
 */
export function semanticFacadeForAzimuth(azimuth, facadeAzimuths) {
  if (!Number.isFinite(Number(azimuth)) || !facadeAzimuths || typeof facadeAzimuths !== 'object') return null;
  const candidates = Object.entries(facadeAzimuths)
    .map(([face, value]) => ({ face: normalizeFacade(face), azimuth: Number(value) }))
    .filter(item => item.face && Number.isFinite(item.azimuth));
  candidates.sort((a, b) => angularDifference(a.azimuth, Number(azimuth)) - angularDifference(b.azimuth, Number(azimuth)));
  return candidates.length && angularDifference(candidates[0].azimuth, Number(azimuth)) <= 45
    ? candidates[0].face
    : null;
}