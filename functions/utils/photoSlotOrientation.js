/**
 * Street-facing photo slot convention (Hover / EagleView).
 *
 * Every side is named while standing in the street, looking at the front
 * of the house. Left is the viewer's left. Right is the viewer's right.
 * Back Right is the street-right rear corner, which is on the viewer's left
 * once they walk around and face the back wall.
 *
 * Compass azimuths are degrees clockwise from true north. A wall's azimuth
 * is the direction its outward normal points (the direction from the wall
 * toward a person photographing it). The camera's GPS heading points the
 * opposite way, from the photographer toward the wall.
 */

export const PHOTO_SLOT_CONVENTION = 'street_facing_front';

export const SLOT_ORIENTATION_HINT =
  'Left and right are as seen from the street, facing the front. Back Right is on your left when you stand behind the house.';

const SLOT_HINTS = {
  front: 'From the street',
  back: 'Opposite the street',
  left_side: 'Your left, from the street',
  right_side: 'Your right, from the street',
  front_left: 'Street front-left corner',
  front_right: 'Street front-right corner',
  back_left: 'Street back-left — your right from behind',
  back_right: 'Street back-right — your left from behind',
};

function normHeading(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ((n % 360) + 360) % 360;
}

function angularDifference(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Named capture slots and the walls they show, in street-facing order.
 * Corner slots list the primary elevation first (front or back), then the
 * adjoining side.
 */
export function slotFaces(label) {
  const text = String(label || '').toLowerCase().trim().replace(/[_-]+/g, ' ');
  if (!text) return [];
  const corner = /corner|angle/.test(text)
    || /\b[fb][lr]\b/.test(text)
    || /(?:front|back|rear)\s+(?:left|right)/.test(text)
    || /(?:left|right)\s+(?:front|back|rear)/.test(text);
  if (!corner) {
    if (/\bfront\b|\bsouth\b/.test(text)) return ['front'];
    if (/\bback\b|\brear\b|\bnorth\b/.test(text)) return ['back'];
    if (/\bleft\b|\bwest\b/.test(text)) return ['left_side'];
    if (/\bright\b|\beast\b/.test(text)) return ['right_side'];
    return [];
  }
  if (/\bfl\b|front\s+left|left\s+front/.test(text)) return ['front', 'left_side'];
  if (/\bfr\b|front\s+right|right\s+front/.test(text)) return ['front', 'right_side'];
  if (/\bbl\b|back\s+left|rear\s+left|left\s+back|left\s+rear/.test(text)) return ['back', 'left_side'];
  if (/\bbr\b|back\s+right|rear\s+right|right\s+back|right\s+rear/.test(text)) return ['back', 'right_side'];
  return [];
}

export function slotHint(label) {
  const faces = slotFaces(label);
  if (faces.length === 2) {
    const key = `${faces[0] === 'front' ? 'front' : 'back'}_${faces[1] === 'left_side' ? 'left' : 'right'}`;
    return SLOT_HINTS[key] || SLOT_ORIENTATION_HINT;
  }
  if (faces.length === 1) return SLOT_HINTS[faces[0]] || SLOT_ORIENTATION_HINT;
  return null;
}

/**
 * Outward-normal azimuths for a house whose front wall faces `frontOutwardAz`.
 * Left/right follow the street: a south-facing front (180°) has its left wall
 * facing west (270°) and its right wall facing east (90°).
 */
const ROAD_SKIP = /^(footway|path|cycleway|steps|corridor|bridleway|track|pedestrian)$/;

function toLocalMeters(lat, lng, originLat, originLng) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(originLat * Math.PI / 180);
  return [(lng - originLng) * mPerDegLng, (lat - originLat) * mPerDegLat];
}

/**
 * Bearing from the building toward the nearest road, which is the front
 * wall's outward normal. Overpass highway ways from the building query are
 * the input. A missing heading must not fall back to "front faces north".
 * Returns null when no street is within 80 m.
 */
export function nearestRoadFrontAzimuth(elements, latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let bestDist = Infinity;
  let bestPoint = null;
  for (const el of Array.isArray(elements) ? elements : []) {
    const highway = el?.tags?.highway;
    if (!highway || ROAD_SKIP.test(String(highway))) continue;
    const geom = Array.isArray(el.geometry) ? el.geometry : [];
    for (let i = 0; i < geom.length - 1; i += 1) {
      const a = toLocalMeters(geom[i].lat, geom[i].lon, lat, lng);
      const b = toLocalMeters(geom[i + 1].lat, geom[i + 1].lon, lat, lng);
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const len2 = abx * abx + aby * aby;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (-a[0] * abx + -a[1] * aby) / len2)) : 0;
      const px = a[0] + abx * t;
      const py = a[1] + aby * t;
      const dist = Math.hypot(px, py);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = [px, py];
      }
    }
  }
  if (!bestPoint || bestDist > 80) return null;
  const az = Math.atan2(bestPoint[0], bestPoint[1]) * 180 / Math.PI;
  return (az + 360) % 360;
}

export function streetFacingWallAzimuths(frontOutwardAz) {
  const front = normHeading(frontOutwardAz);
  if (front == null) return null;
  return {
    front,
    left: (front + 90) % 360,
    back: (front + 180) % 360,
    right: (front + 270) % 360,
  };
}

/**
 * Turn the longest footprint edge into street-relative faces once the
 * street-facing bearing is known. `streetFacingAzimuth` is the front wall's
 * outward normal (from the house toward the street).
 */
export function alignWallAzimuthsToStreet(wallAzimuths, streetFacingAzimuth) {
  const street = normHeading(streetFacingAzimuth);
  if (!wallAzimuths || street == null) return null;
  const order = ['front', 'right', 'back', 'left'];
  const azimuths = order.map((face) => normHeading(wallAzimuths[face]));
  if (azimuths.some((az) => az == null)) return null;
  let best = 0;
  let bestErr = Infinity;
  for (let rot = 0; rot < 4; rot++) {
    const err = angularDifference(street, azimuths[rot]);
    if (err < bestErr) {
      bestErr = err;
      best = rot;
    }
  }
  const rotated = {
    front: azimuths[best],
    right: azimuths[(best + 1) % 4],
    back: azimuths[(best + 2) % 4],
    left: azimuths[(best + 3) % 4],
  };
  // The source pair may itself have left and right swapped. Rebuild from the
  // chosen front so the street convention is what callers store.
  return streetFacingWallAzimuths(rotated.front);
}

const OBLIQUE_THRESHOLD_DEG = 35;

/**
 * GPSImgDirection is the direction the camera points. The wall being
 * photographed faces the camera, so its outward normal is the opposite heading.
 */
export function headingToWallFace(cameraHeading, wallAzimuths) {
  const heading = normHeading(cameraHeading);
  if (heading == null || !wallAzimuths) return null;
  const facingNormal = (heading + 180) % 360;
  const walls = [
    { face: 'front', az: normHeading(wallAzimuths.front) },
    { face: 'right_side', az: normHeading(wallAzimuths.right) },
    { face: 'back', az: normHeading(wallAzimuths.back) },
    { face: 'left_side', az: normHeading(wallAzimuths.left) },
  ].filter((wall) => wall.az != null);
  if (walls.length === 0) return null;
  walls.sort((a, b) => angularDifference(facingNormal, a.az) - angularDifference(facingNormal, b.az));
  const primary = walls[0];
  const secondary = walls[1];
  const angularError = angularDifference(facingNormal, primary.az);
  const isOblique = angularError > OBLIQUE_THRESHOLD_DEG;
  return {
    face: primary.face,
    isOblique,
    secondaryFace: isOblique && secondary ? secondary.face : null,
    angularError,
  };
}

/**
 * Where to stand, and which way to look, to photograph one wall.
 * `wallAz` is that wall's outward normal.
 */
export function cameraForWall(wallAz) {
  const outward = normHeading(wallAz);
  if (outward == null) return null;
  return {
    searchBearing: outward,
    cameraHeading: (outward + 180) % 360,
  };
}
