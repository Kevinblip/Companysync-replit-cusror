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
  const label = String(result?.view_label || result?.label || '').toLowerCase();
  // A corner frame shows two walls. Its corner count belongs to neither face
  // alone, and letting it occupy the face slot hides the straight elevation.
  if (result?.is_corner_shot === true || /corner|angle/.test(label)) return '';
  const raw = String(result?.wall_face || label).toLowerCase();
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
      // A jogged wall shows more than the two ends of a rectangle. The cap
      // only rejects a nonsense count, then the halving below removes the
      // double view of each corner.
      outside: Math.max(0, Math.min(8, Number.isFinite(outside) ? outside : 0)),
      inside: Math.max(0, Math.min(6, Number.isFinite(inside) ? inside : 0)),
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

/**
 * A traced footprint's vertices are the building corners. Per-elevation
 * counts see each corner twice and also pick up window and jog edges, so
 * they must not raise the footprint count. Photos are the fallback only
 * when there is no traced polygon (a rectangle default still yields to a
 * photo that found an inside corner the box cannot see).
 */
/**
 * No traced outline. Photo tallies count the same corner from every elevation
 * and also count window and jog edges. An orthogonal building has
 * outside = 4 + 2 × reflex (inside) corners. The rectangle's 4 outside
 * corners stay a floor so a photo that under-counts cannot erase them.
 * Inside corners stay at the reflex count. Length is count × wall height.
 */
export function capUntracedCorners(photo, footprint) {
  const photoHeight = photo?.outside_count > 0 ? photo.outside_lf / photo.outside_count : 0;
  const footprintHeight = footprint?.outside_count > 0 ? footprint.outside_lf / footprint.outside_count : 0;
  const height = photoHeight || footprintHeight || 0;
  const reflex = Math.max(0, Math.round(photo?.inside_count || 0));
  const floorOutside = Math.max(4, footprint?.outside_count || 0);
  const outside = Math.min(
    Math.max(photo?.outside_count || 0, floorOutside),
    4 + 2 * reflex,
  );
  return {
    outside_count: outside,
    inside_count: reflex,
    outside_lf: Math.round(outside * height),
    inside_lf: Math.round(reflex * height),
    source: 'capped_elevation_photos',
  };
}

/**
 * Corners of the roof-facet wall outline. The Microsoft ring is often an
 * 8-vertex simplification. A turn counts only when it is near a right angle
 * and the jog is at least 4 ft deep, so raster steps are not corners.
 * Inside corners follow the orthogonal identity (outside = 4 + 2×inside)
 * when the outline's reflex count is the stair-step noise.
 */
export function cornersFromFacetOutline(poly, wallHeightFt, wallRingCorners, ringVertexCount) {
  const ringVertices = Number(ringVertexCount) || 0;
  if (!wallRingCorners || wallRingCorners.source !== 'footprint_polygon') return null;
  if (!(ringVertices > 0) || ringVertices > 8) return null;
  // A ring that already records a jog is not replaced by the roof trace.
  // A plain 4-corner rectangle is not replaced either: the roof outline's
  // stair-steps were billed as outside corners on simple footprints.
  // Real bump-outs on a jogged ring are added later, deduped.
  if ((wallRingCorners.outside_count || 0) <= 4 && (wallRingCorners.inside_count || 0) === 0) return null;
  if ((wallRingCorners.outside_count || 0) > 4 || (wallRingCorners.inside_count || 0) > 0) return null;
  if (!Array.isArray(poly) || poly.length < 4) return null;
  const height = Math.max(0, Number(wallHeightFt) || 0);
  const n = poly.length;
  let winding = 0;
  const turns = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[(i - 1 + n) % n];
    const b = poly[i];
    const c = poly[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const bcx = c[0] - b[0];
    const bcz = c[1] - b[1];
    const cross = abx * bcz - abz * bcx;
    const scale = Math.hypot(abx, abz) * Math.hypot(bcx, bcz);
    const chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const depth = chord > 0.01 ? Math.abs(abx * (c[1] - a[1]) - abz * (c[0] - a[0])) / chord : 0;
    winding += cross;
    turns.push({ sin: scale > 0 ? cross / scale : 0, depth });
  }
  const sign = winding >= 0 ? 1 : -1;
  let outside = 0;
  let inside = 0;
  for (const turn of turns) {
    if (Math.abs(turn.sin) < 0.7 || turn.depth < 4) continue;
    if (turn.sin * sign > 0) outside += 1;
    else inside += 1;
  }
  if (outside <= wallRingCorners.outside_count) return null;
  const identityInside = Math.max(0, Math.round((outside - 4) / 2));
  const insideCount = Math.max(
    wallRingCorners.inside_count || 0,
    Math.min(inside, identityInside),
  );
  return {
    outside_count: outside,
    inside_count: insideCount,
    outside_lf: Math.round(outside * height),
    inside_lf: Math.round(insideCount * height),
    source: 'roof_facet_outline',
  };
}

export function chooseCornerTotals(photo, footprint) {
  // A traced building outline (OSM, Microsoft, or the roof-facet wall line),
  // not the rectangle we invent when no outline was passed. Per-photo corner
  // counts must not raise it.
  if (footprint?.source === 'footprint_polygon' || footprint?.source === 'roof_facet_outline') return footprint;
  if (!photo) return footprint;
  return capUntracedCorners(photo, footprint);
}

/**
 * Brick and stone walls do not get vinyl outside corners. The polygon
 * choice has already happened; this only scales the outside count by the
 * siding share of the perimeter. Inside corners stay.
 */
function faceHasSiding(face) {
  if (!face) return true;
  if (Number.isFinite(Number(face.siding_percent))) return Number(face.siding_percent) > 0;
  const siding = (face.regions || [])
    .filter((region) => !['brick', 'stone', 'stucco'].includes(region.material))
    .reduce((sum, region) => sum + (Number(region.percent) || 0), 0);
  return siding > 0;
}

const MASONRY_MATERIALS = ['brick', 'stone', 'stucco'];

function sectionPolygon(section) {
  if (Array.isArray(section?.polygon) && section.polygon.length >= 3) return section.polygon;
  const box = section?.bbox;
  if (box && [box.x, box.y, box.w, box.h].every((value) => Number.isFinite(Number(value)))) {
    return [
      [Number(box.x), Number(box.y)],
      [Number(box.x) + Number(box.w), Number(box.y)],
      [Number(box.x) + Number(box.w), Number(box.y) + Number(box.h)],
      [Number(box.x), Number(box.y) + Number(box.h)],
    ];
  }
  return null;
}

function pointXY(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  if (point && typeof point === 'object') return [Number(point.x), Number(point.y)];
  return [NaN, NaN];
}

function sectionConfidenceUnit(section) {
  const raw = Number(section?.confidence);
  if (!Number.isFinite(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
}

/**
 * Full-height brick or stone at 'start' and 'end'. `reads` is every such
 * polygon, including a mixed wall with no confidence. `qualified` is the
 * corner photo at 0.8 or better, which can drop a corner by itself.
 * A wainscot does not reach the eave, so it is not the corner board.
 */
function masonryEndReads(face) {
  const reads = new Set(Array.isArray(face?.masonry_ends) ? face.masonry_ends : []);
  const qualified = new Set(reads);
  const sections = [
    ...(Array.isArray(face?.sections) ? face.sections : []),
    ...(Array.isArray(face?.material_sections) ? face.material_sections : []),
  ];
  for (const section of sections) {
    const material = String(section?.material || '').toLowerCase();
    if (!/brick|stone/.test(material)) continue;
    const poly = sectionPolygon(section);
    if (!poly) continue;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of poly) {
      const [x, y] = pointXY(point);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!(minY <= 0.2 && maxY >= 0.8)) continue;
    const confident = section?.corner_photo === true && sectionConfidenceUnit(section) >= 0.8;
    if (minX <= 0.12) {
      reads.add('start');
      if (confident) qualified.add('start');
    }
    if (maxX >= 0.88) {
      reads.add('end');
      if (confident) qualified.add('end');
    }
  }
  return { reads, qualified };
}

function masonryCornerEnds(face) {
  return masonryEndReads(face).qualified;
}

/**
 * A corner is siding trim or it is not. A wall-wide masonry percent does
 * not scale the board. Drop it when this end is brick or stone, or when
 * the wall is masonry with only a sliver of siding. A siding percent with
 * no region split stays all-or-nothing.
 */
function sidingCornerFraction(face, end) {
  if (!face) return 1;
  // An unphotographed face borrowed the house mix. Any siding in that mix
  // keeps the corner; scaling it by the borrowed brick share zeroed the LF.
  if (face.inferred) return faceHasSiding(face) ? 1 : 0;
  const ends = masonryCornerEnds(face);
  if (end && ends.has(end)) return 0;
  const regions = Array.isArray(face.regions) ? face.regions : [];
  let masonry = 0;
  let sidingFromRegions = null;
  for (const region of regions) {
    const pct = Number(region.percent) || 0;
    if (MASONRY_MATERIALS.includes(region.material)) masonry += pct;
    else if (region.material && region.material !== 'unknown' && region.material !== 'other') {
      sidingFromRegions = (sidingFromRegions || 0) + pct;
    }
  }
  if (sidingFromRegions == null && Number.isFinite(Number(face.siding_percent))) {
    return Number(face.siding_percent) > 0 ? 1 : 0;
  }
  const siding = sidingFromRegions || 0;
  if (!(siding > 0)) return 0;
  if (siding < 20 && masonry > siding) return 0;
  return 1;
}

function ringPoints(poly) {
  const ring = (Array.isArray(poly) ? poly : []).map(pointEastNorth).filter((pt) => pt.every(Number.isFinite));
  if (ring.length >= 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) ring.pop();
  }
  return ring;
}

function outsideTurnRecords(poly, { minSin = 0.14, minDepth = 0 } = {}) {
  const ring = ringPoints(poly);
  if (ring.length < 3) return [];
  let winding = 0;
  for (let i = 0; i < ring.length; i += 1) winding += vertexTurn(ring, i).cross;
  const ccw = winding >= 0;
  const sign = ccw ? 1 : -1;
  const turns = [];
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const turn = vertexTurn(ring, i);
    if (!(turn.scale > 0) || Math.abs(turn.cross) / turn.scale < minSin) continue;
    if (turn.cross * sign <= 0) continue;
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const chord = Math.hypot(ring[next][0] - ring[prev][0], ring[next][1] - ring[prev][1]);
    const depth = chord > 0.01
      ? Math.abs(
        (ring[i][0] - ring[prev][0]) * (ring[next][1] - ring[prev][1])
        - (ring[i][1] - ring[prev][1]) * (ring[next][0] - ring[prev][0]),
      ) / chord
      : 0;
    if (depth < minDepth) continue;
    turns.push({
      x: ring[i][0],
      y: ring[i][1],
      incoming: outwardAzimuth(ring, prev, ccw),
      outgoing: outwardAzimuth(ring, i, ccw),
    });
  }
  return turns;
}

/** Stair-step twins of one corner sit a few feet apart. A real jog is deeper. */
function clusterCornerRecords(turns, maxGapFt) {
  const used = new Set();
  const kept = [];
  for (let i = 0; i < turns.length; i += 1) {
    if (used.has(i)) continue;
    used.add(i);
    kept.push(turns[i]);
    const stack = [i];
    while (stack.length) {
      const current = stack.pop();
      for (let j = 0; j < turns.length; j += 1) {
        if (used.has(j)) continue;
        const gap = Math.hypot(turns[current].x - turns[j].x, turns[current].y - turns[j].y);
        if (gap <= maxGapFt) {
          used.add(j);
          stack.push(j);
        }
      }
    }
  }
  return kept;
}

function faceEaveFtOr(faceEaveFt, face, fallback) {
  const value = Number(faceEaveFt?.[face]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Same full wall as a confirmed two-story tap: 9 ft × 2 + 1 ft band joist.
const SPLIT_TALL_SECTION_FT = 19;

function storiesOf(faceStories, face) {
  const value = faceStories?.[face];
  if (value && typeof value === 'object') return value.stories;
  return value;
}

/**
 * A one-story or two-story corner is the shorter adjoining eave. A split-level
 * corner on the tall section is the full wall there, not the averaged eave
 * locked on every face. When the two eaves already differ, the taller one is
 * that section. When both still hold the average, the tall section is the
 * two-story wall.
 */
function cornerBoardFt(leftName, rightName, faceEaveFt, faceStories, houseHeight) {
  const left = faceEaveFtOr(faceEaveFt, leftName, houseHeight);
  const right = faceEaveFtOr(faceEaveFt, rightName, houseHeight);
  const split = storiesOf(faceStories, leftName) === 'split'
    || storiesOf(faceStories, rightName) === 'split';
  if (!split) return Math.min(left, right);
  if (Math.abs(left - right) > 1) return Math.max(left, right);
  const average = Math.max(left, right);
  if (average > 0 && average < 16) return SPLIT_TALL_SECTION_FT;
  return average;
}

function faceConfirmed(face) {
  return face?.confirmed === true || face?.material_agreement?.billed_from === 'rep_confirmed';
}

function confirmedSidingPercent(face) {
  if (!faceConfirmed(face)) return null;
  if (Number.isFinite(Number(face.siding_percent))) return Number(face.siding_percent);
  const regions = Array.isArray(face.regions) ? face.regions : [];
  let siding = 0;
  let seen = false;
  for (const region of regions) {
    if (!region?.material || region.material === 'unknown' || region.material === 'other') continue;
    if (MASONRY_MATERIALS.includes(region.material)) continue;
    siding += Number(region.percent) || 0;
    seen = true;
  }
  return seen ? siding : null;
}

function sectionCoversEnd(section, end) {
  const poly = sectionPolygon(section);
  if (!poly) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of poly) {
    const [x, y] = pointXY(point);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(minY <= 0.2 && maxY >= 0.8)) return false;
  if (end === 'start') return minX <= 0.12;
  if (end === 'end') return maxX >= 0.88;
  return false;
}

/** Confirmed siding share at one end of a face. Null when the face is not confirmed. */
function confirmedEndSidingPercent(face, end) {
  const faceShare = confirmedSidingPercent(face);
  if (faceShare == null) return null;
  const named = face?.end_shares?.[end];
  const namedSiding = named?.siding ?? named?.siding_percent;
  if (Number.isFinite(Number(namedSiding))) return Number(namedSiding);
  const sections = [
    ...(Array.isArray(face?.sections) ? face.sections : []),
    ...(Array.isArray(face?.material_sections) ? face.material_sections : []),
  ];
  for (const section of sections) {
    const material = String(section?.material || '').toLowerCase();
    if (!/brick|stone|stucco/.test(material)) continue;
    if (sectionCoversEnd(section, end)) return 0;
  }
  return faceShare;
}

function endHasMasonrySignal(face, end) {
  const named = face?.end_shares?.[end];
  const namedSiding = named?.siding ?? named?.siding_percent;
  if (Number.isFinite(Number(namedSiding)) && Number(namedSiding) < 50) return true;
  const sections = [
    ...(Array.isArray(face?.sections) ? face.sections : []),
    ...(Array.isArray(face?.material_sections) ? face.material_sections : []),
  ];
  return sections.some((section) => {
    const material = String(section?.material || '').toLowerCase();
    return /brick|stone|stucco/.test(material) && sectionCoversEnd(section, end);
  });
}

/**
 * Drop a confirmed corner when that end is masonry, when the face is under
 * 20% siding, or when a mostly masonry face meets a sided face. Two faces
 * that are both partly sided (about 20–50%) keep the corner. Dropping either
 * face under 50% removed every corner on a brick house whose sided walls
 * were all in that band.
 */
function confirmedDropsCorner(left, right) {
  const leftShare = confirmedEndSidingPercent(left, 'end');
  const rightShare = confirmedEndSidingPercent(right, 'start');
  const drops = (share, face, end, otherShare) => {
    if (share == null) return false;
    if (share < 20) return true;
    if (endHasMasonrySignal(face, end) && share < 50) return true;
    if (share < 50 && otherShare != null && otherShare >= 50) return true;
    return false;
  };
  return drops(leftShare, left, 'end', rightShare)
    || drops(rightShare, right, 'start', leftShare);
}

function faceSidingPercent(face) {
  if (!face) return 0;
  const regions = Array.isArray(face.regions) ? face.regions : [];
  let siding = 0;
  let saw = false;
  for (const region of regions) {
    const pct = Number(region.percent) || 0;
    if (!region?.material || region.material === 'unknown' || region.material === 'other') continue;
    if (MASONRY_MATERIALS.includes(region.material)) continue;
    siding += pct;
    saw = true;
  }
  if (!saw && Number.isFinite(Number(face.siding_percent))) return Number(face.siding_percent);
  return siding;
}

function azimuthDifference(left, right) {
  const delta = Math.abs((((left - right) % 360) + 360) % 360);
  return delta > 180 ? 360 - delta : delta;
}

function outwardAzimuth(poly, edgeIndex, ccw) {
  const a = poly[edgeIndex];
  const b = poly[(edgeIndex + 1) % poly.length];
  const east = b[0] - a[0];
  const north = b[1] - a[1];
  const outEast = ccw ? north : -north;
  const outNorth = ccw ? -east : east;
  return (Math.atan2(outEast, outNorth) * 180 / Math.PI + 360) % 360;
}

function faceForOutwardAzimuth(azimuth, frontAzimuth) {
  const targets = [
    ['front', frontAzimuth],
    ['left_side', (frontAzimuth + 90) % 360],
    ['back', (frontAzimuth + 180) % 360],
    ['right_side', (frontAzimuth + 270) % 360],
  ];
  let best = 'front';
  let bestDiff = 360;
  for (const [face, target] of targets) {
    const diff = azimuthDifference(azimuth, target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = face;
    }
  }
  return best;
}

function pointEastNorth(point) {
  if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
  if (!point || typeof point !== 'object') return [NaN, NaN];
  return [Number(point.x ?? point.east), Number(point.y ?? point.north)];
}

/**
 * Wall widths are the satellite footprint edges, each assigned to the face
 * its outward normal points at, relative to the front wall, then summed.
 * A notch makes one face several edges. Opposite faces of an orthogonal
 * outline sum equal; a re-entrant edge facing the other way does not, so
 * this is not the bounding box. A photo estimate never changes these lengths.
 * The bearing is the longest edge on that face, which is what the gable-end
 * test compares to the roof slope.
 */
export function faceWidthsFromFootprint(polygon, frontAzimuthDeg) {
  const front = Number(frontAzimuthDeg);
  const emptyEdges = { front: [], back: [], left_side: [], right_side: [] };
  const empty = {
    front: 0, back: 0, left_side: 0, right_side: 0, perimeter_ft: 0, bearings: {}, edges: emptyEdges,
  };
  if (!Array.isArray(polygon) || polygon.length < 3 || !Number.isFinite(front)) return empty;
  const ring = polygon.map(pointEastNorth).filter((pt) => pt.every(Number.isFinite));
  if (ring.length >= 2) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05) ring.pop();
  }
  if (ring.length < 3) return empty;
  let winding = 0;
  for (let i = 0; i < ring.length; i += 1) winding += vertexTurn(ring, i).cross;
  const ccw = winding >= 0;
  const widths = { front: 0, back: 0, left_side: 0, right_side: 0 };
  const edges = { front: [], back: [], left_side: [], right_side: [] };
  const bearings = {};
  const longest = {};
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(length > 0.05)) continue;
    const azimuth = outwardAzimuth(ring, i, ccw);
    const face = faceForOutwardAzimuth(azimuth, front);
    widths[face] += length;
    edges[face].push({
      length_ft: Math.round(length * 100) / 100,
      azimuth_deg: Math.round(azimuth * 10) / 10,
    });
    if (!(longest[face] > length)) {
      longest[face] = length;
      bearings[face] = azimuth;
    }
  }
  const perimeter = widths.front + widths.back + widths.left_side + widths.right_side;
  return {
    front: widths.front,
    back: widths.back,
    left_side: widths.left_side,
    right_side: widths.right_side,
    perimeter_ft: perimeter,
    bearings,
    edges,
  };
}

function sidingSidingPairCount(faces) {
  const has = (name) => faceHasSiding(faces?.[name]);
  return [
    ['front', 'left_side'],
    ['front', 'right_side'],
    ['back', 'left_side'],
    ['back', 'right_side'],
  ].filter(([left, right]) => has(left) && has(right)).length;
}

/**
 * Outside corners are billed only where siding meets siding, each at the
 * eave of its two adjoining faces (the shorter one — that is the corner
 * board). A masonry wall meeting siding is not a corner. A mixed wall still
 * drops a corner when that end reads brick or stone. A confirmed face drops
 * a corner when that end is masonry, when the face is under 20% siding, or
 * when it is under half siding and meets a sided face. Two partly sided
 * faces keep the corner. The roof outline does not add a corner the
 * footprint ring does not already have.
 */
export function countSidingOutsideCorners({
  polygon = null,
  outlinePolygon = null,
  corners,
  materialMap = null,
  frontAzimuthDeg = null,
  wallHeightFt = 0,
  faceEaveFt = null,
  faceStories = null,
} = {}) {
  const base = corners && typeof corners === 'object' ? corners : {
    outside_count: 0,
    inside_count: 0,
    outside_lf: 0,
    inside_lf: 0,
    source: 'rectangle_default',
  };
  const faces = materialMap?.faces;
  if (!faces) return base;
  const houseHeight = base.outside_count > 0
    ? (Number(base.outside_lf) || 0) / base.outside_count
    : Math.max(0, Number(wallHeightFt) || 0);
  const finish = (count, lf, extra = {}) => ({
    ...base,
    outside_count: count,
    outside_lf: Math.round(lf),
    corner_rule: 'siding_meets_siding',
    ...extra,
  });
  const pairs = sidingSidingPairCount(faces);
  const front = Number(frontAzimuthDeg);
  if (!Number.isFinite(front) || !Array.isArray(polygon) || polygon.length < 3) {
    return finish(pairs, pairs * houseHeight);
  }

  const turns = outsideTurnRecords(polygon, { minSin: 0.14 });
  let count = 0;
  let lf = 0;
  let scaled = false;
  for (const turn of turns) {
    const leftName = faceForOutwardAzimuth(turn.incoming, front);
    const rightName = faceForOutwardAzimuth(turn.outgoing, front);
    // The incoming edge ends at this vertex. The outgoing edge starts here.
    // Both ends reading masonry drops the corner even when each wall is mixed
    // and neither photo cleared the 0.8 corner-photo bar on its own.
    const bothMasonry = masonryEndReads(faces[leftName]).reads.has('end')
      && masonryEndReads(faces[rightName]).reads.has('start');
    const confirmedMasonry = confirmedDropsCorner(faces[leftName], faces[rightName]);
    let fraction = bothMasonry || confirmedMasonry ? 0 : Math.min(
      sidingCornerFraction(faces[leftName], 'end'),
      sidingCornerFraction(faces[rightName], 'start'),
    );
    // Every wall a sliver of siding used to drop the whole house, including
    // the corner where those two slivers meet. Bill that board at the
    // larger siding share instead of at the full eave or at zero.
    if (!(fraction > 0) && !bothMasonry && !confirmedMasonry) {
      const leftShare = faceSidingPercent(faces[leftName]);
      const rightShare = faceSidingPercent(faces[rightName]);
      if (leftShare > 0 && leftShare < 20 && rightShare > 0 && rightShare < 20) {
        fraction = Math.max(leftShare, rightShare) / 100;
      }
    }
    if (!(fraction > 0)) {
      scaled = true;
      continue;
    }
    if (fraction < 1) scaled = true;
    const eave = cornerBoardFt(leftName, rightName, faceEaveFt, faceStories, houseHeight);
    count += 1;
    lf += eave * fraction;
  }
  // A bad front bearing must not wipe corners that the four walls still share.
  if (count === 0 && pairs > 0 && turns.length === 0) return finish(pairs, pairs * houseHeight);

  // A simple four-corner ring does not pick up roof-outline corners.
  // A footprint that already jogs can add outline corners the ring missed.
  let bumpOuts = 0;
  const simpleFootprint = (turns.length > 0 ? turns.length : Number(base.outside_count) || 0) <= 4
    && (Number(base.inside_count) || 0) === 0;
  if (!simpleFootprint && Array.isArray(outlinePolygon) && outlinePolygon.length >= 4) {
    const outlineTurns = clusterCornerRecords(
      outsideTurnRecords(outlinePolygon, { minSin: 0.7, minDepth: 4 }),
      4,
    );
    bumpOuts = Math.max(0, outlineTurns.length - turns.length);
    if (bumpOuts > 0) {
      count += bumpOuts;
      lf += bumpOuts * houseHeight;
    }
  }
  return finish(count, lf, {
    bump_out_corners: bumpOuts,
    corner_rule: scaled || bumpOuts > 0 ? 'siding_meets_siding' : base.corner_rule,
  });
}

export function maskOutsideCorners(corners, masonryFraction = 0, wallHeightFt = 0) {
  const fraction = Math.max(0, Math.min(1, Number(masonryFraction) || 0));
  const implied = corners?.outside_count > 0
    ? (Number(corners.outside_lf) || 0) / corners.outside_count
    : 0;
  const height = Math.max(0, Number(wallHeightFt) || 0) || implied;
  const outside = Math.round((Number(corners?.outside_count) || 0) * (1 - fraction));
  return {
    ...corners,
    outside_count: outside,
    outside_lf: Math.round(outside * height),
    inside_count: corners?.inside_count || 0,
    inside_lf: corners?.inside_lf || 0,
    masonry_fraction: fraction,
  };
}
