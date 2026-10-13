import { buildSidingMeasurementGraph } from "../../functions/utils/sidingMeasurementGraph.js";
import {
  scalePolygonToPerimeter,
  rectanglePolygon,
  polygonBBoxDims,
} from "../../functions/utils/footprintPolygon.js";
import { calculateNetSiding, openingsFromCounts } from "./companySyncFormulas.js";

const DEFAULT_OPENING_GEOMETRY = {
  window: { width_ft: 3, height_ft: 4 },
  entry_door: { width_ft: 3, height_ft: 6.8 },
  garage_door: { width_ft: 16, height_ft: 7, at_grade: true },
};

const DEFAULT_FACES = ['front', 'back', 'left_side', 'right_side'];

/**
 * Rebuild siding measurements and canonical opening geometry after user edits.
 * This is intentionally pure so summaries, estimate quantities, and 3D consume
 * the same regenerated graph rather than independently patched aggregates.
 */
export function rebuildSidingMeasurementsFromEdits(original, edits = {}) {
  if (!original || Object.keys(edits).length === 0) return original;

  const perimeterFt = Number(edits.perimeter_ft ?? original.perimeter_ft) || 0;
  const storyCount = Number(edits.story_count ?? original.story_count) || 1;
  const wallHeightFt =
    Number(edits.story_height_ft ?? original.story_height_ft) || (storyCount * 9);
  const gableRiseFt =
    Number(edits.gable_rise_ft ?? original.gable_rise_ft ?? 0);
  const buildingWidthFt =
    Number(original.building_width_ft) || (perimeterFt / 4);
  const gableAreaSqft = gableRiseFt > 0
    ? Math.round(2 * (buildingWidthFt * gableRiseFt) / 2)
    : 0;
  const grossWallAreaSqft =
    Math.round(perimeterFt * wallHeightFt + gableAreaSqft);

  // Keep the traced outline coherent with an edited perimeter. Without this the
  // 3D model keeps rendering the original shape while the numbers beside it
  // describe a different building; resizing about the centroid preserves the
  // corners and wings we traced.
  const originalPerimeterFt = Number(original.perimeter_ft) || 0;
  const originalPolygon =
    Array.isArray(original.footprint_polygon_xy) && original.footprint_polygon_xy.length >= 3
      ? original.footprint_polygon_xy : null;
  const perimeterEdited = perimeterFt > 0 && Math.abs(perimeterFt - originalPerimeterFt) > 0.5;

  let footprintPolygonXY = originalPolygon;
  if (perimeterEdited) {
    if (originalPolygon) {
      footprintPolygonXY = scalePolygonToPerimeter(originalPolygon, perimeterFt) || originalPolygon;
    } else {
      // Legacy record saved before footprints were traced. Emit the degenerate
      // rectangle for the edited perimeter, keeping the original width/length
      // ratio, so the 3D model stops rendering a building whose dimensions the
      // numbers beside it no longer describe.
      const wRaw = Number(original.building_width_ft) || 0;
      const lRaw = Number(original.building_length_ft) || 0;
      const ratio = (wRaw > 0 && lRaw > 0) ? wRaw / (wRaw + lRaw) : 0.5;
      const half = perimeterFt / 2;
      footprintPolygonXY = rectanglePolygon(half * (1 - ratio), half * ratio);
    }
  }

  // Dimensions must follow the outline we are actually returning, or the model
  // and the summary describe two different buildings.
  const footprintDims = footprintPolygonXY ? polygonBBoxDims(footprintPolygonXY) : null;

  const windowCount =
    Number(edits.windows_count ?? original.windows_count ?? 0);
  const entryDoorCount =
    Number(edits.doors_count ?? original.doors_count ?? 0);
  const garageDoorCount =
    Number(edits.garage_door_count ?? original.garage_door_count ?? 0);
  const accentDeductionSqft =
    Number(original.accent_deduction_sqft ?? original.masonry_deduct_sqft ?? 0);
  const originalGraph = original.measurement_graph;

  const countTargets = {
    window: windowCount,
    entry_door: entryDoorCount,
    garage_door: garageDoorCount,
  };
  const rebuiltOpenings = [];

  for (const [type, requested] of Object.entries(countTargets)) {
    const desired = Math.max(0, Math.floor(Number(requested) || 0));
    const existing = (originalGraph?.opening_groups || [])
      .filter((group) => group.type === type);

    for (let index = 0; index < desired; index++) {
      const prior = existing[index];
      const geometry = prior || DEFAULT_OPENING_GEOMETRY[type];
      rebuiltOpenings.push({
        observation_id:
          prior?.provenance?.observation_id || `manual_${type}_${index}`,
        type,
        wall_face: prior?.face || DEFAULT_FACES[index % DEFAULT_FACES.length],
        width_ft:
          Number(geometry.width_ft) || DEFAULT_OPENING_GEOMETRY[type].width_ft,
        height_ft:
          Number(geometry.height_ft) || DEFAULT_OPENING_GEOMETRY[type].height_ft,
        pos_x: prior?.pos_x ?? ((index + 1) * 4),
        pos_y: prior?.pos_y ?? (type === 'garage_door' ? 0 : 3),
        zone: prior?.zone || 'manual_override',
        confidence: prior?.confidence ?? 0.5,
        synthetic:
          !prior || prior?.uncertainty === 'count_based_default_geometry',
        at_grade: prior?.at_grade ?? DEFAULT_OPENING_GEOMETRY[type].at_grade,
        components: prior?.component_ids?.map((componentId) => {
          const component = originalGraph?.opening_components?.find(
            (item) => item.id === componentId,
          );
          return component ? {
            type: component.type,
            width_ft: component.width_ft,
            height_ft: component.height_ft,
            sqft: component.area_sqft,
            perimeter_lf: component.perimeter_lf,
          } : null;
        }).filter(Boolean),
      });
    }
  }

  const openingsByFace = new Map();
  for (const opening of rebuiltOpenings) {
    const face = opening.wall_face || 'front';
    if (!openingsByFace.has(face)) openingsByFace.set(face, []);
    openingsByFace.get(face).push(opening);
  }

  const graphInputPhotos = (originalGraph?.wall_facets || [])
    .filter((facet) => !facet.is_unknown)
    .map((facet) => ({
      // Pin the face explicitly: resolveWallFace reads wall_face first, so the
      // rebuilt photo lands on the same wall even when photo_label is a corner
      // slot name like "FR Corner".
      wall_face: facet.face,
      view_label: facet.photo_label || facet.face,
      confidence: facet.confidence ?? 0.5,
      // Carry per-face dimensions and corner provenance through the rebuild.
      // Dropping them silently regresses the elevation drawings to generic
      // global-box rectangles after any manual edit, and re-labels a
      // corner-derived width as if it had come from a flat wall photo.
      wall_width_ft: facet.wall_width_ft || 0,
      wall_height_ft: facet.wall_height_ft || 0,
      story_count: facet.story_count || 0,
      is_corner_shot: facet.dimension_source === 'corner_photo',
      siding_material: facet.siding_material || null,
      siding_profile: facet.siding_profile || null,
      non_siding_material: facet.non_siding_material || facet.accent_material || null,
      non_siding_pct: facet.non_siding_pct ?? null,
      material_regions: Array.isArray(facet.material_regions) ? facet.material_regions : [],
      material_confidence: facet.material_confidence ?? null,
      material_uncertain: facet.material_uncertain === true,
      openings: openingsByFace.get(facet.face) || [],
    }));
  for (const [face, openings] of openingsByFace) {
    // Match on the pinned face, not view_label — view_label may now be a photo
    // label, which would let a duplicate entry through for the same wall.
    if (!graphInputPhotos.some((photo) => photo.wall_face === face)) {
      graphInputPhotos.push({ wall_face: face, view_label: face, confidence: 0.5, openings });
    }
  }

  const updatedGraph = originalGraph ? {
    ...buildSidingMeasurementGraph({
      perPhotoResults: graphInputPhotos,
      footprint: originalGraph.building?.footprint,
      storyCount,
      wallHeightFt,
      grossWallAreaSqft,
      accentDeductionSqft,
      perimeterFt,
      buildingWidthFt:
        originalGraph.building?.building_width_ft ?? original.building_width_ft,
      buildingLengthFt:
        originalGraph.building?.building_length_ft ?? original.building_length_ft,
      footprintSource:
        originalGraph.building?.footprint_source ?? original.footprint_source,
      smallOpeningsInWaste:
        originalGraph.diagnostics?.small_openings_in_waste === true,
      // Re-apply the per-face material mix the original analysis measured.
      // Dropping it would make an edited measurement fall back to the
      // house-wide siding share and start charging brick-wall openings against
      // the siding column again.
      faceMasonryPct:
        originalGraph.totals?.provenance?.face_masonry_pct ?? null,
      roofFacets: originalGraph.roof_facets,
    }),
    // Measurement edits do not create or improve photo evidence.
    coverage: originalGraph.coverage,
    manual_overrides: Object.keys(edits),
  } : null;

  // CompanySync formula: use actual opening dimensions × counts when graph unavailable
  const fallbackOpenings = openingsFromCounts({
    windows: windowCount,
    entryDoors: entryDoorCount,
    garageDoors: garageDoorCount,
  });
  const fallbackNet = calculateNetSiding(perimeterFt, wallHeightFt, fallbackOpenings);
  const openingDeductionSqft =
    updatedGraph?.totals?.opening_deduction_sqft ?? fallbackNet.deductions;
  const netSidingAreaSqft =
    updatedGraph?.totals?.net_siding_area_sqft ??
    Math.max(0, fallbackNet.netZeroWaste - accentDeductionSqft);
  const netSidingSquares = Math.round(netSidingAreaSqft) / 100;
  const jChannelLf =
    updatedGraph?.totals?.j_channel_lf ??
    Math.round(
      windowCount * 2 * (3 + 4) +
      entryDoorCount * (3 + 2 * 6.8) +
      garageDoorCount * (16 + 2 * 7),
    );
  const starterStripLf =
    updatedGraph?.totals?.starter_strip_lf ??
    Math.max(0, Math.round(perimeterFt - garageDoorCount * 16));
  const trimTotals = original.trim_totals ? {
    ...original.trim_totals,
    j_channel_lf: jChannelLf,
    starter_strip_lf: starterStripLf,
  } : null;

  return {
    ...original,
    perimeter_ft: perimeterFt,
    footprint_polygon_xy: footprintPolygonXY,
    building_width_ft: footprintDims
      ? Math.round(footprintDims.widthFt) : original.building_width_ft,
    building_length_ft: footprintDims
      ? Math.round(footprintDims.lengthFt) : original.building_length_ft,
    story_count: storyCount,
    story_height_ft: wallHeightFt,
    gable_rise_ft: gableRiseFt,
    gable_area_sqft: gableAreaSqft,
    gross_wall_area_sqft: grossWallAreaSqft,
    windows_count: windowCount,
    doors_count: entryDoorCount,
    garage_door_count: garageDoorCount,
    opening_deduction_sqft: openingDeductionSqft,
    opening_deduct_sqft: openingDeductionSqft,
    wall_area_sqft: netSidingAreaSqft,
    wall_area_sq: netSidingSquares,
    order_qty_10_percent_waste_sq:
      Math.round(netSidingSquares * 1.10 * 100) / 100,
    ...(updatedGraph ? { measurement_graph: updatedGraph } : {}),
    ...(updatedGraph?.material_map ? {
      material_map: updatedGraph.material_map,
      materialMap: updatedGraph.material_map,
    } : {}),
    ...(trimTotals ? {
      trim_totals: trimTotals,
      j_channel_openings_lf: jChannelLf,
      starter_strip_lf: starterStripLf,
    } : {}),
    _userEditedFields: Object.keys(edits),
  };
}