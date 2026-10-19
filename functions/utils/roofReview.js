/**
 * A measurement is not ready when the free map or Solar cannot show that
 * this roof is the main residence. The rep confirms it or hand-traces it.
 * Thresholds are general: a roof Solar already covers, sitting on the
 * addressed building, stays ready.
 */

import { distanceMeters, pitchFactor } from './roofFootprintArea.js';

const OUTBUILDING = /^(garage|garages|shed|outbuilding|barn|carport|greenhouse|roof)$/i;
const OUTBUILDING_TARGET = /^(garage|garages|shed|outbuilding|barn|carport)$/i;

export const SOLAR_CENTROID_FAR_M = 30;
/** Review when Solar's ground plan covers less than this share of the address outline. */
export const SOLAR_REVIEW_COVERAGE = 0.85;
/**
 * Longest ordinary house this check still treats as plausible, length ÷ width.
 * A wider limit would hide a partial Solar model; a tighter one would flag
 * long, narrow houses whose roof already matches their walls.
 */
export const WALL_ROOF_MAX_ASPECT = 3;
/** Flag when the roof is under this share of the minimum for that shape. */
export const WALL_ROOF_SHORTFALL = 0.85;
export const REP_REVIEW_ASK = 'Confirm this is the right roof, or hand-trace it, before marking the measurement ready.';

export function isOutbuildingTarget(structureType) {
  return OUTBUILDING_TARGET.test(String(structureType || '').trim());
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function housenumber(tags, address) {
  const tagged = String(tags?.['addr:housenumber'] || '').trim().toLowerCase();
  const wanted = String(address || '').match(/^\s*(\d+[a-zA-Z]?)/);
  return { tagged, wanted: wanted ? wanted[1].toLowerCase() : '' };
}

/**
 * Full wall height in feet. A value above 14 ft is already the whole wall
 * (a two-story eave). A shorter value is one story and is multiplied by the
 * story count. Missing both falls back to 9 ft per story.
 */
export function fullWallHeightFt({ wallHeightFt = 0, storyCount = 0, storyHeightFt = 0 } = {}) {
  const explicit = num(wallHeightFt);
  if (explicit >= 8) return Math.min(explicit, 40);
  const stories = num(storyCount);
  const perStory = num(storyHeightFt);
  if (perStory > 14) return Math.min(perStory, 40);
  if (stories >= 1 && perStory >= 7) return Math.min(stories * perStory, 40);
  if (stories >= 1 && stories <= 4) return Math.min(stories * 9, 40);
  return 0;
}

/**
 * Solar can agree with a small map outline and still be only part of the
 * house. Wall area and wall height imply a perimeter. The smallest pitched
 * roof on a building no skinnier than WALL_ROOF_MAX_ASPECT is the bar.
 * Under WALL_ROOF_SHORTFALL of that bar, the roof needs a rep. This does
 * not choose a replacement area.
 *
 * @returns {null|{code:string,detail:string,ratio:number,min_roof_sqft:number}}
 */
export function roofShortForWalls({
  roofSlopeSqFt = 0,
  wallAreaSqFt = 0,
  wallHeightFt = 0,
  storyCount = 0,
  storyHeightFt = 0,
  pitchLabel = null,
  pitchDegrees = null,
  structureType = 'house',
} = {}) {
  if (isOutbuildingTarget(structureType)) return null;
  const roof = num(roofSlopeSqFt);
  const wall = num(wallAreaSqFt);
  if (!(roof >= 200) || !(wall >= 800)) return null;
  const height = fullWallHeightFt({ wallHeightFt, storyCount, storyHeightFt });
  if (!(height >= 8)) return null;
  const perimeter = wall / height;
  if (!(perimeter >= 40)) return null;
  const aspect = WALL_ROOF_MAX_ASPECT;
  const minPlan = (aspect * perimeter * perimeter) / (4 * (aspect + 1) ** 2);
  const factor = pitchFactor({ pitchLabel, pitchDegrees }) || 1;
  const minRoof = minPlan * Math.max(1, factor);
  if (!(minRoof > 0)) return null;
  const ratio = roof / minRoof;
  if (ratio >= WALL_ROOF_SHORTFALL) return null;
  return {
    code: 'roof_short_for_walls',
    ratio: Math.round(ratio * 100) / 100,
    min_roof_sqft: Math.round(minRoof),
    perimeter_ft: Math.round(perimeter),
    wall_height_ft: Math.round(height * 10) / 10,
    detail: `The satellite roof is ${Math.round(roof).toLocaleString()} sq ft, about ${Math.round(ratio * 100)}% of the smallest roof these walls can belong to.`,
  };
}

/**
 * @param {object} input
 * @param {object|null} input.footprint areaSqFt, containsPoint, distanceM, method, tags
 * @param {number} [input.largerNeighborRatio] biggest other building within 25 m ÷ this one
 */
export function assessRoofReview({
  latitude = null,
  longitude = null,
  address = '',
  footprint = null,
  solarGroundSqFt = 0,
  solarSlopeSqFt = 0,
  pitchLabel = null,
  segmentCount = 0,
  solarCentroid = null,
  largerNeighborRatio = null,
  footprintPitchApplied = false,
  solarOnDifferentBuilding = false,
  footprintLookupTimedOut = false,
  structureType = 'house',
  billedRoofSqFt = 0,
  wallAreaSqFt = 0,
  wallHeightFt = 0,
  storyCount = 0,
  storyHeightFt = 0,
} = {}) {
  const reasons = [];
  const area = num(footprint?.areaSqFt);
  const ground = num(solarGroundSqFt);
  const method = footprint?.method || 'none';
  const containsPoint = footprint?.containsPoint === true || method === 'contains_point' || method === 'address_tag';
  const distanceM = num(footprint?.distanceM);
  const atAddress = Boolean(footprint) && area > 0 && (
    containsPoint || (method === 'closest' && distanceM > 0 && distanceM <= 15)
  );
  const tags = footprint?.tags || {};

  if (!atAddress) {
    reasons.push({
      code: 'no_footprint_at_address',
      detail: 'No building outline was found at this address.',
    });
  }

  const pitchedFootprint = area * (pitchFactor({ pitchLabel }) || 0);
  const slopeCoversOutline = num(solarSlopeSqFt) > 0
    && pitchedFootprint > 0
    && pitchedFootprint < num(solarSlopeSqFt) * 1.25;
  const coverage = area > 0 && ground > 0 ? ground / area : null;
  // Billing still uses the 75% ground test. Review starts at 85%: Gerhard's
  // plan covered 77% of the footprint and stayed ready at −45%, while the
  // accurate houses all covered at least 88%.
  const groundBelowReview = coverage != null && coverage < SOLAR_REVIEW_COVERAGE;
  // A pin on a different building than Solar measured is not "Solar is
  // smaller than this outline". Coverage can sit over 100% and still be
  // the wrong roof. Say that, and ask for the pitch.
  if (solarOnDifferentBuilding === true) {
    reasons.push({
      code: 'solar_measured_other_building',
      detail: 'The pin is on a different building than the one the satellite measured. Confirm the pitch and hand-trace this roof before marking the measurement ready.',
    });
  } else if (atAddress && (footprintPitchApplied || (groundBelowReview && !slopeCoversOutline))) {
    const pct = coverage == null ? null : Math.round(coverage * 100);
    reasons.push({
      code: 'solar_smaller_than_footprint',
      detail: pct == null
        ? 'The satellite roof is much smaller than the building outline.'
        : `The satellite roof plan covers ${pct}% of the building outline.`,
    });
  }

  if (footprintLookupTimedOut) {
    reasons.push({
      code: 'footprint_lookup_timeout',
      detail: 'The building-outline lookup timed out, so this roof was not fully checked against a footprint.',
    });
  }

  if (solarCentroid && Number.isFinite(num(latitude)) && Number.isFinite(num(longitude))) {
    const away = distanceMeters(latitude, longitude, solarCentroid.lat, solarCentroid.lng);
    if (away > SOLAR_CENTROID_FAR_M) {
      reasons.push({
        code: 'solar_centroid_far',
        detail: `The satellite roof is centered ${Math.round(away)} m from this address, so it may be a different building.`,
      });
    }
  }

  const numbers = housenumber(tags, address);
  const conflictingAddress = Boolean(numbers.tagged && numbers.wanted && numbers.tagged !== numbers.wanted);
  const outbuilding = OUTBUILDING.test(String(tags.building || ''));
  const smallBesideLargerHouse = method !== 'address_tag'
    && area > 0
    && area <= 1000
    && num(largerNeighborRatio) >= 2;
  if (!isOutbuildingTarget(structureType) && (outbuilding || conflictingAddress || smallBesideLargerHouse)) {
    reasons.push({
      code: 'not_main_residence',
      detail: 'The outline used is not the main residence at this address.',
    });
  }

  const billed = num(billedRoofSqFt) > 0 ? num(billedRoofSqFt) : num(solarSlopeSqFt);
  const wallGap = roofShortForWalls({
    roofSlopeSqFt: billed,
    wallAreaSqFt,
    wallHeightFt,
    storyCount,
    storyHeightFt,
    pitchLabel,
    structureType,
  });
  if (wallGap) reasons.push({ code: wallGap.code, detail: wallGap.detail });

  const segments = num(segmentCount);
  if (atAddress && area >= 2200 && segments > 0 && segments <= 2 && ground > 0 && ground < area * 0.7) {
    reasons.push({
      code: 'low_segment_count',
      detail: 'The satellite model has too few roof planes for a building this size.',
    });
  }

  const needs = reasons.length > 0;
  const details = reasons.map((reason) => reason.detail).join(' ');
  // The other-building reason already asks the rep to confirm the pitch and
  // hand-trace. Appending the generic ask repeats that sentence.
  const alreadyAsks = /hand-trace/i.test(details);
  return {
    needs_rep_review: needs,
    measurement_ready: !needs,
    status: needs ? 'needs_rep_review' : 'ready',
    reasons,
    message: needs
      ? `Needs rep review. ${details}${alreadyAsks ? '' : ` ${REP_REVIEW_ASK}`}`
      : null,
  };
}
