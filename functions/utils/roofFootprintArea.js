/**
 * Roof area when Google Solar measured only part of the building.
 *
 * The billable slope is the mapped footprint times the pitch factor
 * (secant of the pitch). Nothing in here reads a Hover, EagleView, or
 * other report quantity — those are comparisons, not inputs.
 */

import { areaWeightedPitchMode } from './roofPitch.js';
import { solarAreaParts, solarUndershootsFootprint } from './wallMaterialSections.js';

const FT_PER_DEG_LAT = 364567.2;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** sec(pitch) = sqrt(1 + (rise/12)^2). A flat roof has factor 1. */
export function pitchFactorFromLabel(pitchLabel) {
  const match = String(pitchLabel || '').match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (!match) return null;
  const rise = Number(match[1]);
  if (!(rise >= 0) || rise > 48) return null;
  return Math.sqrt(1 + (rise / 12) ** 2);
}

export function pitchFactorFromDegrees(pitchDegrees) {
  const deg = num(pitchDegrees);
  if (!(deg >= 0) || deg >= 80) return null;
  const cos = Math.cos(deg * Math.PI / 180);
  if (!(cos > 0.15)) return null;
  return 1 / cos;
}

export function pitchFactor({ pitchLabel = null, pitchDegrees = null } = {}) {
  return pitchFactorFromLabel(pitchLabel) || pitchFactorFromDegrees(pitchDegrees);
}

/** Plan area of a local-feet ring. Accepts [x, y] pairs or {x, y} points. */
export function ringPlanSqFt(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const pts = ring.map((p) => (
    Array.isArray(p) ? { x: num(p[0]), y: num(p[1]) } : { x: num(p?.x), y: num(p?.y) }
  )).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

function havFt(la1, ln1, la2, ln2) {
  const R = 20902231;
  const dLa = (la2 - la1) * Math.PI / 180;
  const dLn = (ln2 - ln1) * Math.PI / 180;
  const a = Math.sin(dLa / 2) ** 2
    + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLn / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Local-feet ring centred on the vertex centroid. Same haversine the roof
 * handler uses, so a footprint the eave-ratio gate rejected still has one
 * plan area.
 */
export function ringFromLatLngGeometry(geometry) {
  const nodes = Array.isArray(geometry) ? geometry : [];
  if (nodes.length < 3) return null;
  const closed = nodes.length > 1
    && nodes[0].lat === nodes[nodes.length - 1].lat
    && nodes[0].lon === nodes[nodes.length - 1].lon;
  const open = closed ? nodes.slice(0, -1) : nodes;
  if (open.length < 3) return null;
  const cLat = open.reduce((s, n) => s + num(n.lat), 0) / open.length;
  const cLng = open.reduce((s, n) => s + num(n.lon), 0) / open.length;
  const xy = open.map((n) => [
    havFt(cLat, cLng, cLat, n.lon) * (n.lon >= cLng ? 1 : -1),
    havFt(cLat, cLng, n.lat, cLng) * (n.lat >= cLat ? 1 : -1),
  ]);
  const areaSqFt = ringPlanSqFt(xy);
  if (!(areaSqFt > 0)) return null;
  return {
    xy,
    areaSqFt,
    origin: { latitude: cLat, longitude: cLng },
  };
}

/**
 * A Solar plane overlaps this outline when its center or box meets the ring.
 * A plane centered on the house does not belong to a garage 24 m away.
 */
export function segmentOverlapsBuilding(segment, geometry) {
  const ring = Array.isArray(geometry) ? geometry : [];
  if (ring.length < 3) return false;
  const lat = num(segment?.center?.latitude);
  const lng = num(segment?.center?.longitude);
  if (lat && lng && pointInGeometry(lat, lng, ring)) return true;
  const sw = segment?.boundingBox?.sw;
  const ne = segment?.boundingBox?.ne;
  const south = num(sw?.latitude);
  const west = num(sw?.longitude);
  const north = num(ne?.latitude);
  const east = num(ne?.longitude);
  if (!(south && west && north && east)) return false;
  const corners = [
    { lat: south, lon: west },
    { lat: south, lon: east },
    { lat: north, lon: east },
    { lat: north, lon: west },
  ];
  if (corners.some((corner) => pointInGeometry(corner.lat, corner.lon, ring))) return true;
  const minLat = Math.min(south, north);
  const maxLat = Math.max(south, north);
  const minLon = Math.min(west, east);
  const maxLon = Math.max(west, east);
  return ring.some((node) => {
    const nlat = num(node?.lat);
    const nlon = num(node?.lon);
    return nlat >= minLat && nlat <= maxLat && nlon >= minLon && nlon <= maxLon;
  });
}

/**
 * Pitch for a building Solar did not measure as a whole.
 * Only planes that overlap the outline count. None means the pitch is
 * unknown — the house pitch is not a substitute.
 */
export function pitchOnBuilding(segments, geometry) {
  const overlapping = (Array.isArray(segments) ? segments : []).filter((segment) => (
    segmentOverlapsBuilding(segment, geometry)
  ));
  const mode = areaWeightedPitchMode(overlapping);
  if (!mode) {
    return {
      known: false,
      label: null,
      degrees: null,
      rise: null,
      source: 'pitch_unknown',
      segmentCount: 0,
      segments: [],
    };
  }
  return {
    known: true,
    ...mode,
    source: 'solar_segments_on_building',
    segmentCount: overlapping.length,
    segments: overlapping,
  };
}

function pointInGeometry(lat, lng, geometry) {
  const geom = Array.isArray(geometry) ? geometry : [];
  if (geom.length < 3) return false;
  let inside = false;
  for (let i = 0, j = geom.length - 1; i < geom.length; j = i, i += 1) {
    const yi = num(geom[i].lat);
    const xi = num(geom[i].lon);
    const yj = num(geom[j].lat);
    const xj = num(geom[j].lon);
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function geometryCentroid(geometry) {
  const nodes = (Array.isArray(geometry) ? geometry : []).filter((n) => Number.isFinite(num(n?.lat)));
  if (!nodes.length) return null;
  const closed = nodes.length > 1
    && nodes[0].lat === nodes[nodes.length - 1].lat
    && nodes[0].lon === nodes[nodes.length - 1].lon;
  const open = closed ? nodes.slice(0, -1) : nodes;
  return {
    lat: open.reduce((s, n) => s + num(n.lat), 0) / open.length,
    lng: open.reduce((s, n) => s + num(n.lon), 0) / open.length,
  };
}

function candidateGeometry(candidate) {
  if (Array.isArray(candidate?.geometry)) return candidate.geometry;
  if (Array.isArray(candidate?.el?.geometry)) return candidate.el.geometry;
  return null;
}

export function candidateTags(candidate) {
  if (candidate?.el?.tags && typeof candidate.el.tags === 'object') return candidate.el.tags;
  if (candidate?.tags && typeof candidate.tags === 'object') return candidate.tags;
  return {};
}

/** Meters between two WGS84 points. */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const north = (num(lat2) - num(lat1)) * FT_PER_DEG_LAT;
  const east = (num(lng2) - num(lng1)) * FT_PER_DEG_LAT * Math.cos(((num(lat1) + num(lat2)) / 2) * Math.PI / 180);
  return Math.hypot(east, north) / 3.28084;
}

const STREET_SUFFIX = /\b(road|rd|drive|dr|street|st|avenue|ave|lane|ln|court|ct|boulevard|blvd|way|place|pl|terrace|ter|circle|cir|trail|trl)\b/g;

export function streetKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(STREET_SUFFIX, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Housenumber and street from a free-text address. "2051 Hanover Rd" → { number: '2051', street: 'hanover' }. */
export function parseStreetAddress(address) {
  const text = String(address || '').trim();
  const match = text.match(/^\s*(\d+[a-zA-Z]?)\s+([^,]+)/);
  if (!match) return { number: '', street: '' };
  return { number: match[1].toLowerCase(), street: streetKey(match[2]) };
}

function candidateHousenumber(candidate) {
  const tags = candidateTags(candidate);
  return String(tags['addr:housenumber'] || tags.housenumber || '').trim().toLowerCase();
}

function candidateStreet(candidate) {
  const tags = candidateTags(candidate);
  return streetKey(tags['addr:street'] || tags.street || '');
}

function addressConflicts(candidate, wanted) {
  if (!wanted?.number) return false;
  const number = candidateHousenumber(candidate);
  if (!number) return false;
  if (number !== wanted.number) return true;
  const street = candidateStreet(candidate);
  if (street && wanted.street && street !== wanted.street) return true;
  return false;
}

function addressMatches(candidate, wanted) {
  if (!wanted?.number) return false;
  if (candidateHousenumber(candidate) !== wanted.number) return false;
  const street = candidateStreet(candidate);
  if (!street || !wanted.street) return true;
  return street === wanted.street;
}

const OUTBUILDING_TARGET = /^(garage|garages|shed|outbuilding|barn|carport)$/i;

function buildingUnderPin(candidates, latitude, longitude) {
  const selected = selectAddressBuilding(candidates, latitude, longitude, {
    address: '',
    maxDistanceM: 0,
  });
  return selected.method === 'contains_point' ? selected.building : null;
}

/**
 * The building this measurement is for.
 * A house uses the address tag, then the polygon under the pin.
 * An outbuilding does not inherit that address outline, and a pin that
 * sits on a different building than the Solar centroid does not inherit
 * the Solar building either. Both use the building under or nearest the pin.
 * `solarOnDifferentBuilding` means Solar's area is a different structure,
 * so the caller bills this outline instead of that area.
 */
export function selectTargetBuilding(candidates, latitude, longitude, {
  address = '',
  maxDistanceM = 25,
  structureType = 'house',
  solarCentroid = null,
} = {}) {
  const outbuilding = OUTBUILDING_TARGET.test(String(structureType || '').trim());
  const pinBuilding = buildingUnderPin(candidates, latitude, longitude);
  const solarLat = Number(solarCentroid?.lat);
  const solarLng = Number(solarCentroid?.lng);
  const solarBuilding = Number.isFinite(solarLat) && Number.isFinite(solarLng)
    ? buildingUnderPin(candidates, solarLat, solarLng)
    : null;
  const pinDiffers = Boolean(pinBuilding && solarBuilding && pinBuilding !== solarBuilding);
  if (outbuilding || pinDiffers) {
    const selected = selectAddressBuilding(candidates, latitude, longitude, {
      address: '',
      maxDistanceM: outbuilding ? Math.max(num(maxDistanceM), 40) : maxDistanceM,
    });
    return {
      ...selected,
      solarOnDifferentBuilding: Boolean(selected.building && solarBuilding && selected.building !== solarBuilding),
    };
  }
  const selected = selectAddressBuilding(candidates, latitude, longitude, { address, maxDistanceM });
  return { ...selected, solarOnDifferentBuilding: false };
}

/**
 * The building for this address.
 * An address-tagged way wins over a larger neighbor. Otherwise the polygon
 * that contains the pin, otherwise the closest centroid inside maxDistanceM.
 * A way tagged with a different housenumber is never this roof.
 */
export function selectAddressBuilding(candidates, latitude, longitude, { address = '', maxDistanceM = 25 } = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidateGeometry(candidate)?.length >= 3);
  const wanted = parseStreetAddress(address);
  const tagged = list.filter((candidate) => addressMatches(candidate, wanted));
  if (tagged.length === 1) return { building: tagged[0], method: 'address_tag' };
  if (tagged.length > 1) {
    const inside = tagged.find((candidate) => pointInGeometry(num(latitude), num(longitude), candidateGeometry(candidate)));
    if (inside) return { building: inside, method: 'address_tag' };
    return { building: closestCandidate(tagged, latitude, longitude).candidate, method: 'address_tag' };
  }
  const eligible = list.filter((candidate) => !addressConflicts(candidate, wanted));
  // The tightest outline that contains the pin. A larger way that also
  // contains it is not this roof.
  let hit = null;
  let hitArea = Infinity;
  for (const candidate of eligible) {
    if (!pointInGeometry(num(latitude), num(longitude), candidateGeometry(candidate))) continue;
    const area = relativeRingArea(candidateGeometry(candidate));
    if (area < hitArea) {
      hit = candidate;
      hitArea = area;
    }
  }
  if (hit) return { building: hit, method: 'contains_point' };
  const nearest = closestCandidate(eligible, latitude, longitude);
  if (nearest.candidate && nearest.distanceM <= maxDistanceM) {
    return { building: nearest.candidate, method: 'closest', distanceM: nearest.distanceM };
  }
  return { building: null, method: 'none', distanceM: nearest.distanceM };
}

function relativeRingArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p.lon * q.lat - q.lon * p.lat;
  }
  return Math.abs(area) / 2;
}

function closestCandidate(list, latitude, longitude) {
  let candidate = null;
  let distanceM = Infinity;
  for (const item of list) {
    const centroid = geometryCentroid(candidateGeometry(item));
    if (!centroid) continue;
    const dist = distanceMeters(latitude, longitude, centroid.lat, centroid.lng);
    if (dist < distanceM) {
      distanceM = dist;
      candidate = item;
    }
  }
  return { candidate, distanceM: Number.isFinite(distanceM) ? distanceM : null };
}

/**
 * The building the coordinate actually sits on. A larger way elsewhere in
 * the Overpass radius is not this roof. Falls back to the nearest centroid
 * within 40 m when the pin is just outside the wall line.
 */
export function buildingContainingPoint(candidates, latitude, longitude, maxDistanceM = 40) {
  const list = Array.isArray(candidates) ? candidates : [];
  const lat = num(latitude);
  const lng = num(longitude);
  const inside = list.find((candidate) => pointInGeometry(lat, lng, candidateGeometry(candidate)));
  if (inside) return inside;
  let best = null;
  let bestM = Infinity;
  for (const candidate of list) {
    const centroid = geometryCentroid(candidateGeometry(candidate));
    if (!centroid) continue;
    const north = (centroid.lat - lat) * FT_PER_DEG_LAT;
    const east = (centroid.lng - lng) * FT_PER_DEG_LAT * Math.cos(((centroid.lat + lat) / 2) * Math.PI / 180);
    const distM = Math.hypot(east, north) / 3.28084;
    if (distM < bestM) {
      bestM = distM;
      best = candidate;
    }
  }
  return bestM <= maxDistanceM ? best : null;
}

function asSolarPotential(solar) {
  if (!solar || typeof solar !== 'object') return null;
  if (solar.solarPotential && typeof solar.solarPotential === 'object') return solar.solarPotential;
  if (solar.wholeRoofStats || solar.roofSegmentStats) return solar;
  return null;
}

/**
 * Choose the roof area.
 *
 * Solar's plan is "far less" than the footprint when it covers under 75%
 * (the same test as solarUndershootsFootprint): a partial Solar model on a
 * larger outline is billed from that outline. A model that already covers
 * the outline stays on Solar. Walls that cannot belong to a roof that small
 * are a review flag, not a new area.
 *
 * The experimental imagery takeoff does not run unless the caller opts in,
 * and even then it does not set the billed area. "Takeoff didn't run" is
 * therefore not, by itself, a reason to throw away a Solar model that
 * already covers the footprint — doing so would mark every ordinary roof
 * unready. It is the reason a far-short Solar plan cannot stay ready:
 * nothing else measured the missing planes.
 *
 * When the takeoff did run and Solar is still far short, the footprint
 * wins too. The trace is not the measurement.
 *
 * @returns {object} decision. use_footprint_pitch means the caller must bill
 *   area_sqft, mark the result low confidence, and not measurement-ready.
 */
export function resolveFootprintPitchArea({
  solar = null,
  solarPotential = null,
  footprintPlanSqFt = 0,
  footprintPolygon = null,
  pitchLabel = null,
  pitchDegrees = null,
  imageryTakeoffRan = false,
  solarOnDifferentBuilding = false,
  pitchKnown = true,
} = {}) {
  const factor = pitchFactor({ pitchLabel, pitchDegrees });
  let foot = num(footprintPlanSqFt);
  if (!(foot > 0) && footprintPolygon) foot = ringPlanSqFt(footprintPolygon);
  const parts = solarAreaParts(asSolarPotential(solarPotential || solar));
  const slope = parts?.area_sqft || 0;
  let plan = parts?.ground_area_sqft || 0;
  if (!(plan > 0) && slope > 0 && factor) plan = slope / factor;
  const coverage = foot > 0 && plan > 0 ? plan / foot : null;
  const solarFarUnderFootprint = solarUndershootsFootprint(plan, foot);
  const takeoffDidNotRun = !imageryTakeoffRan;
  // Slope area already within 25% of footprint × pitch is the whole roof.
  // Replacing it would bill the outline again (Roesing: −7% became about +17%).
  const pitchedFootprint = foot > 0 && factor > 0 ? foot * factor : 0;
  const slopeAlreadyCovers = slope > 0 && pitchedFootprint > 0 && pitchedFootprint < slope * 1.25;
  // Either the takeoff never ran or Solar covers far less than the
  // footprint. Both are true for a partial model on the default path.
  // A covering Solar model is kept when the only miss is the opt-in trace.
  // Solar's area is a different structure from the one under the pin.
  // A bigger Solar number can still "cover" the smaller outline on paper,
  // and that is the wrong roof. Bill this outline times the pitch of the
  // planes that actually sit on it. The house pitch is not that pitch.
  // With no plane on this outline, the area stays the plan and the pitch
  // stays unknown so a rep can enter it.
  const differentBuilding = solarOnDifferentBuilding === true && foot > 0;
  const pitchMissing = pitchKnown === false || !(factor > 0);
  const wrongBuilding = differentBuilding && !pitchMissing;
  const useFootprintPitch = wrongBuilding || (
    foot > 0 && factor > 0 && solarFarUnderFootprint
    && !slopeAlreadyCovers
    && (takeoffDidNotRun || solarFarUnderFootprint)
  );

  const coverageRounded = coverage == null ? null : Math.round(coverage * 1000) / 1000;
  const base = {
    pitch_factor: factor == null ? null : Math.round(factor * 1000) / 1000,
    footprint_plan_sqft: foot > 0 ? Math.round(foot) : null,
    solar_plan_sqft: plan > 0 ? Math.round(plan) : null,
    solar_slope_sqft: slope > 0 ? Math.round(slope) : null,
    solar_coverage_ratio: coverageRounded,
    imagery_takeoff_ran: imageryTakeoffRan === true,
  };

  if (differentBuilding && pitchMissing) {
    return {
      ...base,
      pitch_factor: null,
      pitch_unknown: true,
      use_footprint_pitch: true,
      area_sqft: Math.round(foot),
      area_method: 'footprint_pitch_unknown',
      measurement_ready: false,
      confidence: 'low',
      reason: 'solar_measured_other_building',
    };
  }

  if (!useFootprintPitch) {
    return {
      ...base,
      pitch_unknown: false,
      use_footprint_pitch: false,
      area_sqft: slope > 0 ? Math.round(slope) : null,
      area_method: slope > 0 ? 'solar' : null,
      measurement_ready: null,
      confidence: 'standard',
      reason: !(foot > 0) ? 'no_footprint' : (factor ? 'solar_covers_footprint' : 'no_pitch'),
    };
  }

  return {
    ...base,
    pitch_unknown: false,
    use_footprint_pitch: true,
    area_sqft: Math.round(foot * factor),
    area_method: 'footprint_x_pitch',
    measurement_ready: false,
    confidence: 'low',
    reason: wrongBuilding
      ? 'solar_measured_other_building'
      : (takeoffDidNotRun ? 'imagery_takeoff_not_run' : 'solar_far_under_footprint'),
  };
}
