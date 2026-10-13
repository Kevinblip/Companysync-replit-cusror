/**
 * Company Sync Hybrid Measurement & Geometry Engine
 *
 * Canonical formulas for roof area (from footprint) and net siding area.
 * Import these everywhere — never inline the pitch multiplier or overhang factor.
 *
 * ⚠️  Do NOT apply calculateRoofAreaFromFootprint to Google Solar API areas —
 *      Solar already returns measured sloped area including overhang.
 *      Use only when starting from a flat GIS / OSM / manual footprint area.
 */

/** Standard 16-inch eave overhang expressed as an area scale factor. */
export const OVERHANG_FACTOR = 1.12;

/**
 * Slope multiplier that converts a horizontal footprint area to the actual
 * sloped roof surface area.
 *
 * @param {number} pitchRiseOver12 - Rise portion of an X/12 pitch (e.g. 6 for 6/12).
 * @returns {number}
 */
export function pitchMultiplier(pitchRiseOver12) {
  const rise = Number(pitchRiseOver12) || 6;
  return Math.sqrt(1 + Math.pow(rise / 12, 2));
}

/**
 * Calculate sloped roof area from a horizontal footprint area.
 * Applies both the pitch slope correction and the standard 1.12 overhang factor.
 *
 * @param {number} footprintSqFt - Flat (horizontal) footprint area in sq ft.
 * @param {number} [pitch=6]     - Rise portion of pitch (e.g. 6 for 6/12).
 * @returns {number} Sloped roof area in sq ft, rounded to nearest integer.
 */
export function calculateRoofAreaFromFootprint(footprintSqFt, pitch = 6) {
  return Math.round(
    (Number(footprintSqFt) || 0) * pitchMultiplier(pitch) * OVERHANG_FACTOR
  );
}

/**
 * Calculate net siding area from perimeter, wall height, and an openings list.
 *
 * All openings are deducted regardless of size.
 *
 * @param {number} perimeterLinearFeet - Total exterior wall perimeter in linear feet.
 * @param {number} wallHeightFeet      - Eave height (floor to soffit) in feet.
 * @param {Array}  openingsArray       - Array of opening objects. Each must have
 *   `width` (or `width_ft`) and `height` (or `height_ft`) in feet.
 * @returns {{ gross: number, deductions: number, netZeroWaste: number }}
 */
export function calculateNetSiding(perimeterLinearFeet, wallHeightFeet, openingsArray = []) {
  const grossWallArea = perimeterLinearFeet * wallHeightFeet;

  // Total square footage of all windows, doors, and garage bays
  const totalOpeningsArea = (openingsArray || []).reduce((sum, opening) => {
    const w = Number(opening.width ?? opening.width_ft) || 0;
    const h = Number(opening.height ?? opening.height_ft) || 0;
    return sum + (w * h);
  }, 0);

  const netSidingArea = grossWallArea - totalOpeningsArea;
  return {
    gross:        Math.round(grossWallArea),
    deductions:   Math.round(totalOpeningsArea),
    netZeroWaste: Math.round(Math.max(0, netSidingArea)),
  };
}

/**
 * Standalone roof calibration — overrides aerial pitch defaults with ground truth.
 *
 * Implements ProductionTighteningEngine.calibrateRoofArea.
 *
 * Uses the true pitch-multiplier formula:  sqrt(1 + (pitch/12)²)
 * This is the same kernel used inside calculateFusedRoof, but exposed here
 * as a standalone entry point for paths that already have a flat footprint
 * area and a single ground-measured pitch (e.g. satellite-only, no Solar API).
 *
 * @param {number} flatFootprintSqFt    - Ground-level footprint area in sqft.
 * @param {number} groundDetectedPitch  - Roof pitch (rise-in-12, e.g. 6 for 6/12).
 * @returns {number} Exact roof area in SQ (square = 100 sqft), 2 decimal places.
 */
export function calibrateRoofArea(flatFootprintSqFt, groundDetectedPitch) {
  const trueMultiplier = Math.sqrt(1 + Math.pow(groundDetectedPitch / 12, 2));
  const calibratedSqFt = (Number(flatFootprintSqFt) || 0) * trueMultiplier;
  return Number((calibratedSqFt / 100).toFixed(2));
}

/**
 * Enforces Net Siding Deductions from pre-computed totals.
 *
 * Implements ProductionTighteningEngine.calculateNetSiding.
 *
 * Accepts already-resolved sqft values so callers are not responsible for
 * the division-by-100 and rounding step inline. Use this (not the legacy
 * calculateNetSiding perimeter×height variant) when gross wall sqft,
 * masonry isolation, and opening deductions are already aggregated.
 *
 * @param {number} grossWallSqFt         - Total gross wall surface area (sqft).
 * @param {number} stoneIsolatedSqFt     - Masonry / stone wainscot deduction (sqft).
 * @param {number} openingsDeductionSqFt - Sum of all window + door openings (sqft).
 * @returns {number} Net siding in SQ (100 sqft = 1 SQ), 2 decimal places.
 */
export function calculateNetSidingSQ(grossWallSqFt, stoneIsolatedSqFt, openingsDeductionSqFt) {
  const netSqFt = (Number(grossWallSqFt) || 0)
                - (Number(stoneIsolatedSqFt)     || 0)
                - (Number(openingsDeductionSqFt)  || 0);
  return Number((Math.max(0, netSqFt) / 100).toFixed(2));
}

/**
 * Default rough-opening dimensions (width × height, in feet) for common opening types.
 * Used when the AI has not returned measured opening geometry.
 */
export const DEFAULT_OPENING_SQFT = {
  window:             3 * 4,   // 12 sqft  — standard double-hung
  entry_door:         3 * 6.8, // ~20.4 sqft
  garage_door:        16 * 7,  // 112 sqft — double-wide
  garage_door_single: 9 * 7,   // 63 sqft  — single
};

/** Return corroborated, in-range crew-camera roof-pitch readings. */
export function selectConsistentFacadePitchSlopes(groundPitchSlopes = []) {
  const slopes = groundPitchSlopes
    .map(Number)
    .filter(n => Number.isFinite(n) && n >= 2 && n <= 20);
  if (slopes.length < 2) return slopes;
  const sorted = [...slopes].sort((a, b) => a - b);
  const clusters = sorted.map((start, index) =>
    sorted.slice(index).filter(pitch => pitch - start <= 2));
  const largest = Math.max(...clusters.map(cluster => cluster.length));
  const candidates = [...new Map(
    clusters
      .filter(cluster => cluster.length === largest)
      .map(cluster => [cluster.join(','), cluster]),
  ).values()];
  // A tie means distinct crew-photo clusters support different slopes. Do not
  // average them into a pitch that no photo actually observed.
  return candidates.length === 1 ? candidates[0] : [];
}

/**
 * Hybrid Solar × Ground-Vision roof calibration.
 *
 * The Solar API returns a slope-corrected area using its own internally-assumed
 * pitch. When crew-cam / elevation photos reveal the *actual* pitch, use this
 * function to back out Solar's assumption and re-apply the true measurement.
 *
 * @param {number}   solarRoofSqFt        - Slope-adjusted roof area from Solar API (sqft).
 * @param {number}   solarPitchMultiplier - Solar's implicit pitch factor (1/cos(pitchRad)).
 * @param {number[]} groundPitchSlopes    - Array of X-in-12 pitches from photo analysis.
 * @returns {{ calibrated_roof_sqft, calibrated_roof_sq, order_qty_15pct_sq,
 *             detected_pitch, was_recalibrated }}
 */
export function calculateFusedRoof(solarRoofSqFt, solarPitchMultiplier, groundPitchSlopes = []) {
  const slopes = selectConsistentFacadePitchSlopes(groundPitchSlopes);
  const avgPitch = slopes.length
    ? slopes.reduce((a, b) => a + b, 0) / slopes.length
    : Math.round((Math.acos(1 / solarPitchMultiplier) * 180 / Math.PI) * 12 / 45); // back-derive
  const trueMultiplier = Math.sqrt(1 + Math.pow(avgPitch / 12, 2));
  // Back Solar slope area to flat footprint, then re-slope at true pitch.
  const flatSqFt = solarRoofSqFt / Math.max(solarPitchMultiplier, 1.001);
  const calibratedSqFt = flatSqFt * trueMultiplier;
  return {
    calibrated_roof_sqft:   Math.round(calibratedSqFt),
    calibrated_roof_sq:     Number((calibratedSqFt / 100).toFixed(2)),
    order_qty_15pct_sq:     Number(((calibratedSqFt * 1.15) / 100).toFixed(2)),
    detected_pitch:         `${Number(avgPitch.toFixed(1))}/12`,
    // The 3% rule is relative to Solar's multiplier. An absolute 0.03
    // threshold would miss meaningful shallow-roof changes (for example 3/12
    // → 4/12), where the multiplier moves by less than three hundredths.
    was_recalibrated:       Math.abs(trueMultiplier - solarPitchMultiplier) / Math.max(Math.abs(solarPitchMultiplier), 1.001) > 0.03,
  };
}

/**
 * De-group mulled window banks into individual unit counts while preserving
 * accurate area deductions. Accepts openings in inches (widthInches/heightInches)
 * or feet (width_ft/height_ft/width/height).
 *
 * @param {Array} openings
 * @returns {{ total_deduction_sqft: number, total_individual_units: number }}
 */
export function processWindowUnits(openings = []) {
  let totalDeductionSqFt = 0;
  let totalIndividualUnits = 0;
  for (const o of openings) {
    const wFt = o.widthInches != null
      ? o.widthInches / 12
      : Number(o.width_ft ?? o.width ?? 0);
    const hFt = o.heightInches != null
      ? o.heightInches / 12
      : Number(o.height_ft ?? o.height ?? 0);
    totalDeductionSqFt   += wFt * hFt;
    totalIndividualUnits += Math.max(1, o.mullionCount ?? o.mullion_count ?? 1);
  }
  return {
    total_deduction_sqft:    Math.round(totalDeductionSqFt * 10) / 10,
    total_individual_units:  totalIndividualUnits,
  };
}

/**
 * Build an openings list from counts + default geometry.
 * Used in fallback paths where only counts (not measured dims) are available.
 *
 * @param {{ windows?: number, entryDoors?: number, garageDoors?: number, singleGarageDoors?: number }} counts
 * @returns {Array<{type: string, width: number, height: number}>}
 */
/**
 * Resolve vertical wall height (feet) from a siding profile + course count.
 * Implements the ScaleAnchorResolver spec:
 *   vinyl_4      → courseCount × (4/12) ft   — standard 4" vinyl/aluminium exposure
 *   vinyl_5      → courseCount × (5/12) ft   — 5" vinyl or fibre-cement
 *   cedar_lap    → courseCount × (8/12) ft   — typical 8" cedar lap exposure
 *   board_batten → 80/12 ft when a door is visible (6.67 ft standard door anchor),
 *                  else courseCount × (7/12) ft
 *   shake        → same as board_batten (course height varies widely)
 *
 * @param {'vinyl_4'|'vinyl_5'|'cedar_lap'|'board_batten'|'shake'|string} profile
 * @param {number} courseCount  Number of lap courses from grade to eave
 * @param {boolean} hasDoor     Whether an entry/garage door is visible in the photo
 * @returns {number} Eave height in feet
 */
export function resolveVerticalScale(profile, courseCount, hasDoor = false) {
  switch (profile) {
    case 'vinyl_4':    return courseCount * (4 / 12);
    case 'vinyl_5':    return courseCount * (5 / 12);
    case 'cedar_lap':  return courseCount * (8 / 12);
    case 'board_batten':
    case 'shake':
      // Anchor to standard 80" door height when one is visible; otherwise estimate
      // from course count using 7" as the typical board/shake exposure.
      return hasDoor ? (80 / 12) : courseCount * (7 / 12);
    default:           return courseCount * (4 / 12); // safe fallback: vinyl_4
  }
}

/**
 * Map the AI's siding_material string to the nearest ScaleAnchor profile.
 * Used when siding_profile is not returned by the AI directly.
 *
 * @param {string|null} material
 * @returns {'vinyl_4'|'vinyl_5'|'cedar_lap'|'board_batten'|'shake'}
 */
/**
 * Calculates shutter pair counts, individual unit dimensions, and total surface area.
 * Implements AccessoryDetector.processShutters spec.
 *
 * @param {Array<{id:string, heightInches:number, widthInches:number, hasLeftShutter:boolean, hasRightShutter:boolean}>} windows
 * @returns {{ shutter_pair_count: number, shutter_total_sqft: number, shutter_inventory: Array }}
 */
export function processShutters(windows = []) {
  let pairCount = 0;
  let totalShutterSqFt = 0;
  const inventory = [];

  // Count individual panels, not just complete pairs. Carrier reports (Hover
  // included) itemize shutters as individual panels, and a window wearing a
  // single shutter is real scope — the old pairs-only test silently dropped it
  // from both the count and the square footage.
  let panelCount = 0;

  for (const w of windows) {
    const panels = (w.hasLeftShutter ? 1 : 0) + (w.hasRightShutter ? 1 : 0);
    if (panels === 0) continue;
    panelCount += panels;
    if (panels === 2) pairCount++;
    // Standard shutter width = half the window width; height matches window height
    const shutterWidthInches = Math.round((w.widthInches || 0) / 2);
    totalShutterSqFt += (panels * (shutterWidthInches * (w.heightInches || 0))) / 144;
    inventory.push({
      windowId: w.id,
      panelCount: panels,
      shutterSize: `${shutterWidthInches}" W x ${w.heightInches}" H`,
    });
  }

  return {
    shutter_pair_count:  pairCount,
    shutter_panel_count: panelCount,
    shutter_total_sqft:  Math.round(totalShutterSqFt),
    shutter_inventory:   inventory,
  };
}

/**
 * Calculates awning surface area and project scope.
 * Implements AccessoryDetector.processAwnings spec.
 *
 * @param {Array<{location:string, widthInches:number, projectionInches:number, materialType:string}>} awnings
 * @returns {{ awning_count: number, awning_total_sqft: number, awning_breakdown: Array }}
 */
export function processAwnings(awnings = []) {
  let totalAwningSqFt = 0;

  const summary = awnings.map(a => {
    const areaSqFt = ((a.widthInches || 0) * (a.projectionInches || 0)) / 144;
    totalAwningSqFt += areaSqFt;
    return {
      location:   a.location,
      material:   a.materialType || a.material,
      dimensions: `${a.widthInches}" W x ${a.projectionInches}" Depth`,
      area_sqft:  Math.round(areaSqFt),
    };
  });

  return {
    awning_count:       awnings.length,
    awning_total_sqft:  Math.round(totalAwningSqFt),
    awning_breakdown:   summary,
  };
}

export function materialToSidingProfile(material) {
  switch (material) {
    case 'fiber_cement': return 'vinyl_5';   // Hardie: ~5–6" exposure; vinyl_5 is conservative
    case 'wood':         return 'cedar_lap'; // Cedar/wood lap: 8" typical
    case 'vinyl':
    case 'aluminum':
    default:             return 'vinyl_4';   // Most common residential siding
  }
}

export function openingsFromCounts({ windows = 0, entryDoors = 0, garageDoors = 0, singleGarageDoors = 0 } = {}) {
  const result = [];
  for (let i = 0; i < windows;           i++) result.push({ type: 'window',      width: 3,  height: 4   });
  for (let i = 0; i < entryDoors;        i++) result.push({ type: 'entry_door',  width: 3,  height: 6.8 });
  for (let i = 0; i < garageDoors;       i++) result.push({ type: 'garage_door', width: 16, height: 7   });
  for (let i = 0; i < singleGarageDoors; i++) result.push({ type: 'garage_door', width: 9,  height: 7   });
  return result;
}
