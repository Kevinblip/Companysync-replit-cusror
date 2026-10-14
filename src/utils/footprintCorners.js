/**
 * Outside and inside corners from a footprint polygon.
 * The API and the siding PDF both call this so the counts cannot diverge.
 *
 * A convex turn is an outside corner. A reflex turn is an inside corner.
 * Nearly straight vertices are skipped so a traced edge with a tiny jog
 * does not invent a corner.
 */

function vertexTurn(poly, index) {
  const n = poly.length;
  const [ax, az] = poly[(index - 1 + n) % n];
  const [bx, bz] = poly[index];
  const [cx, cz] = poly[(index + 1) % n];
  const abx = bx - ax;
  const abz = bz - az;
  const bcx = cx - bx;
  const bcz = cz - bz;
  const cross = abx * bcz - abz * bcx;
  const abLen = Math.hypot(abx, abz);
  const bcLen = Math.hypot(bcx, bcz);
  return { cross, scale: abLen * bcLen };
}

export function countFootprintCorners(poly, wallHeightFt = 0) {
  const height = Math.max(0, Number(wallHeightFt) || 0);
  if (!Array.isArray(poly) || poly.length < 3) {
    const outside = 4;
    return {
      outside_count: outside,
      inside_count: 0,
      outside_lf: Math.round(outside * height),
      inside_lf: 0,
      source: 'rectangle_default',
    };
  }

  let winding = 0;
  for (let i = 0; i < poly.length; i++) {
    winding += vertexTurn(poly, i).cross;
  }
  const sign = winding >= 0 ? 1 : -1;
  let outside = 0;
  let inside = 0;
  for (let i = 0; i < poly.length; i++) {
    const { cross, scale } = vertexTurn(poly, i);
    if (!(scale > 0)) continue;
    // Ignore turns under about 8 degrees. A straight wall is not a corner.
    if (Math.abs(cross) / scale < 0.14) continue;
    if (cross * sign > 0) outside += 1;
    else inside += 1;
  }
  if (outside === 0) outside = 4;
  return {
    outside_count: outside,
    inside_count: inside,
    outside_lf: Math.round(outside * height),
    inside_lf: Math.round(inside * height),
    source: 'footprint_polygon',
  };
}

function canonicalElevationFace(result) {
  const raw = String(result?.wall_face || result?.view_label || result?.label || '').toLowerCase();
  if (raw.includes('left')) return 'left';
  if (raw.includes('right')) return 'right';
  if (raw.includes('back') || raw.includes('rear')) return 'back';
  if (raw.includes('front')) return 'front';
  return '';
}

/**
 * Corner counts reported on the four elevation photos.
 * Each corner is seen from two elevations, so the visible counts are halved.
 * Returns null when a face omitted the count — the footprint count stays.
 */
export function cornersFromElevationPhotos(perPhotoResults, wallHeightFt = 0) {
  const height = Math.max(0, Number(wallHeightFt) || 0);
  const byFace = new Map();
  for (const result of perPhotoResults || []) {
    const face = canonicalElevationFace(result);
    if (!face || byFace.has(face)) continue;
    if (result?.outside_corners_visible == null && result?.inside_corners_visible == null) continue;
    const outside = Number(result.outside_corners_visible);
    const inside = Number(result.inside_corners_visible);
    if (!Number.isFinite(outside) && !Number.isFinite(inside)) continue;
    byFace.set(face, {
      outside: Math.max(0, Math.min(2, Number.isFinite(outside) ? outside : 0)),
      inside: Math.max(0, Math.min(3, Number.isFinite(inside) ? inside : 0)),
    });
  }
  if (byFace.size < 4) return null;
  const outside = Math.round([...byFace.values()].reduce((sum, face) => sum + face.outside, 0) / 2);
  const inside = Math.round([...byFace.values()].reduce((sum, face) => sum + face.inside, 0) / 2);
  if (outside <= 0) return null;
  return {
    outside_count: outside,
    inside_count: inside,
    outside_lf: Math.round(outside * height),
    inside_lf: Math.round(inside * height),
    source: 'photos',
  };
}
