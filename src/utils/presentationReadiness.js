import { hasOpeningInventory, resolveOpeningCounts } from './openingCounts';

const PHOTO_HEIGHT_SOURCE = /^(photo_calibration|manual_calibration)/i;

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasSolarRoofGeometry(satellite) {
  return Boolean(
    satellite?.raw_solar_data?.solarPotential?.roofSegmentStats?.length
    || satellite?.roof_facets?.length
    || satellite?.solarPotential?.roofSegmentStats?.length,
  );
}

export function resolveWallMeasurementSource(measurements = {}) {
  const graph = measurements.measurement_graph || {};
  // Authoritative signal: the measurement graph records which derivation
  // actually produced the hero wall area. When it says the photo wall planes
  // won, nothing else needs to be inferred — the walls ARE photo-calibrated.
  const heroSource = String(
    graph.totals?.gross_wall_area_source || measurements.wall_area_source || '',
  );
  if (heroSource === 'photo_wall_planes') {
    const measured = graph.totals?.photo_measured_faces;
    return {
      kind: 'photo_calibration',
      label: 'Photo-calibrated wall planes',
      shortLabel: 'Photo-calibrated walls',
      observedFacetCount: Array.isArray(measured)
        ? measured.length
        : (Array.isArray(graph.wall_facets) ? graph.wall_facets.length : 0),
      measuredFaces: Array.isArray(measured) ? measured : [],
      substitutedFaces: Array.isArray(graph.totals?.photo_substituted_faces)
        ? graph.totals.photo_substituted_faces
        : [],
    };
  }
  const facets = Array.isArray(graph.wall_facets) ? graph.wall_facets : [];
  const observedFacets = facets.filter(facet => (
    facet?.face
    && facet.face !== 'unknown'
    && !facet.is_unknown
  ));
  const heightSource = String(measurements.height_source || '');
  const photoCalibratedHeight = PHOTO_HEIGHT_SOURCE.test(heightSource);
  const photoWallFacets = observedFacets.filter(facet => (
    /photo|calibrat/i.test(String(facet.dimension_source || facet.provenance?.source || ''))
    || Number(facet.wall_width_ft) > 0
    || Number(facet.wall_height_ft) > 0
  ));
  const photoCalibrated = photoCalibratedHeight && (
    photoWallFacets.length > 0
    || measurements.photo_calibration_anchors > 0
    || measurements.photo_calibration_count > 0
  );

  if (photoCalibrated) {
    return {
      kind: 'photo_calibration',
      label: 'Photo-calibrated wall planes',
      shortLabel: 'Photo-calibrated walls',
      observedFacetCount: observedFacets.length,
    };
  }

  if (measurements.manual_measurement || measurements.footprint_source === 'manual') {
    return {
      kind: 'manual',
      label: 'Manual wall measurements',
      shortLabel: 'Manual measurements',
      observedFacetCount: observedFacets.length,
    };
  }

  if (
    measurements.used_satellite_footprint
    || measurements.osm_perimeter_used
    || /solar|osm|footprint|eave/i.test(String(
      measurements.footprint_source || graph.building?.footprint_source || '',
    ))
  ) {
    return {
      kind: 'footprint_extrusion',
      label: 'Footprint extrusion',
      shortLabel: 'Satellite extrusion',
      observedFacetCount: observedFacets.length,
    };
  }

  return {
    kind: 'unknown',
    label: 'Wall source not confirmed',
    shortLabel: 'Source unconfirmed',
    observedFacetCount: observedFacets.length,
  };
}

function openingGroupsFor(measurements = {}) {
  const graphGroups = measurements.measurement_graph?.opening_groups;
  if (Array.isArray(graphGroups)) return graphGroups;
  return Array.isArray(measurements.openings_detail)
    ? measurements.openings_detail
    : null;
}

export function resolvePhotoWallAreaSqft(measurements = {}) {
  return [
    measurements.photo_wall_area_sqft,
    measurements.photo_calibrated_wall_area_sqft,
    measurements.photo_net_wall_area_sqft,
    measurements.measurement_graph?.totals?.photo_wall_area_sqft,
    measurements.measurement_graph?.totals?.photo_calibrated_wall_area_sqft,
  ].map(asNumber).find(value => value != null && value > 0) ?? null;
}

export function getPresentationReadiness({
  measurements = {},
  satelliteAnalysis = null,
  garageDoorOverrideAccepted = false,
  showAnyway = false,
} = {}) {
  const source = resolveWallMeasurementSource(measurements);
  const graph = measurements.measurement_graph || {};
  const materialMap = measurements.material_map
    || measurements.materialMap
    || graph.material_map
    || null;
  const photosExist = Number(measurements.photos_analyzed) > 0
    || (Array.isArray(graph.wall_facets) && graph.wall_facets.some(facet => Number(facet.photo_count) > 0));
  const coverage = measurements.coverage || graph.coverage || null;
  const groups = openingGroupsFor(measurements);
  const counts = resolveOpeningCounts(measurements);
  const footprintPolygon = measurements.footprint_polygon_xy;
  const hasFootprintPolygon = Array.isArray(footprintPolygon) && footprintPolygon.length >= 3;
  const openingCount = groups
    ? groups.length
    : [counts.windows, counts.doors, counts.garageDoors]
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
  const openingInventory = hasOpeningInventory(measurements)
    || Array.isArray(measurements.openings_detail);
  const openingsKnown = openingInventory && (
    groups != null
    || (counts.windowsExact && counts.doorsExact)
  );
  const openingsPunched = openingCount === 0
    ? openingsKnown
    : openingsKnown && hasFootprintPolygon && groups?.length > 0;
  const grade = String(measurements.confidence_grade || '').toUpperCase();
  const tolerance = asNumber(measurements.tolerance_pct);
  const garageDoorCount = asNumber(
    measurements.garage_door_count ?? graph.counts?.garage_doors,
  ) ?? 0;
  const reasons = [];
  const warnings = [];

  if (!hasSolarRoofGeometry(satelliteAnalysis)) {
    reasons.push('Google Solar roof geometry is not available.');
  }
  if (source.kind !== 'photo_calibration') {
    reasons.push(
      source.kind === 'footprint_extrusion'
        ? 'Walls are still calculated from the satellite/footprint extrusion.'
        : 'A photo-calibrated wall source is not confirmed.',
    );
  }
  if (!openingsPunched) {
    reasons.push(
      openingCount > 0
        ? 'Measured openings cannot be punched into the customer wall geometry.'
        : 'Window and door inventory is not authoritative yet.',
    );
  }
  if (!['A', 'B'].includes(grade)) {
    reasons.push(`Wall estimate quality is Grade ${grade || 'unknown'}; Grade B or better is required.`);
  }
  if (tolerance != null && tolerance >= 20) {
    reasons.push(`Wall estimate tolerance is ±${tolerance}%; review the photos before presenting it.`);
  }
  if (coverage?.review_required || coverage?.missing_faces?.length > 0) {
    reasons.push('Photo coverage is incomplete or needs review.');
  }
  if (photosExist && !materialMap) {
    reasons.push('Photo material classification is missing; Present cannot claim siding quantities yet.');
  } else if (photosExist && materialMap?.review_required) {
    reasons.push('Photo material classification is incomplete or ambiguous; review stone versus siding before Present.');
  }
  if (garageDoorCount > 2 && !garageDoorOverrideAccepted) {
    reasons.push(`${garageDoorCount} garage doors needs an explicit review override.`);
  }

  const photoArea = resolvePhotoWallAreaSqft(measurements);
  // Compare against the FOOTPRINT EXTRUSION, not against `gross_wall_area_sqft`
  // — once the photo prism becomes the hero, gross IS the photo area and the
  // check would trivially compare a number with itself.
  const extrusionArea = asNumber(
    graph.totals?.extrusion_wall_area_sqft
    ?? measurements.extrusion_wall_area_sqft
    ?? graph.totals?.gross_wall_area_sqft
    ?? measurements.gross_wall_area_sqft,
  );
  if (photoArea != null && extrusionArea != null && extrusionArea > 0) {
    const differencePct = Math.round(Math.abs(photoArea - extrusionArea) / extrusionArea * 100);
    if (differencePct > 25) {
      reasons.push(`Photo wall area differs from satellite extrusion by ${differencePct}%.`);
    }
  }

  if (source.kind === 'footprint_extrusion') {
    warnings.push('Photos uploaded — openings counted; wall area is still satellite extrusion.');
  }
  if (source.kind !== 'photo_calibration') {
    warnings.push('Present is blocked until photo-calibrated wall planes are applied.');
  }

  return {
    allowed: reasons.length === 0 || showAnyway,
    blocked: reasons.length > 0 && !showAnyway,
    reasons,
    warnings,
    source,
    counts,
    openingCount,
    openingsPunched,
    hasSolarRoof: hasSolarRoofGeometry(satelliteAnalysis),
    photoAreaSqft: photoArea,
    extrusionAreaSqft: extrusionArea,
    materialMap,
  };
}

// ── Wall-area provenance (banner honesty) ───────────────────────────────────
// "8 photos + satellite" may only be claimed when the photos actually drove the
// wall area of the siding faces. When they only supplied opening counts, the
// banner has to say so — a homeowner reading "measured from photos" beside a
// number that came from a satellite extrusion is being misled.
export function describeWallAreaProvenance(measurements = {}) {
  const graph = measurements.measurement_graph || {};
  const totals = graph.totals || {};
  const source = String(totals.gross_wall_area_source || measurements.wall_area_source || '');
  const photoCalibrated = source === 'photo_wall_planes';
  const measuredFaces = Array.isArray(totals.photo_measured_faces)
    ? totals.photo_measured_faces
    : (Array.isArray(measurements.photo_measured_faces) ? measurements.photo_measured_faces : []);
  const substitutedFaces = Array.isArray(totals.photo_substituted_faces)
    ? totals.photo_substituted_faces
    : (Array.isArray(measurements.photo_substituted_faces) ? measurements.photo_substituted_faces : []);
  const openingCount = asNumber(
    graph.counts?.rough_openings ?? measurements.rough_openings_count,
  );

  return {
    photoCalibrated,
    measuredFaces,
    substitutedFaces,
    openingCount,
    // Short phrase for the "Siding measured — …" headline. It must never name
    // an imagery source it cannot verify (the footprint may be OSM, Solar, a
    // roof-eave trace or the photos themselves) — the caller prints the real
    // footprint source on the next line.
    headline: photoCalibrated
      ? 'wall planes measured from photos'
      : 'footprint extrusion + photo opening counts',
    // One-line explanation printed under the headline.
    detail: photoCalibrated
      ? `📷 Wall area from ${measuredFaces.length} photo-measured elevation${measuredFaces.length === 1 ? '' : 's'}${
        substitutedFaces.length > 0
          ? ` (${substitutedFaces.join(', ').replace(/_/g, ' ')} substituted from the footprint)`
          : ''}`
      : `📐 Wall area from the footprint extrusion — photos supplied${
        openingCount != null ? ` ${openingCount}` : ''} opening count${openingCount === 1 ? '' : 's'}, not the wall planes`,
  };
}

// ── PhotoPresent ────────────────────────────────────────────────────────────
// A blocked mesh Present must never dead-end at a padlock. Even when the wall
// geometry is not customer-safe, the best elevation photo IS a truthful thing
// to show a homeowner, annotated with what we actually classified. This picks
// that photo and the chips that go with it.
// Only a labelled ELEVATION may stand in for the Present view. A detail shot, a
// damage close-up or an unlabelled upload carries no face assignment, so putting
// whole-house material and quantity chips beside it would attribute the whole
// building to a photo of one shutter. No face → no PhotoPresent.
const PHOTO_PRESENT_FACE_MATCHERS = [
  { face: 'front', test: /(^|[\s_-])front([\s_-]|$)|elevation[\s_-]?a\b/i },
  { face: 'right_side', test: /(^|[\s_-])right([\s_-]|$)/i },
  { face: 'left_side', test: /(^|[\s_-])left([\s_-]|$)/i },
  { face: 'back', test: /(^|[\s_-])(back|rear)([\s_-]|$)/i },
];

function labelOf(photo) {
  return String(photo?.label || photo?.face || photo?.name || '').trim();
}

function canonicalFaceOf(photo) {
  const label = labelOf(photo);
  if (!label) return null;
  // A "detail"/"damage"/"close-up" slot is supporting evidence, never a face.
  if (/detail|damage|close[\s_-]?up|roof|interior/i.test(label)) return null;
  const hit = PHOTO_PRESENT_FACE_MATCHERS.find(m => m.test.test(label));
  return hit ? hit.face : null;
}

const MATERIAL_CHIP_LABELS = {
  lap_siding: 'Lap siding',
  vertical_siding: 'Vertical siding',
  stone: 'Stone',
  brick: 'Brick',
  stucco: 'Stucco',
  glass: 'Glass',
  other: 'Other',
  unknown: 'Unclassified',
};

export function getPhotoPresentPlan({ measurements = {}, photos = [] } = {}) {
  const graph = measurements.measurement_graph || {};
  const totals = graph.totals || {};

  const candidates = (Array.isArray(photos) ? photos : [])
    .map(p => ({ photo: p, face: canonicalFaceOf(p) }))
    .filter(c => c.photo && (c.photo.url || c.photo.preview) && c.face);
  if (candidates.length === 0) {
    // No face-assigned elevation — fall through to the padlock rather than
    // dressing an unidentified photo up as the customer-facing render.
    return { available: false, photo: null, chips: [], banner: null, materialLines: [] };
  }

  // Prefer an elevation the graph actually measured, then the usual front-first
  // order a homeowner expects to see.
  const measuredFaces = Array.isArray(totals.photo_measured_faces) ? totals.photo_measured_faces : [];
  const facePreference = ['front', 'right_side', 'left_side', 'back'];
  const rank = (c) => (measuredFaces.includes(c.face) ? 0 : 10) + facePreference.indexOf(c.face);
  const chosenCandidate = candidates.slice().sort((a, b) => rank(a) - rank(b))[0];
  const chosen = chosenCandidate.photo;
  const materialMap = measurements.material_map || measurements.materialMap || graph.material_map || null;
  const provenance = describeWallAreaProvenance(measurements);
  const counts = resolveOpeningCounts(measurements);

  const chips = [];
  const sidingSqft = asNumber(totals.net_siding_area_sqft ?? measurements.wall_area_sqft);
  if (sidingSqft != null) {
    chips.push({ key: 'siding', label: 'Siding', value: `${Math.round(sidingSqft).toLocaleString()} sqft` });
  }
  const masonrySqft = asNumber(totals.masonry_area_sqft ?? measurements.masonry_area_sqft);
  if (masonrySqft != null && masonrySqft > 0) {
    chips.push({ key: 'masonry', label: 'Excluded masonry', value: `${Math.round(masonrySqft).toLocaleString()} sqft` });
  }
  if (counts.windows != null) {
    chips.push({ key: 'windows', label: 'Window assemblies', value: String(counts.windows) });
  }
  if (counts.doors != null) {
    chips.push({ key: 'doors', label: 'Doors', value: String(counts.doors) });
  }
  const grade = String(measurements.confidence_grade || '').toUpperCase();
  if (grade) {
    const tolerance = asNumber(measurements.tolerance_pct);
    chips.push({
      key: 'grade',
      label: 'Quality',
      value: tolerance != null ? `Grade ${grade} (±${tolerance}%)` : `Grade ${grade}`,
    });
  }

  const materialLines = materialMap?.faces
    ? Object.values(materialMap.faces).map(face => ({
      face: face.face,
      label: String(face.face || '').replace(/_/g, ' '),
      sidingPercent: asNumber(face.siding_percent),
      dominant: (face.regions || [])
        .slice()
        .sort((a, b) => (Number(b.percent) || 0) - (Number(a.percent) || 0))
        .map(region => MATERIAL_CHIP_LABELS[region.material] || region.material)[0] || null,
    }))
    : [];

  return {
    available: true,
    photo: { url: chosen.url || chosen.preview, label: labelOf(chosen) || 'Elevation photo' },
    chips,
    materialLines,
    banner: provenance.detail,
    photoCalibrated: provenance.photoCalibrated,
  };
}
