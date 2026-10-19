/**
 * HouseModel3D — Procedural 3D house viewer
 *
 * Walls:
 *   When `footprintPolygon` is provided ([[east_ft, north_ft], …] from OSM),
 *   every vertex segment of the polygon is extruded to the full wall height —
 *   capturing L-shapes, recessed walls, and garage offsets exactly.
 *   Falls back to a rectangle if no polygon data is available.
 *
 * Roof:
 *   When `roofSegments` (Solar API `roofSegmentStats`) is provided and non-empty,
 *   each segment is rendered as an individual pitched quad using its exact
 *   azimuth, pitchDegrees, and bounding-box extents — producing real valleys,
 *   hips, and ridges from the detected geometry.
 *   Falls back to a generic hip/gable mesh when no segment data is present.
 *
 * Openings:
 *   Photo-detected windows/doors (pre-filtered server-side: ≥10 sqft, merged
 *   within 12 in, deductions only for ≥20 sqft) are placed on the polygon edge
 *   whose outward-normal azimuth best matches the opening's compass direction.
 */
import { useEffect, useRef, useState } from 'react';
import { applyPhotoTextures } from './photoTextures';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  enforceUnifiedRidge,
  snapEavesToWallPlate,
  buildParametricGable,
  buildParametricHip,
  buildFootprintRoofSurface,
  roofHintsFromSolarSegments,
} from '@/utils/MeshGeometryBuilder';
import { partitionGableEndOpenings } from '@/utils/gableOpeningRouting';
import { footprintClassFor3D, resolveRoof3DSource, shouldAttemptFootprintRoof } from '@/utils/roof3DSourceSelection';
import {
  compareRoof3DMeasurements,
  formatRoof3DParityWarning,
  fitRoofSurfaceArraysToArea,
  lineLength,
  positionArraySurfaceArea,
} from '@/utils/roof3DMeasurementParity';
import { shouldFillGableEdge } from '../../../functions/utils/roofFacetGeometry.js';
import { facadeAzimuth, normalizeFacade } from '@/utils/facadeOrientation';

// ─── Color palette (Hover-inspired light gray) ────────────────────────────────
const C = {
  sky:     0xdde3ea,   // brighter, cleaner backdrop (Hover-like light studio)
  studioBg: 0xf3f4f6,  // presentation view: near-white seamless backdrop
  studioGnd:0xe9eaec,  // presentation view: neutral floor that only carries shadow
  grass:   0xa8bd8b,   // lighter sage so the model pops instead of sinking into murk
  pad:     0xa6a8a9,
  drive:   0x96918d,
  wall:    0xcac6be,   // sun-facing
  wallB:   0xb2aea6,   // shadow side
  trim:    0xdedad2,
  found:   0x7c7870,
  stone:   0x8a8680,
  roofS:   0x3a3830,  // near-black charcoal asphalt (sun-facing)
  roofN:   0x2a2820,  // slightly darker (shadow-facing)
  roofE:   0x322e28,
  roofW:   0x322e28,
  ridge:   0x1e1c18,  // cap/ridge darker
  glass:   0x6888a8,
  wframe:  0xe4e0d8,
  door:    0x584838,
  garDoor: 0x8a8680,
  edge:    0x5e5c58,
  hip:     0x3e3c38,
};

// Shared by the parametric roof faces and the calibrated photo-plane roof.
// buildPhotoRoof sits outside buildRoofFaces, so this cannot stay local there.
const FACE_COLORS = { south: C.roofS, north: C.roofN, east: C.roofE, west: C.roofW };

// ─── Materials ────────────────────────────────────────────────────────────────
// Every surface is physically-based (MeshStandardMaterial) so the image-based
// environment light produces real soft reflections and believable shading —
// Phong's flat plastic look was the single biggest reason the model read as a
// diagram instead of a house.
//
// Legacy call sites still pass `shininess`; it is translated to roughness and
// stripped so Three.js never warns about an unknown property.
function stdMat(params = {}) {
  const { shininess, specular, ...rest } = params;
  const roughness = rest.roughness != null
    ? rest.roughness
    : Math.min(0.96, Math.max(0.32, 1 - (Number(shininess) || 8) / 120));
  const mat = new THREE.MeshStandardMaterial({
    roughness,
    metalness: rest.metalness != null ? rest.metalness : 0.04,
    ...rest,
  });
  // Reuse the colour map as a bump map: lap-siding and shingle courses gain
  // real relief under the sun instead of reading as a printed pattern.
  if (mat.map && !mat.bumpMap) {
    mat.bumpMap = mat.map;
    mat.bumpScale = rest.bumpScale != null ? rest.bumpScale : 0.035;
  }
  return mat;
}

// Reflective glazing. Dark, low-roughness and slightly metallic so the
// environment reflects in the pane the way real glass does.
function glassMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x2a3742, roughness: 0.06, metalness: 0.72, envMapIntensity: 1.6,
  });
}

// ─── Facet hover tooltip helpers ─────────────────────────────────────────────
function azimuthToCardinal(deg) {
  const d = ((deg % 360) + 360) % 360;
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(d / 45) % 8];
}
function degToSlope(deg) {
  const rise = Math.round(Math.tan(deg * Math.PI / 180) * 12 * 2) / 2;
  return `${rise}/12`;
}

// ─── Siding canvas texture ─────────────────────────────────────────────────────
// Warm medium-gray horizontal lap siding — matches most vinyl/fiber-cement installs.
function makeSidingTexture() {
  // 512 px with taller courses: at 256 the lap lines aliased into grey mush as
  // soon as the camera pulled back, which flattened every wall.
  // 512 / 32 = 16 whole courses, so the texture tiles with no visible seam at
  // the repeat boundary (26 px left a sliced course every 512 px).
  const sz = 512, bh = 32;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < sz; y += bh) {
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    g.addColorStop(0,    '#bab6ae');  // warm light gray (top highlight)
    g.addColorStop(0.65, '#aeaaa2'); // mid tone
    g.addColorStop(1,    '#9e9a92'); // shadow at lap edge
    ctx.fillStyle = g;
    ctx.fillRect(0, y, sz, bh - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; // shadow line at every lap
    ctx.fillRect(0, y + bh - 1, sz, 1);
  }
  // Subtle vertical grain noise
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let x = 0; x < sz; x += 6) ctx.fillRect(x, 0, 1, sz);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeVerticalSidingTexture() {
  const sz = 512, board = 42;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  for (let x = 0; x < sz; x += board) {
    const g = ctx.createLinearGradient(x, 0, x + board, 0);
    g.addColorStop(0, '#aaa69f');
    g.addColorStop(0.48, '#c0bcb5');
    g.addColorStop(1, '#98948c');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, board - 1, sz);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fillRect(x + board - 1, 0, 1, sz);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ─── Masonry / stucco canvas textures ─────────────────────────────────────────
// Brick and stone are the two materials contractors most need to SEE, because
// they are the ones that do not get re-sided. Rendering them with the lap-siding
// texture made a brick front read as vinyl and hid the actual scope of work.

// Running-bond brick. 512 / 32 = 16 whole courses and 512 / 128 = 4 whole
// bricks per row, so the half-brick offset survives the repeat boundary.
function makeBrickTexture() {
  const sz = 512, ch = 32, bw = 128;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#8d8177'; ctx.fillRect(0, 0, sz, sz); // mortar bed
  // Deterministic per-brick tone so the field is blended, not a flat red slab.
  const tone = (r, c) => Math.abs((Math.sin(r * 12.9898 + c * 78.233) * 43758.5453) % 1);
  let row = 0;
  for (let y = 0; y < sz; y += ch, row++) {
    const offset = (row % 2) * (bw / 2); // running bond
    for (let x = -bw; x < sz + bw; x += bw) {
      const bx = x + offset, t = tone(row, Math.round(bx / bw));
      // Clay reds ranging into brown-grey, the way a real blended brick reads.
      const r0 = 132 + Math.round(t * 46), g0 = 70 + Math.round(t * 30), b0 = 58 + Math.round(t * 24);
      ctx.fillStyle = `rgb(${r0},${g0},${b0})`;
      ctx.fillRect(bx + 2, y + 2, bw - 4, ch - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; // top light catch
      ctx.fillRect(bx + 2, y + 2, bw - 4, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';       // shadow into the bed joint
      ctx.fillRect(bx + 2, y + ch - 4, bw - 4, 2);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Irregular coursed ledgestone — deliberately unlike brick so the two are
// distinguishable at a glance when a house mixes them.
function makeStoneTexture() {
  const sz = 512, ch = 42;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#6f6b65'; ctx.fillRect(0, 0, sz, sz); // mortar
  const rnd = (r, c) => Math.abs((Math.sin(r * 45.233 + c * 19.717) * 24634.6345) % 1);
  let row = 0;
  for (let y = 0; y < sz; y += ch, row++) {
    let x = -Math.round(rnd(row, 0) * 60);
    let col = 0;
    while (x < sz + 80) {
      const w = 60 + Math.round(rnd(row, col) * 90); // varied stone lengths
      const t = rnd(row, col + 7);
      const g0 = 122 + Math.round(t * 52);
      ctx.fillStyle = `rgb(${g0 + 8},${g0 + 4},${g0 - 6})`;
      ctx.fillRect(x + 3, y + 3, w - 6, ch - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 3, y + 3, w - 6, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.24)';
      ctx.fillRect(x + 3, y + ch - 5, w - 6, 2);
      x += w; col++;
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Troweled stucco — no courses at all, which is exactly what distinguishes it
// from every lap and masonry material.
function makeStuccoTexture() {
  const sz = 512;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#cfc7b8'; ctx.fillRect(0, 0, sz, sz);
  // Deterministic speckle; no Math.random so the texture is stable across
  // re-renders and screenshot comparisons.
  for (let i = 0; i < 9000; i++) {
    const a = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const b = Math.abs((Math.sin(i * 78.233) * 12345.6789) % 1);
    const c = Math.abs((Math.sin(i * 39.425) * 9876.54321) % 1);
    ctx.fillStyle = c > 0.5
      ? `rgba(255,255,255,${0.05 + c * 0.10})`
      : `rgba(0,0,0,${0.03 + c * 0.07})`;
    ctx.fillRect(a * sz, b * sz, 1 + c * 2, 1 + c * 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Resolve an analyzer material string to a renderable texture.
 *
 * Wall UVs are in FEET, and `repeat` converts feet → texture tiles, so `repeat`
 * alone carries the scale here — never bake it into the UVs as well or the
 * courses come out doubled.
 *
 * @returns {{make: () => THREE.Texture, repeat: number, color: number}}
 *   `repeat` is 1/(feet per tile). `color` multiplies the map, so masonry uses
 *   white to let the texture's own colour through.
 */
const MATERIAL_RENDER = {
  brick:  { make: makeBrickTexture,  repeat: 1 / 4, color: 0xffffff },
  stone:  { make: makeStoneTexture,  repeat: 1 / 6, color: 0xffffff },
  stucco: { make: makeStuccoTexture, repeat: 1 / 4, color: 0xffffff },
  vertical_siding: { make: makeVerticalSidingTexture, repeat: 1 / 8, color: C.wall },
};
// Everything else is a lap/plank product and keeps the existing siding look.
const LAP_RENDER = { make: makeSidingTexture, repeat: 1 / 8, color: C.wall };

export function materialRender(name) {
  const key = String(name || '').toLowerCase().trim();
  if (MATERIAL_RENDER[key]) return MATERIAL_RENDER[key];
  // Masonry veneers and common synonyms map onto the masonry textures.
  if (key.includes('brick')) return MATERIAL_RENDER.brick;
  if (key.includes('stone') || key.includes('masonry')) return MATERIAL_RENDER.stone;
  if (key.includes('stucco') || key.includes('eifs')) return MATERIAL_RENDER.stucco;
  if (key.includes('vertical') || key.includes('board_batten') || key.includes('board-batten')) {
    return MATERIAL_RENDER.vertical_siding;
  }
  return LAP_RENDER;
}

/**
 * Map each footprint edge to a cladding material using the SAME azimuth
 * matching that assigns openings to edges, so a wall's material and its windows
 * can never land on different faces.
 */
export function assignMaterialsToEdges(pts, faceMaterials, fallback = null) {
  const n = pts.length;
  const edgeAz = polyEdgeNormals(pts).map(normalToAzimuth);
  const faces = Object.keys(faceMaterials || {});
  return Array.from({ length: n }, (_, i) => {
    let bestFace = null, bestDiff = 360;
    for (const face of faces) {
      const d = azDiff(edgeAz[i], zoneToAzimuth(face));
      if (d < bestDiff) { bestDiff = d; bestFace = face; }
    }
    // Beyond 45° the edge belongs to a different elevation than any face we
    // measured; fall back rather than smearing brick onto an unmeasured wall.
    return bestFace && bestDiff <= 45 ? faceMaterials[bestFace] : fallback;
  });
}

// ─── Shingle canvas texture (staggered courses) ───────────────────────────────
// Default is near-black charcoal — matching real architectural asphalt shingles.
// Pass a lighter base string to render lighter-color roofs (e.g. tan, grey).
function makeShingleTexture(base = '#26231e') {
  // 512 / 32 = 16 whole courses and 512 / 64 = 8 whole tabs, so the pattern
  // tiles seamlessly and the odd/even stagger survives the repeat boundary.
  const sz = 512, ch = 32, tw = 64;
  const cv = document.createElement('canvas');
  cv.width = sz; cv.height = sz;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, sz, sz);
  // Deterministic per-tab jitter — architectural shingles are blended from
  // several granule tones, and a perfectly uniform field is what made the roof
  // read as painted cardboard.
  const tabTone = (r, c) => (Math.sin(r * 12.9898 + c * 78.233) * 43758.5453) % 1;
  let row = 0;
  for (let y = 0; y < sz; y += ch, row++) {
    // Course gradient: slight highlight at butt edge, shadow at top
    const g = ctx.createLinearGradient(0, y, 0, y + ch);
    g.addColorStop(0,   'rgba(255,255,255,0.13)');  // butt highlight
    g.addColorStop(0.5, 'rgba(0,0,0,0.02)');
    g.addColorStop(1,   'rgba(0,0,0,0.38)');        // shadow under next course
    ctx.fillStyle = g; ctx.fillRect(0, y, sz, ch);
    // Per-tab tonal variation
    const off = (row % 2) * (tw / 2);
    let col = 0;
    for (let x = -tw; x < sz + tw; x += tw, col++) {
      const n = tabTone(row, col);
      const a = Math.min(0.16, Math.abs(n) * 0.16);
      ctx.fillStyle = n > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(x + off, y, tw, ch - 1);
    }
    // Tab cut lines (staggered per row)
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    for (let x = -tw; x < sz + tw; x += tw) ctx.fillRect(x + off, y + 3, 2, ch - 3);
    // Course shadow line
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(0, y + ch - 2, sz, 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Edge highlight colors — match the 2D measurement legend
const EDGE_COLORS = {
  ridge:  0x8b5cf6, // purple
  hip:    0x3b82f6, // blue
  valley: 0x22c55e, // green
  rake:   0xf97316, // orange
  eave:   0xef4444, // red
};

function isFiniteGeometryNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// ─── Canonical facet roof (classified geometry from roofFacetGeometry.js) ─────
//
// `roofFacets` come from the measurement handler: local-feet polygons with
// per-corner heights above the wall plate and classified edges
// (eave/ridge/hip/valley/rake + junction diagonals). Renders true facet
// planes with shingle texture, color-coded edge lines + LF labels, and
// closes gable walls beneath sloped exterior rake edges.
function isRenderableRoofFacet(facet) {
  return Boolean(
    facet
    && typeof facet === 'object'
    && Array.isArray(facet.polygon)
    && facet.polygon.length >= 3
    && Array.isArray(facet.edges)
    && facet.edges.every(edge => edge && typeof edge === 'object')
    && facet.polygon.every(point =>
      point
      && typeof point === 'object'
      && isFiniteGeometryNumber(point.x)
      && isFiniteGeometryNumber(point.y)
    )
  );
}

function finiteHeight(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function isRenderableRoofEdge(edge) {
  return Boolean(
    edge
    && typeof edge === 'object'
    && isFiniteGeometryNumber(edge.x1)
    && isFiniteGeometryNumber(edge.y1)
    && isFiniteGeometryNumber(edge.x2)
    && isFiniteGeometryNumber(edge.y2)
  );
}

function buildFacetRoof(roofFacets, wallH, targetCx, targetCz, scene, toDispose) {
  const facets = Array.isArray(roofFacets) ? roofFacets.filter(isRenderableRoofFacet) : [];
  if (facets.length === 0) return null;

  // Recenter facet cloud onto the wall footprint center.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const vertices = facets.flatMap(f => f.polygon);
  if (vertices.length === 0) return null;
  for (const p of vertices) {
    const wx = Number(p.x), wz = -Number(p.y);
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
  }
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return null;
  const offX = targetCx - (minX + maxX) / 2;
  const offZ = targetCz - (minZ + maxZ) / 2;
  const toWorld = (p) => [Number(p.x) + offX, wallH + finiteHeight(p.h), -Number(p.y) + offZ];

  const labelTargets = [];
  const facetMeshes = [];
  const metrics = {
    facetCount: facets.length,
    roofSurfaceAreaSqft: 0,
    eaveLf: 0,
    ridgeLf: 0,
  };
  const texShingle = makeShingleTexture(); toDispose.push(texShingle);

  for (const f of facets) {
    const pts = f.polygon.map(toWorld);
    // Fan triangulation (polygons are convex quads/rects)
    const tris = [];
    for (let i = 1; i < pts.length - 1; i++) tris.push(pts[0], pts[i], pts[i + 1]);
    const flat = new Float32Array(tris.flat());
    metrics.roofSurfaceAreaSqft += positionArraySurfaceArea(flat);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(flat, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(computePlanarUVs(flat), 2));
    geom.computeVertexNormals();
    const t = texShingle.clone(); t.needsUpdate = true;
    const mat = shingleMat(t);
    toDispose.push(geom, mat, t);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = {
      pitchDeg: Number(f.pitch_degrees) || 0,
      azimuthDeg: Number(f.azimuth_degrees) || 0,
      areaSqft: Number(f.area_sqft) || 0,
    };
    scene.add(mesh);
    facetMeshes.push(mesh);

    // Facet pitch label at centroid — only for facets big enough to read at a
    // glance; small facets get hover tooltips instead of a permanent chip.
    if ((f.area_sqft || 0) >= 90) {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const cz = pts.reduce((a, p) => a + p[2], 0) / pts.length;
      labelTargets.push({ worldPos: [cx, cy + 0.4, cz], text: `${f.pitch || ''} · ${Math.round(f.area_sqft || 0)} ft²`, priority: 2 });
    }
  }

  // ── Edge highlight lines + LF labels + gable in-fill ──────────────────────
  const drawnShared = new Set();
  const texGable = makeSidingTexture(); toDispose.push(texGable);
  let drewGableFills = 0; // track whether any elevated open-edge fills were rendered

  for (const f of facets) {
    for (const e of (Array.isArray(f.edges) ? f.edges : []).filter(isRenderableRoofEdge)) {
      if (!e.type || e.type === 'none') continue;
      // Draw each shared edge once
      if (e.shared_with) {
        const key = [f.id, e.shared_with].sort().join('|') + '|' + e.type + '|' + Math.round((e.x1 + e.x2) / 2) + ',' + Math.round((e.y1 + e.y2) / 2);
        if (drawnShared.has(key)) continue;
        drawnShared.add(key);
      }
      if (e.type === 'eave' || e.type === 'ridge') {
        const edgeLength = Number(e.length_ft) || Math.hypot(Number(e.x2) - Number(e.x1), Number(e.y2) - Number(e.y1));
        metrics[e.type === 'eave' ? 'eaveLf' : 'ridgeLf'] += edgeLength;
      }
      const a = toWorld({ x: e.x1, y: e.y1, h: e.h1 });
      const b = toWorld({ x: e.x2, y: e.y2, h: e.h2 });
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (len < 0.5) continue;
      const color = EDGE_COLORS[e.type] || C.edge;
      const thick = e.type === 'eave' ? 0.08 : 0.12;
      const eg = new THREE.BoxGeometry(thick, thick, len);
      const em = stdMat({ color, shininess: 30 });
      const eMesh = new THREE.Mesh(eg, em);
      eMesh.userData.measurementOverlay = true;
      eMesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.10, (a[2] + b[2]) / 2);
      eMesh.lookAt(new THREE.Vector3(b[0], b[1] + 0.10, b[2]));
      scene.add(eMesh); toDispose.push(eg, em);

      // LF labels for structural edges (long enough to matter, decluttered on screen)
      if ((e.type === 'ridge' || e.type === 'hip' || e.type === 'valley') && (e.length_ft || len) >= 6) {
        labelTargets.push({
          worldPos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1.3, (a[2] + b[2]) / 2],
          text: `${e.type.toUpperCase()} ${Math.round(e.length_ft || len)} LF`,
          priority: 1,
        });
      }

      // Close gable walls beneath sloped, unshared exterior edges only. A level
      // unmatched ridge is not a wall boundary; filling beneath it creates a
      // vertical sheet through complex multi-ridge roofs.
      const openHigh = shouldFillGableEdge(e, f.elevation_offset_ft);
      if (openHigh) {
        const localPlateY = wallH + finiteHeight(f.elevation_offset_ft);
        const verts = new Float32Array([
          a[0], a[1], a[2],  b[0], b[1], b[2],  b[0], localPlateY, b[2],
          a[0], a[1], a[2],  b[0], localPlateY, b[2],  a[0], localPlateY, a[2],
        ]);
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        gg.computeVertexNormals();
        const gt = texGable.clone(); gt.needsUpdate = true;
        gt.repeat.set(len / 8, Math.max(
          finiteHeight(e.h1) - finiteHeight(f.elevation_offset_ft),
          finiteHeight(e.h2) - finiteHeight(f.elevation_offset_ft),
        ) / 8);
        const gm = stdMat({ color: C.wall, map: gt, shininess: 6, side: THREE.DoubleSide });
        const gMesh = new THREE.Mesh(gg, gm);
        gMesh.castShadow = true; scene.add(gMesh); toDispose.push(gg, gm, gt);
        drewGableFills++;
      }
    }
  }

  // ── Guaranteed bounding-box gable fills ──────────────────────────────────
  // When edge-based fills produced nothing (classified facets that only carry
  // ridge + eave types with no rake annotation), build gable triangles from
  // the facet-cloud bounding-box extremes.  Handles the common "2-facet gable
  // from Solar API" case that produces open triangular holes at each end.
  if (drewGableFills === 0) {
    // Max height above wall plate across all polygon vertices
    let maxH = 0;
    for (const p of vertices) maxH = Math.max(maxH, finiteHeight(p.h));

    if (maxH > 0.3) {
      // Bounding box of all polygon vertices in world space
      let wMinX = Infinity, wMaxX = -Infinity, wMinZ = Infinity, wMaxZ = -Infinity;
      for (const p of vertices) {
        const [wx,,wz] = toWorld(p);
        if (wx < wMinX) wMinX = wx; if (wx > wMaxX) wMaxX = wx;
        if (wz < wMinZ) wMinZ = wz; if (wz > wMaxZ) wMaxZ = wz;
      }
      if (![wMinX, wMaxX, wMinZ, wMaxZ].every(Number.isFinite)) return null;

      // Apex: Z-centroid of all ridge-height vertices, at ridgeY
      const ridgeY = wallH + maxH;
      let apexZSum = 0, apexN = 0;
      for (const p of vertices) {
        if (Math.abs(finiteHeight(p.h) - maxH) < 0.5) {
          apexZSum += toWorld(p)[2]; apexN++;
        }
      }
      // Do not divide an empty ridge candidate set. Incomplete Solar polygons
      // may have no vertex close enough to the computed maximum height.
      const apexZ = apexN > 0 && Number.isFinite(apexZSum)
        ? apexZSum / apexN
        : (wMinZ + wMaxZ) / 2;

      const texGF = makeSidingTexture(); toDispose.push(texGF);
      const mGF = stdMat({ color: C.wall, map: texGF, shininess: 6, side: THREE.DoubleSide });
      toDispose.push(mGF);

      // West gable (at wMinX) — wind CCW from outside
      const westV = new Float32Array([
        wMinX, wallH, wMinZ,   wMinX, ridgeY, apexZ,   wMinX, wallH, wMaxZ,
      ]);
      const eastV = new Float32Array([
        wMaxX, wallH, wMinZ,   wMaxX, wallH, wMaxZ,   wMaxX, ridgeY, apexZ,
      ]);
      for (const verts of [westV, eastV]) {
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        gg.computeVertexNormals();
        const gMesh = new THREE.Mesh(gg, mGF);
        gMesh.castShadow = true; scene.add(gMesh); toDispose.push(gg);
      }
    }
  }

  return { labelTargets, facetMeshes, metrics };
}

// ─── Generic fallback roof (hip or gable, 4 faces) ────────────────────────────
function buildRoofFaces(L, W, wallH, rise, overhang, isHip) {
  const hw = W / 2 + overhang;
  const hl = L / 2 + overhang;
  const peakY = wallH + rise;
  const ridgeHL = isHip ? Math.max(0, hl - hw) : 0;

  const makeFace = (tris) => {
    const flat = [];
    tris.forEach(tri => tri.forEach(v => flat.push(...v)));
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flat), 3));
    geom.computeVertexNormals();
    const n = flat.length / 3;
    const cx = flat.filter((_,i)=>i%3===0).reduce((a,b)=>a+b,0)/n;
    const cy = flat.filter((_,i)=>i%3===1).reduce((a,b)=>a+b,0)/n;
    const cz = flat.filter((_,i)=>i%3===2).reduce((a,b)=>a+b,0)/n;
    return { geom, center: [cx,cy,cz] };
  };

  const faces = [];
  if (isHip && ridgeHL > 0.01) {
    const {geom:sg,center:sc} = makeFace([
      [[-hl,wallH,-hw],[hl,wallH,-hw],[ridgeHL,peakY,0]],
      [[-hl,wallH,-hw],[ridgeHL,peakY,0],[-ridgeHL,peakY,0]],
    ]);
    faces.push({dir:'south',geom:sg,center:sc,color:FACE_COLORS.south});
    const {geom:ng,center:nc} = makeFace([
      [[-hl,wallH,hw],[-ridgeHL,peakY,0],[ridgeHL,peakY,0]],
      [[-hl,wallH,hw],[ridgeHL,peakY,0],[hl,wallH,hw]],
    ]);
    faces.push({dir:'north',geom:ng,center:nc,color:FACE_COLORS.north});
    const {geom:wg,center:wc} = makeFace([[[-hl,wallH,-hw],[-ridgeHL,peakY,0],[-hl,wallH,hw]]]);
    faces.push({dir:'west',geom:wg,center:wc,color:FACE_COLORS.west});
    const {geom:eg,center:ec} = makeFace([[[hl,wallH,-hw],[hl,wallH,hw],[ridgeHL,peakY,0]]]);
    faces.push({dir:'east',geom:eg,center:ec,color:FACE_COLORS.east});
  } else if (isHip) {
    const {geom:sg,center:sc} = makeFace([[[-hl,wallH,-hw],[hl,wallH,-hw],[0,peakY,0]]]);
    faces.push({dir:'south',geom:sg,center:sc,color:FACE_COLORS.south});
    const {geom:ng,center:nc} = makeFace([[[-hl,wallH,hw],[0,peakY,0],[hl,wallH,hw]]]);
    faces.push({dir:'north',geom:ng,center:nc,color:FACE_COLORS.north});
    const {geom:wg,center:wc} = makeFace([[[-hl,wallH,-hw],[-hl,wallH,hw],[0,peakY,0]]]);
    faces.push({dir:'west',geom:wg,center:wc,color:FACE_COLORS.west});
    const {geom:eg,center:ec} = makeFace([[[hl,wallH,-hw],[0,peakY,0],[hl,wallH,hw]]]);
    faces.push({dir:'east',geom:eg,center:ec,color:FACE_COLORS.east});
  } else {
    const {geom:sg,center:sc} = makeFace([
      [[-hl,wallH,-hw],[hl,wallH,-hw],[hl,wallH+rise,0]],
      [[-hl,wallH,-hw],[hl,wallH+rise,0],[-hl,wallH+rise,0]],
    ]);
    faces.push({dir:'south',geom:sg,center:sc,color:FACE_COLORS.south});
    const {geom:ng,center:nc} = makeFace([
      [[-hl,wallH,hw],[-hl,wallH+rise,0],[hl,wallH+rise,0]],
      [[-hl,wallH,hw],[hl,wallH+rise,0],[hl,wallH,hw]],
    ]);
    faces.push({dir:'north',geom:ng,center:nc,color:FACE_COLORS.north});
  }
  return faces;
}

// ─── Procedural multi-facet roof from Solar API roofSegmentStats ──────────────
//
// Each segment in `roofSegments` (Solar API solarPotential.roofSegmentStats) has:
//   pitchDegrees, azimuthDegrees,
//   center: { latitude, longitude },
//   boundingBox: { ne: {latitude, longitude}, sw: {latitude, longitude} },
//   stats: { areaMeters2, groundAreaMeters2 }
//
// We render each segment as a planar quad:
//   - Oriented so its down-slope direction faces `azimuth`
//   - Tilted at `pitchDegrees` above the horizontal
//   - Sized from its bounding box extents, decomposed into rafter-run × ridge-len
//   - Positioned from segment center relative to average centroid of all segments
//
// Returns array of { worldPos, text } label targets (same shape as buildRoofFaces).
function buildSegmentRoof(roofSegments, wallH, overhang, scene, toDispose) {
  const valid = (roofSegments || []).filter(
    s => s.center?.latitude && s.center?.longitude && s.boundingBox
  );
  if (valid.length === 0) return null;

  // ── Reference centroid: average of all segment centers ──────────────────────
  const refLat = valid.reduce((s, seg) => s + seg.center.latitude,  0) / valid.length;
  const refLng = valid.reduce((s, seg) => s + seg.center.longitude, 0) / valid.length;
  const cosRef = Math.cos(refLat * Math.PI / 180);

  // Convert absolute lat/lng → local feet XZ (X=east, Z=south, origin=centroid)
  const toXZ = (lat, lng) => [
    (lng - refLng) * 364320 * cosRef,   // east offset in ft  → Three.js X
    -((lat - refLat) * 364320),          // north offset in ft → Three.js Z (negated)
  ];

  const labelTargets = [];
  const facetMeshes  = [];
  const metrics = {
    facetCount: valid.length,
    roofSurfaceAreaSqft: 0,
    eaveLf: 0,
    ridgeLf: 0,
  };
  const texShingle = makeShingleTexture();
  toDispose.push(texShingle);

  for (const seg of valid) {
    const pitchDeg   = Math.max(0, seg.pitchDegrees   ?? 20);
    const azimuthDeg = ((seg.azimuthDegrees ?? 180) % 360 + 360) % 360;
    const pitchRad   = pitchDeg   * Math.PI / 180;
    const azimuthRad = azimuthDeg * Math.PI / 180;

    // ── Segment centre in world XZ ───────────────────────────────────────────
    const [cx, cz] = toXZ(seg.center.latitude, seg.center.longitude);

    // ── Bounding-box extents → rafter-run × ridge-length ─────────────────────
    const bb = seg.boundingBox;
    const latSpanFt = Math.abs(bb.ne.latitude  - bb.sw.latitude)  * 364320;
    const lngSpanFt = Math.abs(bb.ne.longitude - bb.sw.longitude)  * 364320 * cosRef;

    // The rafter runs along the slope direction (azimuth); the ridge runs perpendicular.
    // We decompose by projecting the bbox axes onto the slope direction:
    //   slope dir unit = (sin az, 0, -cos az)  in XZ
    //   lat axis  unit = (0,  0, -1)  (north = -Z)
    //   lng axis  unit = (1,  0,  0)  (east  = +X)
    const sinAz = Math.abs(Math.sin(azimuthRad));
    const cosAz = Math.abs(Math.cos(azimuthRad));
    // Ground projection of the rafter run (weighted mix of bbox axes)
    const rafterGround = Math.max(3, latSpanFt * cosAz + lngSpanFt * sinAz);
    // Ridge length (perpendicular to slope)
    const ridgeLen     = Math.max(3, latSpanFt * sinAz + lngSpanFt * cosAz);

    // ── Eave height for this segment (flat roof = wallH, sloped = wallH - rise/2) ─
    // All segments share the same wall plate height; the rise is computed from pitch.
    const rise = rafterGround * Math.tan(pitchRad);

    // ── Direction vectors ────────────────────────────────────────────────────
    // down-slope direction in XZ plane (points toward the eave / away from ridge)
    const downX =  Math.sin(azimuthRad);
    const downZ = -Math.cos(azimuthRad);
    // along-ridge direction (perpendicular to down-slope)
    const ridgeX =  Math.cos(azimuthRad);
    const ridgeZ =  Math.sin(azimuthRad);

    // ── Four corners of the segment quad ─────────────────────────────────────
    // The segment's downhill edge (eave) is at wallH; uphill edge (ridge/hip) at wallH + rise.
    // Centre of eave edge: cx + downX * (rafterGround/2), cz + downZ * (rafterGround/2)
    // Centre of ridge edge: cx - downX * (rafterGround/2), cz - downZ * (rafterGround/2)
    const halfD = rafterGround / 2;
    const halfR = ridgeLen     / 2;

    const eaveX = cx + downX * halfD,  eaveZ = cz + downZ * halfD;
    const rideX = cx - downX * halfD,  rideZ = cz - downZ * halfD;

    // Eave corners (Y = wallH; include overhang offset outward)
    const ov = overhang;
    const el0x = eaveX - ridgeX * halfR - downX * ov,  el0z = eaveZ - ridgeZ * halfR - downZ * ov;
    const el1x = eaveX + ridgeX * halfR - downX * ov,  el1z = eaveZ + ridgeZ * halfR - downZ * ov;
    // Ridge/hip corners (Y = wallH + rise)
    const rl0x = rideX - ridgeX * halfR,  rl0z = rideZ - ridgeZ * halfR;
    const rl1x = rideX + ridgeX * halfR,  rl1z = rideZ + ridgeZ * halfR;
    const eaveY  = wallH;
    const ridgeY = wallH + rise;

    const verts = new Float32Array([
      // tri 1
      el0x, eaveY,  el0z,
      el1x, eaveY,  el1z,
      rl1x, ridgeY, rl1z,
      // tri 2
      el0x, eaveY,  el0z,
      rl1x, ridgeY, rl1z,
      rl0x, ridgeY, rl0z,
    ]);
    metrics.roofSurfaceAreaSqft += positionArraySurfaceArea(verts);
    metrics.eaveLf += Math.hypot(el1x - el0x, el1z - el0z);
    metrics.ridgeLf += Math.hypot(rl1x - rl0x, rl1z - rl0z);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(computePlanarUVs(verts), 2));
    geom.computeVertexNormals();

    // Shade: S-facing (~180°) lightest, N-facing (~0°/360°) darkest
    const shade = 0.42 + 0.22 * Math.cos((azimuthDeg - 180) * Math.PI / 180);
    const texture = texShingle.clone();
    texture.needsUpdate = true;
    const mat = stdMat({
      color: new THREE.Color().setHSL(0.07, 0.09, shade),
      map: texture,
      shininess: 20,
      roughness: 0.92,
      bumpMap: texture,
      bumpScale: 0.07,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = {
      isRoofFacet: true,
      pitchDeg,
      azimuthDeg,
      areaSqft: (seg.stats?.areaMeters2 || 0) * 10.7639,
    };
    scene.add(mesh);
    facetMeshes.push(mesh);
    toDispose.push(mat, geom, texture);

    // Label at segment centre (only large facets — hover covers the rest)
    if ((seg.stats?.areaMeters2 || 0) * 10.7639 >= 90) {
      labelTargets.push({
        worldPos: [cx, eaveY + rise * 0.55, cz],
        text: `${pitchDeg.toFixed(0)}° · ${azimuthDeg.toFixed(0)}°`,
        priority: 2,
      });
    }
  }

  return { labelTargets, facetMeshes, metrics };
}

function buildOutlineRoof(polyXZ, roofSegments, wallH, slope, overhang, facetCount, scene, toDispose) {
  const hints = roofHintsFromSolarSegments(roofSegments, slope);
  const surface = buildFootprintRoofSurface(polyXZ, wallH, hints.slope, {
    orientationDeg: hints.orientationDeg,
    overhangFt: overhang,
  });
  if (!surface) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(surface.vertices, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(computePlanarUVs(surface.vertices), 2));
  geom.computeVertexNormals();
  const texture = makeShingleTexture();
  const material = shingleMat(texture);
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { isRoofFacet: true, geometrySource: surface.source };
  scene.add(mesh);
  toDispose.push(geom, material, texture);
  const fasciaMaterial = phongMat(C.trim);
  toDispose.push(fasciaMaterial);
  for (let i = 0; i < surface.eavePolygon.length; i++) {
    const a = surface.eavePolygon[i];
    const b = surface.eavePolygon[(i + 1) % surface.eavePolygon.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.2) continue;
    const fasciaGeom = new THREE.BoxGeometry(length, 0.5, 0.22);
    const fascia = new THREE.Mesh(fasciaGeom, fasciaMaterial);
    fascia.position.set((a[0] + b[0]) / 2, wallH - 0.24, (a[1] + b[1]) / 2);
    fascia.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    fascia.castShadow = true;
    scene.add(fascia);
    toDispose.push(fasciaGeom);
  }
  return {
    labelTargets: [{
      worldPos: [surface.bounds.cx, surface.maxY + 0.7, surface.bounds.cz],
      text: `${Math.round(Math.atan(hints.slope) * 180 / Math.PI)}° · OUTLINE`,
      priority: 2,
    }],
    facetMeshes: [mesh],
    metrics: {
      facetCount,
      roofSurfaceAreaSqft: positionArraySurfaceArea(surface.vertices),
      eaveLf: 0,
      ridgeLf: 0,
    },
  };
}

// Physical-photo roof planes do not contain survey-grade world coordinates.
// Render each calibrated elevation plane against the mapped footprint dimensions,
// preserving its measured width, slope length, pitch, and direction. This is
// intentionally a measurement visualization, not a claim of photogrammetric mesh.
function buildPhotoRoof(photoPlanes, L, W, wallH, scene, toDispose) {
  const valid = (photoPlanes || []).filter(p =>
    Number(p.width_ft) >= 3 && Number(p.slope_length_ft) >= 3 && Number(p.area_sqft) >= 20
  );
  if (valid.length === 0) return null;

  const labelTargets = [];
  const facetMeshes = [];
  const texShingle = makeShingleTexture();
  toDispose.push(texShingle);
  const metrics = {
    facetCount: 0,
    roofSurfaceAreaSqft: 0,
    eaveLf: 0,
    ridgeLf: 0,
  };
  for (const plane of valid) {
    const face = String(plane.face || 'unknown').toLowerCase();
    if (face === 'unknown') continue;
    const pitchMatch = String(plane.pitch || '6/12').match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
    const slope = pitchMatch ? Number(pitchMatch[1]) / Number(pitchMatch[2]) : 0.5;
    const pitchRad = Math.atan(slope);
    const measuredWidth = Math.max(3, Number(plane.width_ft));
    const slopeLength = Math.max(3, Number(plane.slope_length_ft));
    const groundRun = slopeLength * Math.cos(pitchRad);
    const rise = slopeLength * Math.sin(pitchRad);
    const alongX = face === 'front' || face === 'back';
    const span = Math.min(measuredWidth, alongX ? L + 3 : W + 3);
    const sign = face === 'front' || face === 'left_side' ? -1 : 1;
    const eaveCoord = sign * ((alongX ? W : L) / 2 + 0.8);
    const ridgeCoord = eaveCoord - sign * groundRun;
    const half = span / 2;
    const vertices = alongX
      ? [
          [-half, wallH, eaveCoord], [half, wallH, eaveCoord],
          [half, wallH + rise, ridgeCoord], [-half, wallH + rise, ridgeCoord],
        ]
      : [
          [eaveCoord, wallH, -half], [eaveCoord, wallH, half],
          [ridgeCoord, wallH + rise, half], [ridgeCoord, wallH + rise, -half],
        ];
    const geometry = new THREE.BufferGeometry();
    // Keep the roof mesh non-indexed like every other builder so surface-area
    // calibration can inspect the exact rendered triangle list.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      ...vertices[0], ...vertices[1], ...vertices[2],
      ...vertices[0], ...vertices[2], ...vertices[3],
    ], 3));
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        computePlanarUVs(geometry.attributes.position.array),
        2,
      ),
    );
    geometry.computeVertexNormals();
    const surfaceAreaSqft = (
      Math.hypot(vertices[1][0] - vertices[0][0], vertices[1][1] - vertices[0][1], vertices[1][2] - vertices[0][2])
      * Math.hypot(vertices[3][0] - vertices[0][0], vertices[3][1] - vertices[0][1], vertices[3][2] - vertices[0][2])
    );
    const roofTexture = texShingle.clone();
    roofTexture.needsUpdate = true;
    const material = stdMat({
      color: FACE_COLORS[face === 'left_side' ? 'west' : face === 'right_side' ? 'east' : face === 'back' ? 'north' : 'south'],
      map: roofTexture,
      shininess: 18,
      roughness: 0.92,
      bumpMap: roofTexture,
      bumpScale: 0.07,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: plane.occluded ? 0.62 : 0.92,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    facetMeshes.push(mesh);
    metrics.facetCount++;
    metrics.roofSurfaceAreaSqft += surfaceAreaSqft;
    metrics.eaveLf += lineLength(vertices[0], vertices[1]);
    metrics.ridgeLf += lineLength(vertices[2], vertices[3]);
    toDispose.push(geometry, material, roofTexture);
    const center = vertices.reduce((acc, point) => acc.map((v, i) => v + point[i] / 4), [0, 0, 0]);
    labelTargets.push({
      worldPos: center,
      text: `${face.replace('_side', '')} · ${plane.pitch || 'pitch ?'} · ${Math.round(Number(plane.area_sqft))} ft²`,
      priority: 2,
    });
  }
  return labelTargets.length ? { labelTargets, facetMeshes, metrics } : null;
}

function fitRenderedRoofMeshesToArea(facetMeshes, wallHeightFt, targetAreaSqft) {
  const positionAttributes = facetMeshes
    .map(mesh => mesh.geometry?.getAttribute?.('position'))
    .filter(Boolean);
  const fit = fitRoofSurfaceArraysToArea({
    surfaceArrays: positionAttributes.map(attribute => attribute.array),
    wallHeightFt,
    targetAreaSqft,
  });
  if (!fit.applied) return fit;

  positionAttributes.forEach((attribute, index) => {
    attribute.array.set(fit.surfaceArrays[index]);
    attribute.needsUpdate = true;
  });
  facetMeshes.forEach(mesh => mesh.geometry?.computeVertexNormals?.());
  return fit;
}

const graphEdgeTotal = (graph, type) => (graph?.edges || []).reduce(
  (sum, edge) => sum + (edge?.type === type ? Number(edge.length_ft) || 0 : 0),
  0
);

// ─── Orbit controls ───────────────────────────────────────────────────────────
function attachOrbitControls(domEl, camera, target) {
  const isOrthographic = camera.isOrthographicCamera === true;
  let theta = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
  let phi   = Math.acos(Math.max(-1, Math.min(1,
    (camera.position.y - target.y) / camera.position.distanceTo(target))));
  let radius = camera.position.distanceTo(target);
  const MIN_PHI = isOrthographic ? 0.001 : 0.08, MAX_PHI = Math.PI * 0.45, MIN_R = 8, MAX_R = 260;

  let dragging = false, lastX = 0, lastY = 0;
  const sync = () => {
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(target);
  };

  const onDown  = e => { dragging=true; lastX=e.clientX; lastY=e.clientY; };
  const onUp    = ()  => { dragging=false; };
  const onMove  = e  => {
    if(!dragging)return;
    theta -= (e.clientX-lastX)*0.007;
    phi = Math.max(MIN_PHI,Math.min(MAX_PHI,phi+(e.clientY-lastY)*0.007));
    lastX=e.clientX; lastY=e.clientY; sync();
  };
  const onWheel = e => {
    e.preventDefault();
    if (isOrthographic) {
      camera.zoom = Math.max(0.45, Math.min(5, camera.zoom * (1 - e.deltaY * 0.001)));
      camera.updateProjectionMatrix();
    } else {
      radius=Math.max(MIN_R,Math.min(MAX_R,radius*(1+e.deltaY*0.001))); sync();
    }
  };
  let lastDist=0;
  const onTS=e=>{ if(e.touches.length===1){dragging=true;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;} if(e.touches.length===2)lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY); };
  const onTE=()=>{dragging=false;};
  const onTM=e=>{
    if(e.touches.length===1&&dragging){theta-=(e.touches[0].clientX-lastX)*0.007;phi=Math.max(MIN_PHI,Math.min(MAX_PHI,phi+(e.touches[0].clientY-lastY)*0.007));lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;sync();}
    if(e.touches.length===2){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      if (d > 0) {
        if (isOrthographic) {
          camera.zoom = Math.max(0.45, Math.min(5, camera.zoom * (d / Math.max(1, lastDist))));
          camera.updateProjectionMatrix();
        } else {
          radius=Math.max(MIN_R,Math.min(MAX_R,radius*(lastDist/d))); sync();
        }
      }
      lastDist=d;
    }
  };
  sync();
  domEl.addEventListener('pointerdown',onDown); domEl.addEventListener('pointerup',onUp);
  domEl.addEventListener('pointermove',onMove); domEl.addEventListener('pointercancel',onUp);
  domEl.addEventListener('wheel',onWheel,{passive:false});
  domEl.addEventListener('touchstart',onTS,{passive:true}); domEl.addEventListener('touchend',onTE);
  domEl.addEventListener('touchmove',onTM,{passive:true});
  return ()=>{
    domEl.removeEventListener('pointerdown',onDown); domEl.removeEventListener('pointerup',onUp);
    domEl.removeEventListener('pointermove',onMove); domEl.removeEventListener('pointercancel',onUp);
    domEl.removeEventListener('wheel',onWheel);
    domEl.removeEventListener('touchstart',onTS); domEl.removeEventListener('touchend',onTE);
    domEl.removeEventListener('touchmove',onTM);
  };
}

// ─── Polygon utilities ────────────────────────────────────────────────────────

// Convert [[east_ft, north_ft]] to world XZ [[x, z]]
// In Three.js: X=east, Z=south (+Z = toward viewer), so north = -Z
function polygonToWorldXZ(poly) {
  if (!Array.isArray(poly)) return null;
  const points = poly
    .map(point => {
      const x = Array.isArray(point) ? point[0] : point?.x;
      const y = Array.isArray(point) ? point[1] : point?.y;
      const east = Number(x);
      const north = Number(y);
      return Number.isFinite(east) && Number.isFinite(north) ? [east, -north] : null;
    })
    .filter(Boolean);
  return points.length >= 3 ? points : null;
}

// Axis-aligned bounding box of world XZ polygon
function polyBBox(pts) {
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const[x,z]of pts){
    if(x<minX)minX=x; if(x>maxX)maxX=x;
    if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
  }
  return {minX,maxX,minZ,maxZ,spanX:maxX-minX,spanZ:maxZ-minZ};
}

// Outward unit normal for each polygon edge (robust to winding order)
function polyEdgeNormals(pts) {
  const n=pts.length;
  const cx=pts.reduce((s,[x])=>s+x,0)/n;
  const cz=pts.reduce((s,[,z])=>s+z,0)/n;
  return pts.map(([ax,az],i)=>{
    const[bx,bz]=pts[(i+1)%n];
    const dx=bx-ax,dz=bz-az,len=Math.sqrt(dx*dx+dz*dz)||1;
    let nx=dz/len,nz=-dx/len;
    const midX=(ax+bx)/2,midZ=(az+bz)/2;
    if(nx*(midX-cx)+nz*(midZ-cz)<0){nx=-nx;nz=-nz;}
    return{nx,nz};
  });
}

// Convert zone name or compass label to azimuth in degrees (0=N, 90=E, 180=S, 270=W)
function zoneToAzimuth(zone) {
  const z = String(zone || '').toLowerCase().trim();
  // Numeric azimuth passed directly
  const num = parseFloat(z);
  if (!isNaN(num) && z.match(/^\d/)) return ((num % 360) + 360) % 360;
  const MAP = {
    north: 0, back: 0, rear: 0,
    northeast: 45, ne: 45,
    east: 90, right: 90, right_side: 90,
    southeast: 135, se: 135,
    south: 180, front: 180,
    southwest: 225, sw: 225,
    west: 270, left: 270, left_side: 270,
    northwest: 315, nw: 315,
  };
  // Partial match (e.g. "front_left" → try "front")
  for (const [k, v] of Object.entries(MAP)) {
    if (z === k || z.startsWith(k)) return v;
  }
  return 180; // default: south/front
}

// Azimuth of an edge's outward normal in degrees (0=N, 90=E, 180=S, 270=W)
// normal = { nx, nz } in Three.js XZ where +X=east, +Z=south
// north=-Z → azimuth=0, east=+X → azimuth=90
function normalToAzimuth(normal) {
  const az = Math.atan2(normal.nx, -normal.nz) * 180 / Math.PI;
  return ((az % 360) + 360) % 360;
}

// Angular difference between two azimuths (result 0..180)
function azDiff(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// Assign openings to polygon edges using compass-azimuth matching.
// Each opening can carry a `zone` (front/back/left_side/right_side),
// `wall_face` (N/S/E/W), or a numeric `azimuth_degrees` field.
// The edge whose outward-normal azimuth is closest to the opening's
// target azimuth wins.
function assignOpeningsToEdges(pts, openings) {
  const normals = polyEdgeNormals(pts);
  const edgeAzimuths = normals.map(normalToAzimuth);
  const n = pts.length;
  const buckets = Array.from({length: n}, () => []);

  for (const o of (openings || [])) {
    // Prefer explicit azimuth_degrees; fall back to wall_face then zone
    const targetAz = o.azimuth_degrees != null
      ? ((o.azimuth_degrees % 360) + 360) % 360
      : zoneToAzimuth(o.wall_face || o.zone || 'front');

    let best = 0, bestDiff = 360;
    for (let i = 0; i < n; i++) {
      const diff = azDiff(edgeAzimuths[i], targetAz);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    buckets[best].push(o);
  }
  return buckets;
}

// Generate synthetic openings from counts when openings_detail not available
function syntheticOpenings(wCount=0, dCount=0, gCount=0) {
  const ops=[];
  const wZones=['front','right_side','back','left_side'];
  for(let i=0;i<wCount;i++) ops.push({type:'window',zone:wZones[i%wZones.length],width_ft:2.8,height_ft:3.4});
  for(let i=0;i<dCount;i++) ops.push({type:'entry_door',zone:'front',width_ft:3,height_ft:6.8});
  for(let i=0;i<gCount;i++) ops.push({type:'garage_door',zone:'front',width_ft:16,height_ft:7});
  return ops;
}

function openingPositionFraction(value, dimensionFt, opening) {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || dimensionFt <= 0) {
    return null;
  }
  const unit = String(
    opening?.position_unit || opening?.position_units || opening?.coordinate_unit || ''
  ).toLowerCase();
  if (unit === 'fraction' || unit === 'normalized' || unit === 'ratio') {
    return Number(value);
  }
  return Number(value) / dimensionFt;
}

// Build a gable-end face in local (across-face, above-wall) coordinates so
// openings can be cut with the same ShapeGeometry hole path used by polygon
// walls. The raw parametric gable is still supplied by MeshGeometryBuilder;
// this helper only owns the Three.js face/cutout construction.
function buildParametricGableFace(
  verts,
  side,
  W,
  wallH,
  rise,
  openings,
  scene,
  toDispose,
  texG,
) {
  const x = verts[0];
  const baseZ = Math.min(verts[2], verts[5], verts[8]);
  const topZ = Math.max(verts[2], verts[5], verts[8]);
  const span = topZ - baseZ;
  if (!Number.isFinite(x) || span <= 0 || rise <= 0) return;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(span, 0);
  shape.lineTo(span / 2, rise);
  shape.closePath();

  const endOpenings = openings || [];
  const usedIntervals = [];

  endOpenings.forEach((opening, index) => {
    const measuredT = openingPositionFraction(opening.pos_x, W, opening);
    const t = measuredT == null
      ? (index + 1) / (endOpenings.length + 1)
      : Math.min(1, Math.max(0, measuredT));
    const openingWidth = Math.min(
      Math.max(Number(opening.width_ft) || 3, 1.5),
      W / (endOpenings.length + 1) * 0.85,
    );
    const openingHeight = Math.min(
      Math.max(Number(opening.height_ft) || 3.5, 1.5),
      Math.max(1.5, rise * 0.7),
    );

    // Gable routing already limits this list to measured openings entirely
    // above the wall plate, so no synthetic/default position is allowed here.
    const measuredYFraction = openingPositionFraction(opening.pos_y, wallH, opening);
    if (measuredYFraction == null) return;
    const desiredY = measuredYFraction * wallH;
    const halfH = openingHeight / 2;
    const margin = 0.15;
    const minV = halfH + margin;
    const maxV = rise - halfH - margin;
    if (maxV <= minV) return;
    const vCenter = Math.min(maxV, Math.max(minV, desiredY - wallH));
    const vTop = vCenter + halfH;

    // At the top of the opening the triangle is narrowest. Shrink and clamp
    // the opening there so ShapeGeometry never receives a hole outside its
    // outer contour (which can otherwise produce malformed triangulation).
    const triangleLeft = (span / 2) * (vTop / rise);
    const triangleRight = span - triangleLeft;
    const maxWidth = triangleRight - triangleLeft - margin * 2;
    const clippedWidth = Math.min(openingWidth, maxWidth);
    if (clippedWidth < 0.5) return;

    // pos_x follows each wall's outside-facing left-to-right direction. The
    // east wall's edge runs in the opposite Z direction from the west wall.
    const centerZ = side === 'west'
      ? -W / 2 + t * W
      : W / 2 - t * W;
    const desiredU = centerZ - baseZ;
    const minU = triangleLeft + margin + clippedWidth / 2;
    const maxU = triangleRight - margin - clippedWidth / 2;
    const centerU = Math.min(maxU, Math.max(minU, desiredU));
    const u0 = centerU - clippedWidth / 2;
    const u1 = centerU + clippedWidth / 2;
    const v0 = vCenter - halfH;
    const v1 = vCenter + halfH;

    // Shape holes must not intersect one another.
    if (usedIntervals.some(([a0, a1]) => u0 < a1 && u1 > a0)) return;
    usedIntervals.push([u0, u1]);

    const hole = new THREE.Path();
    hole.moveTo(u0, v0);
    hole.lineTo(u1, v0);
    hole.lineTo(u1, v1);
    hole.lineTo(u0, v1);
    hole.closePath();
    shape.holes.push(hole);

    // The normal box-wall renderer deliberately excludes these openings, so
    // add their glazed insert at the gable plane instead of leaving a void.
    const outsideOffset = side === 'west' ? -0.14 : 0.14;
    const windowX = x + outsideOffset;
    const windowY = wallH + vCenter;
    const windowZ = baseZ + centerU;
    const frameMaterial = trimMat(C.wframe);
    const glassMaterial = glassMat();
    const frameGeometry = new THREE.BoxGeometry(0.18, openingHeight + 0.24, clippedWidth + 0.28);
    const glassGeometry = new THREE.BoxGeometry(0.24, openingHeight, clippedWidth);
    const mullionGeometry = new THREE.BoxGeometry(0.28, 0.07, clippedWidth);
    const frame = new THREE.Mesh(frameGeometry, frameMaterial);
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    const mullion = new THREE.Mesh(mullionGeometry, frameMaterial);
    frame.position.set(windowX, windowY, windowZ);
    glass.position.set(windowX, windowY, windowZ);
    mullion.position.set(windowX, windowY, windowZ);
    frame.castShadow = true;
    glass.castShadow = true;
    mullion.castShadow = true;
    scene.add(frame, glass, mullion);
    toDispose.push(
      frameMaterial, glassMaterial,
      frameGeometry, glassGeometry, mullionGeometry,
    );
  });

  const geometry = new THREE.ShapeGeometry(shape);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i);
    const v = positions.getY(i);
    positions.setXYZ(i, x, wallH + v, baseZ + u);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const texture = texG.clone();
  texture.needsUpdate = true;
  texture.repeat.set(span / 8, rise / 8);
  const material = stdMat({
    color: C.wall,
    map: texture,
    shininess: 6,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  scene.add(mesh);
  toDispose.push(geometry, material, texture);
}

// ─── Wall builders ────────────────────────────────────────────────────────────

function phongMat(color, opts={}) {
  return stdMat({color, shininess:10, ...opts});
}

// Trim/fascia/corner boards: painted millwork is smoother than siding.
function trimMat(color=C.trim) {
  return stdMat({ color, roughness: 0.55, metalness: 0.03 });
}

/**
 * Planar UVs for a triangle soup lying in (or near) a single plane.
 *
 * The parametric roof faces shipped with a shingle map but no `uv` attribute at
 * all, so every fragment sampled texel (0,0) and the whole roof rendered as one
 * flat slab. Projecting onto the face's own tangent basis (u along the ridge, v
 * up the slope) makes the courses run the way real shingles do — and it is
 * correct for gable, hip and dormer faces alike, unlike a world-axis projection.
 *
 * @param pos    Float32Array of xyz triples
 * @param scale  feet per texture tile
 */
function computePlanarUVs(pos, scale = 8) {
  const count = pos.length / 3;
  const uvs = new Float32Array(count * 2);
  if (count < 3) return uvs;
  const ax = pos[3]-pos[0], ay = pos[4]-pos[1], az = pos[5]-pos[2];
  const bx = pos[6]-pos[0], by = pos[7]-pos[1], bz = pos[8]-pos[2];
  let nx = ay*bz - az*by, ny = az*bx - ax*bz, nz = ax*by - ay*bx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // u = cross(worldUp, n): the horizontal line on the face (ridge direction).
  let ux = nz, uy = 0, uz = -nx;
  const ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-6) { ux = 1; uy = 0; uz = 0; } else { ux /= ul; uz /= ul; }
  // v = cross(n, u): straight up the slope.
  const vx = ny*uz - nz*uy, vy = nz*ux - nx*uz, vz = nx*uy - ny*ux;
  for (let i = 0; i < count; i++) {
    const x = pos[i*3], y = pos[i*3+1], z = pos[i*3+2];
    uvs[i*2]   = (x*ux + y*uy + z*uz) / scale;
    uvs[i*2+1] = (x*vx + y*vy + z*vz) / scale;
  }
  return uvs;
}

// Asphalt shingles. The tint multiplier stays light enough that the course
// pattern survives filmic tonemapping — a darker multiplier crushed the whole
// roof to a single flat black slab.
function shingleMat(tex) {
  return stdMat({
    map: tex, color: 0x9b948b, roughness: 0.92, metalness: 0,
    bumpScale: 0.09, side: THREE.DoubleSide,
  });
}

// Per-edge polygon walls with siding texture, edge outlines, and REAL opening
// cutouts. Geometry is built directly from the edge endpoints (correct by
// construction — no rotation-convention pitfalls): each wall is a ShapeGeometry
// in (u,v) edge space, with window/door holes, remapped onto the 3D edge.
export function buildPolyWalls(polyXZ, wallH, stoneH, scene, toDispose, texSiding, edgeBuckets=null, wallOut=null, edgeMaterials=null, selectedAzimuth=null, edgeAccentMaterials=null, highlightSelected=true) {
  const n=polyXZ.length;
  const wallNorms=wallOut?polyEdgeNormals(polyXZ):null;
  // One canvas texture per distinct material, not per edge — each edge still
  // clones it because clones are what carry the per-wall `repeat`.
  const texCache=new Map();
  const baseTexFor=(rend)=>{
    if(rend===LAP_RENDER)return texSiding;
    if(!texCache.has(rend)){ const bt=rend.make(); texCache.set(rend,bt); toDispose.push(bt); }
    return texCache.get(rend);
  };
  for(let i=0;i<n;i++){
    const[ax,az]=polyXZ[i],[bx,bz]=polyXZ[(i+1)%n];
    const dx=bx-ax,dz=bz-az,len=Math.sqrt(dx*dx+dz*dz);
    if(len<0.5)continue;
    const ux=dx/len,uz=dz/len;
    const upperH=wallH-stoneH;

    // Upper siding shape with opening holes (u: 0..len along edge, v: 0..upperH)
    const shape=new THREE.Shape();
    shape.moveTo(0,0); shape.lineTo(len,0); shape.lineTo(len,upperH); shape.lineTo(0,upperH); shape.closePath();
    const ops=edgeBuckets?(edgeBuckets[i]||[]):[];
    const usedIntervals=[];
    const doorIntervals=[]; // door apertures also pierce the wainscot below
    ops.forEach((o,idx)=>{
      const measuredT=openingPositionFraction(o.pos_x,len,o);
      const t=measuredT==null?(idx+1)/(ops.length+1):Math.min(1,Math.max(0,measuredT));
      const maxW=len/(ops.length+1)*0.85;
      const oW=Math.min(Math.max(o.width_ft||3,1.5),maxW);
      const oH=Math.min(o.height_ft||3.5,wallH*0.9);
      const uc=t*len;
      const isDoor=o.type==='garage_door'||o.type==='door'||o.type==='entry_door'||o.type==='slider_door';
      let v0,v1;
      if(isDoor){
        // Doors run from the FLOOR up: the upper-wall hole starts at its base
        // (v=0) and the wainscot below is cut separately via doorIntervals.
        v0=0.02; v1=Math.max(0.5,oH-stoneH);
      } else {
        const measuredYFraction=openingPositionFraction(o.pos_y,wallH,o);
        const measuredY=measuredYFraction == null ? null : measuredYFraction*wallH;
        const wY=measuredY == null ? wallH*0.58 : Math.min(wallH-oH/2,Math.max(oH/2,measuredY));
        v0=Math.max(0.15,(wY-oH/2)-stoneH); v1=(wY+oH/2)-stoneH;
      }
      // Clamp hole inside the shape horizontally / at the top
      const u0=Math.max(0.15,uc-oW/2), u1=Math.min(len-0.15,uc+oW/2);
      v1=Math.min(upperH-0.15,v1);
      if(u1-u0<0.5||v1-v0<0.5)return;
      // Skip overlapping holes (Shape holes must not intersect)
      for(const[p0,p1]of usedIntervals){ if(u0<p1&&u1>p0)return; }
      usedIntervals.push([u0,u1]);
      if(isDoor)doorIntervals.push([u0,u1]);
      const hole=new THREE.Path();
      hole.moveTo(u0,v0); hole.lineTo(u1,v0); hole.lineTo(u1,v1); hole.lineTo(u0,v1); hole.closePath();
      shape.holes.push(hole);
    });

    const wG=new THREE.ShapeGeometry(shape);
    // Remap flat (u,v) → 3D along the edge; ShapeGeometry UVs equal (u,v).
    const posA=wG.attributes.position;
    for(let k=0;k<posA.count;k++){
      const u=posA.getX(k),v=posA.getY(k);
      posA.setXYZ(k,ax+u*ux,stoneH+v,az+u*uz);
    }
    posA.needsUpdate=true; wG.computeVertexNormals();
    // Per-face cladding. With no material data this resolves to LAP_RENDER,
    // which is byte-for-byte the previous behaviour (texSiding @ 1/8, C.wall).
    const rend=edgeMaterials?materialRender(edgeMaterials[i]):LAP_RENDER;
    const t=baseTexFor(rend).clone(); t.needsUpdate=true; t.repeat.set(rend.repeat,rend.repeat);
    const mW=stdMat({color:rend.color,map:t,shininess:6,side:THREE.DoubleSide});
    const wallAzimuth = wallNorms ? normalToAzimuth(wallNorms[i]) : null;
    const isSelectedFacade = Number.isFinite(selectedAzimuth)
      && wallAzimuth != null
      && azDiff(wallAzimuth, selectedAzimuth) <= 45;
    if (isSelectedFacade && highlightSelected) {
      mW.emissive.set(0x2563eb);
      mW.emissiveIntensity = 0.58;
    }
    const wM=new THREE.Mesh(wG,mW);
    wM.userData.selectedFacade = isSelectedFacade;
    wM.castShadow=true; wM.receiveShadow=true;
    scene.add(wM); toDispose.push(mW,wG,t);
    if(wallOut){
      const nr=wallNorms[i];
      // flipU: photo reads left-to-right when viewed from OUTSIDE the wall
      wallOut.push({mesh:wM,az:normalToAzimuth(nr),lenFt:len,upperH,flipU:(ux*nr.nz-uz*nr.nx)<0});
    }

    // Wainscot — built in segments that SKIP door apertures so doors cut
    // through the full wall height (no solid stone strip behind them).
    if(stoneH>0){
      const spans=[]; let cursor=0;
      doorIntervals.sort((a,b)=>a[0]-b[0]).forEach(([d0,d1])=>{
        if(d0>cursor+0.05)spans.push([cursor,d0]);
        cursor=Math.max(cursor,d1);
      });
      if(cursor<len-0.05)spans.push([cursor,len]);
      if(spans.length>0){
        const verts=[];
        for(const[s0,s1]of spans){
          const x0=ax+s0*ux,z0=az+s0*uz,x1=ax+s1*ux,z1=az+s1*uz;
          verts.push(
            x0,0,z0, x1,0,z1, x1,stoneH,z1,
            x0,0,z0, x1,stoneH,z1, x0,stoneH,z0,
          );
        }
        const sg=new THREE.BufferGeometry();
        const positions=new Float32Array(verts);
        sg.setAttribute('position',new THREE.BufferAttribute(positions,3));
        // Keep UVs in feet; the selected texture's repeat is the sole scale
        // control, matching the upper-wall material path.
        sg.setAttribute('uv',new THREE.BufferAttribute(computePlanarUVs(positions,1),2));
        sg.computeVertexNormals();
        const accentRend=edgeAccentMaterials?materialRender(edgeAccentMaterials[i]):null;
        let accentTex=null;
        let ms;
        if(accentRend && accentRend!==LAP_RENDER){
          accentTex=baseTexFor(accentRend).clone();
          accentTex.needsUpdate=true;
          accentTex.repeat.set(accentRend.repeat,accentRend.repeat);
          ms=stdMat({color:accentRend.color,map:accentTex,shininess:10,side:THREE.DoubleSide});
        } else {
          // No observed masonry on this face: preserve the legacy flat band
          // rather than guessing from another elevation.
          ms=stdMat({color:C.stone,shininess:10,side:THREE.DoubleSide});
        }
        const sm=new THREE.Mesh(sg,ms); sm.castShadow=true;
        scene.add(sm); toDispose.push(ms,sg);
        if(accentTex)toDispose.push(accentTex);
      }
    }

    // Top edge rail
    const eMat=new THREE.LineBasicMaterial({color:C.edge});
    const topG=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax,wallH,az),new THREE.Vector3(bx,wallH,bz)]);
    const botG=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax,0,az),new THREE.Vector3(bx,0,bz)]);
    const crnG=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ax,0,az),new THREE.Vector3(ax,wallH,az)]);
    scene.add(new THREE.Line(topG,eMat)); scene.add(new THREE.Line(botG,eMat)); scene.add(new THREE.Line(crnG,eMat));
    toDispose.push(eMat,topG,botG,crnG);
  }

  // Solid floor cap (polygon outline)
  const floorShape=new THREE.Shape(polyXZ.map(([x,z])=>new THREE.Vector2(x,z)));
  const floorG=new THREE.ShapeGeometry(floorShape);
  const floorM=phongMat(C.found);
  const floorMesh=new THREE.Mesh(floorG,floorM);
  floorMesh.rotation.x=-Math.PI/2; floorMesh.position.y=0.02; floorMesh.receiveShadow=true;
  scene.add(floorMesh); toDispose.push(floorG,floorM);

  // Ceiling cap
  const ceilShape=new THREE.Shape(polyXZ.map(([x,z])=>new THREE.Vector2(x,z)));
  const ceilG=new THREE.ShapeGeometry(ceilShape);
  const ceilM=phongMat(C.trim);
  const ceilMesh=new THREE.Mesh(ceilG,ceilM);
  ceilMesh.rotation.x=Math.PI/2; ceilMesh.position.y=wallH+0.01;
  scene.add(ceilMesh); toDispose.push(ceilG,ceilM);
}

// Rectangle fallback walls
function buildBoxWalls(L, W, wallH, stoneH, scene, toDispose, texSiding, wallOut=null, selectedAzimuth=null, highlightSelected=true) {
  const T=0.26;
  const faces=[
    {isZ:true, sign:-1,len:L,color:C.wall},
    {isZ:true, sign: 1,len:L,color:C.wallB},
    {isZ:false,sign:-1,len:W,color:C.wall},
    {isZ:false,sign: 1,len:W,color:C.wallB},
  ];
  for(const f of faces){
    const[sx,sz]=f.isZ?[f.len,T]:[T,f.len];
    const xc=f.isZ?0:-(L/2)*f.sign;
    const zc=f.isZ?-(W/2)*f.sign:0;
    const upperH=wallH-stoneH;
    const t=texSiding.clone(); t.needsUpdate=true; t.repeat.set(f.len/8,wallH/8);
    const mW=stdMat({color:f.color,map:t,shininess:6});
    const faceAzimuth = f.isZ ? (f.sign < 0 ? 0 : 180) : (f.sign < 0 ? 270 : 90);
    const isSelectedFacade = Number.isFinite(selectedAzimuth) && faceAzimuth === selectedAzimuth;
    if (isSelectedFacade && highlightSelected) {
      mW.emissive.set(0x2563eb);
      mW.emissiveIntensity = 0.58;
    }
    if(stoneH>0){
      const ms=phongMat(C.stone);
      const sm=new THREE.Mesh(new THREE.BoxGeometry(sx,stoneH,sz),ms);
      sm.position.set(xc,stoneH/2,zc); sm.castShadow=true; scene.add(sm); toDispose.push(ms);
      const wm=new THREE.Mesh(new THREE.BoxGeometry(sx,upperH,sz),mW);
      wm.position.set(xc,stoneH+upperH/2,zc); wm.castShadow=true; wm.userData.selectedFacade=isSelectedFacade; scene.add(wm); toDispose.push(mW);
      wallOut&&wallOut.push({mesh:wm,az:faceAzimuth,lenFt:f.len,upperH,uvNormalized:true});
    } else {
      const wm=new THREE.Mesh(new THREE.BoxGeometry(sx,wallH,sz),mW);
      wm.position.set(xc,wallH/2,zc); wm.castShadow=true; wm.userData.selectedFacade=isSelectedFacade; scene.add(wm); toDispose.push(mW);
      wallOut&&wallOut.push({mesh:wm,az:faceAzimuth,lenFt:f.len,upperH:wallH,uvNormalized:true});
    }
    toDispose.push(t);
  }
}

// Place opening meshes (window/door/garage) on a polygon edge
function placeOpeningsOnEdge(ax,az,bx,bz,wallH,openings,scene,toDispose) {
  if(!openings||openings.length===0)return;
  const dx=bx-ax,dz=bz-az,edgeLen=Math.sqrt(dx*dx+dz*dz);
  // Rotation that maps the mesh's local +X (its width) onto the edge direction.
  const angle=Math.atan2(-dz,dx);

  openings.forEach((o,idx)=>{
    const measuredT = openingPositionFraction(o.pos_x,edgeLen,o);
    const t=measuredT == null ? (idx+1)/(openings.length+1) : Math.min(1,Math.max(0,measuredT));
    const wx=ax+dx*t,wz=az+dz*t;
    const maxW=edgeLen/(openings.length+1)*0.85;
    const oW=Math.min(Math.max(o.width_ft||3,1.5),maxW);
    const oH=Math.min(o.height_ft||3.5,wallH*0.62);

    if(o.type==='garage_door'){
      const gY=oH/2+0.04;
      const mF=phongMat(C.trim); const mGD=phongMat(C.garDoor);
      const fG=new THREE.BoxGeometry(oW+0.32,oH+0.22,0.22);
      const gG=new THREE.BoxGeometry(oW,oH,0.30);
      const r1G=new THREE.BoxGeometry(oW,0.06,0.32); const r2G=new THREE.BoxGeometry(oW,0.06,0.32);
      [fG,gG,r1G,r2G].forEach((g,gi)=>{
        const mat=[mF,mGD,mF,mF][gi];
        const m=new THREE.Mesh(g,mat);
        const yOff=gi===2?oH*0.3:gi===3?oH*0.7:0;
        m.position.set(wx,gY+yOff,wz); m.rotation.y=angle; m.castShadow=true; scene.add(m);
      });
      toDispose.push(mF,mGD,fG,gG,r1G,r2G);
    } else if(o.type==='door'||o.type==='entry_door'||o.type==='slider_door'){
      const dY=oH/2+0.04;
      const mF=phongMat(C.wframe); const mD=phongMat(C.door);
      const fG=new THREE.BoxGeometry(oW+0.30,oH+0.20,0.22);
      const dG=new THREE.BoxGeometry(oW,oH,0.30);
      const fm=new THREE.Mesh(fG,mF); fm.position.set(wx,dY,wz); fm.rotation.y=angle; scene.add(fm);
      const dm=new THREE.Mesh(dG,mD); dm.position.set(wx,dY,wz); dm.rotation.y=angle; dm.castShadow=true; scene.add(dm);
      toDispose.push(mF,mD,fG,dG);
    } else {
      // window
      const measuredYFraction=openingPositionFraction(o.pos_y,wallH,o);
      const measuredY=measuredYFraction == null ? null : measuredYFraction*wallH;
      const wY=measuredY == null
        ? wallH*0.58
        : Math.min(wallH-oH/2,Math.max(oH/2,measuredY));
      const mF=trimMat(C.wframe); const mG=glassMat();
      const fG=new THREE.BoxGeometry(oW+0.28,oH+0.24,0.20);
      const gG=new THREE.BoxGeometry(oW,oH,0.30);
      const mHG=new THREE.BoxGeometry(oW,0.07,0.32);
      const fm=new THREE.Mesh(fG,mF); fm.position.set(wx,wY,wz); fm.rotation.y=angle; scene.add(fm);
      const gm=new THREE.Mesh(gG,mG); gm.position.set(wx,wY,wz); gm.rotation.y=angle; scene.add(gm);
      const mH=new THREE.Mesh(mHG,mF); mH.position.set(wx,wY,wz); mH.rotation.y=angle; scene.add(mH);
      const componentCount=Math.max(1,Number(o.component_count)||1);
      for(let unit=1;unit<componentCount;unit++){
        const offset=(-oW/2)+(oW*unit/componentCount);
        const vx=wx+Math.cos(angle)*offset;
        const vz=wz-Math.sin(angle)*offset;
        const mVG=new THREE.BoxGeometry(0.07,oH,0.32);
        const mV=new THREE.Mesh(mVG,mF); mV.position.set(vx,wY,vz); mV.rotation.y=angle; scene.add(mV);
        toDispose.push(mVG);
      }
      if(componentCount===1){
        const mVG=new THREE.BoxGeometry(0.07,oH,0.32);
        const mV=new THREE.Mesh(mVG,mF); mV.position.set(wx,wY,wz); mV.rotation.y=angle; scene.add(mV);
        toDispose.push(mVG);
      }
      toDispose.push(mF,mG,fG,gG,mHG);
    }
  });
}

// Place openings on box walls by zone
function placeOpeningsOnBoxWalls(L, W, wallH, openings, scene, toDispose) {
  const edgeForAzimuth = az => {
    // Map compass azimuth to rectangle edges
    const norm = ((az % 360) + 360) % 360;
    if (norm < 45 || norm >= 315) return { ax:L/2,  az:-W/2, bx:-L/2, bz:-W/2 };  // N/back
    if (norm < 135) return { ax:L/2,  az:W/2,  bx:L/2,  bz:-W/2 };               // E/right
    if (norm < 225) return { ax:-L/2, az:W/2,  bx:L/2,  bz:W/2  };               // S/front
    return               { ax:-L/2, az:-W/2, bx:-L/2, bz:W/2  };                 // W/left
  };
  const buckets = {};
  for (const o of (openings || [])) {
    const az = o.azimuth_degrees != null
      ? ((o.azimuth_degrees % 360) + 360) % 360
      : zoneToAzimuth(o.wall_face || o.zone || 'front');
    const key = Math.round(az / 90) * 90; // quantise to nearest cardinal
    (buckets[key] = buckets[key] || []).push(o);
  }
  for (const [azKey, ops] of Object.entries(buckets)) {
    const e = edgeForAzimuth(Number(azKey));
    placeOpeningsOnEdge(e.ax, e.az, e.bx, e.bz, wallH, ops, scene, toDispose);
  }
}

// Build a garage volume from polygon or simple box
function buildGarageVolume(
  garagePolyXZ,
  garageWallH,
  garageCx,
  garageCz,
  gW,
  gL,
  scene,
  toDispose,
  phongFn,
  sharedWallTexture = null,
  sharedWallMaterial = null,
) {
  if(garagePolyXZ && garagePolyXZ.length>=3){
    const garageTexture = sharedWallTexture || makeSidingTexture();
    const garageMaterials = sharedWallMaterial
      ? Array(garagePolyXZ.length).fill(sharedWallMaterial)
      : null;
    buildPolyWalls(
      garagePolyXZ, garageWallH, 0, scene, toDispose, garageTexture,
      null, null, garageMaterials,
    );
    const bbox=polyBBox(garagePolyXZ);
    const gL2=bbox.spanX,gW2=bbox.spanZ;
    const garageRoofTexture = makeShingleTexture();
    const mGR=shingleMat(garageRoofTexture);
    const grG=new THREE.BoxGeometry(gL2+1.2,0.35,gW2+1.2);
    const grM=new THREE.Mesh(grG,mGR);
    grM.position.set((bbox.minX+bbox.maxX)/2,garageWallH,(bbox.minZ+bbox.maxZ)/2);
    grM.castShadow=true; grM.receiveShadow=true; scene.add(grM); toDispose.push(mGR,garageRoofTexture);
    grM.rotation.z=0.04;
  } else if(gW>0&&gL>0){
    // Render a synthetic attached wing with the same wall renderer as the
    // main house instead of a flat untextured box.
    const garagePoly = [
      [garageCx - gL / 2, garageCz - gW / 2],
      [garageCx + gL / 2, garageCz - gW / 2],
      [garageCx + gL / 2, garageCz + gW / 2],
      [garageCx - gL / 2, garageCz + gW / 2],
    ];
    const garageTexture = sharedWallTexture || makeSidingTexture();
    const garageMaterials = sharedWallMaterial
      ? Array(garagePoly.length).fill(sharedWallMaterial)
      : null;
    buildPolyWalls(
      garagePoly, garageWallH, 0, scene, toDispose, garageTexture,
      null, null, garageMaterials,
    );
    const garageRoofTexture = makeShingleTexture();
    const mGR=shingleMat(garageRoofTexture);
    const grG=new THREE.BoxGeometry(gL+1.0,0.3,gW+1.0);
    const grM=new THREE.Mesh(grG,mGR);
    grM.position.set(garageCx,garageWallH+0.05,garageCz);
    grM.castShadow=true; grM.receiveShadow=true; scene.add(grM); toDispose.push(mGR,garageRoofTexture);
  }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function HouseModel3D({
  perimeter=0, wallHeight, roofPitch, roofArea, roofType,
  storyCount=1, buildingLength, buildingWidth,
  hasStoneWainscot=false, wallAreaSqft=0,
  hipLf=0, ridgeLf=0, valleyLf=0, eaveLf=0,
  // Geometry props:
  footprintPolygon,   // [[east_ft, north_ft], ...] from OSM
  garagePolygon,      // [[east_ft, north_ft], ...] or null
  openings,
  measurementGraph,   // canonical graph; rough-opening groups are authoritative
  materialMap = null, // normalized photo material map; keeps wall textures honest
  roofMeasurementGraph, // calibrated physical-photo planes/edges
  roofGeometrySource, // estimate-authoritative source selected during reconciliation
  roofSegments,       // Solar API solarPotential.roofSegmentStats (all detected facets)
  roofFacets,         // canonical classified facet geometry from roofFacetGeometry.js
  windowsCount=0, doorsCount=0, garageDoorCount=0,
  // Footprint data source — e.g. 'osm', 'solar_bbox', 'roof_eave', 'photo_estimate', 'manual'.
  // Used to populate the shape-quality badge when no polygon is available.
  footprintSource,
  // 'traced_polygon' when footprintPolygon is a real outline (OSM way or Solar
  // roof-facet union), 'rectangle_estimate' when it is only a bounding box.
  // A traced outline already contains any attached garage, so the synthetic
  // garage wing below must not be added on top of it.
  footprintGeometry,
  photos = [],        // [{ face: 'front'|'back'|'left'|'right', url }] — real facade photos for texture mode (illustrative)
  selectedFacade = null, // canonical facade selected by the estimator compass controls
  selectedAzimuth = null, // physical cardinal azimuth from the estimator compass controls
  // When true, a ground-photo-derived pitch has overridden the satellite
  // baseline: abandon the noisy Solar DSM slopes (segment/facet meshes) and
  // snap the parametric solid to roofPitch. Calibrated physical-photo planes
  // are themselves ground truth and stay usable.
  photoVerifiedPitch = false,
  measurementSummary,
  onPresentationChange = null,
  onGeneratePresentationRender = null,
  presentationRenderPending = false,
  presentationAllowed = true,
  presentationBlockReasons = [],
  presentationOverride = false,
  onPresentationOverride = null,
  garageDoorOverrideAccepted = false,
  // PhotoPresent: the customer-safe fallback when the mesh Present is blocked.
  // { available, photo:{url,label}, chips:[{key,label,value}], materialLines, banner }
  // built by getPhotoPresentPlan(). A blocked Present must never dead-end at a
  // padlock — if we have a real elevation photo we can always show that, with
  // the material split we actually classified, instead of nothing.
  photoPresent = null,
}) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  // Presentation ("customer") view is the default: a clean studio render with
  // no measurement chips, no coloured edge overlays and no diagnostic badges.
  // Estimator view brings the full measurement layer back.
  const [presentation, setPresentation] = useState(true);
  // Aerial roof = the same panel, camera swung straight overhead, showing the
  // satellite takeoff (Google Solar facets/edges). It is a view of the roof we
  // already measured — it never introduces its own geometry or quantities.
  const [aerial, setAerial] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [wainscot,   setWainscot]   = useState(!!hasStoneWainscot);
  const [tooltip,    setTooltip]    = useState(null); // null | { x, y, pitchDeg, azimuthDeg, areaSqft }
  const [photoTex,   setPhotoTex]   = useState(false); // wrap real facade photos onto walls
  const [viewerError, setViewerError] = useState(null);
  const [viewerAttempt, setViewerAttempt] = useState(0);
  const photosKey = (photos || []).map(p => `${p.face}|${p.url}`).join(';');
  const selectedFacadeKey = normalizeFacade(selectedFacade);
  const selectedFacadeAzimuth = Number.isFinite(Number(selectedAzimuth))
    ? Number(selectedAzimuth)
    : facadeAzimuth(selectedFacadeKey);

  const capturePresentation = async () => {
    if (!onGeneratePresentationRender || presentationRenderPending) return;
    if (!presentationAllowed && !presentationOverride) {
      throw new Error(
        presentationBlockReasons[0]
        || 'Presentation is blocked until the wall measurement review is complete.',
      );
    }
    if (!presentation) setPresentation(true);
    if ((photos || []).length > 0 && !photoTex) setPhotoTex(true);
    const wantsPhotos = (photos || []).length > 0;
    const deadline = Date.now() + 5000;
    let readyScene = null;
    // React state changes rebuild the Three scene. Capture only the rebuilt clean
    // scene, never whichever renderer happened to exist when the click began.
    while (Date.now() < deadline) {
      const candidate = sceneRef.current;
      if (candidate?.presentation === true && (!wantsPhotos || candidate.photoTex === true)) {
        readyScene = candidate;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!readyScene) throw new Error('The clean 3D presentation view did not become ready.');
    await Promise.race([
      readyScene.photoTexturesReady || Promise.resolve(),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ]);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = readyScene.renderer?.domElement;
    if (!canvas) throw new Error('The 3D presentation view is not ready yet.');
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    await onGeneratePresentationRender({
      base64: dataUrl.split(',')[1],
      mimeType: 'image/jpeg',
      hasFacadePhotos: (photos || []).length > 0,
    });
  };

  const stories   = Number(storyCount)||1;
  const passedH   = Number(wallHeight);
  // Spec baseline: 1-story = 9 ft, 2-story = 18 ft, 3-story = 27 ft.
  // The 3D mesh must never render shorter than the spec baseline.  A passed-in
  // wallHeight below the baseline typically means clamped per-photo readings
  // (e.g. 14 ft for a 2-story) averaged before the spec floor was enforced.
  // The model shows the physically correct minimum; the number panel still
  // displays the actual computed value from the measurement card above.
  const baselineH = stories * 9;
  // The summary card is the authority. Do not silently replace a measured
  // height with the story-count baseline; that makes the 3D quantity disagree
  // with the number the estimator is about to price.
  const wallH     = passedH > 0 ? passedH : baselineH;
  const perimNum  = Number(perimeter)||0;

  // ── Compute L/W from polygon or supplied dims ─────────────────────────────
  const polyXZ = footprintPolygon && footprintPolygon.length >= 3
    ? polygonToWorldXZ(footprintPolygon) : null;

  let L = Number(buildingLength)||0;
  let W = Number(buildingWidth)||0;
  if (polyXZ) {
    const bb = polyBBox(polyXZ);
    L = Math.max(bb.spanX, bb.spanZ);
    W = Math.min(bb.spanX, bb.spanZ);
  } else if (!L||!W) {
    const halfP=(perimNum||80)/2; W=halfP/2.5; L=halfP-W;
  }
  L=Math.max(L,18); W=Math.max(W,14);

  const garagePolyXZ = garagePolygon && garagePolygon.length>=3
    ? polygonToWorldXZ(garagePolygon) : null;

  const pitchStr=String(roofPitch||'6/12');
  let slope=0.5;
  const pm=pitchStr.match(/(\d+\.?\d*)\s*\/\s*(\d+\.?\d*)/);
  if(pm)slope=Number(pm[1])/Number(pm[2]);
  else if(/^\d+\.?\d*$/.test(pitchStr.trim()))slope=Number(pitchStr.trim())/12;

  const rise     = (W/2)*slope;
  const overhang = Math.min(2.0,Math.max(1.0,W*0.04));
  const stoneH   = wainscot ? Math.min(3.0,wallH*0.22) : 0;
  const isHip    = /hip|pyramid|dutch/i.test(String(roofType||''))||Number(hipLf)>0;
  const roofAreaSq = Number(roofArea)||0;
  // Fit the clean render like a product photograph instead of using a fixed
  // distance that leaves a small CAD-looking house floating in excess space.
  // Keep a little room for the roof rise and the foundation at the hero angle.
  const perspectiveFov = 32;
  const heroFitDistance = Math.max(
    28,
    Math.max(L, W) / (2 * Math.tan((perspectiveFov * Math.PI / 180) / 2)) * 1.16,
    (wallH + rise) / (2 * Math.tan((perspectiveFov * Math.PI / 180) / 2)) * 1.28,
  );
  const camDist = aerial
    ? Math.max(L, W) * 0.82 + 12
    : heroFitDistance;

  // Render every canonical rough-opening group, including small non-deductible
  // openings. Components remain nested in their outside assembly geometry.
  const graphOpenings = measurementGraph?.opening_groups?.map(group => ({
    id: group.id,
    type: group.type,
    wall_face: group.face,
    zone: group.zone,
    width_ft: group.width_ft,
    height_ft: group.height_ft,
    component_count: group.component_ids?.length || (group.type === 'window' ? 1 : 0),
    pos_x: group.pos_x,
    pos_y: group.pos_y,
    position_unit: group.position_unit,
  })) || [];
  const effectiveOpenings = measurementGraph
    ? graphOpenings
    : (openings && openings.length > 0)
      ? openings
      : syntheticOpenings(Number(windowsCount)||0, Number(doorsCount)||0, Number(garageDoorCount)||0);

  // One classification for the estimator badge and the Solar/parametric
  // decision. resolveRoof3DSource does not return the class it consumes.
  const footprintClass = footprintClassFor3D(footprintPolygon);
  const roofSource = resolveRoof3DSource({
    roofGeometrySource,
    roofMeasurementGraph,
    photoVerifiedPitch,
    measurementGraph,
    roofFacets,
    roofSegments,
    footprintPolygon,
    footprintClass,
    isHip,
  });

  // The shared source resolver performs the canonical micro-facet filtering.
  // Geometry-only cleanup remains here because it changes vertices, not source
  // authority or the count shown to contractors.
  const facetData = snapEavesToWallPlate(
    enforceUnifiedRidge(
      roofSource.canonicalFacets
    )
  );
  const photoPlanes = roofSource.photoPlanes;
  const renderableSegments = roofSource.solarSegments;
  const filteredSegments = roofSource.solarSegments;
  const forcedParametric = roofSource.forcedParametric;
  const rawSegments = Array.isArray(roofSegments) ? roofSegments : [];
  const graphFacetInput = Array.isArray(measurementGraph?.roof_facets)
    ? measurementGraph.roof_facets : [];
  const propFacetInput = Array.isArray(roofFacets) ? roofFacets : [];
  const rawFacetInput = graphFacetInput.length > 0 ? graphFacetInput : propFacetInput;
  const hasCompletePhotoRoof = roofSource.path === 'physical_photos';
  const hasFacetRoof = roofSource.path === 'canonical_facets';
  const hasSegments = roofSource.path === 'solar_segments';
  const hasOutlineRoof = shouldAttemptFootprintRoof({
    footprintPolygon,
    hasCompletePhotoRoof,
  });
  const renderedFacetCount = roofSource.facetCount;
  // No Solar geometry at all is normal: a real outline still owns the roof,
  // while an unusable/missing outline gets the visible parametric fallback.
  const hasInvalidRoofGeometry = roofSource.path === 'parametric_fallback'
    && !photoVerifiedPitch
    && !forcedParametric
    && (rawFacetInput.length > 0 || rawSegments.length > 0)
    && roofSource.canonicalFacets.length === 0
    && roofSource.solarSegments.length === 0;

  // Only the parametric gable fallback owns triangular end faces. Split
  // measured gable windows out before normal box-wall placement so they render
  // once, at their actual above-eave location.
  const gableOpeningPartition = !isHip && !hasInvalidRoofGeometry
    && !hasCompletePhotoRoof && !hasFacetRoof && !hasSegments
    ? partitionGableEndOpenings(effectiveOpenings, wallH)
    : { west: [], east: [], wall: effectiveOpenings };

  useEffect(()=>{
    if(!mountRef.current)return;
    setViewerError(null);

    // Tear down previous scene
    if(sceneRef.current){
      const{renderer,detachOrbit,detachHover,animId,toDispose,domLabels,ro}=sceneRef.current;
      cancelAnimationFrame(animId); ro?.disconnect(); detachOrbit?.(); if(detachHover)detachHover(); renderer.dispose();
      toDispose.forEach(d=>{try{d.dispose();}catch(_){}});
      renderer.domElement.remove(); domLabels.forEach(el=>el.remove());
      setTooltip(null);
      sceneRef.current=null;
    }

    const container=mountRef.current;
    const W_px=container.clientWidth||700;
    const H_px=container.clientHeight||420;
    let renderer;

    try {
    // ── Renderer ────────────────────────────────────────────────────────────
    renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(W_px,H_px);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    // Filmic tonemapping keeps sunlit siding from clipping to flat white and
    // holds detail in the shaded elevations — the "photo" look versus the old
    // blown-out diagram look.
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=presentation?1.18:1.06;
    container.appendChild(renderer.domElement);

    // ── Camera: southwest corner, ~42° above horizon ─────────────────────
     const aerialAspect = W_px / Math.max(1, H_px);
      const camera = aerial
       ? (() => {
           // Aerial is a true map-like takeoff, not a perspective camera viewed
           // from far away. The orthographic view keeps Solar footprint edges
           // from converging and makes the roof shape inspectable.
            const halfHeight = Math.max(
              W / 2,
              L / Math.max(0.5, aerialAspect) / 2,
            ) * 1.18 + 3;
            const halfWidth = halfHeight * aerialAspect;
           return new THREE.OrthographicCamera(
             -halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 1400,
           );
         })()
        : new THREE.PerspectiveCamera(perspectiveFov,W_px/H_px,0.1,1400);
    // Aerial roof looks straight down on the measured roof (satellite takeoff
    // framing). Orbit stays attached so drag/scroll still works.
     const target=new THREE.Vector3(0,aerial?wallH*0.9:wallH*0.46,0);
      // Thirty degrees above the horizon gives the viewer a readable facade
      // while retaining enough roof plane to feel like a real property photo.
      const initPhi=aerial?0.001:(Math.PI / 2 - Math.PI / 6);
      const initTheta=aerial?0:-Math.PI*0.30;
     const orbitDist=camDist;
    camera.position.set(
      target.x+orbitDist*Math.sin(initPhi)*Math.sin(initTheta),
      target.y+orbitDist*Math.cos(initPhi),
      target.z+orbitDist*Math.sin(initPhi)*Math.cos(initTheta),
    );
    camera.lookAt(target);
    const detachOrbit=attachOrbitControls(renderer.domElement,camera,target);

    // ── Scene ───────────────────────────────────────────────────────────────
    const scene=new THREE.Scene();
    const bg=presentation?C.studioBg:C.sky;
    scene.background=new THREE.Color(bg);
    scene.fog=new THREE.Fog(bg,camDist*2.2,camDist*3.8);

    // Image-based lighting: a room probe gives every PBR surface soft directional
    // reflections (window glass, painted trim, metal). Without it, standard
    // materials look as flat as the Phong ones they replaced.
    const pmrem=new THREE.PMREMGenerator(renderer);
    const roomEnv=new RoomEnvironment();
    const envRT=pmrem.fromScene(roomEnv,0.04);
    scene.environment=envRT.texture;
    const disposeEnv={dispose(){
      try{envRT.dispose();}catch(_){/* noop */}
      try{pmrem.dispose();}catch(_){/* noop */}
      try{roomEnv.dispose?.();}catch(_){/* noop */}
    }};

    // Lighting — hemisphere sky/ground + key sun, Hover-like bright daylight.
    // The hemisphere lift keeps north faces and the underside of eaves readable
    // instead of collapsing to near-black in top-down views.
    // The environment probe already supplies most of the ambient fill, so the
    // hemisphere/ambient pair is dialled back — stacking them washed the model out.
    const hemi=new THREE.HemisphereLight(0xe8eef6,presentation?0xd6d8da:0x9aa888,presentation?0.45:0.62);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xd8dce4,presentation?0.18:0.30));
    const sun=new THREE.DirectionalLight(0xfff8f0,presentation?2.0:1.6);
    sun.position.set(L*1.6,wallH*5.5,W*0.8); sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    Object.assign(sun.shadow.camera,{left:-140,right:140,top:140,bottom:-140});
    scene.add(sun);
    const fill=new THREE.DirectionalLight(0xc0cce0,0.55);
    fill.position.set(-L*1.2,wallH*2,-W); scene.add(fill);
    const bounce=new THREE.DirectionalLight(0xe8f0e0,0.15);
    bounce.position.set(0,-8,0); scene.add(bounce);

    const toDispose=[disposeEnv];
    const phongFn=(color,opts={})=>stdMat({color,shininess:10,...opts});

    // ── Ground ───────────────────────────────────────────────────────────────
    // Presentation view swaps the lawn for a neutral studio floor so the house
    // reads as a product render rather than a game scene.
    const mGrass=presentation
      ? stdMat({color:C.studioGnd,roughness:0.95,metalness:0})
      : phongFn(C.grass);
    toDispose.push(mGrass);
    const gnd=new THREE.Mesh(new THREE.PlaneGeometry(600,600),mGrass);
    gnd.rotation.x=-Math.PI/2; gnd.position.y=-0.06; gnd.receiveShadow=true; scene.add(gnd);

    // Concrete apron (footprint-shaped pad)
     if(!presentation || aerial){
     if(polyXZ){
      const padShape=new THREE.Shape(polyXZ.map(([x,z])=>new THREE.Vector2(x,z)));
      const padG=new THREE.ShapeGeometry(padShape);
      const padM=phongFn(C.pad); toDispose.push(padM);
      const padMesh=new THREE.Mesh(padG,padM);
      padMesh.rotation.x=-Math.PI/2; padMesh.position.y=-0.03; padMesh.receiveShadow=true;
      scene.add(padMesh); toDispose.push(padG);
     } else {
      const mPad=phongFn(C.pad); toDispose.push(mPad);
      const pad=new THREE.Mesh(new THREE.PlaneGeometry(L+12,W+12),mPad);
      pad.rotation.x=-Math.PI/2; pad.position.y=-0.03; pad.receiveShadow=true; scene.add(pad);
    }
     }

    // Driveway strip toward south (positive Z) — site view only
    if(!presentation){
      const mDrv=phongFn(C.drive); toDispose.push(mDrv);
      const drv=new THREE.Mesh(new THREE.PlaneGeometry(10,20),mDrv);
      drv.rotation.x=-Math.PI/2; drv.position.set(0,-0.02,W/2+11); drv.receiveShadow=true; scene.add(drv);
    }

    // ── Foundation ───────────────────────────────────────────────────────────
    if(polyXZ){
      const fndShape=new THREE.Shape(polyXZ.map(([x,z])=>new THREE.Vector2(x,z)));
      const fndG=new THREE.ExtrudeGeometry(fndShape,{depth:0.55,bevelEnabled:false});
      fndG.rotateX(-Math.PI/2);
      const fndM=phongFn(C.found); toDispose.push(fndM,fndG);
      const fndMesh=new THREE.Mesh(fndG,fndM);
      fndMesh.position.y=-0.55; fndMesh.castShadow=true; fndMesh.receiveShadow=true;
      scene.add(fndMesh);
    } else {
      const mFnd=phongFn(C.found); toDispose.push(mFnd);
      const fm=new THREE.Mesh(new THREE.BoxGeometry(L+0.6,0.6,W+0.6),mFnd);
      fm.position.y=-0.3; fm.castShadow=true; fm.receiveShadow=true; scene.add(fm);
    }

    // ── Walls (extruded along every vertex segment of the real polygon) ──────
    const texSiding=makeSidingTexture(); toDispose.push(texSiding);
    const edgeBuckets=polyXZ
      ? assignOpeningsToEdges(polyXZ,gableOpeningPartition.wall)
      : null;
    // Per-face cladding from the canonical graph, so a brick elevation renders
    // as brick instead of inheriting the house-wide lap texture. Falls back to
    // the house-wide material when a face was never measured.
    const faceMaterials={};
    const faceAccentMaterials={};
    (measurementGraph?.wall_facets||[]).forEach(f=>{
      if (!f?.face || f.face === 'unknown') return;
      const mapped = materialMap?.faces?.[f.face]
        || measurementGraph?.material_map?.faces?.[f.face]
        || measurementGraph?.materialMap?.faces?.[f.face];
      const mappedRegions = Array.isArray(mapped?.regions) ? mapped.regions : [];
      const sidingRegion = mappedRegions
        .filter(region => region?.included_in_siding_sq)
        .sort((a, b) => (Number(b.area_sqft) || 0) - (Number(a.area_sqft) || 0))[0];
      const accentRegion = mappedRegions
        .filter(region => !region?.included_in_siding_sq && ['stone', 'brick', 'stucco'].includes(region?.material))
        .sort((a, b) => (Number(b.area_sqft) || 0) - (Number(a.area_sqft) || 0))[0];
      if (sidingRegion?.material) faceMaterials[f.face] = sidingRegion.material;
      else if (accentRegion?.material) faceMaterials[f.face] = accentRegion.material;
      else if (f.siding_material) faceMaterials[f.face] = f.siding_material;
      if (accentRegion?.material) faceAccentMaterials[f.face] = accentRegion.material;
      else if (f.accent_material) faceAccentMaterials[f.face] = f.accent_material;
    });
    // Unmatched edges deliberately get NO material and fall back to lap siding.
    // Propagating the majority material would paint brick onto a back wall that
    // was never photographed — the model must not claim a material it did not
    // observe, for the same reason the measurement graph refuses to.
    const edgeMaterials=(polyXZ && Object.keys(faceMaterials).length>0)
      ? assignMaterialsToEdges(polyXZ,faceMaterials,null)
      : null;
    const edgeAccentMaterials=(polyXZ && Object.keys(faceAccentMaterials).length>0)
      ? assignMaterialsToEdges(polyXZ,faceAccentMaterials,null)
      : null;
    const materialCounts = Object.values(faceMaterials).reduce((counts, material) => {
      counts[material] = (counts[material] || 0) + 1;
      return counts;
    }, {});
    const sharedGarageMaterial = Object.entries(materialCounts)
      .sort(([, countA], [, countB]) => countB - countA)[0]?.[0] || null;
    const wallMeshes=[]; // {mesh, az, lenFt, upperH, uvNormalized, flipU} for photo texturing
    if(polyXZ){
      buildPolyWalls(polyXZ,wallH,stoneH,scene,toDispose,texSiding,edgeBuckets,wallMeshes,edgeMaterials,selectedFacadeAzimuth,edgeAccentMaterials,!presentation&&!aerial);
    } else {
      buildBoxWalls(L,W,wallH,stoneH,scene,toDispose,texSiding,wallMeshes,selectedFacadeAzimuth,!presentation&&!aerial);
    }

    // ── Photo textures: wrap real facade photos onto matching walls ──────────
    // Illustrative layer only — measurement math never reads this. A wall with
    // no matching photo keeps its procedural siding texture.
    let photoTexturesReady=Promise.resolve();
    if(photoTex && (photos||[]).length){
      const loader=new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
      const sceneAtBuild=scene; // identity guard: a callback resolving after teardown must not touch this scene
      let resolveTextures;
      let settled=0;
      let started=null;
      photoTexturesReady=new Promise(resolve=>{resolveTextures=resolve;});
      const markSettled=()=>{
        settled++;
        if(started!==null&&settled>=started)resolveTextures();
      };
      started=applyPhotoTextures(
        wallMeshes,
        photos.map(p=>({url:p.url,az:zoneToAzimuth(p.face)})),
        {loader,isCurrent:()=>sceneRef.current?.scene===sceneAtBuild,toDispose,onSettled:markSettled},
      );
      if(started===0||settled>=started)resolveTextures();
    }

    // ── Corner boards ────────────────────────────────────────────────────────
    const mCorner=phongFn(C.trim); toDispose.push(mCorner);
    if(polyXZ){
      for(const[x,z]of polyXZ){
        const cg=new THREE.BoxGeometry(0.44,wallH,0.44);
        const cm=new THREE.Mesh(cg,mCorner);
        cm.position.set(x,wallH/2,z); cm.castShadow=true; scene.add(cm); toDispose.push(cg);
      }
    } else {
      for(const[sx,sz]of[[-1,-1],[1,-1],[1,1],[-1,1]]){
        const cg=new THREE.BoxGeometry(0.44,wallH,0.44);
        const cm=new THREE.Mesh(cg,mCorner);
        cm.position.set(sx*(L/2),wallH/2,sz*(W/2)); cm.castShadow=true; scene.add(cm); toDispose.push(cg);
      }
    }

    // ── Openings: photo-detected windows/doors placed on azimuth-matched edges ─
    // All canonical assemblies render, even if an estimating rule excludes a
    // small opening from the siding deduction.
    if(polyXZ){
      for(let i=0;i<polyXZ.length;i++){
        const[ax,az]=polyXZ[i],[bx,bz]=polyXZ[(i+1)%polyXZ.length];
        placeOpeningsOnEdge(ax,az,bx,bz,wallH,edgeBuckets[i],scene,toDispose);
      }
    } else {
      placeOpeningsOnBoxWalls(L,W,wallH,gableOpeningPartition.wall,scene,toDispose);
    }

    // ── Garage volume ─────────────────────────────────────────────────────────
    const garageWallH = Math.round(wallH * 0.62); // single-story attached garage
    if (garagePolyXZ) {
      buildGarageVolume(
        garagePolyXZ, garageWallH, 0, 0, 0, 0, scene, toDispose, phongFn,
        texSiding, sharedGarageMaterial,
      );
    // The `polyXZ.length > 4` clause covers legacy records saved before
    // footprintGeometry existed: anything with more than four corners is a
    // traced outline whatever the flag says, and already contains the garage.
    } else if (Number(garageDoorCount) > 0
               && footprintGeometry !== 'traced_polygon'
               && !(polyXZ && polyXZ.length > 4)) {
      // Only when the footprint is a plain rectangle. A traced outline already
      // includes the garage wing, so synthesizing one would render it twice.
      const garDoor = effectiveOpenings.find(o => o.type === 'garage_door');
      const gDoorW  = garDoor ? (Number(garDoor.width_ft) || 16) : 16;
      const synGW   = gDoorW + 4;               // width (Z): door + frame clearance
      const synGL   = Math.round(synGW * 1.1);  // depth (X): ~110% of width
      // Attach to the right (+X) side of the main house, front-aligned
      const synCx   = L / 2 + synGL / 2;
      const synCz   = -(W / 2 - synGW / 2);    // align front face with house front
      buildGarageVolume(
        null, garageWallH, synCx, synCz, synGW, synGL, scene, toDispose, phongFn,
        texSiding, sharedGarageMaterial,
      );
    }

    // ── Fascia ───────────────────────────────────────────────────────────────
    const mFascia=phongFn(C.trim); toDispose.push(mFascia);
    const ov=overhang;
    const addFascia=(px,py,pz,sx,sy,sz)=>{
      const g=new THREE.BoxGeometry(sx,sy,sz);
      const m=new THREE.Mesh(g,mFascia); m.position.set(px,py,pz); m.castShadow=true; scene.add(m); toDispose.push(g);
    };
    if (!hasOutlineRoof) {
      addFascia(0,wallH-0.3,-(W/2+ov+0.08),L+ov*2+0.2,0.5,0.28);
      addFascia(0,wallH-0.3, (W/2+ov+0.08),L+ov*2+0.2,0.5,0.28);
      if(!isHip){
        addFascia(-(L/2+ov+0.08),wallH-0.3,0,0.28,0.5,W+ov*2+0.2);
        addFascia( (L/2+ov+0.08),wallH-0.3,0,0.28,0.5,W+ov*2+0.2);
      }
    }

    // ── Roof ──────────────────────────────────────────────────────────────────
    // Priority 1: Solar API roofSegmentStats → individual facet quads
    // Priority 2: Generic 4-facet hip/gable fallback
    const labelTargets=[];
    let usedSegmentRoof = false;
    const roofMetrics = {
      facetCount: 0,
      roofSurfaceAreaSqft: 0,
      eaveLf: 0,
      ridgeLf: 0,
      wallHeightFt: wallH,
    };

     const facetMeshes = [];
      if(!hasInvalidRoofGeometry && hasCompletePhotoRoof){
      const photoResult = buildPhotoRoof(photoPlanes, L, W, wallH, scene, toDispose);
      if(photoResult){
        photoResult.labelTargets.forEach(l => labelTargets.push(l));
        photoResult.facetMeshes.forEach(m => facetMeshes.push(m));
        Object.assign(roofMetrics, photoResult.metrics);
        usedSegmentRoof = true;
      }
      } else if(!hasInvalidRoofGeometry && hasFacetRoof){
       // Canonical facets own roof-plane topology and elevation. A traced
       // footprint still owns the walls, but must not flatten multi-level roof
       // sections into the outline renderer's single wall plate.
       const bbC = polyXZ ? polyBBox(polyXZ) : null;
       const tCx = bbC ? (bbC.minX + bbC.maxX) / 2 : 0;
       const tCz = bbC ? (bbC.minZ + bbC.maxZ) / 2 : 0;
       const facetResult = buildFacetRoof(facetData, wallH, tCx, tCz, scene, toDispose);
       if(facetResult){
         facetResult.labelTargets.forEach(l => labelTargets.push(l));
         facetResult.facetMeshes.forEach(m => facetMeshes.push(m));
         Object.assign(roofMetrics, facetResult.metrics);
         usedSegmentRoof = true;
       }
      } else if(hasOutlineRoof){
       // Satellite facets provide pitch/orientation hints only. The real traced
       // wall outline owns roof position, extent, hips, ridges, and valleys.
       const outlineResult = buildOutlineRoof(
         polyXZ, renderableSegments, wallH, slope, overhang, renderedFacetCount, scene, toDispose
       );
       if(outlineResult){
         outlineResult.labelTargets.forEach(l => labelTargets.push(l));
         outlineResult.facetMeshes.forEach(m => facetMeshes.push(m));
         Object.assign(roofMetrics, outlineResult.metrics);
         usedSegmentRoof = true;
       }
      } else if (aerial && hasSegments) {
        // Aerial must use actual Solar segment geometry when no traced footprint
        // is available. The normal estimator view can still use its safer
        // centered fallback, but the Aerial pill may never label that fallback
        // as a Solar takeoff.
        const solarResult = buildSegmentRoof(
          renderableSegments, wallH, overhang, scene, toDispose,
        );
        if (solarResult) {
          solarResult.labelTargets.forEach(l => labelTargets.push(l));
          solarResult.facetMeshes.forEach(m => facetMeshes.push(m));
          Object.assign(roofMetrics, solarResult.metrics);
          usedSegmentRoof = true;
        }
      }
    // Never fall back to detached Solar bounding-box planes. If the outline is
    // unusable the existing house-centred parametric roof below is safer.

     if(!usedSegmentRoof){
      // ── Parametric watertight generic roof ──────────────────────────────────
      // Replaces the old flat-color buildRoofFaces path with a shingle-textured
      // MeshGeometryBuilder output that enforces:
      //   • Single continuous ridge (gable) or four-hip with shared ridge segment
      //   • Eave vertices exactly at wallH (zero air-gap with wall top-plate)
      //   • Shared vertex positions across opposing faces (no seams)
      const texShingle2 = makeShingleTexture(); toDispose.push(texShingle2);
      // Keep visual overhang out of the measured shingle mesh. Area fitting
      // below then preserves the summary's true plan/slope relationship.
      const ov = 0;

      const addParametricFace = (verts, label, labelPos) => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(computePlanarUVs(verts), 2));
        geom.computeVertexNormals();
        const n = verts.length / 3;
        const cx = verts.filter((_,i)=>i%3===0).reduce((a,b)=>a+b,0)/n;
        const cy = verts.filter((_,i)=>i%3===1).reduce((a,b)=>a+b,0)/n;
        const cz = verts.filter((_,i)=>i%3===2).reduce((a,b)=>a+b,0)/n;
        // computePlanarUVs already emits UVs in tile units (feet / 8), so the
        // repeat stays 1:1 — scaling it by face size again tiled the shingles
        // quadratically tighter as the roof got bigger.
        const t = texShingle2.clone(); t.needsUpdate = true; t.repeat.set(1, 1);
        const mat = shingleMat(t);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); toDispose.push(geom, mat, t);
        facetMeshes.push(mesh);
        roofMetrics.facetCount++;
        roofMetrics.roofSurfaceAreaSqft += positionArraySurfaceArea(verts);
        if (label) labelTargets.push({ worldPos: labelPos || [cx, cy + 0.5, cz], text: label, priority: 2 });
      };

      const addEdgeLine = (from, to, color, thick=0.20) => {
        const [fx,fy,fz]=from, [tx,ty,tz]=to;
        const len = Math.hypot(tx-fx,ty-fy,tz-fz);
        if (len < 0.5) return;
        const eg = new THREE.BoxGeometry(thick, thick, len);
        const em = stdMat({ color, shininess:30 });
        const eMesh = new THREE.Mesh(eg, em);
        eMesh.userData.measurementOverlay = true;
        eMesh.position.set((fx+tx)/2,(fy+ty)/2,(fz+tz)/2);
        eMesh.lookAt(new THREE.Vector3(tx,ty,tz));
        scene.add(eMesh); toDispose.push(eg, em);
      };

      if (!isHip) {
        // ── Bilateral Gable ──────────────────────────────────────────────────
        const g = buildParametricGable(L, W, wallH, slope, ov);

        addParametricFace(g.southFace.verts, `S · ${pitchStr}`,
          [0, wallH + g.rise * 0.55, -(W/2 + ov*0.6)]);
        addParametricFace(g.northFace.verts, `N · ${pitchStr}`,
          [0, wallH + g.rise * 0.55,  (W/2 + ov*0.6)]);

        // Gable-end triangles (siding texture, flush with wall plane)
        const texG = makeSidingTexture(); toDispose.push(texG);
        buildParametricGableFace(
          g.westGable, 'west', W, wallH, g.rise, gableOpeningPartition.west,
          scene, toDispose, texG,
        );
        buildParametricGableFace(
          g.eastGable, 'east', W, wallH, g.rise, gableOpeningPartition.east,
          scene, toDispose, texG,
        );

        // Single continuous ridge line
        addEdgeLine(g.ridge.from, g.ridge.to, C.ridge, 0.28);
        roofMetrics.ridgeLf = lineLength(g.ridge.from, g.ridge.to);
        roofMetrics.eaveLf = g.eaveEdges.reduce((sum, edge) => sum + lineLength(edge.from, edge.to), 0);
        labelTargets.push({
          worldPos: [0, g.ridgeY + 0.8, 0],
          text: `RIDGE ${Math.round(L + ov*2)} LF`,
          priority: 1,
        });

        // Rake edges (orange) and eave edges (red)
        for (const e of g.rakeEdges)  addEdgeLine(e.from, e.to, EDGE_COLORS.rake, 0.18);
        for (const e of g.eaveEdges)  addEdgeLine(e.from, e.to, EDGE_COLORS.eave, 0.14);

      } else {
        // ── Four-Hip ─────────────────────────────────────────────────────────
        const h = buildParametricHip(L, W, wallH, slope, ov);

        addParametricFace(h.southVerts, `S · ${pitchStr}`,
          [0, wallH + h.rise * 0.55, -(W/2 + ov*0.6)]);
        addParametricFace(h.northVerts, `N · ${pitchStr}`,
          [0, wallH + h.rise * 0.55,  (W/2 + ov*0.6)]);
        addParametricFace(h.westVerts,  `W · ${pitchStr}`,
          [-(L/2 + ov*0.6), wallH + h.rise * 0.55, 0]);
        addParametricFace(h.eastVerts,  `E · ${pitchStr}`,
          [ (L/2 + ov*0.6), wallH + h.rise * 0.55, 0]);

        // Single continuous ridge
        addEdgeLine(h.ridge.from, h.ridge.to, C.ridge, 0.28);
        roofMetrics.ridgeLf = lineLength(h.ridge.from, h.ridge.to);
        roofMetrics.eaveLf = h.eaveEdges.reduce((sum, edge) => sum + lineLength(edge.from, edge.to), 0);
        labelTargets.push({
          worldPos: [0, h.ridgeY + 0.8, 0],
          text: `RIDGE ${Math.round(h.ridgeHL * 2)} LF`,
          priority: 1,
        });

        // Hip lines (blue) and eave edges (red)
        for (const { from, to } of h.hipLines)  addEdgeLine(from, to, EDGE_COLORS.hip, 0.18);
        for (const e of h.eaveEdges)             addEdgeLine(e.from, e.to, EDGE_COLORS.eave, 0.14);
      }
    }
    const targetRoofAreaSqft = Number(measurementSummary?.roofAreaSqft);
    const areaFit = fitRenderedRoofMeshesToArea(facetMeshes, wallH, targetRoofAreaSqft);
    roofMetrics.roofSurfaceAreaSqft = areaFit.areaSqft;

    // The Aerial pill is a roof takeoff, so give each real roof plane a quiet
    // boundary line. EdgesGeometry omits coplanar triangle diagonals and keeps
    // the result legible without turning the presentation into a blueprint.
    if (aerial && (hasSegments || hasFacetRoof)) {
      facetMeshes.forEach(mesh => {
        const edgeGeometry = new THREE.EdgesGeometry(mesh.geometry, 24);
        const edgeMaterial = new THREE.LineBasicMaterial({
          color: 0xf8fafc,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        });
        const edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edgeLines.position.y += 0.045;
        edgeLines.userData.aerialRoofEdge = true;
        scene.add(edgeLines);
        toDispose.push(edgeGeometry, edgeMaterial);
      });
    }

    // Linears are structural measurements, not the perimeter of decorative
    // shingle overhang. Canonical facets expose their source edges directly.
    // Physical-photo graphs do too; Solar/parametric source data provides the
    // estimate linears because their visual quads do not encode edge topology.
    if (hasCompletePhotoRoof) {
      roofMetrics.eaveLf = graphEdgeTotal(roofMeasurementGraph, 'eave');
      roofMetrics.ridgeLf = graphEdgeTotal(roofMeasurementGraph, 'ridge');
    } else {
      roofMetrics.eaveLf = Number(measurementSummary?.eaveLf) || 0;
      roofMetrics.ridgeLf = Number(measurementSummary?.ridgeLf) || 0;
    }

    // These are the structural quantities contractors compare with the card.
    // Mesh area is fitted above; source linears never include visual overhang.
    const summaryEaveLf = Number(measurementSummary?.eaveLf);
    const summaryRidgeLf = Number(measurementSummary?.ridgeLf);
    if (Number.isFinite(summaryEaveLf) && summaryEaveLf > 0) {
      labelTargets.push({
        worldPos: [0, wallH + 0.8, -(W / 2 + overhang * 0.65)],
        text: `EAVE ${Math.round(summaryEaveLf)} LF`,
        priority: 1,
      });
    }
    if (Number.isFinite(summaryRidgeLf) && summaryRidgeLf > 0) {
      labelTargets.push({
        worldPos: [0, wallH + rise + 1.0, 0],
        text: `RIDGE ${Math.round(summaryRidgeLf)} LF`,
        priority: 1,
      });
    }

    const parity = compareRoof3DMeasurements({
      rendered: roofMetrics,
      summary: measurementSummary || {},
    });
    if (import.meta.env.DEV && parity.mismatches.length > 0) {
      console.warn(formatRoof3DParityWarning(parity), {
        path: hasCompletePhotoRoof
          ? 'physical_photos'
          : hasFacetRoof
            ? 'canonical_facets'
            : hasSegments
              ? 'solar_segments'
              : 'parametric_fallback',
        checks: parity.checks,
      });
    }

    // ── DOM labels ────────────────────────────────────────────────────────────
    // Each label carries a priority (0 = wall dims, 1 = structural edges,
    // 2 = facet pitch/area). The render loop declutters them in screen space:
    // labels are placed highest-priority-first and any chip that would overlap
    // an already-placed chip is hidden for that frame. This keeps the model
    // readable from every orbit angle instead of stacking into a black wall.
    // Presentation view is deliberately chip-free: measurement overlays are the
    // estimator's layer, not the homeowner's.
    const domLabels=[];
    if(showLabels && !presentation){
      for(const{worldPos,text,priority=2}of labelTargets){
        const div=document.createElement('div');
        div.style.cssText=[
          'position:absolute','background:rgba(24,26,30,0.82)','color:#f2f0ea',
          'font-size:10px','font-weight:600','font-family:system-ui,sans-serif',
          'padding:2px 6px','border-radius:4px','pointer-events:none',
          'white-space:nowrap','letter-spacing:0.3px','border:1px solid rgba(255,255,255,0.18)',
          'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
        ].join(';');
        div.dataset.wx=worldPos[0]; div.dataset.wy=worldPos[1]; div.dataset.wz=worldPos[2];
        div.dataset.pr=priority;
        div.textContent=text; container.appendChild(div);
        // Cache measured size at creation: a chip hidden by the declutter pass
        // (display:none) reports offsetWidth/Height = 0, which would corrupt
        // next frame's collision rect if re-measured while hidden.
        div.dataset.w=div.offsetWidth; div.dataset.h=div.offsetHeight;
        domLabels.push(div);
      }
      // Wall dimension labels
      const wallDims=[
        {worldPos:[0,0.5,-(W/2+ov+2)],text:`${L.toFixed(0)} ft`},
        {worldPos:[0,0.5, (W/2+ov+2)],text:`${L.toFixed(0)} ft`},
        {worldPos:[-(L/2+ov+2),0.5,0],text:`${W.toFixed(0)} ft`},
        {worldPos:[ (L/2+ov+2),0.5,0],text:`${W.toFixed(0)} ft`},
      ];
      for(const{worldPos,text}of wallDims){
        const div=document.createElement('div');
        div.style.cssText=[
          'position:absolute','background:rgba(37,80,160,0.88)','color:#e8f1ff',
          'font-size:9px','font-weight:700','font-family:system-ui,sans-serif',
          'padding:1px 5px','border-radius:4px','pointer-events:none','white-space:nowrap',
          'box-shadow:0 1px 3px rgba(0,0,0,0.30)',
        ].join(';');
        div.dataset.wx=worldPos[0]; div.dataset.wy=worldPos[1]; div.dataset.wz=worldPos[2];
        div.dataset.pr=0;
        div.textContent=text; container.appendChild(div);
        div.dataset.w=div.offsetWidth; div.dataset.h=div.offsetHeight;
        domLabels.push(div);
      }
    }

    // Presentation view hides every line overlay — coloured ridge/hip/valley
    // highlights and wall outlines are measurement annotation, and they are what
    // make the model read as a wireframe diagram instead of a building.
    // The aerial takeoff is a technical view: facet edges stay visible there
    // even while the rest of the panel is in customer mode.
    if(presentation && !aerial){
      scene.traverse(o=>{
        if(o.isLine||o.isLineSegments||o.isLineLoop||o.userData?.measurementOverlay) o.visible=false;
      });
    }

    // ── Raycaster: facet hover tooltip ────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredMesh = null;
    const EMISSIVE_HOVER = new THREE.Color(0x2244aa);
    const onPointerMove = (e) => {
      if (facetMeshes.length === 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(facetMeshes, false);
      if (hits.length > 0) {
        const hit = hits[0].object;
        if (hit !== hoveredMesh) {
          if (hoveredMesh) hoveredMesh.material.emissive.set(0x000000);
          hoveredMesh = hit;
          hit.material.emissive.copy(EMISSIVE_HOVER);
        }
        const ud = hit.userData;
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          pitchDeg:   ud.pitchDeg,
          azimuthDeg: ud.azimuthDeg,
          areaSqft:   ud.areaSqft,
        });
      } else {
        if (hoveredMesh) { hoveredMesh.material.emissive.set(0x000000); hoveredMesh = null; }
        setTooltip(null);
      }
    };
    const onPointerLeave = () => {
      if (hoveredMesh) { hoveredMesh.material.emissive.set(0x000000); hoveredMesh = null; }
      setTooltip(null);
    };
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    const detachHover = () => {
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
    };

    // ── ResizeObserver ────────────────────────────────────────────────────────
    const ro=new ResizeObserver(()=>{
      const w=container.clientWidth,h=container.clientHeight;
      renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
    });
    ro.observe(container);

    // ── Animate ───────────────────────────────────────────────────────────────
    let animId;
    const tempV=new THREE.Vector3();
    const animate=()=>{
      animId=requestAnimationFrame(animate);
      renderer.render(scene,camera);
      if(domLabels.length>0){
        const cw=container.clientWidth,ch=container.clientHeight;
        // Project every label, then place greedily by priority, hiding chips
        // that would overlap an already-placed chip (6px padding).
        const items=[];
        for(const div of domLabels){
          tempV.set(parseFloat(div.dataset.wx),parseFloat(div.dataset.wy),parseFloat(div.dataset.wz)).project(camera);
          const sx=(tempV.x+1)/2*cw, sy=(-tempV.y+1)/2*ch;
          const inView=tempV.z<1&&sx>-20&&sx<cw+20&&sy>-20&&sy<ch+20;
          if(!inView){ div.style.display='none'; continue; }
          items.push({div,sx,sy,pr:parseInt(div.dataset.pr||'2',10)});
        }
        items.sort((a,b)=>a.pr-b.pr);
        const placed=[];
        for(const it of items){
          // Use cached dimensions (never offsetWidth here — hidden chips read 0)
          const w=parseFloat(it.div.dataset.w)||60,h=parseFloat(it.div.dataset.h)||16;
          const x1=it.sx-w/2-6,y1=it.sy-h/2-6,x2=it.sx+w/2+6,y2=it.sy+h/2+6;
          let blocked=false;
          for(const p of placed){ if(x1<p.x2&&x2>p.x1&&y1<p.y2&&y2>p.y1){ blocked=true; break; } }
          if(blocked){ it.div.style.display='none'; continue; }
          placed.push({x1,y1,x2,y2});
          it.div.style.display='block';
          it.div.style.left=(it.sx-w/2)+'px';
          it.div.style.top=(it.sy-h/2)+'px';
        }
      }
    };
    animate();

    sceneRef.current={renderer,scene,camera,detachOrbit,detachHover,animId,toDispose,domLabels,ro,presentation,photoTex,photoTexturesReady};
    return()=>{
      cancelAnimationFrame(animId); ro?.disconnect(); detachOrbit?.(); detachHover?.(); renderer.dispose();
      toDispose.forEach(d=>{try{d.dispose();}catch(_){}});
      scene.traverse(o=>{try{o.geometry?.dispose();}catch(_){}});
      renderer.domElement.remove(); domLabels.forEach(el=>{try{el.remove();}catch(_){}});
      setTooltip(null);
      sceneRef.current=null;
    };
    } catch (error) {
      // Some mobile browsers/webviews have WebGL disabled or exhausted. Keep the
      // estimator usable instead of allowing an imperative Three.js error to
      // escape and crash the surrounding measurement screen.
      console.error('[HouseModel3D] Viewer initialization failed:', error);
      try { renderer?.dispose(); } catch (_) {}
      try { container.replaceChildren(); } catch (_) {}
      setTooltip(null);
       setViewerError(hasInvalidRoofGeometry
         ? 'Roof preview unavailable — satellite data incomplete'
         : 'The 3D preview could not start for this measurement or this device.');
      return undefined;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
   },[L,W,wallH,rise,stoneH,overhang,isHip,camDist,pitchStr,showLabels,presentation,aerial,hasSegments,hasCompletePhotoRoof,hasFacetRoof,hasInvalidRoofGeometry,
     footprintPolygon,garagePolygon,footprintGeometry,openings,measurementGraph,materialMap,roofMeasurementGraph,roofSegments,roofFacets,windowsCount,doorsCount,garageDoorCount,
      photoTex,photosKey,selectedFacadeKey,selectedFacadeAzimuth,viewerAttempt,measurementSummary]);

  const pill={
    background:'rgba(10,12,18,0.62)',color:'rgba(220,218,210,0.92)',
    fontSize:10,padding:'2px 8px',borderRadius:4,
    backdropFilter:'blur(4px)',fontFamily:'system-ui,sans-serif',
  };
  // ── Aerial roof (satellite takeoff) readout ────────────────────────────────
  // The aerial tab is a Google Solar view. It only opens when the roof actually
  // being rendered is Solar-derived: photo-measured planes, manual/traced
  // outlines and the parametric fallback all get the empty state instead of
  // being passed off as a satellite takeoff. It reports the roof numbers the
  // estimate already holds and derives nothing of its own.
  const canonicalFacetsFromSolar = (roofSource.canonicalFacets || [])
    .some(f => /solar/i.test(String(f?.provenance || '')));
  const solarReturnedGeometry = rawSegments.length > 0;
  const hasSatelliteTakeoff = hasSegments
    || (hasFacetRoof && (canonicalFacetsFromSolar || solarReturnedGeometry));
  // Two different honest failures: Solar has no coverage here at all, versus
  // Solar data exists but a more trustworthy source owns this roof.
  const aerialEmptyReason = solarReturnedGeometry || rawFacetInput.length > 0
    ? 'superseded'
    : 'no_coverage';

  const firstFinite = (...values) => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  // A missing quantity prints as "—". Never coerce unknown to 0 — a contractor
  // reads "valleys 0 LF" as measured-and-none, not as not-measured.
  const fmtLf = value => (value === null ? '—' : `${Math.round(value)} LF`);
  const aerialAreaSqft = firstFinite(
    measurementSummary?.roofAreaSqft,
    roofAreaSq > 0 ? roofAreaSq * 100 : null,
  );
  const aerialRidgeLf = firstFinite(ridgeLf, measurementSummary?.ridgeLf);
  const aerialHipLf = firstFinite(hipLf);
  const aerialRidgeHipLf = aerialRidgeLf === null && aerialHipLf === null
    ? null
    : (aerialRidgeLf || 0) + (aerialHipLf || 0);
  const aerialFootprintSource = footprintSource
    || (footprintPolygon ? 'traced' : hasSegments || hasFacetRoof ? 'solar' : 'estimate');
  const aerialFooterLine = [
    'Roof',
    aerialAreaSqft !== null && aerialAreaSqft > 0
      ? `${Math.round(aerialAreaSqft).toLocaleString()} ft² (${(aerialAreaSqft / 100).toFixed(1)} sq)`
      : '— ft²',
    `ridges/hips ${fmtLf(aerialRidgeHipLf)}`,
    `valleys ${fmtLf(firstFinite(valleyLf))}`,
    `eaves ${fmtLf(firstFinite(eaveLf, measurementSummary?.eaveLf))}`,
    `pitch ${pitchStr || '—'}`,
    `footprint=${aerialFootprintSource}`,
    'SANITY-REVIEW',
  ].join(' | ');
  const aerialPresentationLine = [
    'Google Solar roof takeoff',
    aerialAreaSqft !== null && aerialAreaSqft > 0
      ? `${Math.round(aerialAreaSqft).toLocaleString()} ft²`
      : 'area —',
    `pitch ${pitchStr || '—'}`,
    'verify on site',
  ].join(' · ');
  const observedWallFacets = measurementGraph?.wall_facets || [];
  const hasUnconfirmedWallMaterial = !measurementGraph
    || observedWallFacets.length === 0
    || observedWallFacets.some(f => (
      !f?.face
      || f.face === 'unknown'
       || !(
         materialMap?.faces?.[f.face]?.regions?.some(region =>
           region?.material && !['unknown', 'other'].includes(region.material),
         )
         || f.siding_material
       )
       || (
         !materialMap?.faces?.[f.face]?.regions?.some(region =>
           region?.material && !['unknown', 'other'].includes(region.material),
         )
         && /unknown|unconfirmed|unclassified|pending/i.test(String(f.siding_material))
       )
    ))
    // A traced wing can have more wall edges than the four cardinal records
    // commonly returned by the classifier; those extra edges are assumptions.
    || (footprintPolygon
      && footprintPolygon.length > 4
      && observedWallFacets.length < footprintPolygon.length);

  const btn=(active,accent)=>({
    fontSize:11,padding:'3px 10px',borderRadius:5,fontWeight:600,cursor:'pointer',border:'none',
    background:active?accent:'rgba(0,0,0,0.38)',color:'#fff',backdropFilter:'blur(4px)',
    fontFamily:'system-ui,sans-serif',
  });

  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-gray-600 bg-gray-900"
         style={{position:'relative'}}>
      <div ref={mountRef} style={{width:'100%',height:420}}/>

      {viewerError && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/95 px-6 text-center text-slate-100"
          data-testid="house-model-3d-error"
          style={{
            position: 'absolute', inset: 0, zIndex: 20, display: 'flex',
            flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: 24, textAlign: 'center', color: '#f8fafc',
            background: 'rgba(2, 6, 23, 0.96)',
          }}
        >
          <p className="max-w-sm text-sm font-medium" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{viewerError}</p>
          <p className="max-w-sm text-xs text-slate-300" style={{ margin: 0, maxWidth: 360, fontSize: 12, color: '#cbd5e1' }}>
            Your 2D measurements are still available. Try again, or continue using the report and elevation views.
          </p>
          <button
            type="button"
            onClick={() => {
              setViewerError(null);
              setViewerAttempt(attempt => attempt + 1);
            }}
            className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-200"
            style={{ border: 0, borderRadius: 6, padding: '7px 12px', background: '#fff', color: '#0f172a', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            data-testid="button-retry-house-model-3d"
          >
            Try 3D Again
          </button>
        </div>
      )}

      {presentation && !aerial && !presentationAllowed && !presentationOverride && (
        photoPresent?.available ? (
          // ── PhotoPresent ────────────────────────────────────────────────────
          // The mesh is not customer-safe, but the homeowner's own elevation
          // photo is. Show it full-panel with the material/quantity chips we
          // actually classified, so Present is a real answer instead of a lock.
          <div
            data-testid="presentation-photo-present"
            style={{
              position:'absolute',inset:0,zIndex:19,display:'flex',flexDirection:'column',
              background:'#0f172a',color:'#f8fafc',fontFamily:'system-ui,sans-serif',
            }}
          >
            <div style={{position:'relative',flex:'1 1 auto',minHeight:0,background:'#020617'}}>
              <img
                src={photoPresent.photo.url}
                alt={photoPresent.photo.label}
                data-testid="img-photo-present"
                style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}
              />
              <div style={{
                position:'absolute',top:10,left:10,padding:'4px 9px',borderRadius:999,
                background:'rgba(15,23,42,0.82)',fontSize:11,fontWeight:800,letterSpacing:0.3,
              }}>
                📷 {photoPresent.photo.label}
              </div>
            </div>
            <div style={{padding:'10px 14px 12px',borderTop:'1px solid rgba(148,163,184,0.28)'}}>
              {photoPresent.banner && (
                <p data-testid="text-photo-present-banner" style={{margin:'0 0 7px',fontSize:11,lineHeight:1.45,color:'#cbd5e1'}}>
                  {photoPresent.banner}
                </p>
              )}
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {(photoPresent.chips || []).map(chip => (
                  <span
                    key={chip.key}
                    data-testid={`chip-photo-present-${chip.key}`}
                    style={{
                      display:'inline-flex',gap:5,alignItems:'baseline',padding:'3px 8px',
                      borderRadius:999,background:'rgba(30,41,59,0.9)',
                      border:'1px solid rgba(148,163,184,0.35)',fontSize:11,
                    }}
                  >
                    <span style={{color:'#94a3b8'}}>{chip.label}</span>
                    <strong style={{color:'#f8fafc'}}>{chip.value}</strong>
                  </span>
                ))}
              </div>
              {(photoPresent.materialLines || []).length > 0 && (
                <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
                  {photoPresent.materialLines.map(line => (
                    <span key={line.face} style={{fontSize:10,color:'#94a3b8'}}>
                      {line.label}: {line.dominant || 'unclassified'}
                      {line.sidingPercent != null ? ` · ${Math.round(line.sidingPercent)}% siding` : ''}
                    </span>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:9}}>
                <button
                  type="button"
                  onClick={() => {
                    setPresentation(false);
                    onPresentationChange?.(false);
                  }}
                  style={{border:0,borderRadius:6,padding:'6px 11px',background:'#fff',color:'#0f172a',fontSize:11,fontWeight:800,cursor:'pointer'}}
                  data-testid="button-show-build-accuracy"
                >
                  Show Build accuracy view
                </button>
                {onPresentationOverride && (
                  <button
                    type="button"
                    onClick={onPresentationOverride}
                    style={{border:'1px solid #fdba74',borderRadius:6,padding:'6px 11px',background:'#7c2d12',color:'#ffedd5',fontSize:11,fontWeight:800,cursor:'pointer'}}
                    data-testid="button-show-anyway-build-accuracy"
                  >
                    Show anyway (Build accuracy)
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            data-testid="presentation-blocked"
            style={{
              position:'absolute',inset:0,zIndex:19,display:'flex',
              flexDirection:'column',alignItems:'center',justifyContent:'center',
              gap:10,padding:24,textAlign:'center',
              background:'rgba(15,23,42,0.94)',color:'#f8fafc',
              fontFamily:'system-ui,sans-serif',
            }}
          >
            <div style={{fontSize:22}}>🔒</div>
            <p style={{margin:0,fontSize:14,fontWeight:800}}>Present view is blocked for this measurement</p>
            <p style={{margin:0,maxWidth:420,fontSize:12,lineHeight:1.5,color:'#cbd5e1'}}>
              This prevents an extrusion-only or blank-wall model from being shown to a homeowner.
              {presentationBlockReasons.slice(0, 2).map(reason => (
                <span key={reason} style={{display:'block',marginTop:3}}>• {reason}</span>
              ))}
            </p>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
              <button
                type="button"
                onClick={() => {
                  setPresentation(false);
                  onPresentationChange?.(false);
                }}
                style={{border:0,borderRadius:6,padding:'7px 12px',background:'#fff',color:'#0f172a',fontSize:12,fontWeight:800,cursor:'pointer'}}
                data-testid="button-show-build-accuracy"
              >
                Show Build accuracy view
              </button>
              {onPresentationOverride && (
                <button
                  type="button"
                  onClick={onPresentationOverride}
                  style={{border:'1px solid #fdba74',borderRadius:6,padding:'7px 12px',background:'#7c2d12',color:'#ffedd5',fontSize:12,fontWeight:800,cursor:'pointer'}}
                  data-testid="button-show-anyway-build-accuracy"
                >
                  Show anyway (Build accuracy)
                </button>
              )}
            </div>
          </div>
        )
      )}

      {/* Toolbar */}
      <div style={{position:'absolute',top:8,left:8,display:'flex',gap:5,zIndex:10,flexWrap:'wrap',maxWidth:'calc(100% - 96px)'}}>
        <button onClick={()=>{
                  setPresentation(v=>{
                    const next=!v;
                    onPresentationChange?.(next);
                    return next;
                  });
                }} style={btn(true,presentation?'#0f766e':'#334155')}
                title={presentation
                  ? 'Clean render for the homeowner — switch to see measurements'
                  : 'Measurement overlays on — switch back to the clean homeowner render'}
                data-testid="button-toggle-presentation-view">
          {presentation ? '🏡 Customer view' : '📐 Estimator view'}
        </button>
        {!presentation && (
          <button onClick={()=>setShowLabels(v=>!v)} style={btn(showLabels,'#1a6b5a')}>
            📐 Labels
          </button>
        )}
        <button onClick={()=>setWainscot(v=>!v)} style={btn(wainscot,'#7a4510')}>
          🪨 Stone
        </button>
        {(photos || []).length > 0 && (
          <button onClick={()=>setPhotoTex(v=>!v)} style={btn(photoTex,'#1d4ed8')}
                  title="Wrap the real facade photos onto the walls (illustrative — not measurement)">
            📷 Photos
          </button>
        )}
        <button onClick={()=>setAerial(v=>!v)} style={btn(aerial,'#0891b2')}
                title="Top-down satellite takeoff — the Google Solar roof we already measured, viewed from above"
                data-testid="button-toggle-aerial-roof">
          🛰 Aerial roof
        </button>
        {onGeneratePresentationRender && (
          <button
            onClick={() => capturePresentation().catch(err => onGeneratePresentationRender(null, err))}
            disabled={presentationRenderPending || (!presentationAllowed && !presentationOverride)}
            style={{...btn(false,''), background:'#7c3aed', opacity:(presentationRenderPending || (!presentationAllowed && !presentationOverride))?0.5:1}}
            title={!presentationAllowed && !presentationOverride
              ? 'Blocked until the wall measurement review is complete'
              : 'Generate a photorealistic customer-facing illustration from this measured model'}
            data-testid="button-generate-presentation-render"
          >
            {presentationRenderPending ? '✨ Rendering…' : '✨ Presentation render'}
          </button>
        )}
        {Number.isFinite(selectedFacadeAzimuth) && (
          <div
            data-testid="house-model-selected-facade"
            style={{...btn(false,''), background:'rgba(37,99,235,0.9)', cursor:'default'}}
            title="The blue wall is the calculated facade selected from the map compass controls"
          >
            ◉ {azimuthToCardinal(selectedFacadeAzimuth)} facade
          </div>
        )}
        {/* Diagnostic badges are estimator context — the homeowner render stays clean. */}
        {!presentation && (footprintPolygon ? (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(180,220,160,0.85)'}}>
            📍 Real shape
          </div>
        ) : (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(210,190,130,0.85)'}}
               title={footprintSource ? `Footprint source: ${footprintSource}` : 'No OSM polygon — using estimated rectangle'}>
            ⬜ Estimated shape
          </div>
        ))}
        {/* Footprint classification badge */}
        {!presentation && <div
        data-testid="footprint-class-badge"
        style={{
          ...btn(false,''),
          background: footprintClass.type === 'rectangle'
            ? 'rgba(12,60,22,0.60)'
            : footprintClass.type === 'l-shape'
            ? 'rgba(60,40,10,0.60)'
            : 'rgba(50,10,60,0.60)',
          cursor: 'default', fontSize: 9,
          color: footprintClass.type === 'rectangle'
            ? 'rgba(140,255,160,0.88)'
            : footprintClass.type === 'l-shape'
            ? 'rgba(255,210,110,0.88)'
            : 'rgba(230,160,255,0.88)',
        }}
        title={`Footprint: ${footprintClass.type} | L=${footprintClass.L?.toFixed(0)} W=${footprintClass.W?.toFixed(0)} fill=${(footprintClass.fillRatio*100).toFixed(0)}%`}>
          {footprintClass.type === 'rectangle' ? '▬' : footprintClass.type === 'l-shape' ? '⌐' : '⊤'}
          {' '}{footprintClass.type.replace('-',' ')}
          {footprintClass.isSquare ? ' (sq)' : ''}
          {forcedParametric ? ' · parametric' : ''}
        </div>}

        {!presentation && (hasCompletePhotoRoof ? (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(150,235,215,0.9)'}}
               title="Calibrated physical-photo planes; verify field measurements before ordering"
               data-testid="house-model-3d-facet-count">
             📷 {renderedFacetCount} measured roof planes
          </div>
        ) : hasFacetRoof ? (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(190,170,255,0.9)'}}
               title="Classified facet geometry: ridge/hip/valley/rake/eave edges from satellite segments"
               data-testid="house-model-3d-facet-count">
             🏔 {renderedFacetCount} classified facets
          </div>
        ) : hasSegments ? (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(180,200,255,0.85)'}}
               title={`${filteredSegments.length} Solar API segments (${rawSegments.length - filteredSegments.length} micro-segments dropped)`}
               data-testid="house-model-3d-facet-count">
             🛰 {renderedFacetCount} roof planes
          </div>
        ) : photoVerifiedPitch ? (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(150,235,150,0.9)'}}
               title={`Ground-photo pitch ${pitchStr} overrode the satellite DSM slopes; parametric ${isHip ? 'hip' : 'gable'} snapped to the photo-verified angle`}>
            📷 Photo-verified pitch {pitchStr}
          </div>
        ) : (
          <div style={{...btn(false,''), background:'rgba(20,20,18,0.55)', cursor:'default', fontSize:9, color:'rgba(235,190,120,0.9)'}}
               title={forcedParametric
                 ? `Parametric ${isHip ? 'hip' : 'gable'} — Solar had ${rawSegments.length} segments for a simple rectangle; replaced with clean topology`
                  : 'Roof planes are inferred from footprint, roof type, and pitch'}
               data-testid="house-model-3d-facet-count">
             {forcedParametric ? '🔷' : '⚠'} {forcedParametric
               ? `Parametric ${isHip ? 'hip' : 'gable'} · ${renderedFacetCount} facets`
               : `Inferred roof geometry · ${renderedFacetCount} facets`}
          </div>
        ))}
      </div>

      <div style={{position:'absolute',top:8,right:8,zIndex:10,color:'rgba(255,255,255,0.32)',
                   fontSize:10,pointerEvents:'none',fontFamily:'system-ui,sans-serif'}}>
        Drag · scroll to zoom
      </div>

       {presentation && !aerial && hasUnconfirmedWallMaterial && (
        <div
          data-testid="material-unconfirmed-banner"
          style={{
            position:'absolute',top:42,left:8,zIndex:11,maxWidth:'calc(100% - 16px)',
            padding:'5px 9px',borderRadius:5,border:'1px solid rgba(251,146,60,0.65)',
            background:'rgba(124,45,18,0.92)',color:'#ffedd5',fontSize:10,
            fontWeight:700,fontFamily:'system-ui,sans-serif',boxShadow:'0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          Material unconfirmed — visual cladding is an assumption
        </div>
      )}

      {/* Facet hover tooltip — estimator layer only */}
      {tooltip && !presentation && (hasSegments || hasFacetRoof) && (
        <div style={{
          position:'absolute',
          left: tooltip.x + 14,
          top:  Math.max(4, tooltip.y - 100),
          zIndex:20, pointerEvents:'none',
          background:'rgba(10,12,22,0.93)',
          color:'#e8e4d8',
          fontSize:11, fontFamily:'system-ui,sans-serif',
          padding:'8px 12px', borderRadius:7,
          border:'1px solid rgba(130,160,255,0.22)',
          backdropFilter:'blur(6px)',
          boxShadow:'0 4px 18px rgba(0,0,0,0.55)',
          minWidth:152, lineHeight:'1.75',
        }}>
          <div style={{fontWeight:700,marginBottom:3,color:'#8ab0ff',fontSize:12,letterSpacing:'0.3px'}}>
            {azimuthToCardinal(tooltip.azimuthDeg)} · {tooltip.azimuthDeg.toFixed(0)}°
          </div>
          <div>⛰ {degToSlope(tooltip.pitchDeg)} pitch</div>
          <div>📐 {Math.round(tooltip.areaSqft).toLocaleString()} ft²</div>
        </div>
      )}

      {/* Aerial takeoff: no Solar geometry for this address. Same panel, honest
          empty state — never a faked top-down roof. */}
      {aerial && !hasSatelliteTakeoff && (
        <div
          data-testid="aerial-roof-empty"
          style={{position:'absolute',inset:0,zIndex:15,display:'flex',flexDirection:'column',
                  alignItems:'center',justifyContent:'center',gap:10,padding:24,textAlign:'center',
                  background:'rgba(2,6,23,0.88)',fontFamily:'system-ui,sans-serif'}}
        >
          <p style={{margin:0,fontSize:14,fontWeight:700,color:'#f8fafc'}}>
            {aerialEmptyReason === 'no_coverage'
              ? 'No Google Solar coverage for this address'
              : 'No satellite takeoff shown for this roof'}
          </p>
          <div style={{maxWidth:420,background:'#fff7ed',border:'1px solid #fdba74',borderRadius:8,
                       padding:'8px 12px',fontSize:12,color:'#9a3412',lineHeight:1.45}}>
            {aerialEmptyReason === 'no_coverage'
              ? 'Satellite takeoff assumption — confirm before using. Google Solar returned no aerial roof geometry, so nothing is drawn here. Measure from photos or draw the roof manually instead.'
              : 'Satellite takeoff assumption — confirm before using. This roof is measured from a more trustworthy source (photo-measured planes, a traced outline, or a manual pitch), so the Solar geometry is not shown.'}
          </div>
          <button
            type="button"
            onClick={() => setAerial(false)}
            data-testid="button-exit-aerial-roof"
            style={{border:0,borderRadius:6,padding:'7px 12px',background:'#fff',color:'#0f172a',
                    fontSize:12,fontWeight:700,cursor:'pointer'}}
          >
            Back to 3D view
          </button>
        </div>
      )}

      {/* Aerial takeoff technical footer — same blue technical line style. */}
      {aerial && hasSatelliteTakeoff && (
        <div
          data-testid="aerial-roof-footer"
          style={{position:'absolute',bottom:8,left:8,right:8,zIndex:12,pointerEvents:'none',
                  background:'rgba(37,99,235,0.92)',color:'#eaf2ff',fontSize:10,padding:'3px 9px',
                  borderRadius:4,fontFamily:'system-ui,sans-serif',backdropFilter:'blur(4px)',
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}
        >
          {presentation ? aerialPresentationLine : aerialFooterLine}
        </div>
      )}

      {presentation && !aerial && (
        <div
          data-testid="house-model-3d-disclaimer"
          style={{
            position:'absolute',bottom:8,left:'50%',transform:'translateX(-50%)',
            zIndex:11,pointerEvents:'none',padding:'3px 9px',borderRadius:4,
            background:'rgba(15,23,42,0.68)',color:'rgba(255,255,255,0.86)',
            fontSize:10,fontFamily:'system-ui,sans-serif',whiteSpace:'nowrap',
          }}
        >
          Estimate measurements — verify on site.
        </div>
      )}

      {/* Spec pill */}
      {!presentation && !aerial && (
        <div style={{position:'absolute',bottom:8,left:8,zIndex:10,pointerEvents:'none',...pill}}>
          {L.toFixed(0)}×{W.toFixed(0)} ft · {wallH.toFixed(0)} ft walls · {pitchStr} · {renderedFacetCount} facets · {stories}s
        </div>
      )}

      {/* Stats */}
      {showLabels && !presentation && !aerial && (
        <div style={{position:'absolute',bottom:8,right:8,zIndex:10,
                     display:'flex',flexDirection:'column',gap:3,alignItems:'flex-end',pointerEvents:'none'}}>
          {roofAreaSq>0&&(
            <div style={{background:'rgba(20,40,100,0.76)',color:'#c8deff',fontSize:10,
                         padding:'2px 8px',borderRadius:4,whiteSpace:'nowrap',backdropFilter:'blur(4px)',fontFamily:'system-ui,sans-serif'}}>
              🏠 {roofAreaSq.toFixed(1)} SQ roof
            </div>
          )}
          {Number(wallAreaSqft)>0&&(
            <div style={{background:'rgba(10,70,50,0.76)',color:'#b8f0d8',fontSize:10,
                         padding:'2px 8px',borderRadius:4,whiteSpace:'nowrap',backdropFilter:'blur(4px)',fontFamily:'system-ui,sans-serif'}}>
              📐 {Number(wallAreaSqft).toLocaleString()} ft² siding
            </div>
          )}
          {perimNum>0&&(
            <div style={{...pill,whiteSpace:'nowrap'}}>
              ⬜ {perimNum.toFixed(0)} LF perimeter
            </div>
          )}
        </div>
      )}
    </div>
  );
}
