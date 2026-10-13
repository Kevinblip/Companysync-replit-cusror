const assert = require('assert');

(async () => {
  const { buildRoofMeasurementGraph, reconcileRoofMeasurement } = await import('../functions/utils/roofMeasurementGraph.js');
  const photos = ['front', 'back', 'left_side', 'right_side'].map((face) => ({
    view_label: face,
    wall_face: face,
    confidence: 82,
    roof_edge_observation_complete: true,
    gutter_observation_complete: true,
    roof_planes: face === 'front' ? [{
      observation_id: 'main_front_plane',
      face: 'front',
      width_ft: 40,
      slope_length_ft: 16.8,
      area_sqft: 9999,
      confidence: 82,
      pitch: '6/12',
    }] : face === 'back' ? [{
      observation_id: 'main_back_plane',
      face: 'back',
      width_ft: 40,
      slope_length_ft: 16.8,
      confidence: 82,
      pitch: '6/12',
    }] : [],
    roof_edges: [
      { edge_id: `eave_${face}`, type: 'eave', face, length_ft: 30, confidence: 82 },
      ...(face === 'front' ? [{ edge_id: 'gutter_front', type: 'gutter', face, length_ft: 30, confidence: 82 }] : []),
    ],
  }));
  const graph = buildRoofMeasurementGraph({
    perPhotoResults: photos,
    buildingWidthFt: 30,
    buildingLengthFt: 40,
    footprintSource: 'osm',
  });
  assert.equal(graph.coverage.area_complete, true);
  assert.equal(graph.totals.observed_roof_area_sq, 13.44);
  assert.equal(graph.totals.gutter_lf, 30);
  assert.equal(graph.totals.predominant_pitch, '6/12');
  assert.equal(graph.coverage.elevation_count, 4);
  assert.equal(graph.coverage.footprint_consistent, true);
  assert.equal(graph.coverage.simple_plane_topology, true);
  assert.equal(graph.coverage.gutter_coverage_complete, true);
  assert.equal(graph.coverage.edge_coverage_complete, true);
  assert.ok(graph.warnings.some(w => w.includes('contradicted measured dimensions')));

  const photoOnly = reconcileRoofMeasurement(null, graph);
  assert.equal(photoOnly.measurement_source, 'Physical Photos');
  assert.equal(photoOnly.corrected_area_sq, 13.44);

  const close = reconcileRoofMeasurement({
    roof_area_sq: 13,
    corrected_area_sq: 13,
    waste_percentage: 10,
    eave_lf: 80,
    confidence_warnings: [],
  }, graph);
  assert.equal(close.roof_measurement_comparison.estimate_area_source, 'physical_photos');
  assert.equal(close.corrected_area_sq, 13.44);
  assert.equal(close.final_order_quantity_sq, 14.78);

  const disagreement = reconcileRoofMeasurement({
    roof_area_sq: 6,
    corrected_area_sq: 6,
    waste_percentage: 10,
    eave_lf: 80,
    confidence_warnings: [],
  }, graph);
  assert.equal(disagreement.roof_measurement_comparison.material_disagreement, true);
  assert.equal(disagreement.roof_measurement_comparison.estimate_area_source, 'satellite');
  assert.equal(disagreement.corrected_area_sq, 6);

  const partial = buildRoofMeasurementGraph({
    perPhotoResults: photos.slice(0, 1),
    buildingWidthFt: 30,
    buildingLengthFt: 40,
    footprintSource: 'osm',
  });
  const partialResult = reconcileRoofMeasurement({ roof_area_sq: 12, corrected_area_sq: 12 }, partial);
  assert.equal(partial.coverage.area_complete, false);
  assert.equal(partialResult.corrected_area_sq, 12);

  const duplicateFaceGraph = buildRoofMeasurementGraph({
    perPhotoResults: photos.map((photo, index) => index === 0 ? {
      ...photo,
      roof_planes: [
        ...photo.roof_planes,
        { ...photo.roof_planes[0], observation_id: 'duplicate_front_plane', width_ft: 10 },
      ],
    } : photo),
    buildingWidthFt: 30,
    buildingLengthFt: 40,
    footprintSource: 'osm',
  });
  assert.equal(duplicateFaceGraph.coverage.simple_plane_topology, false);
  assert.equal(duplicateFaceGraph.coverage.area_complete, false);

  const noGutterGraph = buildRoofMeasurementGraph({
    perPhotoResults: photos.map((photo, index) => ({
      ...photo,
      roof_edge_observation_complete: index !== 3,
      gutter_observation_complete: index !== 3,
      roof_edges: photo.roof_edges.filter(edge => edge.type !== 'gutter'),
    })),
    buildingWidthFt: 30,
    buildingLengthFt: 40,
    footprintSource: 'osm',
  });
  const noGutterResult = reconcileRoofMeasurement({
    roof_area_sq: 13,
    corrected_area_sq: 13,
    gutter_lf: 44,
  }, noGutterGraph);
  assert.equal(noGutterGraph.totals.gutter_lf, 0);
  assert.equal(noGutterGraph.coverage.gutter_coverage_complete, false);
  assert.equal(noGutterGraph.coverage.edge_coverage_complete, false);
  assert.equal(noGutterResult.gutter_lf, 44);
  assert.equal(noGutterResult.ridge_lf || 0, 0);

  const noGutterPhotoOnly = reconcileRoofMeasurement(null, noGutterGraph);
  assert.equal(noGutterPhotoOnly.corrected_area_sq, 13.44);
  assert.equal(noGutterPhotoOnly.gutter_lf, 0);
  assert.equal(noGutterPhotoOnly.eave_lf, 0);
  assert.equal(noGutterPhotoOnly.roof_review_required, true);
  console.log('roof measurement graph: all assertions passed');
})();