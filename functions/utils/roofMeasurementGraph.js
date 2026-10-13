const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const round = (value, places = 1) => {
  const scale = 10 ** places;
  return Math.round(num(value) * scale) / scale;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, num(value)));

const normalizeFace = (value) => {
  const face = String(value || '').toLowerCase();
  if (face.includes('back') || face.includes('rear') || face.includes('north')) return 'back';
  if (face.includes('left') || face.includes('west')) return 'left_side';
  if (face.includes('right') || face.includes('east')) return 'right_side';
  if (face.includes('front') || face.includes('south')) return 'front';
  return 'unknown';
};

const normalizeEdgeType = (value) => {
  const type = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (type.includes('gutter')) return 'gutter';
  if (type.includes('eave')) return 'eave';
  if (type.includes('ridge')) return 'ridge';
  if (type.includes('hip')) return 'hip';
  if (type.includes('valley')) return 'valley';
  if (type.includes('rake')) return 'rake';
  if (type.includes('step')) return 'step_flashing';
  return null;
};

const stableObservationKey = (item, prefix, index, face) => {
  const supplied = item.observation_id || item.id || item.plane_id || item.edge_id;
  if (supplied) return String(supplied).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return `${prefix}_${face}_${index}`;
};

const pitchCosine = (pitch) => {
  const match = String(pitch || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (!match || Number(match[2]) <= 0) return null;
  const slope = Number(match[1]) / Number(match[2]);
  return 1 / Math.sqrt(1 + slope * slope);
};

/**
 * Builds a deterministic graph of roof-plane and roof-edge observations extracted
 * from labeled physical photos. It never invents missing planes or scales totals
 * toward a target report. Incomplete coverage remains incomplete.
 */
export function buildRoofMeasurementGraph({
  perPhotoResults = [],
  buildingWidthFt = 0,
  buildingLengthFt = 0,
  footprintSource = 'photos',
  // True plan area of the traced footprint, when one exists. width x length is
  // only correct for a rectangle: on an L-shaped house the bounding box
  // overstates the plan area, and every ratio derived from it then reads low.
  footprintAreaSqft: footprintAreaSqftInput = 0,
} = {}) {
  const planeById = new Map();
  const edgeById = new Map();
  const evidence = [];
  const coveredFaces = new Set();
  const coveredElevations = new Set();
  const gutterInspectedElevations = new Set();
  const edgeInspectedElevations = new Set();
  const photoPitchVotes = new Map();

  for (const [photoIndex, result] of perPhotoResults.entries()) {
    if (!result) continue;
    const label = result.view_label || result.label || `photo_${photoIndex + 1}`;
    const resultFace = normalizeFace(result.wall_face || label);
    const resultConfidence = clamp(result.confidence || 50, 0, 100);
    const resultPlanes = Array.isArray(result.roof_planes) ? result.roof_planes : [];
    const resultEdges = Array.isArray(result.roof_edges) ? result.roof_edges : [];
    if (
      result.roof_pitch_detected
      && ['high', 'medium'].includes(String(result.roof_pitch_confidence || '').toLowerCase())
    ) {
      photoPitchVotes.set(
        result.roof_pitch_detected,
        (photoPitchVotes.get(result.roof_pitch_detected) || 0) + resultConfidence,
      );
    }
    const isVerifiedElevation = result.source_type !== 'street_view' || result.verified_elevation === true;
    if (
      resultFace !== 'unknown'
      && resultConfidence >= 70
      && result.occluded !== true
      && result.is_corner_shot !== true
      && isVerifiedElevation
    ) {
      coveredElevations.add(resultFace);
      if (result.gutter_observation_complete === true) gutterInspectedElevations.add(resultFace);
      if (result.roof_edge_observation_complete === true) edgeInspectedElevations.add(resultFace);
    }

    evidence.push({
      photo_id: `photo_${photoIndex + 1}`,
      label,
      face: resultFace,
      confidence: round(resultConfidence, 0),
      plane_count: resultPlanes.length,
      edge_count: resultEdges.length,
      occluded: result.occluded === true,
    });

    resultPlanes.forEach((plane, planeIndex) => {
      const face = normalizeFace(plane.face || plane.roof_face || resultFace);
      const widthFt = clamp(plane.width_ft || plane.eave_width_ft, 0, 250);
      const slopeLengthFt = clamp(plane.slope_length_ft || plane.rafter_length_ft, 0, 150);
      const reportedAreaSqft = clamp(plane.area_sqft, 0, 30000);
      // Dimensions are the canonical source. Never let a contradictory model-
      // supplied area override width × slope length and drive order quantity.
      const areaSqft = widthFt * slopeLengthFt;
      if (areaSqft < 20 || widthFt < 3 || slopeLengthFt < 3) return;

      const confidence = clamp(plane.confidence ?? resultConfidence, 0, 100);
      const suppliedIdentity = plane.observation_id || plane.id || plane.plane_id;
      const id = stableObservationKey(plane, 'plane', planeIndex, face);
      const normalized = {
        id,
        face,
        width_ft: round(widthFt),
        slope_length_ft: round(slopeLengthFt),
        area_sqft: round(areaSqft),
        reported_area_sqft: reportedAreaSqft ? round(reportedAreaSqft) : null,
        reported_area_difference_pct: reportedAreaSqft
          ? round(Math.abs(reportedAreaSqft - areaSqft) / areaSqft * 100, 1)
          : null,
        pitch: plane.pitch || result.roof_pitch_detected || null,
        azimuth_degrees: Number.isFinite(Number(plane.azimuth_degrees))
          ? round(((Number(plane.azimuth_degrees) % 360) + 360) % 360)
          : null,
        confidence: round(confidence, 0),
        occluded: plane.occluded === true,
        stable_identity: Boolean(suppliedIdentity),
        source_label: label,
      };
      const existing = planeById.get(id);
      if (!existing || normalized.confidence > existing.confidence) planeById.set(id, normalized);
      if (!normalized.occluded && normalized.confidence >= 55 && face !== 'unknown') coveredFaces.add(face);
    });

    resultEdges.forEach((edge, edgeIndex) => {
      const type = normalizeEdgeType(edge.type || edge.edge_type);
      const lengthFt = clamp(edge.length_ft, 0, 1000);
      if (!type || lengthFt < 1) return;
      const face = normalizeFace(edge.face || edge.roof_face || resultFace);
      const confidence = clamp(edge.confidence ?? resultConfidence, 0, 100);
      const id = stableObservationKey(edge, type, edgeIndex, face);
      const normalized = {
        id,
        type,
        face,
        length_ft: round(lengthFt),
        confidence: round(confidence, 0),
        occluded: edge.occluded === true,
        source_label: label,
      };
      const existing = edgeById.get(id);
      if (!existing || normalized.confidence > existing.confidence) edgeById.set(id, normalized);
    });
  }

  const planes = [...planeById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const edges = [...edgeById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const observedAreaSqft = round(planes.reduce((sum, plane) => sum + plane.area_sqft, 0));
  const avgPlaneConfidence = planes.length
    ? round(planes.reduce((sum, plane) => sum + plane.confidence, 0) / planes.length, 0)
    : 0;
  const faceCount = coveredFaces.size;
  const elevationCount = coveredElevations.size;
  const coverageRatio = round(elevationCount / 4, 2);
  const pitchVotes = new Map();
  planes.forEach((plane) => {
    if (!plane.pitch) return;
    pitchVotes.set(plane.pitch, (pitchVotes.get(plane.pitch) || 0) + plane.area_sqft);
  });
  const predominantPitch = [...pitchVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || [...photoPitchVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || null;
  const footprintAreaSqft = num(footprintAreaSqftInput) > 0
    ? num(footprintAreaSqftInput)
    : num(buildingWidthFt) * num(buildingLengthFt);
  const normalizedFootprintSource = String(footprintSource || '').toLowerCase();
  // Photos Only has no aerial polygon, but four calibrated elevation photos
  // can still establish a conservative rectangular footprint. This is only a
  // calibration input; the complete-area gates below still have to pass.
  const photoCalibratedFootprint = normalizedFootprintSource === 'photos'
    && footprintAreaSqft >= 200
    && num(buildingWidthFt) >= 10
    && num(buildingLengthFt) >= 10;
  const mappedFootprint = ['osm', 'solar', 'roof_eave'].includes(normalizedFootprintSource)
    ? footprintAreaSqft >= 200
    : photoCalibratedFootprint;
  const projectedAreaSqft = round(planes.reduce((sum, plane) => {
    const cosine = pitchCosine(plane.pitch);
    return cosine == null ? sum : sum + plane.area_sqft * cosine;
  }, 0));
  const projectedFootprintRatio = footprintAreaSqft > 0
    ? round(projectedAreaSqft / footprintAreaSqft, 2)
    : null;
  const planeFaces = new Set(planes.map((plane) => plane.face));
  const hasOpposingOrientations = (
    (planeFaces.has('front') && planeFaces.has('back'))
    || (planeFaces.has('left_side') && planeFaces.has('right_side'))
  );
  const simplePlaneTopology = planeFaces.size === planes.length && (
    (planes.length === 2 && hasOpposingOrientations)
    || (planes.length === 4 && planeFaces.size === 4)
  );
  const everyPlaneAuthoritative = planes.length >= 2 && planes.every((plane) =>
    plane.stable_identity
    && plane.confidence >= 70
    && plane.occluded !== true
    && plane.face !== 'unknown'
    && pitchCosine(plane.pitch) != null
  );
  const footprintConsistent = projectedFootprintRatio != null
    && projectedFootprintRatio >= 0.85
    && projectedFootprintRatio <= 1.35;
  const areaComplete = mappedFootprint
    && elevationCount === 4
    && everyPlaneAuthoritative
    && hasOpposingOrientations
    && simplePlaneTopology
    && footprintConsistent;
  const gutterCoverageComplete = gutterInspectedElevations.size === 4;
  const edgeCoverageComplete = edgeInspectedElevations.size === 4;

  const edgeTotals = {
    ridge_lf: 0,
    hip_lf: 0,
    valley_lf: 0,
    rake_lf: 0,
    eave_lf: 0,
    gutter_lf: 0,
    step_flashing_lf: 0,
  };
  edges.forEach((edge) => {
    const key = `${edge.type}_lf`;
    if (key in edgeTotals) edgeTotals[key] += edge.length_ft;
  });
  Object.keys(edgeTotals).forEach((key) => { edgeTotals[key] = round(edgeTotals[key]); });

  const warnings = [];
  if (planes.length === 0) warnings.push('No roof plane had enough visible calibrated geometry to measure.');
  if (!areaComplete) warnings.push('Roof photo coverage is incomplete; observed plane area is not a whole-roof total.');
  if (elevationCount < 4) warnings.push(`Only ${elevationCount} of 4 elevation directions supplied verified calibration evidence.`);
  if (!mappedFootprint) warnings.push('A mapped or fully calibrated photo footprint is required before photos can set whole-roof area.');
  if (!everyPlaneAuthoritative && planes.length > 0) warnings.push('Every authoritative plane needs a stable identity, known face and pitch, no occlusion, and at least 70% confidence.');
  if (!hasOpposingOrientations && planes.length > 0) warnings.push('Opposing roof orientations were not both measured.');
  if (!simplePlaneTopology && planes.length > 0) warnings.push('Photo authority is limited to a simple two-plane opposing roof or four-plane one-per-elevation roof; complex topology requires satellite or manual review.');
  if (!footprintConsistent && projectedFootprintRatio != null) warnings.push(`Photo-plane ground projection is ${projectedFootprintRatio}× the mapped footprint; expected 0.85–1.35×.`);
  if (planes.some((plane) => plane.reported_area_difference_pct > 10)) {
    warnings.push('One or more AI-reported plane areas contradicted measured dimensions; width × slope length was used.');
  }

  return {
    version: 1,
    source: 'physical_photos',
    footprint_source: footprintSource,
    footprint: {
      building_width_ft: round(buildingWidthFt),
      building_length_ft: round(buildingLengthFt),
    },
    planes,
    edges,
    evidence,
    coverage: {
      covered_faces: [...coveredFaces].sort(),
      face_count: faceCount,
      covered_elevations: [...coveredElevations].sort(),
      elevation_count: elevationCount,
      gutter_inspected_elevations: [...gutterInspectedElevations].sort(),
      gutter_coverage_complete: gutterCoverageComplete,
      edge_inspected_elevations: [...edgeInspectedElevations].sort(),
      edge_coverage_complete: edgeCoverageComplete,
      ratio: coverageRatio,
      area_complete: areaComplete,
      mapped_footprint: mappedFootprint,
      photo_calibrated_footprint: photoCalibratedFootprint,
      every_plane_authoritative: everyPlaneAuthoritative,
      opposing_orientations: hasOpposingOrientations,
      simple_plane_topology: simplePlaneTopology,
      projected_area_sqft: projectedAreaSqft,
      footprint_area_sqft: round(footprintAreaSqft),
      projected_footprint_ratio: projectedFootprintRatio,
      footprint_consistent: footprintConsistent,
      review_required: !areaComplete,
    },
    totals: {
      observed_roof_area_sqft: observedAreaSqft,
      observed_roof_area_sq: round(observedAreaSqft / 100, 2),
      predominant_pitch: predominantPitch,
      ...edgeTotals,
    },
    confidence: {
      overall: avgPlaneConfidence,
      tolerance_pct: areaComplete ? 12 : 25,
    },
    warnings,
  };
}

/**
 * Public fail-closed summary accompanying the siding response. Partial photo
 * observations remain visible as evidence, but area is only authoritative
 * after the graph passes area_complete.
 */
export function summarizeRoofMeasurement(graph) {
  const coverage = graph?.coverage || {};
  const totals = graph?.totals || {};
  const confidence = graph?.confidence || {};
  const complete = coverage.area_complete === true;
  const hasPitch = Boolean(totals.predominant_pitch);
  const hasPlanes = Number(graph?.planes?.length || 0) > 0;
  const roofType = Number(totals.hip_lf) > 0
    ? (Number(totals.valley_lf) > 0 ? 'hip / valley' : 'hip')
    : Number(totals.rake_lf) > 0
      ? 'gable'
      : Number(totals.ridge_lf) > 0 ? 'ridge roof' : null;
  const linears = {};
  ['ridge_lf', 'hip_lf', 'valley_lf', 'rake_lf', 'eave_lf', 'gutter_lf', 'step_flashing_lf']
    .forEach((key) => {
      const value = Number(totals[key]);
      if (Number.isFinite(value) && value > 0) linears[key] = value;
    });

  return {
    status: complete ? 'complete' : (hasPlanes || hasPitch ? 'partial' : 'unavailable'),
    source: 'physical_photos',
    complete,
    roof_type: complete ? roofType : null,
    area_sq: complete ? Number(totals.observed_roof_area_sq) || null : null,
    area_sqft: complete ? Number(totals.observed_roof_area_sqft) || null : null,
    observed_area_sq: Number(totals.observed_roof_area_sq) || null,
    pitch: totals.predominant_pitch || null,
    pitch_confidence: hasPitch ? (complete ? 'measured' : 'observed') : 'none',
    linears,
    linears_complete: coverage.edge_coverage_complete === true,
    gutters_complete: coverage.gutter_coverage_complete === true,
    confidence: Number(confidence.overall) || 0,
    tolerance_pct: Number(confidence.tolerance_pct) || 25,
    coverage: {
      elevations: Number(coverage.elevation_count) || 0,
      planes: Number(graph?.planes?.length) || 0,
      ratio: coverage.ratio ?? null,
      notes: Array.isArray(graph?.warnings) ? graph.warnings : [],
    },
  };
}

/**
 * Reconciles a completed satellite analysis with an independent photo graph.
 * A photo area can only become estimate-authoritative when coverage is complete,
 * confidence is adequate, and the independent sources agree within 25%.
 * Larger disagreements remain visible and require review.
 */
export function reconcileRoofMeasurement(satelliteAnalysis, photoGraph) {
  if (!photoGraph) return satelliteAnalysis;
  if (!satelliteAnalysis) {
    const photoSq = num(photoGraph.totals?.observed_roof_area_sq);
    const photoConfidence = num(photoGraph.confidence?.overall);
    const areaComplete = photoGraph.coverage?.area_complete === true;
    if (!areaComplete || photoConfidence < 70 || photoSq <= 0) return null;
    const pitch = photoGraph.totals?.predominant_pitch || '6/12';
    const wastePct = num(photoGraph.totals?.valley_lf) > 0 || num(photoGraph.totals?.hip_lf) > 0 ? 12 : 10;
    const edgeCoverageComplete = photoGraph.coverage?.edge_coverage_complete === true;
    const gutterCoverageComplete = photoGraph.coverage?.gutter_coverage_complete === true;
    const photoEdge = (key) => edgeCoverageComplete ? num(photoGraph.totals?.[key]) : 0;
    return {
      success: true,
      roof_area_sq: photoSq,
      roof_area_sqft: round(photoSq * 100, 0),
      corrected_area_sq: photoSq,
      corrected_area_sqft: round(photoSq * 100, 0),
      area_is_slope_adjusted: true,
      pitch,
      pitch_source: 'physical_photos',
      roof_type: photoEdge('hip_lf') > 0 ? 'hip' : 'photo_measured',
      ridge_lf: photoEdge('ridge_lf'),
      hip_lf: photoEdge('hip_lf'),
      valley_lf: photoEdge('valley_lf'),
      rake_lf: photoEdge('rake_lf'),
      eave_lf: photoEdge('eave_lf'),
      gutter_lf: gutterCoverageComplete ? num(photoGraph.totals?.gutter_lf) : 0,
      step_flashing_lf: photoEdge('step_flashing_lf'),
      waste_percentage: wastePct,
      waste_reason: wastePct === 12 ? 'Photo-measured hips/valleys' : 'Photo-measured simple roof',
      final_order_quantity_sq: round(photoSq * (1 + wastePct / 100), 2),
      overall_confidence: photoConfidence,
      measurement_source: 'Physical Photos',
      roof_measurement_graph: photoGraph,
      roof_measurement_comparison: {
        satellite_area_sq: null,
        photo_observed_area_sq: round(photoSq, 2),
        difference_pct: null,
        material_disagreement: false,
        estimate_area_source: 'physical_photos',
      },
      roof_review_required: !edgeCoverageComplete || !gutterCoverageComplete,
      confidence_warnings: [
        ...(!edgeCoverageComplete ? ['Roof area is complete, but photo edge coverage is incomplete; ridge/hip/valley/rake/eave quantities require field review.'] : []),
        ...(!gutterCoverageComplete ? ['Gutter coverage is incomplete; no whole-building gutter quantity was inferred from visible eaves.'] : []),
      ],
      analysis_notes: 'Whole-roof total measured from calibrated physical-photo planes. Verify field measurements before ordering.',
    };
  }
  const satelliteSq = num(satelliteAnalysis.corrected_area_sq || satelliteAnalysis.roof_area_sq);
  const photoSq = num(photoGraph.totals?.observed_roof_area_sq);
  const photoConfidence = num(photoGraph.confidence?.overall);
  const areaComplete = photoGraph.coverage?.area_complete === true;
  const differencePct = satelliteSq > 0 && photoSq > 0
    ? round(Math.abs(photoSq - satelliteSq) / satelliteSq * 100, 1)
    : null;
  const materialDisagreement = differencePct != null && differencePct > 25;
  const photoAreaAuthoritative = areaComplete && photoConfidence >= 70 && photoSq > 0 && !materialDisagreement;
  const usedSq = photoAreaAuthoritative ? photoSq : satelliteSq;

  const edgeTotals = photoGraph.totals || {};
  const edgeCoverageUsable = photoAreaAuthoritative
    && photoGraph.coverage?.edge_coverage_complete === true;
  const takeEdge = (photoKey, satelliteKey) => (
    edgeCoverageUsable && num(edgeTotals[photoKey]) > 0
      ? num(edgeTotals[photoKey])
      : num(satelliteAnalysis[satelliteKey])
  );
  const wastePct = num(satelliteAnalysis.waste_percentage, 12);
  const warnings = [...(satelliteAnalysis.confidence_warnings || [])];
  if (materialDisagreement) {
    warnings.push(`Physical-photo roof area (${photoSq.toFixed(2)} SQ) differs from satellite (${satelliteSq.toFixed(2)} SQ) by ${differencePct}%; review coverage before ordering.`);
  } else if (!areaComplete) {
    warnings.push('Physical photos improved visible roof geometry, but do not cover enough planes to replace the whole-roof area.');
  }

  return {
    ...satelliteAnalysis,
    roof_area_sq: usedSq,
    roof_area_sqft: round(usedSq * 100, 0),
    corrected_area_sq: usedSq,
    corrected_area_sqft: round(usedSq * 100, 0),
    final_order_quantity_sq: round(usedSq * (1 + wastePct / 100), 2),
    ridge_lf: takeEdge('ridge_lf', 'ridge_lf'),
    hip_lf: takeEdge('hip_lf', 'hip_lf'),
    valley_lf: takeEdge('valley_lf', 'valley_lf'),
    rake_lf: takeEdge('rake_lf', 'rake_lf'),
    eave_lf: takeEdge('eave_lf', 'eave_lf'),
    // Gutters are not synonymous with eaves. Preserve an existing explicit
    // gutter measurement unless complete authoritative photos measured gutters.
    gutter_lf: photoAreaAuthoritative
      && photoGraph.coverage?.gutter_coverage_complete === true
      && num(edgeTotals.gutter_lf) > 0
      ? num(edgeTotals.gutter_lf)
      : num(satelliteAnalysis.gutter_lf),
    step_flashing_lf: takeEdge('step_flashing_lf', 'step_flashing_lf'),
    roof_measurement_graph: photoGraph,
    roof_measurement_comparison: {
      satellite_area_sq: round(satelliteSq, 2),
      photo_observed_area_sq: round(photoSq, 2),
      difference_pct: differencePct,
      material_disagreement: materialDisagreement,
      estimate_area_source: photoAreaAuthoritative ? 'physical_photos' : 'satellite',
    },
    measurement_source: 'Hybrid: Physical Photos + Footprint',
    roof_review_required: materialDisagreement || !areaComplete,
    confidence_warnings: warnings,
  };
}
