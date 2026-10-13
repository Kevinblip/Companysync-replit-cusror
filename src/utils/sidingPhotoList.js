/**
 * sidingPhotoList.js
 *
 * Pure helpers that collect and de-duplicate the facade photos fed into
 * handleAnalyzeSiding (AIEstimator.jsx).  Extracted into this module so they
 * can be tested independently without running a browser or React.
 *
 * These helpers are the production code — the test imports them directly.
 */

/**
 * Collect all available facade photos for a siding analysis pass.
 *
 * Street View images (elevationImages) are filtered for availability and
 * mapped to the backend's expected shape.  Manually-uploaded photos are
 * collected from housePhotos (skipped for garages).  Uploaded photos take
 * precedence: if the user uploaded a "Front" photo, any Street View "Front"
 * image is dropped so the backend receives exactly one photo per label.
 *
 * Frames the estimator has explicitly vetoed (excludedStreetViewKeys) are
 * dropped before anything is submitted, so a borderline frame the AI accepted
 * can be overridden by the human looking straight at it.
 *
 * @param {object} opts
 * @param {Array}   opts.elevationImages   - State from StreetViewPanel (may be empty)
 * @param {Array}   opts.housePhotos       - Manually staged photos [{url, label}]
 * @param {boolean} [opts.isGarageStructure=false] - Garage jobs skip uploaded photos
 * @param {boolean} [opts.satelliteOnly=false] - Force satellite-only path (no photos)
 * @param {Array}   [opts.excludedStreetViewKeys=[]] - Estimator-vetoed frame keys
 * @returns {{ svPhotos, uploadedPhotos, dedupedSv, allPhotos, excludedSv }}
 */
export function buildSidingPhotoList({
  elevationImages = [],
  housePhotos = [],
  isGarageStructure = false,
  satelliteOnly = false,
  excludedStreetViewKeys = [],
} = {}) {
  const excludedKeys = new Set((excludedStreetViewKeys || []).map(streetViewFrameKey));

  // Frames the AI/Street View coverage check already rejected never reach here;
  // excludedSv is only the subset a human vetoed, so the caller can report it.
  const usableSv = satelliteOnly ? [] : (elevationImages || [])
    .filter(img => img.available && img.imageUrl && !img._staticApiNotEnabled);
  const excludedSv = usableSv.filter(img => excludedKeys.has(streetViewFrameKey(img)));

  // Street View images (already fetched by StreetViewPanel when address was entered).
  // satelliteOnly=true forces an empty list so the caller takes the satellite-only path.
  const svPhotos = usableSv
    .filter(img => !excludedKeys.has(streetViewFrameKey(img)))
    .map(img => ({
      url: img.imageUrl,
      label: img.direction || 'Front',
      source_type: 'street_view',
      panorama_id: img.panorama_id || img.panoId || null,
      verified_elevation: img.verified_elevation === true,
      // wall_azimuth + heading let the backend recapture a better angle for
      // this same wall when the auto-fetched frame turns out to be trees,
      // sky, or the neighbouring house. Without the azimuth it cannot work
      // out where to stand to see this wall.
      wall_azimuth: Number.isFinite(Number(img.wall_azimuth)) ? Number(img.wall_azimuth) : null,
      heading: Number.isFinite(Number(img.heading)) ? Number(img.heading) : null,
    }));

  // Manually uploaded house photos (not for garages — garage flow skips satellite mode).
  // Also skipped when satelliteOnly=true.
  const uploadedPhotos = !satelliteOnly && !isGarageStructure
    ? (housePhotos || []).map(p => ({
        url: p.url,
        label: p.label,
        exif_heading: p.exif_heading ?? null,
      }))
    : [];

  // Merge: uploaded photos first (user-chosen angles take precedence), then street view.
  // De-duplicate by label so a manual "Front" photo replaces the street view "Front".
  const seenLabels = new Set(uploadedPhotos.map(p => p.label));
  const dedupedSv = svPhotos.filter(p => !seenLabels.has(p.label));
  const allPhotos = [...uploadedPhotos, ...dedupedSv];

  return { svPhotos, uploadedPhotos, dedupedSv, allPhotos, excludedSv };
}

/**
 * Return the name of the backend function to call based on available photos.
 *
 * When at least one photo is available the photo+satellite path is used for
 * best accuracy.  When there are no photos the satellite-only path fires.
 *
 * @param {Array} allPhotos
 * @returns {'analyzeHousePhotosForSiding' | 'analyzeSidingMeasurement'}
 */
export function chooseSidingAnalysisPath(allPhotos) {
  return allPhotos.length > 0 ? 'analyzeHousePhotosForSiding' : 'analyzeSidingMeasurement';
}

/**
 * Return true when the satellite-only response has no usable wall area,
 * which means we should fall back to a roof-footprint-derived estimate.
 *
 * @param {object|null} data - Raw response data from analyzeSidingMeasurement
 * @returns {boolean}
 */
export function needsRoofFootprintFallback(data) {
  return !Number(data?.wall_area_sq) && !Number(data?.wall_area_sqft);
}

/**
 * Build a rough siding measurement object derived from the roof footprint when
 * the Solar siding API returns zero wall area.  Returns null when there is not
 * enough data to produce a meaningful estimate (no primaryAnalysis, no eave LF,
 * no rake LF, and no roof area to estimate from).
 *
 * The output is Grade D (±20 %) — the caller must surface this to the user.
 *
 * @param {object|null} primaryAnalysis   - satelliteAnalysis from the roof pass
 * @param {number}      storyCount
 * @param {number}      totalWallHt       - total wall height in feet (all stories)
 * @param {number}      openingDeductionPct
 * @returns {object|null}
 */
export function buildRoofFootprintFallback(
  primaryAnalysis,
  storyCount,
  totalWallHt,
  openingDeductionPct,
) {
  if (!primaryAnalysis) return null;
  // Prefer eave perimeter; rake LF is the sloped edge not the wall edge but is
  // better than nothing. If neither is available, estimate from roof area.
  const eaveLF = Number(primaryAnalysis.eave_lf) || 0;
  const rakeLF = Number(primaryAnalysis.rake_lf) || 0;
  const roofSQ = Number(primaryAnalysis.corrected_area_sq) || Number(primaryAnalysis.roof_area_sq) || 0;
  const perimeter = eaveLF > 0 ? eaveLF
    : rakeLF > 0 ? rakeLF * 1.2
    : roofSQ > 0 ? Math.ceil(Math.sqrt(roofSQ * 100) * 4) : 0;
  if (perimeter === 0) return null;
  const side = Math.ceil(perimeter / 4);
  const grossWallSF = perimeter * totalWallHt;
  const netWallSF = Math.round(grossWallSF * (1 - (openingDeductionPct / 100)));
  const corners = 4;
  return {
    gross_wall_area_sqft: Math.round(grossWallSF),
    wall_area_sqft: netWallSF,
    wall_area_sq: netWallSF / 100,
    perimeter_ft: perimeter,
    building_length_ft: side,
    building_width_ft: side,
    story_count: storyCount,
    story_height_ft: totalWallHt,
    windows_count: 0,
    doors_count: 0,
    inside_corners_count: 0,
    outside_corners_count: corners,
    inside_corners_lf: 0,
    outside_corners_lf: corners * totalWallHt,
    wall_top_lf: perimeter,
    wall_bottom_lf: perimeter,
    j_channel_openings_lf: 0,
    overall_confidence: 45,
    confidence_grade: 'D',
    tolerance_pct: 20,
    osm_perimeter_used: false,
    _estimated_from_roof_footprint: true,
  };
}

/**
 * Validate the raw response from analyzeHousePhotosForSiding and return the
 * data object on success.  Throws a descriptive Error on any failure so the
 * caller's catch block can surface the problem without swallowing it.
 *
 * @param {object} response - Raw result from base44.functions.invoke(...)
 * @returns {object} data
 */
export function validatePhotoSidingResponse(response) {
  if (response?.error) throw new Error(response.error);
  const data = response?.data || response;
  if (data?.success === false) throw new Error(data.error || 'Siding photo analysis failed');
  if (!data || typeof data.wall_area_sqft !== 'number') {
    throw new Error('Photo analysis returned no measurements');
  }
  return data;
}

/**
 * Stable identity for a Street View frame, used to remember estimator vetoes.
 *
 * The key is the wall face the frame shows ("Front", "Right Side", …) — NOT the
 * panorama id.  Google re-shoots streets and hands back a new panorama id for
 * the same address, so a pano-based key would silently re-admit a frame the
 * estimator already rejected.  Keying on the face keeps the veto sticky; the UI
 * always offers an explicit "use again" control so it is never a dead end.
 *
 * Accepts an elevationImages entry, a built photo ({label}), or a bare string.
 *
 * @param {object|string} frame
 * @returns {string}
 */
export function streetViewFrameKey(frame) {
  const raw = typeof frame === 'string'
    ? frame
    : (frame?.direction ?? frame?.label ?? '');
  const key = String(raw).trim().toLowerCase().replace(/[\s-]+/g, '_');
  // buildSidingPhotoList labels a direction-less frame "Front"; match that so a
  // veto on such a frame still lines up with the photo actually submitted.
  return key || 'front';
}
