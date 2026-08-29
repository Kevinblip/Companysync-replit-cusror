/**
 * Assemble a single house mesh from AI Estimator photo + satellite/solar data.
 *
 * Production bug this replaces: roof facets drawn from independent Google Solar
 * bounding boxes (each in its own origin, or lat/lng treated as local meters)
 * floating over a default 48 ft × 9 ft "NOT PHOTOGRAPHED" wall box, even when
 * the user had already uploaded facade photos.
 *
 * This module keeps ONE coordinate frame (feet, Z-up, origin at footprint
 * center). Walls come from the estimator footprint; roof planes sit on the
 * eaves. Uploaded facade photos become wall textures and elevation drawings.
 *
 * Hover is not a data source here.
 */

export const DEFAULT_ESTIMATED_WIDTH_FT = 48;
export const DEFAULT_ESTIMATED_HEIGHT_FT = 9;

const MATERIAL_COLORS = {
  roof: 0x2a2a2e,
  siding: 0xc4b49a,
  stone: 0x8b6b4a,
  brick: 0x8a4a3a,
  concrete: 0x8a8a8a,
  stucco: 0xd9d0c1,
  opening: 0xdce8f5,
  trim: 0xf4f0e8,
  unknown: 0xb0b0b0,
};

const VIEW_ALIASES = {
  front: ['front', 'south', 's facade', 'customer', 'front view', 'front elevation'],
  right: ['right', 'east', 'e facade', 'right side', 'right elevation', 'right_elevation'],
  back: ['back', 'rear', 'north', 'n facade', 'rear view', 'rear elevation', 'back elevation'],
  left: ['left', 'west', 'w facade', 'left side', 'left elevation', 'left_elevation'],
};

export function materialColor(material) {
  return MATERIAL_COLORS[material] || MATERIAL_COLORS.unknown;
}

export function inferMaterial(value = {}) {
  const raw = typeof value === 'string'
    ? value
    : `${value.material || ''} ${value.siding_material || ''} ${value.primary_cladding || ''} ${value.name || ''} ${value.type || ''}`;
  const name = String(raw).toLowerCase();
  if (name.includes('roof')) return 'roof';
  if (name.includes('window') || name.includes('door') || name.includes('opening')) return 'opening';
  if (name.includes('stone') || name.includes('masonry veneer')) return 'stone';
  if (name.includes('brick')) return 'brick';
  if (name.includes('concrete') || name.includes('cinder') || name.includes('block')) return 'concrete';
  if (name.includes('stucco')) return 'stucco';
  if (name.includes('trim')) return 'trim';
  if (name.includes('siding') || name.includes('vinyl') || name.includes('fiber') || name.includes('wood') || name.includes('aluminum') || name.includes('lap')) {
    return 'siding';
  }
  if (name.includes('wall')) return 'siding';
  return 'unknown';
}

export function latLngToLocalFt(lat, lng, originLat, originLng) {
  const east = (lng - originLng) * Math.cos((originLat * Math.PI) / 180) * 364000;
  const north = (lat - originLat) * 364000;
  return { x: east, y: north };
}

export function boundingBox(vertices) {
  if (!vertices?.length) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 } };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of vertices) {
    if (!v) continue;
    min.x = Math.min(min.x, v.x);
    min.y = Math.min(min.y, v.y);
    min.z = Math.min(min.z, v.z);
    max.x = Math.max(max.x, v.x);
    max.y = Math.max(max.y, v.y);
    max.z = Math.max(max.z, v.z);
  }
  return {
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

export function centroid(vertices) {
  if (!vertices?.length) return { x: 0, y: 0, z: 0 };
  const s = vertices.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }), { x: 0, y: 0, z: 0 });
  const n = vertices.length;
  return { x: s.x / n, y: s.y / n, z: s.z / n };
}

export function faceNormal(vertices) {
  if (!vertices || vertices.length < 3) return { x: 0, y: 0, z: 1 };
  const a = vertices[0];
  const b = vertices[1];
  const c = vertices[2];
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/**
 * True when roof planes sit on the walls in a shared frame (not exploded).
 */
export function isHouseAssembled(faces, { maxGapFactor = 0.35 } = {}) {
  const walls = (faces || []).filter(f => {
    const t = String(f.type || '').toUpperCase();
    return t.includes('WALL') && !t.includes('PENETRATION');
  });
  const roofs = (faces || []).filter(f => String(f.type || '').toUpperCase().includes('ROOF'));
  if (!walls.length || !roofs.length) return false;

  const wallBox = boundingBox(walls.flatMap(f => f.vertices));
  const roofBox = boundingBox(roofs.flatMap(f => f.vertices));
  const houseBox = boundingBox([...walls, ...roofs].flatMap(f => f.vertices));
  const diag = Math.hypot(houseBox.size.x, houseBox.size.y, houseBox.size.z) || 1;

  const overlapX = Math.min(wallBox.max.x, roofBox.max.x) - Math.max(wallBox.min.x, roofBox.min.x);
  const overlapY = Math.min(wallBox.max.y, roofBox.max.y) - Math.max(wallBox.min.y, roofBox.min.y);
  const xyOverlap = overlapX > 0 && overlapY > 0;

  // Gable end walls can rise to the ridge, so wall max Z may equal roof max Z.
  // Connected means the roof sits on/over the walls, not floating in a separate origin.
  const verticallyConnected =
    roofBox.min.z >= -0.5
    && roofBox.min.z <= wallBox.max.z + Math.max(6, houseBox.size.z * maxGapFactor)
    && roofBox.max.z >= wallBox.max.z - 2;

  const wallC = centroid(walls.flatMap(f => f.vertices));
  const roofC = centroid(roofs.flatMap(f => f.vertices));
  const xySep = Math.hypot(wallC.x - roofC.x, wallC.y - roofC.y);

  return xyOverlap && verticallyConnected && xySep < diag * 0.5;
}

function quad(a, b, c, d) {
  return [a, b, c, d];
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function pitchTo12(pitch) {
  if (pitch == null || pitch === '') return 6;
  if (typeof pitch === 'number' && Number.isFinite(pitch)) {
    return pitch > 20 ? Math.round(Math.tan((pitch * Math.PI) / 180) * 12) : pitch;
  }
  const str = String(pitch);
  const deg = str.match(/([0-9.]+)\s*°/);
  if (deg) return Math.max(1, Math.round(Math.tan((Number(deg[1]) * Math.PI) / 180) * 12));
  const frac = str.match(/([0-9.]+)\s*\/\s*12/);
  if (frac) return Number(frac[1]) || 6;
  const n = Number(str);
  return Number.isFinite(n) && n > 0 ? n : 6;
}

export function photoForView(photos, viewId) {
  if (!photos?.length) return null;
  const keys = VIEW_ALIASES[viewId] || [viewId];
  return photos.find(p => {
    const label = `${p.label || p.name || p.heading || p.category || ''}`.toLowerCase().replace(/[_-]+/g, ' ');
    return keys.some(k => label.includes(k));
  }) || null;
}

export function photosFromLeadDocuments(documents = []) {
  const map = {
    front: 'Front',
    rear: 'Back',
    back: 'Back',
    left_elevation: 'Left Side',
    right_elevation: 'Right Side',
    left: 'Left Side',
    right: 'Right Side',
  };
  return (documents || [])
    .filter(d => {
      const type = String(d.file_type || d.mime_type || '');
      const url = d.file_url || d.url;
      if (!url) return false;
      if (type && !type.startsWith('image/') && !/\.(jpe?g|png|webp|gif)$/i.test(url)) return false;
      return true;
    })
    .map(d => {
      const cat = String(d.category || d.label || d.document_name || '').toLowerCase();
      const label = map[cat] || map[cat.replace(/\s+/g, '_')] || d.category || d.document_name || 'Photo';
      return {
        url: d.file_url || d.url,
        label,
        name: d.document_name || d.name,
        category: d.category,
      };
    });
}

function claddingForPhoto(photo, analysis) {
  const breakdown = analysis?.per_photo_breakdown || analysis?.photo_details || [];
  const row = breakdown.find(r => {
    const label = `${r.label || r.view_label || ''}`.toLowerCase();
    const photoLabel = `${photo?.label || ''}`.toLowerCase();
    return photoLabel && (label === photoLabel || label.includes(photoLabel) || photoLabel.includes(label));
  });
  const primary = inferMaterial(row?.primary_cladding || row?.siding_material || analysis?.siding_material || photo?.material);
  const secondary = row?.secondary_cladding ? inferMaterial(row.secondary_cladding) : null;
  return {
    primary: primary === 'unknown' ? 'siding' : primary,
    secondary: secondary && secondary !== 'unknown' ? secondary : null,
    region: row?.secondary_cladding_region || null,
    secondaryHeightFt: Number(row?.secondary_height_ft) || null,
    row,
  };
}

function gableRoofFaces(lengthFt, widthFt, eaveH, pitch12) {
  const L = lengthFt;
  const W = widthFt;
  const rise = (W / 2) * (pitch12 / 12);
  const ridgeZ = eaveH + rise;
  const hx = W / 2;
  const hy = L / 2;
  const left = quad(
    { x: -hx, y: -hy, z: eaveH },
    { x: -hx, y: hy, z: eaveH },
    { x: 0, y: hy, z: ridgeZ },
    { x: 0, y: -hy, z: ridgeZ },
  );
  const right = quad(
    { x: hx, y: -hy, z: eaveH },
    { x: hx, y: hy, z: eaveH },
    { x: 0, y: hy, z: ridgeZ },
    { x: 0, y: -hy, z: ridgeZ },
  );
  return [
    { id: 'RF-L', type: 'ROOF', name: 'RF-1', material: 'roof', vertices: left, pitch: pitch12 },
    { id: 'RF-R', type: 'ROOF', name: 'RF-2', material: 'roof', vertices: right, pitch: pitch12 },
  ];
}

function hipRoofFaces(lengthFt, widthFt, eaveH, pitch12) {
  const L = lengthFt;
  const W = widthFt;
  const rise = (Math.min(W, L) / 2) * (pitch12 / 12);
  const ridgeZ = eaveH + rise;
  const hx = W / 2;
  const hy = L / 2;
  const ridgeHalf = Math.max(0.5, Math.abs(hy - hx));
  const ridgeY = L >= W ? ridgeHalf : 0;
  const ridgeX = L >= W ? 0 : ridgeHalf;
  const nw = { x: -hx, y: hy, z: eaveH };
  const ne = { x: hx, y: hy, z: eaveH };
  const se = { x: hx, y: -hy, z: eaveH };
  const sw = { x: -hx, y: -hy, z: eaveH };
  if (L >= W) {
    return [
      { id: 'RF-N', type: 'ROOF', name: 'RF-N', material: 'roof', vertices: [nw, ne, { x: 0, y: ridgeY, z: ridgeZ }], pitch: pitch12 },
      { id: 'RF-S', type: 'ROOF', name: 'RF-S', material: 'roof', vertices: [se, sw, { x: 0, y: -ridgeY, z: ridgeZ }], pitch: pitch12 },
      { id: 'RF-E', type: 'ROOF', name: 'RF-E', material: 'roof', vertices: [ne, se, { x: 0, y: -ridgeY, z: ridgeZ }, { x: 0, y: ridgeY, z: ridgeZ }], pitch: pitch12 },
      { id: 'RF-W', type: 'ROOF', name: 'RF-W', material: 'roof', vertices: [sw, nw, { x: 0, y: ridgeY, z: ridgeZ }, { x: 0, y: -ridgeY, z: ridgeZ }], pitch: pitch12 },
    ];
  }
  return [
    { id: 'RF-N', type: 'ROOF', name: 'RF-N', material: 'roof', vertices: [nw, ne, { x: ridgeX, y: 0, z: ridgeZ }, { x: -ridgeX, y: 0, z: ridgeZ }], pitch: pitch12 },
    { id: 'RF-S', type: 'ROOF', name: 'RF-S', material: 'roof', vertices: [se, sw, { x: -ridgeX, y: 0, z: ridgeZ }, { x: ridgeX, y: 0, z: ridgeZ }], pitch: pitch12 },
    { id: 'RF-E', type: 'ROOF', name: 'RF-E', material: 'roof', vertices: [ne, se, { x: ridgeX, y: 0, z: ridgeZ }], pitch: pitch12 },
    { id: 'RF-W', type: 'ROOF', name: 'RF-W', material: 'roof', vertices: [sw, nw, { x: -ridgeX, y: 0, z: ridgeZ }], pitch: pitch12 },
  ];
}

function wallUv(u0, v0, u1, v1) {
  return { u0, v0, u1, v1 };
}

function makeWallFace({
  id, name, compass, viewId, material, vertices, photo, uv = wallUv(0, 0, 1, 1),
}) {
  return {
    id,
    type: 'WALL',
    name,
    material,
    compass,
    viewId,
    vertices,
    photoUrl: photo?.url || photo?.preview || photo?.imageUrl || null,
    photoLabel: photo?.label || null,
    uv,
  };
}

function splitWallByMasonry(face, cladding, eaveH) {
  if (!cladding?.secondary || cladding.region !== 'lower') return [face];
  const splitZ = Math.min(eaveH * 0.85, Math.max(2, cladding.secondaryHeightFt || eaveH * 0.45));
  const verts = face.vertices;
  if (!verts || verts.length !== 4) return [face];
  const [bl, br, tr, tl] = verts;
  const brMid = { x: br.x, y: br.y, z: splitZ };
  const blMid = { x: bl.x, y: bl.y, z: splitZ };
  const vRatio = splitZ / Math.max(eaveH, 0.01);
  const lower = makeWallFace({
    id: `${face.id}-LO`,
    name: `${face.name} (lower)`,
    compass: face.compass,
    viewId: face.viewId,
    material: cladding.secondary,
    vertices: quad(bl, br, brMid, blMid),
    photo: { url: face.photoUrl, label: face.photoLabel },
    uv: wallUv(0, 0, 1, vRatio),
  });
  const upper = makeWallFace({
    id: `${face.id}-UP`,
    name: `${face.name} (upper)`,
    compass: face.compass,
    viewId: face.viewId,
    material: cladding.primary,
    vertices: quad(blMid, brMid, tr, tl),
    photo: { url: face.photoUrl, label: face.photoLabel },
    uv: wallUv(0, vRatio, 1, 1),
  });
  return [lower, upper];
}

function boxWallFaces(lengthFt, widthFt, eaveH, { photos = [], photoAnalysis = null, gable = false, pitch12 = 6 } = {}) {
  const hx = widthFt / 2;
  const hy = lengthFt / 2;
  const rise = gable ? (widthFt / 2) * (pitch12 / 12) : 0;
  const ridgeZ = eaveH + rise;

  const specs = [
    {
      id: 'WA-S', name: 'Front', compass: 'S', viewId: 'front',
      rect: quad({ x: -hx, y: -hy, z: 0 }, { x: hx, y: -hy, z: 0 }, { x: hx, y: -hy, z: eaveH }, { x: -hx, y: -hy, z: eaveH }),
      gableVerts: gable ? [
        { x: -hx, y: -hy, z: 0 },
        { x: hx, y: -hy, z: 0 },
        { x: hx, y: -hy, z: eaveH },
        { x: 0, y: -hy, z: ridgeZ },
        { x: -hx, y: -hy, z: eaveH },
      ] : null,
    },
    {
      id: 'WA-E', name: 'Right Side', compass: 'E', viewId: 'right',
      rect: quad({ x: hx, y: -hy, z: 0 }, { x: hx, y: hy, z: 0 }, { x: hx, y: hy, z: eaveH }, { x: hx, y: -hy, z: eaveH }),
    },
    {
      id: 'WA-N', name: 'Back', compass: 'N', viewId: 'back',
      rect: quad({ x: hx, y: hy, z: 0 }, { x: -hx, y: hy, z: 0 }, { x: -hx, y: hy, z: eaveH }, { x: hx, y: hy, z: eaveH }),
      gableVerts: gable ? [
        { x: hx, y: hy, z: 0 },
        { x: -hx, y: hy, z: 0 },
        { x: -hx, y: hy, z: eaveH },
        { x: 0, y: hy, z: ridgeZ },
        { x: hx, y: hy, z: eaveH },
      ] : null,
    },
    {
      id: 'WA-W', name: 'Left Side', compass: 'W', viewId: 'left',
      rect: quad({ x: -hx, y: hy, z: 0 }, { x: -hx, y: -hy, z: 0 }, { x: -hx, y: -hy, z: eaveH }, { x: -hx, y: hy, z: eaveH }),
    },
  ];

  const faces = [];
  for (const spec of specs) {
    const photo = photoForView(photos, spec.viewId);
    const cladding = claddingForPhoto(photo, photoAnalysis);
    const useGable = Boolean(spec.gableVerts) && !cladding.secondary;
    const face = makeWallFace({
      id: spec.id,
      name: spec.name,
      compass: spec.compass,
      viewId: spec.viewId,
      material: cladding.primary,
      vertices: useGable ? spec.gableVerts : spec.rect,
      photo,
    });
    faces.push(...splitWallByMasonry(face, cladding, eaveH));
  }
  return faces;
}

/**
 * Convert Google Solar roofSegmentStats into roof faces in the SAME local
 * frame as the walls. Independent per-segment origins are rejected: every
 * corner is projected from one lat/lng origin, then snapped onto the eave.
 */
export function solarSegmentsToRoofFaces(segments, {
  originLat = null,
  originLng = null,
  eaveHeightFt = 9,
  lengthFt = 40,
  widthFt = 32,
} = {}) {
  const usable = (segments || []).filter(s => s?.boundingBox?.sw && s?.boundingBox?.ne);
  if (!usable.length) return [];

  const first = usable[0];
  const origin = {
    lat: originLat ?? first.center?.latitude ?? first.boundingBox.sw.latitude,
    lng: originLng ?? first.center?.longitude ?? first.boundingBox.sw.longitude,
  };

  const raw = usable.map((seg, i) => {
    const sw = latLngToLocalFt(seg.boundingBox.sw.latitude, seg.boundingBox.sw.longitude, origin.lat, origin.lng);
    const ne = latLngToLocalFt(seg.boundingBox.ne.latitude, seg.boundingBox.ne.longitude, origin.lat, origin.lng);
    const pitchDeg = Number(seg.pitchDegrees ?? seg.tiltDegrees) || 22;
    const az = ((Number(seg.azimuthDegrees) || 180) % 360 + 360) % 360;
    const azRad = (az * Math.PI) / 180;
    const downX = Math.sin(azRad);
    const downY = Math.cos(azRad);
    const corners = [
      { x: sw.x, y: sw.y },
      { x: ne.x, y: sw.y },
      { x: ne.x, y: ne.y },
      { x: sw.x, y: ne.y },
    ];
    const dots = corners.map(c => c.x * downX + c.y * downY);
    const minDot = Math.min(...dots);
    const maxDot = Math.max(...dots);
    const span = Math.max(maxDot - minDot, 0.1);
    const rise = span * Math.tan((pitchDeg * Math.PI) / 180);
    const vertices = corners.map((c, idx) => {
      const t = (dots[idx] - minDot) / span;
      return { x: c.x, y: c.y, z: eaveHeightFt + (1 - t) * rise };
    });
    return {
      id: `RF-SEG-${i}`,
      type: 'ROOF',
      name: `Roof ${i + 1}`,
      material: 'roof',
      azimuth: az,
      pitch: Math.round(Math.tan((pitchDeg * Math.PI) / 180) * 12) || 6,
      vertices,
    };
  });

  const all = raw.flatMap(f => f.vertices);
  const c = centroid(all);
  const box = boundingBox(all);
  const minZ = Math.min(...all.map(v => v.z));
  const dz = eaveHeightFt - minZ;

  const targetW = Math.max(8, Number(widthFt) || box.size.x);
  const targetL = Math.max(8, Number(lengthFt) || box.size.y);
  let scaleX = 1;
  let scaleY = 1;
  // Independent-origin / lat-as-meters blow-up: scale back onto the footprint.
  if (box.size.x > targetW * 1.35) scaleX = targetW / Math.max(box.size.x, 0.1);
  if (box.size.y > targetL * 1.35) scaleY = targetL / Math.max(box.size.y, 0.1);

  return raw.map(f => ({
    ...f,
    vertices: f.vertices.map(v => ({
      x: (v.x - c.x) * scaleX,
      y: (v.y - c.y) * scaleY,
      z: v.z + dz,
    })),
  }));
}

function footprintFromInputs({
  photos = [],
  photoAnalysis = null,
  satelliteAnalysis = null,
  sidingMeasurements = null,
} = {}) {
  const m = sidingMeasurements || {};
  const p = photoAnalysis || {};
  const sat = satelliteAnalysis || {};
  const breakdown = p.per_photo_breakdown || p.photo_details || [];

  const num = (...vals) => {
    for (const v of vals) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  const frontW = breakdown.filter(r => /front/i.test(`${r.label || r.view_label || ''}`)).map(r => Number(r.wall_width_ft)).find(n => n > 0);
  const sideW = breakdown.filter(r => /left|right/i.test(`${r.label || r.view_label || ''}`)).map(r => Number(r.wall_width_ft)).find(n => n > 0);

  const widthFt = num(m.building_width_ft, p.building_width_ft, sat.building_width_ft, frontW) || (photos.length ? 36 : DEFAULT_ESTIMATED_WIDTH_FT);
  const lengthFt = num(m.building_length_ft, p.building_length_ft, sat.building_length_ft, sideW) || (photos.length ? 32 : 40);
  const stories = num(m.story_count, p.story_count, sat.story_count) || 1;
  // analyzeHousePhotosForSiding stores eave height in story_height_ft
  const eaveHeightFt = num(m.story_height_ft, p.story_height_ft, sat.eave_height_ft) || (stories * 9);
  const pitch = sat.pitch || m.pitch || p.pitch || '6/12';
  const roofType = sat.roof_type || m.roof_type || p.roof_type || 'gable';
  const measured = Boolean(
    m.building_width_ft || p.building_width_ft || sat.building_width_ft
    || m.building_length_ft || p.building_length_ft || sat.roof_area_sq
  );

  return {
    length_ft: round1(lengthFt),
    width_ft: round1(widthFt),
    eave_height_ft: round1(eaveHeightFt),
    story_count: stories,
    pitch,
    roof_type: roofType,
    measured,
  };
}

/**
 * Assemble a coherent house from estimator photos + satellite/solar numbers.
 * Roof planes share the wall frame and meet at the eaves.
 */
export function assembleEstimatorHouse(input = {}) {
  const {
    photos = [],
    photoAnalysis = null,
    satelliteAnalysis = null,
    sidingMeasurements = null,
    roofSegments = null,
    originLat = null,
    originLng = null,
  } = input;

  const fp = footprintFromInputs(input);
  const pitch12 = pitchTo12(fp.pitch);
  const isHip = /hip/i.test(String(fp.roof_type));
  const isGable = !isHip;

  const walls = boxWallFaces(fp.length_ft, fp.width_ft, fp.eave_height_ft, {
    photos,
    photoAnalysis,
    gable: isGable,
    pitch12,
  });

  const segs = roofSegments || satelliteAnalysis?.roof_segments || satelliteAnalysis?.roofSegments || [];
  let roofs = solarSegmentsToRoofFaces(segs, {
    originLat: originLat ?? input.latitude ?? satelliteAnalysis?.latitude,
    originLng: originLng ?? input.longitude ?? satelliteAnalysis?.longitude,
    eaveHeightFt: fp.eave_height_ft,
    lengthFt: fp.length_ft,
    widthFt: fp.width_ft,
  });

  let source = 'photos';
  if (roofs.length && isHouseAssembled([...walls, ...roofs])) {
    source = 'photos_solar';
  } else {
    roofs = isHip
      ? hipRoofFaces(fp.length_ft, fp.width_ft, fp.eave_height_ft, pitch12)
      : gableRoofFaces(fp.length_ft, fp.width_ft, fp.eave_height_ft, pitch12);
    source = segs.length ? 'photos_assembled' : 'photos_assembled';
  }

  const faces = [...walls, ...roofs];
  const photographedWalls = walls.filter(w => w.photoUrl);
  return {
    source,
    estimated: !fp.measured,
    faces,
    assembled: isHouseAssembled(faces),
    footprint: fp,
    photosUsed: photographedWalls.length,
  };
}

/** @deprecated Use assembleEstimatorHouse. Kept as an alias for assembled-footprint tests. */
export function assembleSolarHouse(opts = {}) {
  return assembleEstimatorHouse({
    satelliteAnalysis: {
      building_length_ft: opts.lengthFt,
      building_width_ft: opts.widthFt,
      story_height_ft: opts.eaveHeightFt,
      pitch: opts.pitch,
      roof_type: opts.roofType,
    },
  });
}

function projectWallToView(vertices, axis) {
  const xs = vertices.map(v => (axis === 'x' ? v.x : v.y));
  const zs = vertices.map(v => v.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    width_ft: Math.abs(maxX - minX),
    height_ft: Math.abs(maxZ - minZ),
    outline: vertices.map(v => ({
      u: (axis === 'x' ? v.x : v.y) - minX,
      v: v.z - minZ,
    })),
  };
}

/**
 * Four orthographic elevations.
 * If a facade photo exists, it is NEVER labeled "NOT PHOTOGRAPHED".
 * 48×9 placeholders are last-resort only when there are no walls and no photo.
 */
export function buildElevationDrawings(faces, { photos = [], estimated = false, footprint = null } = {}) {
  const walls = (faces || []).filter(f => {
    const t = String(f.type || '').toUpperCase();
    return t.includes('WALL') && !t.includes('PENETRATION');
  });

  const views = [
    { id: 'front', label: 'Front', dir: { x: 0, y: -1 }, axis: 'x' },
    { id: 'right', label: 'Right Side', dir: { x: 1, y: 0 }, axis: 'y' },
    { id: 'back', label: 'Back', dir: { x: 0, y: 1 }, axis: 'x' },
    { id: 'left', label: 'Left Side', dir: { x: -1, y: 0 }, axis: 'y' },
  ];

  return views.map(view => {
    const photo = photoForView(photos, view.id);
    const facing = walls
      .map(w => ({ wall: w, score: faceNormal(w.vertices).x * view.dir.x + faceNormal(w.vertices).y * view.dir.y }))
      .filter(x => x.score > 0.15)
      .sort((a, b) => b.score - a.score);

    if (!walls.length && !photo) {
      return {
        ...view,
        estimated: true,
        photographed: false,
        width_ft: footprint?.width_ft || DEFAULT_ESTIMATED_WIDTH_FT,
        height_ft: footprint?.eave_height_ft || DEFAULT_ESTIMATED_HEIGHT_FT,
        materials: [],
        outline: [
          { u: 0, v: 0 },
          { u: DEFAULT_ESTIMATED_WIDTH_FT, v: 0 },
          { u: DEFAULT_ESTIMATED_WIDTH_FT, v: DEFAULT_ESTIMATED_HEIGHT_FT },
          { u: 0, v: DEFAULT_ESTIMATED_HEIGHT_FT },
        ],
        photoUrl: null,
        caption: 'NOT PHOTOGRAPHED — ESTIMATED',
      };
    }

    const chosen = facing.length ? facing : walls.map(w => ({ wall: w, score: 0 }));
    const verts = chosen.flatMap(c => c.wall.vertices);
    const proj = verts.length
      ? projectWallToView(verts, view.axis)
      : {
        width_ft: view.axis === 'x' ? (footprint?.width_ft || 36) : (footprint?.length_ft || 32),
        height_ft: footprint?.eave_height_ft || 18,
        outline: [],
      };
    const materials = [...new Set(chosen.map(c => c.wall.material).filter(Boolean))];
    const photographed = Boolean(photo);
    return {
      id: view.id,
      label: view.label,
      estimated: photographed ? false : Boolean(estimated || !footprint?.measured),
      photographed,
      width_ft: round1(proj.width_ft),
      height_ft: round1(proj.height_ft),
      materials,
      outline: proj.outline,
      photoUrl: photo?.url || photo?.preview || photo?.imageUrl || chosen.find(c => c.wall.photoUrl)?.wall.photoUrl || null,
      caption: photographed
        ? 'From uploaded photo'
        : (estimated ? 'From measurements — not photographed' : 'From measurements — not photographed'),
    };
  });
}

export function listMaterials(faces) {
  const counts = {};
  for (const f of faces || []) {
    if (String(f.type || '').toUpperCase().includes('PENETRATION')) continue;
    const m = f.material || inferMaterial(f);
    counts[m] = (counts[m] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([id, facetCount]) => ({ id, label: id[0].toUpperCase() + id.slice(1), facetCount, color: materialColor(id) }))
    .sort((a, b) => b.facetCount - a.facetCount);
}

export function compassFacades(faces) {
  const walls = (faces || []).filter(f => String(f.type || '').toUpperCase() === 'WALL');
  const dirs = [
    { id: 'N', label: 'N facade', dir: { x: 0, y: 1 } },
    { id: 'E', label: 'E facade', dir: { x: 1, y: 0 } },
    { id: 'S', label: 'S facade', dir: { x: 0, y: -1 } },
    { id: 'W', label: 'W facade', dir: { x: -1, y: 0 } },
  ];
  return dirs.map(d => {
    const match = walls.find(w => {
      const n = faceNormal(w.vertices);
      return n.x * d.dir.x + n.y * d.dir.y > 0.5;
    });
    return { ...d, faceId: match?.id || null, material: match?.material || null };
  });
}

export function toViewerModel(assembled, { photos = [] } = {}) {
  const faces = assembled?.faces || [];
  return {
    source: assembled.source,
    estimated: Boolean(assembled.estimated),
    assembled: assembled.assembled ?? isHouseAssembled(faces),
    address: assembled.address || null,
    footprint: assembled.footprint || null,
    faces,
    elevations: buildElevationDrawings(faces, {
      photos,
      estimated: assembled.estimated,
      footprint: assembled.footprint,
    }),
    materials: listMaterials(faces),
    facades: compassFacades(faces),
    photosUsed: assembled.photosUsed || 0,
  };
}

export { MATERIAL_COLORS };
