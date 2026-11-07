// Fascia, soffit, and gutters shared by the photo analysis path.
// A photographed gutter run is kept, including a face the photos show as
// having no gutter. Only a face with no photo at all takes a share of the
// roof-model eave. That eave is the eave edges, never the rakes.

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export function soffitDepthsFromPhotos(perPhotoResults, { hasMeasuredRoofEdges = false } = {}) {
  const eaveDepths = [];
  const rakeDepths = [];
  for (const result of perPhotoResults || []) {
    const eave = num(result?.soffit_depth_ft);
    if (eave != null && eave >= 0.5 && eave <= 6) eaveDepths.push(eave);
    const rake = num(result?.rake_soffit_depth_ft);
    if (rake != null && rake >= 0 && rake <= 6) rakeDepths.push(rake);
  }
  const measuredEave = average(eaveDepths);
  const measuredRake = average(rakeDepths);
  const levelDepthFt = hasMeasuredRoofEdges
    ? (measuredEave != null ? measuredEave : 2)
    : 1.5;
  const slopedDepthFt = measuredRake != null
    ? measuredRake
    : (hasMeasuredRoofEdges ? (measuredEave != null ? measuredEave : 1.5) : 1.5);
  return {
    levelDepthFt,
    slopedDepthFt,
    soffitDepthSource: measuredEave != null || measuredRake != null ? 'measured' : 'estimated',
  };
}

function canonicalFace(result) {
  const face = String(result?.wall_face || result?.view_label || '').toLowerCase();
  if (face.includes('front')) return 'front';
  if (face.includes('back') || face.includes('rear')) return 'back';
  if (face.includes('left')) return 'left';
  if (face.includes('right')) return 'right';
  return '';
}

const GUTTER_FACES = ['front', 'back', 'left', 'right'];

/**
 * Measured gutter runs, one total per wall face. A face that reports the
 * gutter is absent stores 0. A face that was not photographed is absent from
 * the map so the roof-model eave can fill that run. A 0 on an unseen face
 * is not a measurement.
 */
export function collectMeasuredGutterRuns(perPhotoResults) {
  const byFace = new Map();
  let explicit = false;
  for (const result of perPhotoResults || []) {
    if (result?.gutter_observation_complete === true) explicit = true;
    const face = canonicalFace(result);
    if (!face) continue;
    const run = num(result?.gutter_run_lf);
    const visible = result?.gutter_visible;
    if (visible !== true && visible !== false && run == null) continue;
    if (visible === false && !(run > 0)) {
      byFace.set(face, 0);
      continue;
    }
    if (run != null && run > 0) {
      byFace.set(face, Math.max(byFace.get(face) || 0, run));
    }
  }
  const runs = [...byFace.values()];
  const sum = runs.reduce((total, n) => total + n, 0);
  const observed = byFace.size > 0 && (sum > 0 || explicit);
  return { observed, runs: observed ? runs : null, byFace, explicit, faceCount: byFace.size, lf: observed ? sum : 0 };
}

/**
 * Gutters follow roof eave lengths. The wall perimeter plus 8×1.5 ft is a
 * four-corner box, and cutting that box by a gable ratio lands near half of
 * a real eave (Malec gutters vs Hover 351 LF). The longer of the facet eave
 * and the roof-analysis eave wins, even when the facet trace is incomplete.
 * The box is only the last resort.
 */
/**
 * Plan length of unshared level edges. A disconnected facet trace labels the
 * low side as eave and leaves the other level boundary as a ridge or "none".
 * When that unlabeled share is large, the level outline is the eave.
 * A label of rake, ridge, or porch is not enough to drop the edge. Only a
 * segment that actually rises like a rake is left out.
 */
function edgeRisesAsRake(edge, plan) {
  const h1 = Number(edge?.h1);
  const h2 = Number(edge?.h2);
  if (!Number.isFinite(h1) || !Number.isFinite(h2)) return true;
  const rise = Math.abs(h1 - h2);
  if (!(plan > 0)) return rise > 0;
  // 2.5/12 is a roof rake. A level eave can wobble without being one.
  return rise >= 1 && rise / plan >= 2.5 / 12;
}

export function levelOutlineEaveLf(facets) {
  const seen = new Set();
  let total = 0;
  for (const facet of Array.isArray(facets) ? facets : []) {
    for (const edge of facet?.edges || []) {
      if (!edge || edge.shared_with) continue;
      const x1 = Number(edge.x1);
      const y1 = Number(edge.y1);
      const x2 = Number(edge.x2);
      const y2 = Number(edge.y2);
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue;
      const plan = Math.hypot(x2 - x1, y2 - y1);
      if (!(plan > 0.5) || edgeRisesAsRake(edge, plan)) continue;
      const a = `${Math.round(x1 * 2) / 2},${Math.round(y1 * 2) / 2}`;
      const b = `${Math.round(x2 * 2) / 2},${Math.round(y2 * 2) / 2}`;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += plan;
    }
  }
  return Math.round(total * 10) / 10;
}

export function selectGutterEaveLf({
  facetEaveLf = 0,
  facetTraceUsable = false,
  roofEaveLf = 0,
  footprintFallbackLf = 0,
  levelBoundaryLf = 0,
} = {}) {
  const labeled = Number(facetEaveLf) || 0;
  const level = Number(levelBoundaryLf) || 0;
  // The labeled eave is missing a large share of the level outline.
  const facet = level > labeled && labeled > 0 && labeled < level * 0.7 ? level : labeled;
  const facetSource = facet === level && level > labeled ? 'roof_level_outline' : 'roof_facet_eave';
  const roof = Number(roofEaveLf) || 0;
  const fallback = Number(footprintFallbackLf) || 0;
  if (roof > facet && roof > 0) {
    return { eave_lf: Math.round(roof), source: 'roof_eave' };
  }
  if (facet > 0 && (facetTraceUsable || !(roof > 0) || facetSource === 'roof_level_outline')) {
    return { eave_lf: Math.round(facet), source: facetSource };
  }
  if (roof > 0) {
    return { eave_lf: Math.round(roof), source: 'roof_eave' };
  }
  if (facet > 0) {
    return { eave_lf: Math.round(facet), source: 'roof_facet_eave' };
  }
  return { eave_lf: Math.round(fallback), source: 'footprint_fallback' };
}

/**
 * Gemini often copies wall_width_ft into gutter_run_lf. That is the wall,
 * not a gutter tape. The run that would be billed (the longest read on the
 * face) is the one that matters: extra photos of the same wall that miss
 * the width must not vote a real echo down under a photo-count ratio.
 */
export function gutterRunsEchoWallWidth(perPhotoResults) {
  const byFace = new Map();
  for (const result of perPhotoResults || []) {
    const face = canonicalFace(result);
    if (!face) continue;
    const run = num(result?.gutter_run_lf);
    const width = num(result?.wall_width_ft);
    if (!(run > 0) && !(width > 0)) continue;
    const row = byFace.get(face) || { runs: [], widths: [] };
    if (run > 0) row.runs.push(run);
    if (width > 0) row.widths.push(width);
    byFace.set(face, row);
  }
  const faces = [...byFace.values()].filter((row) => row.runs.length > 0 && row.widths.length > 0);
  if (faces.length < 2) return false;
  const echoed = faces.filter((row) => {
    const kept = Math.max(...row.runs);
    return row.widths.some((width) => Math.abs(kept - width) <= 1);
  });
  return echoed.length / faces.length >= 0.5;
}

export function resolveGutterQuantity({
  perPhotoResults,
  roofGraphGutterLf = 0,
  roofGraphComplete = false,
  eaveLf = 0,
  eaveBasisSource = null,
} = {}) {
  const measured = collectMeasuredGutterRuns(perPhotoResults);
  const eave = Number(eaveLf) || 0;
  const explicitAbsent = measured.observed && GUTTER_FACES.some((face) => measured.byFace.get(face) === 0);
  // The level outline is the eave. Photo runs that come in under it are a
  // partial tape (Malec 208 LF against a 343 LF outline), not a shorter house.
  // A shorter facet-eave basis is left alone.
  if (
    eaveBasisSource === 'roof_level_outline'
    && measured.observed
    && !explicitAbsent
    && eave > 0
    && measured.lf + 0.5 < eave
  ) {
    return {
      gutter_lf: Math.round(eave),
      gutter_source: 'roof_eave',
      gutter_filled_faces: [],
      gutter_note: `photo gutter runs (${Math.round(measured.lf)} LF) are under the level-outline eave`,
    };
  }
  // A wall-width echo is not a gutter measurement. The roof eave wins when
  // it is longer and no face was reported as having no gutter.
  if (measured.observed && !explicitAbsent && gutterRunsEchoWallWidth(perPhotoResults) && eave > measured.lf) {
    return {
      gutter_lf: Math.round(eave),
      gutter_source: 'roof_eave',
      gutter_filled_faces: [],
      gutter_note: `photo gutter runs echoed wall widths (${Math.round(measured.lf)} LF) and were shorter than the roof eave`,
    };
  }
  if (measured.observed) {
    const missing = GUTTER_FACES.filter((face) => !measured.byFace.has(face));
    // Every photographed run is kept, including a real zero. Faces with no
    // photo take an equal share of the roof-model eave instead of staying 0.
    const fill = missing.length > 0 && eave > 0
      ? eave * (missing.length / GUTTER_FACES.length)
      : 0;
    const photoLf = measured.lf + fill;
    if (fill > 0) {
      // A missing face was about to be filled from the eave. When the runs
      // already on the photos are within 10% of that eave, the eave is the
      // quantity. Filling the missing face is what pushed Coleman to 116 LF.
      if (eave > 0 && measured.lf > 0 && Math.abs(measured.lf - eave) / eave <= 0.10) {
        return {
          gutter_lf: Math.round(eave),
          gutter_source: 'roof_eave',
          gutter_filled_faces: [],
          gutter_note: `photo gutter runs (${Math.round(measured.lf)} LF) are within 10% of the roof eave`,
        };
      }
      return {
        gutter_lf: Math.round(photoLf),
        gutter_source: 'photos_plus_eave',
        gutter_filled_faces: missing,
      };
    }
    // Every face showed a gutter, none of those reads were marked complete,
    // and the runs add up to about half the roof eave. That is a partial
    // tape, not a house with short gutters. An explicit zero still stays 0.
    const everyFaceGuttered = GUTTER_FACES.every((face) => (measured.byFace.get(face) || 0) > 0);
    if (!measured.explicit && everyFaceGuttered && eave > 0 && measured.lf < eave * 0.6) {
      return {
        gutter_lf: Math.round(eave),
        gutter_source: 'photos_plus_eave',
        gutter_filled_faces: [],
      };
    }
    return { gutter_lf: Math.round(measured.lf), gutter_source: 'photos', gutter_filled_faces: [] };
  }
  const graphLf = Number(roofGraphGutterLf) || 0;
  if (roofGraphComplete && graphLf > 0) {
    return { gutter_lf: Math.round(graphLf), gutter_source: 'photos', gutter_filled_faces: [] };
  }
  return { gutter_lf: Math.round(eave), gutter_source: 'estimated_from_eave', gutter_filled_faces: [] };
}

export function measureElevationAccessories({
  eaveLf = 0,
  rakeLf = 0,
  fasciaLf,
  levelDepthFt = 0,
  slopedDepthFt = 0,
} = {}) {
  const eave = Number(eaveLf) || 0;
  const rake = Number(rakeLf) || 0;
  const level = Number(levelDepthFt) || 0;
  const sloped = Number(slopedDepthFt) || 0;
  const soffitLevelSqft = Math.round(eave * level);
  const soffitSlopedSqft = Math.round(rake * sloped);
  const fascia = Number.isFinite(Number(fasciaLf)) ? Number(fasciaLf) : eave + rake;
  return {
    fascia_lf: Math.round(fascia),
    soffit_level_sqft: soffitLevelSqft,
    soffit_sloped_sqft: soffitSlopedSqft,
    soffit_sqft: soffitLevelSqft + soffitSlopedSqft,
    eave_lf: Math.round(eave),
    rake_lf: Math.round(rake),
  };
}
