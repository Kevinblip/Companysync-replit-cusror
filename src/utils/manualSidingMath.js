/**
 * Manual Siding Measurement Calculator
 *
 * Pure math kernel for the Manual Entry siding estimator.
 * Extracted from handleBuildManualSidingEstimate (AIEstimator.jsx) so it
 * can be unit-tested independently — a wrong coefficient here silently
 * produces a wrong field estimate with real money consequences.
 *
 * Formulas
 * ────────
 *  totalWallHeight   = stories × eaveHt
 *  grossWallSqft     = perim × totalWallHeight
 *  gableBase         = buildingWidth > 0 ? buildingWidth : round(perim / 4)
 *  gableAreaSqft     = gableRise > 0 ? round(gableBase × gableRise) : 0
 *                      (two symmetric triangles: 0.5 × base × rise × 2 = base × rise)
 *  openingDeductSqft = windows×15 + doors×20 + garageDoors×63
 *  netWallSqft       = max(0, grossWallSqft + gableAreaSqft − openingDeductSqft)
 *  starterStripLF    = round(perim)
 *  outsideCornerLF   = round(outsideCorners × totalWallHeight)
 *  jChannelLF        = round(windows×16 + doors×19)
 */

/** Standard opening sqft (contractor rule-of-thumb). */
export const MANUAL_SIDING_OPENING_SQFT = {
  window:     15,   // avg double-hung window rough opening
  door:       20,   // avg entry door rough opening
  garageDoor: 63,   // single garage door (9 × 7)
};

/** Average opening perimeter for J-channel estimation (LF). */
export const MANUAL_SIDING_OPENING_PERIMETER_LF = {
  window: 16,  // avg window perimeter
  door:   19,  // avg door perimeter
};

/**
 * Compute manual siding measurements from contractor-entered form values.
 *
 * @param {object} form
 * @param {number|string} form.perimeter_ft         – Exterior wall perimeter (LF)
 * @param {number|string} form.stories              – Number of stories (may be fractional)
 * @param {number|string} form.eave_height_ft       – Floor-to-soffit height per story (ft)
 * @param {number|string} [form.gable_rise_ft=0]   – Vertical gable rise (ft); 0 = no gable
 * @param {number|string} [form.windows_count=0]   – Number of windows
 * @param {number|string} [form.doors_count=0]     – Number of entry doors
 * @param {number|string} [form.garage_door_count=0] – Number of garage doors (single)
 * @param {number|string} [form.outside_corners_count=4] – Number of outside corners
 * @param {number|string} [form.building_width_ft=0]  – Building width (ft); 0 = use perim/4
 * @param {number|string} [form.building_length_ft=0] – Building length (ft); informational only
 *
 * @returns {{
 *   totalWallHeight:    number,
 *   grossWallSqft:      number,
 *   gableBase:          number,
 *   gableAreaSqft:      number,
 *   openingDeductSqft:  number,
 *   netWallSqft:        number,
 *   jChannelLF:         number,
 *   starterStripLF:     number,
 *   outsideCornerLF:    number,
 *   wall_area_sqft:     number,
 *   wall_area_sq:       number,
 *   opening_deduct_sqft:number,
 *   gable_area_sqft:    number,
 *   starter_strip_lf:   number,
 *   outside_corners_lf: number,
 *   j_channel_openings_lf: number,
 *   perimeter_ft:       number,
 *   story_count:        number,
 *   story_height_ft:    number,
 *   windows_count:      number,
 *   doors_count:        number,
 *   garage_door_count:  number,
 *   gable_rise_ft:      number,
 *   outside_corners_count: number,
 *   building_width_ft:  number|null,
 *   building_length_ft: number|null,
 * }}
 */
export function computeManualSidingMeasurements(form) {
  const perim          = Number(form.perimeter_ft)          || 0;
  const stories        = Number(form.stories)               || 1;
  const eaveHt         = Number(form.eave_height_ft)        || 9;
  const gableRise      = Number(form.gable_rise_ft)         || 0;
  const windows        = Number(form.windows_count)         || 0;
  const doors          = Number(form.doors_count)           || 0;
  const garageDoors    = Number(form.garage_door_count)     || 0;
  const outsideCorners = Number(form.outside_corners_count) || 4;
  const buildingWidth  = Number(form.building_width_ft)     || 0;
  const buildingLength = Number(form.building_length_ft)    || 0;

  const totalWallHeight = stories * eaveHt;
  const grossWallSqft   = perim * totalWallHeight;

  // Gable: two symmetric triangles (front + back).
  // 0.5 × base × rise × 2 sides = base × rise.
  const gableBase     = buildingWidth > 0 ? buildingWidth : Math.round(perim / 4);
  const gableAreaSqft = gableRise > 0 ? Math.round(0.5 * gableBase * gableRise * 2) : 0;

  // Standard opening deductions (contractor rule-of-thumb).
  const { window: windowSqft, door: doorSqft, garageDoor: garageDoorSqft } = MANUAL_SIDING_OPENING_SQFT;
  const openingDeductSqft = (windows * windowSqft) + (doors * doorSqft) + (garageDoors * garageDoorSqft);

  const netWallSqft = Math.max(0, grossWallSqft + gableAreaSqft - openingDeductSqft);

  // Trim lengths.
  const jChannelLF     = Math.round((windows * MANUAL_SIDING_OPENING_PERIMETER_LF.window)
                                  + (doors   * MANUAL_SIDING_OPENING_PERIMETER_LF.door));
  const starterStripLF  = Math.round(perim);
  const outsideCornerLF = Math.round(outsideCorners * totalWallHeight);

  return {
    // ── intermediate values (useful for tests / debugging) ──
    totalWallHeight,
    grossWallSqft,
    gableBase,
    gableAreaSqft,
    openingDeductSqft,
    netWallSqft,
    jChannelLF,
    starterStripLF,
    outsideCornerLF,

    // ── measurement object shape (mirrors what the function stores) ──
    wall_area_sqft:        Math.round(netWallSqft),
    wall_area_sq:          netWallSqft / 100,
    perimeter_ft:          perim,
    story_count:           stories,
    story_height_ft:       eaveHt,
    windows_count:         windows,
    doors_count:           doors,
    garage_door_count:     garageDoors,
    gable_rise_ft:         gableRise,
    gable_area_sqft:       gableAreaSqft,
    outside_corners_count: outsideCorners,
    building_width_ft:     buildingWidth  || null,
    building_length_ft:    buildingLength || null,
    opening_deduct_sqft:   openingDeductSqft,
    j_channel_openings_lf: jChannelLF,
    starter_strip_lf:      starterStripLF,
    outside_corners_lf:    outsideCornerLF,
    inside_corners_lf:     0,
  };
}
