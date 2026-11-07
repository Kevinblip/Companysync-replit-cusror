/**
 * Complete a partial roof outline.
 *
 * Trees, shadows and a segmenter that kept only the main body leave a roof
 * short. The missing pieces are filled from the shape that is already there:
 * square a nibbled plane back to a rectangle, mirror a short slope across its
 * ridge, extend a ridge or eave that stops early, and cover an attached wing
 * the building footprint still shows. Nothing here is a per-house constant.
 * Completed pieces are marked quality "estimated".
 */

const D2R = Math.PI / 180;
const FT_PER_DEG_LAT = 364567.2;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round = (v, p = 2) => {
  const m = 10 ** p;
  return Math.round(num(v) * m) / m;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v)));

export function offsetFeet(fromLat, fromLng, toLat, toLng) {
  const lat1 = num(fromLat);
  const lat2 = num(toLat);
  const north = (lat2 - lat1) * FT_PER_DEG_LAT;
  const east = (num(toLng) - num(fromLng)) * FT_PER_DEG_LAT * Math.cos(((lat1 + lat2) / 2) * D2R);
  return { east, north };
}

export function shiftRing(ring, east, north) {
  if (!Array.isArray(ring)) return [];
  return ring.map((p) => {
    const x = Array.isArray(p) ? num(p[0]) : num(p?.x);
    const y = Array.isArray(p) ? num(p[1]) : num(p?.y);
    return [round(x + east, 3), round(y + north, 3)];
  });
}

function asPoints(poly) {
  if (!Array.isArray(poly)) return [];
  return poly.map((p) => {
    if (Array.isArray(p)) return { x: num(p[0], NaN), y: num(p[1], NaN) };
    return { x: num(p?.x, NaN), y: num(p?.y, NaN) };
  }).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function planArea(pts) {
  return Math.abs(signedArea(pts));
}

function pointInRing(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const yi = pts[i].y;
    const yj = pts[j].y;
    const xi = pts[i].x;
    const xj = pts[j].x;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

function basis(azimuthDeg) {
  const az = ((num(azimuthDeg) % 360) + 360) % 360;
  const down = { x: Math.sin(az * D2R), y: Math.cos(az * D2R) };
  const ridge = { x: down.y, y: -down.x };
  return { down, ridge, azimuth: az };
}

function project(pt, b) {
  return {
    d: pt.x * b.down.x + pt.y * b.down.y,
    r: pt.x * b.ridge.x + pt.y * b.ridge.y,
  };
}

function unproject(d, r, b) {
  return {
    x: b.down.x * d + b.ridge.x * r,
    y: b.down.y * d + b.ridge.y * r,
  };
}

function rectPoly(minD, maxD, minR, maxR, b) {
  return [
    unproject(minD, minR, b),
    unproject(minD, maxR, b),
    unproject(maxD, maxR, b),
    unproject(maxD, minR, b),
  ];
}

function metrics(pts, azimuth) {
  const b = basis(azimuth);
  let minD = Infinity;
  let maxD = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const p of pts) {
    const pr = project(p, b);
    if (pr.d < minD) minD = pr.d;
    if (pr.d > maxD) maxD = pr.d;
    if (pr.r < minR) minR = pr.r;
    if (pr.r > maxR) maxR = pr.r;
  }
  return {
    b,
    minD,
    maxD,
    minR,
    maxR,
    depth: maxD - minD,
    span: maxR - minR,
  };
}

function azimuthDelta(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function slopeFromPlan(plan, pitchDeg) {
  const c = Math.cos(clamp(pitchDeg, 0, 75) * D2R);
  return c > 0.2 ? plan / c : plan;
}

function facetPitch(facet, fallback) {
  const direct = num(facet?.pitch_degrees, NaN);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const label = String(facet?.pitch || '');
  const m = label.match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
  if (m) return Math.atan(Number(m[1]) / 12) / D2R;
  return fallback;
}

function normalizeFacet(raw, index, fallbackPitch) {
  const polygon = asPoints(raw?.polygon);
  if (polygon.length < 3) return null;
  const area = planArea(polygon);
  if (area < 8) return null;
  const pitch = facetPitch(raw, fallbackPitch);
  const azimuth = num(raw?.azimuth_degrees, num(raw?.azimuth, 180));
  return {
    id: String(raw?.id || `facet_${index + 1}`),
    polygon,
    pitch_degrees: round(pitch, 2),
    azimuth_degrees: ((azimuth % 360) + 360) % 360,
    plan_sqft: round(area, 2),
    observed_plan_sqft: round(area, 2),
    estimated_plan_sqft: 0,
    quality: 'observed',
    completion: null,
  };
}

function squareFacet(facet) {
  const m = metrics(facet.polygon, facet.azimuth_degrees);
  if (!(m.depth > 2) || !(m.span > 2)) return { facet, added: null };
  const bboxArea = m.depth * m.span;
  const ratio = facet.plan_sqft / bboxArea;
  // A hip or a solar rectangle is a clean quadrilateral and stays one. A tree
  // bite adds corners, so only a jagged outline is squared back to its box.
  if (facet.polygon.length < 5 || ratio >= 0.93 || ratio < 0.45) return { facet, added: null };
  const squared = rectPoly(m.minD, m.maxD, m.minR, m.maxR, m.b);
  const addedPlan = bboxArea - facet.plan_sqft;
  if (addedPlan < 12) return { facet, added: null };
  return {
    facet: {
      ...facet,
      polygon: squared,
      plan_sqft: round(bboxArea, 2),
      estimated_plan_sqft: round(addedPlan, 2),
      completion: 'rectilinear_square',
    },
    added: null,
  };
}

function extensionFacet(id, polygon, pitch, azimuth, method) {
  const area = planArea(polygon);
  if (area < 12) return null;
  return {
    id,
    polygon,
    pitch_degrees: pitch,
    azimuth_degrees: azimuth,
    plan_sqft: round(area, 2),
    observed_plan_sqft: 0,
    estimated_plan_sqft: round(area, 2),
    quality: 'estimated',
    completion: method,
  };
}

/**
 * A short slope opposite a longer mate is extended downhill to the mate's
 * depth, and a slope whose ridge-axis run stops early is extended sideways
 * to the mate. Hips are left alone: their ridge is shorter than the eave on
 * BOTH slopes, and this only grows a facet toward a mate that is already longer.
 */
function extendBySymmetry(facets) {
  const out = facets.map((f) => ({ ...f, polygon: f.polygon.map((p) => ({ ...p })) }));
  const added = [];
  const used = new Set();
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const a = out[i];
      const b = out[j];
      if (azimuthDelta(a.azimuth_degrees, b.azimuth_degrees + 180) > 25) continue;
      const ma = metrics(a.polygon, a.azimuth_degrees);
      const mb = metrics(b.polygon, b.azimuth_degrees);
      if (ma.depth < 3 || mb.depth < 3 || ma.span < 3 || mb.span < 3) continue;
      const aRidge = unproject(ma.minD, (ma.minR + ma.maxR) / 2, ma.b);
      const bRidge = unproject(mb.minD, (mb.minR + mb.maxR) / 2, mb.b);
      if (Math.hypot(aRidge.x - bRidge.x, aRidge.y - bRidge.y) > 8) continue;
      used.add(i);
      used.add(j);
      // The original plane stays observed. Only the missing strip is estimated,
      // so the strip is not also added onto the facet it came from.
      const grow = (short, sm, longDepth, tag) => {
        if (sm.depth >= longDepth * 0.82 || longDepth - sm.depth < 2) return null;
        const poly = rectPoly(sm.maxD, sm.minD + longDepth, sm.minR, sm.maxR, sm.b);
        const piece = extensionFacet(`${short.id}_sym_${tag}`, poly, short.pitch_degrees, short.azimuth_degrees, 'ridge_symmetry');
        if (!piece) return null;
        added.push(piece);
        return longDepth;
      };
      const grownDepthA = grow(a, ma, mb.depth, 'a');
      const grownDepthB = grow(b, mb, ma.depth, 'b');

      const widen = (facet, sm, matePts, grownDepth) => {
        let minR = Infinity;
        let maxR = -Infinity;
        for (const p of matePts) {
          const r = project(p, sm.b).r;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        }
        const mateSpan = maxR - minR;
        if (!(mateSpan > sm.span * 1.18) || mateSpan - sm.span < 2) return;
        const depthMax = grownDepth != null ? sm.minD + grownDepth : sm.maxD;
        const pieces = [];
        if (minR < sm.minR - 1) pieces.push(rectPoly(sm.minD, depthMax, minR, sm.minR, sm.b));
        if (maxR > sm.maxR + 1) pieces.push(rectPoly(sm.minD, depthMax, sm.maxR, maxR, sm.b));
        pieces.forEach((poly, idx) => {
          const piece = extensionFacet(`${facet.id}_ext_${idx}`, poly, facet.pitch_degrees, facet.azimuth_degrees, 'ridge_extension');
          if (piece) added.push(piece);
        });
      };
      widen(a, ma, b.polygon, grownDepthA);
      widen(b, mb, a.polygon, grownDepthB);
    }
  }

  // One slope visible, the other eaten by trees. Mirror it only when a later
  // footprint check keeps the mirror; without a footprint the mirror is dropped
  // by the caller unless it asked to allow it. We still emit the candidate and
  // let footprint coverage accept it.
  out.forEach((facet, index) => {
    if (used.has(index)) return;
    const m = metrics(facet.polygon, facet.azimuth_degrees);
    if (m.depth < 4 || m.span < 6) return;
    const mirroredAz = (facet.azimuth_degrees + 180) % 360;
    const mb = basis(mirroredAz);
    // Reflect each point across the ridge (the minD line of this facet).
    const reflected = facet.polygon.map((p) => {
      const pr = project(p, m.b);
      const across = m.minD - (pr.d - m.minD);
      return unproject(across, pr.r, m.b);
    });
    const piece = extensionFacet(`${facet.id}_mirror`, reflected, facet.pitch_degrees, mirroredAz, 'ridge_symmetry');
    if (!piece) return;
    piece._mirrorCandidate = true;
    piece._mirrorBasis = mb;
    added.push(piece);
  });

  return { facets: out, added };
}

function ringDistance(a, b) {
  let best = Infinity;
  for (const p of a) {
    for (let i = 0; i < b.length; i += 1) {
      const q = b[i];
      const r = b[(i + 1) % b.length];
      const dx = r.x - q.x;
      const dy = r.y - q.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((p.x - q.x) * dx + (p.y - q.y) * dy) / len2, 0, 1);
      const px = q.x + t * dx;
      const py = q.y + t * dy;
      const dist = Math.hypot(p.x - px, p.y - py);
      if (dist < best) best = dist;
    }
  }
  return best;
}

function footprintWings(facets, footprintRings, pitch, azimuth) {
  const rings = footprintRings.map(asPoints).filter((r) => r.length >= 3 && planArea(r) > 40);
  if (!rings.length || !facets.length) return [];
  const main = rings[0];
  const kept = [main];
  for (const ring of rings.slice(1)) {
    if (ringDistance(main, ring) <= 6 || ringDistance(ring, main) <= 6) kept.push(ring);
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const touch = (p, pad) => {
    if (p.x - pad < minX) minX = p.x - pad;
    if (p.x + pad > maxX) maxX = p.x + pad;
    if (p.y - pad < minY) minY = p.y - pad;
    if (p.y + pad > maxY) maxY = p.y + pad;
  };
  kept.forEach((ring) => ring.forEach((p) => touch(p, 1)));
  facets.forEach((f) => f.polygon.forEach((p) => touch(p, 1)));
  const cell = 1;
  const nx = Math.ceil((maxX - minX) / cell);
  const ny = Math.ceil((maxY - minY) / cell);
  if (nx < 4 || ny < 4 || nx * ny > 400000) return [];
  let foot = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const y = minY + (j + 0.5) * cell;
    for (let i = 0; i < nx; i += 1) {
      const x = minX + (i + 0.5) * cell;
      if (kept.some((ring) => pointInRing(x, y, ring))) foot[j * nx + i] = 1;
    }
  }
  const covered = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const y = minY + (j + 0.5) * cell;
    for (let i = 0; i < nx; i += 1) {
      const x = minX + (i + 0.5) * cell;
      if (facets.some((f) => pointInRing(x, y, f.polygon))) covered[j * nx + i] = 1;
    }
  }
  const open = new Uint8Array(nx * ny);
  let openCount = 0;
  for (let k = 0; k < foot.length; k += 1) {
    if (foot[k] && !covered[k]) { open[k] = 1; openCount += 1; }
  }
  if (openCount < 20) return [];

  const seen = new Uint8Array(open.length);
  const wings = [];
  const b = basis(azimuth);
  let wingIndex = 0;
  for (let start = 0; start < open.length; start += 1) {
    if (!open[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    const cells = [];
    while (stack.length) {
      const k = stack.pop();
      const i = k % nx;
      const j = (k - i) / nx;
      cells.push({ x: minX + (i + 0.5) * cell, y: minY + (j + 0.5) * cell });
      const nbrs = [k - 1, k + 1, k - nx, k + nx];
      for (const n of nbrs) {
        if (n < 0 || n >= open.length || seen[n] || !open[n]) continue;
        const ni = n % nx;
        const nj = (n - ni) / nx;
        if (Math.abs(ni - i) + Math.abs(nj - j) !== 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (cells.length < 20) continue;
    let minD = Infinity;
    let maxD = -Infinity;
    let minR = Infinity;
    let maxR = -Infinity;
    for (const p of cells) {
      const pr = project(p, b);
      if (pr.d < minD) minD = pr.d;
      if (pr.d > maxD) maxD = pr.d;
      if (pr.r < minR) minR = pr.r;
      if (pr.r > maxR) maxR = pr.r;
    }
    const depth = maxD - minD;
    const span = maxR - minR;
    if (depth < 4 || span < 4) continue;
    const mid = (minD + maxD) / 2;
    wingIndex += 1;
    const south = extensionFacet(
      `wing_${wingIndex}_a`,
      rectPoly(minD, mid, minR, maxR, b),
      pitch,
      azimuth,
      'footprint_wing',
    );
    const north = extensionFacet(
      `wing_${wingIndex}_b`,
      rectPoly(mid, maxD, minR, maxR, b),
      pitch,
      (azimuth + 180) % 360,
      'footprint_wing',
    );
    if (south) wings.push(south);
    if (north) wings.push(north);
  }
  return wings;
}

function acceptMirror(piece, footprintRings, overhangFt) {
  const rings = (footprintRings || []).map(asPoints).filter((r) => r.length >= 3);
  if (!rings.length) return false;
  const main = rings[0];
  const kept = [main];
  for (const ring of rings.slice(1)) {
    if (ringDistance(main, ring) <= 6 || ringDistance(ring, main) <= 6) kept.push(ring);
  }
  // The mirror has to land on the building, not on the neighbour's yard.
  const samples = piece.polygon;
  let hits = 0;
  for (const p of samples) {
    if (kept.some((ring) => pointInRing(p.x, p.y, ring))) hits += 1;
  }
  if (hits >= Math.ceil(samples.length * 0.5)) return true;
  const centroid = samples.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  centroid.x /= samples.length;
  centroid.y /= samples.length;
  if (kept.some((ring) => pointInRing(centroid.x, centroid.y, ring))) return true;
  // Overhang: the eave sits just outside the wall line.
  return kept.some((ring) => ringDistance([centroid], ring) <= overhangFt + 2);
}

function footprintAgrees(facets, rings) {
  const pts = facets.flatMap((facet) => facet.polygon);
  if (!pts.length || !rings.length) return false;
  let near = 0;
  for (const p of pts) {
    if (rings.some((ring) => pointInRing(p.x, p.y, ring) || ringDistance([p], ring) <= 8)) near += 1;
  }
  return near / pts.length >= 0.5;
}

function predominant(facets, fallbackPitch, fallbackAz) {
  let pitchW = 0;
  let pitchA = 0;
  let azX = 0;
  let azY = 0;
  let azW = 0;
  for (const f of facets) {
    const w = Math.max(1, f.observed_plan_sqft || f.plan_sqft || 1);
    pitchW += f.pitch_degrees * w;
    pitchA += w;
    const az = f.azimuth_degrees * D2R;
    azX += Math.cos(az) * w;
    azY += Math.sin(az) * w;
    azW += w;
  }
  const pitch = pitchA > 0 ? pitchW / pitchA : fallbackPitch;
  const azimuth = azW > 0 ? ((Math.atan2(azY, azX) / D2R) + 360) % 360 : fallbackAz;
  return { pitch, azimuth };
}

/**
 * @param {object} input
 * @param {object[]} input.facets plan-foot polygons with pitch and azimuth
 * @param {Array} [input.footprint] wall outline in the SAME plan frame
 * @param {Array[]} [input.attachedFootprints] nearby outlines, same frame
 * @param {number} [input.overhangFt]
 * @param {number} [input.fallbackPitchDegrees]
 */
export function completePartialRoof({
  facets: rawFacets = [],
  footprint = null,
  attachedFootprints = [],
  overhangFt = 1.5,
  fallbackPitchDegrees = 26.57,
} = {}) {
  const fallbackPitch = clamp(fallbackPitchDegrees, 0, 60) || 26.57;
  const observed = [];
  (Array.isArray(rawFacets) ? rawFacets : []).forEach((raw, index) => {
    const facet = normalizeFacet(raw, index, fallbackPitch);
    if (facet) observed.push(facet);
  });
  if (!observed.length) {
    return {
      facets: [],
      observed_plan_sqft: 0,
      estimated_plan_sqft: 0,
      observed_slope_sqft: 0,
      estimated_slope_sqft: 0,
      roof_area_sqft: 0,
      partial: false,
      methods: [],
    };
  }

  const squared = observed.map((facet) => squareFacet(facet).facet);
  const sym = extendBySymmetry(squared);
  const footprintRings = [
    ...(Array.isArray(footprint) ? [footprint] : []),
    ...(Array.isArray(attachedFootprints) ? attachedFootprints : []),
  ].map(asPoints).filter((ring) => ring.length >= 3);
  // A footprint drawn in another coordinate frame must not be treated as a
  // missing wing of this roof.
  const aligned = footprintAgrees(squared, footprintRings);
  const added = sym.added.filter((piece) => {
    if (!piece._mirrorCandidate) return true;
    return aligned && acceptMirror(piece, footprintRings, overhangFt);
  }).map((piece) => {
    const copy = { ...piece };
    delete copy._mirrorCandidate;
    delete copy._mirrorBasis;
    return copy;
  });

  let working = [...sym.facets, ...added];
  const { pitch, azimuth } = predominant(squared, fallbackPitch, squared[0].azimuth_degrees);
  const wings = aligned ? footprintWings(working, footprintRings, pitch, azimuth) : [];
  working = [...working, ...wings];

  // A completed roof should not outgrow the building. The wall footprint plus
  // a normal eave overhang is the ceiling; only estimated area is scaled back.
  const footPts = aligned ? asPoints(footprint) : [];
  if (footPts.length >= 3) {
    const dilated = planArea(footPts);
    // overhang on a rectilinear plan adds about perimeter * overhang. Use a
    // 35% plan allowance, the same ceiling the roof handler already uses.
    const ceiling = dilated * 1.35;
    const observedPlan = squared.reduce((s, f) => s + f.observed_plan_sqft, 0);
    let estimatedPlan = working.reduce((s, f) => s + num(f.estimated_plan_sqft), 0);
    // squared facets carry their original area in observed_plan and the bite
    // in estimated_plan, so working plan = observed + estimated.
    const totalPlan = observedPlan + estimatedPlan;
    if (totalPlan > ceiling && estimatedPlan > 1) {
      const allowed = Math.max(0, ceiling - observedPlan);
      const scale = allowed / estimatedPlan;
      working = working.map((f) => {
        if (!(f.estimated_plan_sqft > 0)) return f;
        if (f.observed_plan_sqft > 0) {
          const est = f.estimated_plan_sqft * scale;
          return {
            ...f,
            estimated_plan_sqft: round(est, 2),
            plan_sqft: round(f.observed_plan_sqft + est, 2),
          };
        }
        return {
          ...f,
          plan_sqft: round(f.plan_sqft * scale, 2),
          estimated_plan_sqft: round(f.estimated_plan_sqft * scale, 2),
        };
      }).filter((f) => f.plan_sqft >= 8);
      estimatedPlan = allowed;
    }
  }

  const methods = [...new Set(working.map((f) => f.completion).filter(Boolean))];
  let observedPlan = 0;
  let estimatedPlan = 0;
  let observedSlope = 0;
  let estimatedSlope = 0;
  const facets = working.map((f) => {
    const pitchDeg = f.pitch_degrees;
    const obs = num(f.observed_plan_sqft);
    const est = num(f.estimated_plan_sqft);
    observedPlan += obs;
    estimatedPlan += est;
    observedSlope += slopeFromPlan(obs, pitchDeg);
    estimatedSlope += slopeFromPlan(est, pitchDeg);
    const quality = est > 1 && obs <= 1 ? 'estimated' : (est > 1 ? 'estimated' : 'observed');
    return {
      ...f,
      polygon: f.polygon.map((p) => ({ x: round(p.x, 2), y: round(p.y, 2) })),
      plan_sqft: round(obs + est, 2),
      observed_plan_sqft: round(obs, 2),
      estimated_plan_sqft: round(est, 2),
      slope_sqft: round(slopeFromPlan(obs + est, pitchDeg), 2),
      quality,
    };
  });

  return {
    facets,
    observed_plan_sqft: round(observedPlan, 1),
    estimated_plan_sqft: round(estimatedPlan, 1),
    observed_slope_sqft: round(observedSlope, 1),
    estimated_slope_sqft: round(estimatedSlope, 1),
    roof_area_sqft: round(observedSlope + estimatedSlope, 1),
    partial: estimatedPlan > 15,
    methods,
  };
}

/**
 * Run completion with the footprint shifted into the facet frame.
 * Solar-traced footprints already share that frame (`sameFrame`).
 * A rectangle estimate is not a footprint — pass null for it.
 */
export function completeDetectedRoof({
  facets,
  footprint = null,
  footprintOrigin = null,
  attachedFootprints = [],
  sameFrame = false,
  overhangFt = 1.5,
} = {}) {
  if (!Array.isArray(facets) || facets.length === 0) return null;
  let ring = Array.isArray(footprint) ? footprint : null;
  let attached = Array.isArray(attachedFootprints) ? attachedFootprints : [];
  const origin = facets.frameOrigin;
  if (!sameFrame && ring && origin && footprintOrigin) {
    const shift = offsetFeet(
      origin.latitude,
      origin.longitude,
      footprintOrigin.latitude,
      footprintOrigin.longitude,
    );
    ring = shiftRing(ring, shift.east, shift.north);
    attached = attached.map((item) => shiftRing(item, shift.east, shift.north));
  }
  return completePartialRoof({ facets, footprint: ring, attachedFootprints: attached, overhangFt });
}

/**
 * Plan area of the main outline plus rings that actually touch it.
 * A second OSM way across the lot is not part of this roof.
 */
export function independentFootprintPlanSqFt(main, attached = []) {
  const rings = [main, ...(Array.isArray(attached) ? attached : [])]
    .map(asPoints)
    .filter((ring) => ring.length >= 3 && planArea(ring) > 40);
  if (!rings.length) return 0;
  const body = rings[0];
  let area = planArea(body);
  for (const ring of rings.slice(1)) {
    if (ringDistance(body, ring) <= 6 || ringDistance(ring, body) <= 6) area += planArea(ring);
  }
  return round(area, 1);
}

/**
 * Bill completed slope only when the building outline is at least 25% larger
 * than whichever is already bigger: the outlined planes, or the Solar area.
 * A roof Solar already covers stays on the Solar number, even when the
 * drawn rectangles look short of the outline.
 */
export function billedRoofArea(solarAreaSqFt, completion, context = {}) {
  const solar = num(solarAreaSqFt);
  const keep = {
    area: solar,
    estimated_sqft: 0,
    source: solar > 0 ? 'solar' : null,
    methods: [],
    skip: null,
  };
  const observedPlan = num(completion?.observed_plan_sqft);
  const footprint = num(context.footprintPlanSqFt);
  const covered = Math.max(observedPlan, solar);
  const footprintGap = footprint > 0 && covered > 0 ? footprint / covered : null;
  if (!(footprintGap >= 1.25)) {
    return { ...keep, skip: footprintGap == null ? 'no_independent_footprint' : 'outline_complete' };
  }
  const completed = num(completion?.roof_area_sqft);
  if (!completion?.partial || !(completed > solar + 15)) {
    return { ...keep, skip: 'no_added_area' };
  }
  const pitch = observedPlan > 0 ? Math.max(1, Math.min(solar / observedPlan, 1.6)) : 1.12;
  const gapSlope = Math.max(0, footprint - observedPlan) * pitch;
  const area = Math.min(completed, solar + gapSlope);
  if (!(area > solar + 15)) return { ...keep, skip: 'gap_too_small' };
  return {
    area,
    estimated_sqft: round(area - solar, 1),
    source: 'solar_completed',
    methods: completion.methods || [],
    skip: null,
  };
}

export default completePartialRoof;
