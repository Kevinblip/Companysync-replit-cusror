import {
  classifyFootprint,
  filterMicroFacets,
  preprocessSolarSegments,
} from './MeshGeometryBuilder.js';

export const footprintClassFor3D = (footprintPolygon) => {
  const points = Array.isArray(footprintPolygon)
    ? footprintPolygon
      .map((point) => {
        const east = Number(Array.isArray(point) ? point[0] : point?.x);
        const north = Number(Array.isArray(point) ? point[1] : point?.y);
        return Number.isFinite(east) && Number.isFinite(north) ? [east, -north] : null;
      })
      .filter(Boolean)
    : null;
  return classifyFootprint(points);
};

export const isRenderablePhotoPlane = (plane) =>
  String(plane?.face || '').toLowerCase() !== 'unknown'
  && Number(plane?.width_ft) >= 3
  && Number(plane?.slope_length_ft) >= 3
  && Number(plane?.area_sqft) >= 20;

export const isRenderableSolarSegment = (segment) =>
  Boolean(
    segment?.center?.latitude
    && segment?.center?.longitude
    && segment?.boundingBox
  );

// A complete physical-photo roof is the only source allowed to bypass a real
// traced outline. Solar/canonical data may refine pitch hints, but its absence
// must not collapse an L/T-shaped building back to a rectangular roof.
export const shouldAttemptFootprintRoof = ({ footprintPolygon, hasCompletePhotoRoof = false }) =>
  !hasCompletePhotoRoof
  && Array.isArray(footprintPolygon)
  && footprintPolygon.length >= 3;

/**
 * Select the exact roof path HouseModel3D will render. This is deliberately
 * shared with measurement-summary callers: a card must never independently
 * choose photo, canonical, Solar, or parametric topology.
 */
export function resolveRoof3DSource({
  roofGeometrySource,
  roofMeasurementGraph,
  photoVerifiedPitch = false,
  measurementGraph,
  roofFacets,
  roofSegments,
  footprintClass,
  footprintPolygon,
  isHip = false,
}) {
  const photoPlanes = (roofMeasurementGraph?.planes || []).filter(isRenderablePhotoPlane);
  const rawGraphFacets = measurementGraph?.roof_facets?.filter?.(
    facet => Array.isArray(facet?.polygon)
  ) || [];
  const rawFacetProp = Array.isArray(roofFacets)
    ? roofFacets.filter(facet => Array.isArray(facet?.polygon))
    : [];
  const canonicalFacets = filterMicroFacets(
    rawGraphFacets.length > 0 ? rawGraphFacets : rawFacetProp
  );
  const { segments: filteredSegments, forcedParametric } = preprocessSolarSegments(
    Array.isArray(roofSegments) ? roofSegments : [],
    footprintClass || footprintClassFor3D(footprintPolygon)
  );
  const solarSegments = filteredSegments.filter(isRenderableSolarSegment);

  if (
    roofGeometrySource === 'physical_photos'
    && roofMeasurementGraph?.coverage?.area_complete === true
    && photoPlanes.length > 0
  ) {
    return {
      path: 'physical_photos',
      facetCount: photoPlanes.length,
      photoPlanes,
      canonicalFacets,
      solarSegments,
      forcedParametric,
    };
  }

  if (!photoVerifiedPitch && canonicalFacets.length > 0) {
    return {
      path: 'canonical_facets',
      facetCount: canonicalFacets.length,
      photoPlanes,
      canonicalFacets,
      solarSegments,
      forcedParametric,
    };
  }

  if (!photoVerifiedPitch && !forcedParametric && solarSegments.length > 0) {
    return {
      path: 'solar_segments',
      facetCount: solarSegments.length,
      photoPlanes,
      canonicalFacets,
      solarSegments,
      forcedParametric,
    };
  }

  return {
    path: 'parametric_fallback',
    facetCount: isHip ? 4 : 2,
    photoPlanes,
    canonicalFacets,
    solarSegments,
    forcedParametric,
  };
}