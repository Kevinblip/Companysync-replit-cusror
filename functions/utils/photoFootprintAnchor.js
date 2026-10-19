/**
 * Photos measure height, openings, and material. They do not replace a
 * measured building outline. A footprint that is longer than the photo box
 * is the part of the house the photos did not see; discarding it is what
 * turned a 154 LF wall line into a 108 LF box.
 *
 * Reject the satellite outline only when it is much smaller than the photos.
 * That is the wrong-building case. A photo run that is short of the outline
 * keeps the outline.
 */

const MIN_SATELLITE_TO_PHOTO = 0.55;

export function acceptSatelliteFootprint({ photoPerimeterFt, satellitePerimeterFt } = {}) {
  const photo = Number(photoPerimeterFt);
  const satellite = Number(satellitePerimeterFt);
  if (!(satellite > 0)) return { accept: false, reason: 'no_satellite', ratio: null };
  if (!(photo > 0)) return { accept: true, reason: 'no_photo_estimate', ratio: null };
  const ratio = satellite / photo;
  if (ratio < MIN_SATELLITE_TO_PHOTO) {
    return { accept: false, reason: 'satellite_smaller_than_photos', ratio };
  }
  if (ratio > 4) return { accept: true, reason: 'photos_short_of_footprint', ratio };
  return { accept: true, reason: 'within_band', ratio };
}

/**
 * A polygon the caller already measured (OSM, Solar, or a prior footprint).
 * Returns null for a missing, tiny, or absurd ring so the photo box is used
 * only when there is no outline to anchor to.
 */
export function footprintFromClientPolygon(polygon, { perimeterFt } = {}) {
  if (!Array.isArray(polygon) || polygon.length < 4) return null;
  const ring = polygon.filter((point) => Array.isArray(point)
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1])));
  if (ring.length < 4) return null;
  let traced = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    traced += Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
  }
  const stated = Number(perimeterFt);
  const perimeter = stated >= 40 && stated <= 600 ? stated : traced;
  if (!(perimeter >= 40 && perimeter <= 600)) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return {
    polygon: ring,
    perimeterFt: Math.round(perimeter),
    lengthFt: Math.round(Math.max(spanX, spanY)),
    widthFt: Math.round(Math.min(spanX, spanY)),
  };
}

/** The pin outline is a different building when its scale misses the photos by more than this. */
export const FOOTPRINT_PHOTO_DISAGREE = 0.25;

/**
 * The roof edge agrees with a candidate only when there is a real eave/rake
 * length to compare. A missing roof (roofError 0 because the length is under
 * 20 ft) is not agreement. A 35–49% miss is not an outbuilding.
 */
export function roofEdgeAgrees(roofEdgeFt, roofError) {
  const roof = Number(roofEdgeFt) || 0;
  const error = Number(roofError);
  if (!(roof > 20) || !Number.isFinite(error)) return false;
  return error <= FOOTPRINT_PHOTO_DISAGREE;
}

function positivePhotoWidths(photoWidths = []) {
  return (Array.isArray(photoWidths) ? photoWidths : [])
    .map(Number)
    .filter((width) => width > 5);
}

/**
 * The longest wall the photos measured, and the perimeter those two different
 * wall lengths imply. A second reading of the same long wall is not a depth.
 */
export function photoOutlineSummary(photoWidths = []) {
  const widths = positivePhotoWidths(photoWidths).sort((a, b) => b - a);
  if (!widths.length) return null;
  const longest = widths[0];
  const depth = widths.find((width) => width <= longest * 0.85) || null;
  return {
    longest,
    depth,
    perimeter: depth ? 2 * (longest + depth) : null,
    count: widths.length,
  };
}

function candidateLongestFt(candidate) {
  return Math.max(Number(candidate?.lengthFt) || 0, Number(candidate?.widthFt) || 0);
}

/**
 * How far a footprint's scale is from the photos.
 * Compares the longest side to the longest photo width, and the total
 * perimeter to the perimeter implied by the two photo widths. It does not
 * match each photo to the nearest edge: on an L, one elevation is several
 * colinear edges, and the nearest of those edges is the wrong comparison.
 */
export function footprintPhotoScaleError(candidate, photoWidths = []) {
  const summary = photoOutlineSummary(photoWidths);
  const longestFoot = candidateLongestFt(candidate);
  if (!summary || !(longestFoot > 0)) return null;
  const longestErr = Math.abs(longestFoot - summary.longest) / summary.longest;
  const perimeter = Number(candidate?.perimeterFt) || 0;
  if (!(summary.perimeter > 0) || !(perimeter > 0)) return longestErr;
  const perimeterErr = Math.abs(perimeter - summary.perimeter) / summary.perimeter;
  return (longestErr + perimeterErr) / 2;
}

/**
 * The outline at the pin is not the building in the photos.
 * One cropped wall is not enough; the longest side and the perimeter have
 * to miss by more than 25%.
 */
export function footprintDisagreesWithPhotos(candidate, photoWidths = []) {
  if (positivePhotoWidths(photoWidths).length < 2) return false;
  const error = footprintPhotoScaleError(candidate, photoWidths);
  return error != null && error > FOOTPRINT_PHOTO_DISAGREE;
}

/** A candidate is a smaller building only when its perimeter is at least 8% under the pin. */
export function footprintSmallerThan(candidate, pin) {
  const next = Number(candidate?.perimeterFt) || 0;
  const prev = Number(pin?.perimeterFt) || 0;
  return prev > 0 && next > 0 && next < prev * 0.92;
}

/** The footprint already chosen for this pin, as a picker candidate. */
export function footprintBoxCandidate(polygon, { lengthFt = 0, widthFt = 0, perimeterFt = 0 } = {}) {
  const edgeLengths = [];
  if (Array.isArray(polygon) && polygon.length >= 3) {
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const len = Math.hypot(Number(b[0]) - Number(a[0]), Number(b[1]) - Number(a[1]));
      if (len >= 1) edgeLengths.push(len);
    }
  }
  if (!edgeLengths.length && !(Number(lengthFt) > 0)) return null;
  return {
    polygon: Array.isArray(polygon) ? polygon : null,
    lengthFt: Number(lengthFt) || 0,
    widthFt: Number(widthFt) || 0,
    perimeterFt: Number(perimeterFt) || 0,
    edgeLengths,
  };
}

const EARTH_RADIUS_FT = 20902231;

function haversineFt(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_FT * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Microsoft and OSM buildings share the picker. Each ring is one candidate. */
export function footprintCandidatesFromBuildings(buildings) {
  const list = Array.isArray(buildings) ? buildings : [];
  const candidates = [];
  for (const building of list) {
    const geometry = building?.el?.geometry || building?.geometry || building;
    const ring = projectRingFeet(geometry);
    if (ring) candidates.push({ ...ring, source: 'microsoft' });
  }
  return candidates;
}

export function projectRingFeet(nodes) {
  const raw = Array.isArray(nodes) ? nodes : [];
  if (raw.length < 3) return null;
  const closed = raw.length > 1
    && raw[0].lat === raw[raw.length - 1].lat
    && raw[0].lon === raw[raw.length - 1].lon;
  const open = closed ? raw.slice(0, -1) : raw.slice();
  if (open.length < 3) return null;
  const lats = open.map((n) => n.lat);
  const lngs = open.map((n) => n.lon);
  const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
  const cLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
  const polygon = open.map((n) => [
    haversineFt(cLat, cLng, cLat, n.lon) * (n.lon >= cLng ? 1 : -1),
    haversineFt(cLat, cLng, n.lat, cLng) * (n.lat >= cLat ? 1 : -1),
  ]);
  const edgeLengths = [];
  let perimeter = 0;
  for (let i = 0; i < open.length; i += 1) {
    const a = open[i];
    const b = open[(i + 1) % open.length];
    const len = haversineFt(a.lat, a.lon, b.lat, b.lon);
    if (len >= 1) edgeLengths.push(len);
    perimeter += len;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    polygon,
    perimeterFt: perimeter,
    lengthFt: Math.max(maxX - minX, maxY - minY),
    widthFt: Math.min(maxX - minX, maxY - minY),
    edgeLengths,
  };
}

/**
 * An outbuilding job has the house and the outbuilding inside the same
 * Overpass radius. The largest ring is the house. Pick the ring whose
 * longest side and perimeter match the photos, and prefer the one whose
 * perimeter also matches the roof's eave and rake length.
 * Returns null when no ring is close to the photos, so the caller keeps
 * the photo box instead of the house.
 */
export function chooseOutbuildingFootprint(candidates, { photoWidths = [], roofEdgeFt = 0 } = {}) {
  const widths = (Array.isArray(photoWidths) ? photoWidths : [])
    .map(Number)
    .filter((w) => w > 5);
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!widths.length || !list.length) return null;
  const roof = Number(roofEdgeFt) || 0;
  let best = null;
  let bestScore = Infinity;
  for (const candidate of list) {
    const photoErr = footprintPhotoScaleError(candidate, widths);
    if (photoErr == null) continue;
    const perimeter = Number(candidate.perimeterFt) || 0;
    const roofErr = roof > 20 && perimeter > 0 ? Math.abs(perimeter - roof) / roof : 0;
    const score = photoErr + roofErr;
    if (score < bestScore) {
      bestScore = score;
      best = { candidate, photoError: photoErr, roofError: roofErr, score };
    }
  }
  if (!best || best.photoError > 0.35) return null;
  return best;
}
