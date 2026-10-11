/**
 * Assemble a house mesh from Hover XML (POINTS/LINES/FACES in one coordinate
 * frame) or from Solar/OSM footprint data.
 *
 * The production bug: roof facets were drawn from independent Solar bounding
 * boxes (lat/lng treated as local meters, or each segment origin-shifted), so
 * planes floated apart over an empty 48×9 ft estimated box. Hover already has
 * a shared XYZ frame — walk FACE → LINE → POINT and keep that frame.
 */

export const DEFAULT_ESTIMATED_WIDTH_FT = 48;
export const DEFAULT_ESTIMATED_HEIGHT_FT = 9;

const MATERIAL_COLORS = {
  roof: 0x2a2a2e,
  siding: 0xc4b49a,
  stone: 0x8b6b4a,
  brick: 0x8a4a3a,
  concrete: 0x8a8a8a,
  opening: 0xdce8f5,
  trim: 0xf4f0e8,
  unknown: 0xb0b0b0,
};

export function materialColor(material) {
  return MATERIAL_COLORS[material] || MATERIAL_COLORS.unknown;
}

export function inferMaterial(face = {}) {
  const type = String(face.type || '').toUpperCase();
  const name = String(face.name || face.material || '').toUpperCase();
  if (type.includes('ROOF')) return 'roof';
  if (type.includes('WINDOW') || type.includes('DOOR') || type.includes('PENETRATION')) return 'opening';
  if (name.startsWith('BR') || name.includes('BRICK')) return 'brick';
  if (name.startsWith('ST') || name.includes('STONE')) return 'stone';
  if (name.startsWith('CN') || name.startsWith('CO') || name.includes('CONCRETE')) return 'concrete';
  if (name.includes('TRIM') || name.startsWith('TR')) return 'trim';
  if (name.startsWith('SI') || name.includes('SIDING') || type.includes('WALL')) return 'siding';
  return 'unknown';
}

function parseAttrs(raw) {
  const attrs = {};
  if (!raw) return attrs;
  for (const m of String(raw).matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function samePoint(a, b, eps = 0.02) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}

function walkLinePath(lineIds, lines, points) {
  const verts = [];
  let lastId = null;
  for (const lid of lineIds) {
    const pair = lines[lid];
    if (!pair || pair.length < 2) continue;
    const [a, b] = pair;
    if (!lastId) {
      verts.push(points[a], points[b]);
      lastId = b;
      continue;
    }
    if (a === lastId) {
      verts.push(points[b]);
      lastId = b;
    } else if (b === lastId) {
      verts.push(points[a]);
      lastId = a;
    } else {
      verts.push(points[a], points[b]);
      lastId = b;
    }
  }
  const cleaned = verts.filter(Boolean);
  if (cleaned.length > 1 && samePoint(cleaned[0], cleaned[cleaned.length - 1])) cleaned.pop();
  return cleaned;
}

/**
 * Parse Hover cad_export.xml (v2). Faces share one XYZ frame (feet, Z-up).
 */
export function parseHoverXml3d(xml) {
  if (!xml || typeof xml !== 'string') {
    return { points: {}, lines: {}, faces: [], address: null };
  }

  const addressMatch = xml.match(/<LOCATION[^>]*address="([^"]*)"/);
  const points = {};
  for (const m of xml.matchAll(/<POINT\s+id="([^"]+)"\s+data="([^"]+)"/g)) {
    const parts = m[2].split(',').map(Number);
    if (parts.length < 3 || parts.some(n => Number.isNaN(n))) continue;
    points[m[1]] = { x: parts[0], y: parts[1], z: parts[2] };
  }

  const lines = {};
  for (const m of xml.matchAll(/<LINE\s+id="([^"]+)"[^>]*path="([^"]+)"/g)) {
    lines[m[1]] = m[2].split(',').map(s => s.trim()).filter(Boolean);
  }

  const faces = [];
  for (const m of xml.matchAll(/<FACE\s+([^>]+)>([\s\S]*?)<\/FACE>/g)) {
    const attrs = parseAttrs(m[1]);
    const polyMatch = m[2].match(/<POLYGON([^\/]*)\/>/);
    const polyAttrs = parseAttrs(polyMatch?.[1] || '');
    const path = (polyAttrs.path || '').split(',').map(s => s.trim()).filter(Boolean);
    const vertices = walkLinePath(path, lines, points);
    if (vertices.length < 3) continue;
    const type = String(attrs.type || 'WALL').toUpperCase();
    const face = {
      id: attrs.id,
      type,
      name: attrs.name || attrs.id,
      pitch: polyAttrs.pitch && polyAttrs.pitch !== 'Infinity' ? Number(polyAttrs.pitch) : null,
      area: polyAttrs.size ? Number(polyAttrs.size) : null,
      vertices,
    };
    face.material = inferMaterial(face);
    faces.push(face);
  }

  return {
    points,
    lines,
    faces,
    address: addressMatch ? addressMatch[1] : null,
  };
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
  const walls = (faces || []).filter(f => String(f.type).toUpperCase().includes('WALL') && !String(f.type).toUpperCase().includes('PENETRATION'));
  const roofs = (faces || []).filter(f => String(f.type).toUpperCase().includes('ROOF'));
  if (!walls.length || !roofs.length) return false;

  const wallBox = boundingBox(walls.flatMap(f => f.vertices));
  const roofBox = boundingBox(roofs.flatMap(f => f.vertices));
  const houseBox = boundingBox([...walls, ...roofs].flatMap(f => f.vertices));
  const diag = Math.hypot(houseBox.size.x, houseBox.size.y, houseBox.size.z) || 1;

  const overlapX = Math.min(wallBox.max.x, roofBox.max.x) - Math.max(wallBox.min.x, roofBox.min.x);
  const overlapY = Math.min(wallBox.max.y, roofBox.max.y) - Math.max(wallBox.min.y, roofBox.min.y);
  const xyOverlap = overlapX > 0 && overlapY > 0;

  const eaveGap = roofBox.min.z - wallBox.max.z;
  const connectedAtEave = eaveGap > -2 && eaveGap < Math.max(4, houseBox.size.z * maxGapFactor);

  const wallC = centroid(walls.flatMap(f => f.vertices));
  const roofC = centroid(roofs.flatMap(f => f.vertices));
  const xySep = Math.hypot(wallC.x - roofC.x, wallC.y - roofC.y);

  return xyOverlap && connectedAtEave && xySep < diag * 0.5;
}

function quad(a, b, c, d) {
  return [a, b, c, d];
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
  ].map((f, i) => ({ ...f, id: f.id + i }));
}

function boxWallFaces(lengthFt, widthFt, eaveH, materials = {}) {
  const hx = widthFt / 2;
  const hy = lengthFt / 2;
  const matFor = (key, fallback) => materials[key] || fallback;
  return [
    {
      id: 'SI-S', type: 'WALL', name: 'Front', material: matFor('front', 'siding'),
      vertices: quad({ x: -hx, y: -hy, z: 0 }, { x: hx, y: -hy, z: 0 }, { x: hx, y: -hy, z: eaveH }, { x: -hx, y: -hy, z: eaveH }),
      compass: 'S',
    },
    {
      id: 'SI-E', type: 'WALL', name: 'Right Side', material: matFor('right', 'siding'),
      vertices: quad({ x: hx, y: -hy, z: 0 }, { x: hx, y: hy, z: 0 }, { x: hx, y: hy, z: eaveH }, { x: hx, y: -hy, z: eaveH }),
      compass: 'E',
    },
    {
      id: 'SI-N', type: 'WALL', name: 'Back', material: matFor('back', 'siding'),
      vertices: quad({ x: hx, y: hy, z: 0 }, { x: -hx, y: hy, z: 0 }, { x: -hx, y: hy, z: eaveH }, { x: hx, y: hy, z: eaveH }),
      compass: 'N',
    },
    {
      id: 'SI-W', type: 'WALL', name: 'Left Side', material: matFor('left', 'siding'),
      vertices: quad({ x: -hx, y: hy, z: 0 }, { x: -hx, y: -hy, z: 0 }, { x: -hx, y: -hy, z: eaveH }, { x: -hx, y: hy, z: eaveH }),
      compass: 'W',
    },
  ];
}

/**
 * Assemble a coherent house from footprint + pitch. Roof planes share the wall
 * frame and meet at the eaves — never independent Solar bounding boxes.
 */
export function assembleSolarHouse({
  lengthFt = 40,
  widthFt = 32,
  eaveHeightFt = 9,
  pitch = '6/12',
  roofType = 'gable',
  materials = {},
} = {}) {
  const pitch12 = Number(String(pitch).split('/')[0]) || 6;
  const L = Math.max(8, Number(lengthFt) || 40);
  const W = Math.max(8, Number(widthFt) || 32);
  const H = Math.max(6, Number(eaveHeightFt) || 9);
  const walls = boxWallFaces(L, W, H, materials);
  const isHip = /hip/i.test(String(roofType));
  const roofs = isHip ? hipRoofFaces(L, W, H, pitch12) : gableRoofFaces(L, W, H, pitch12);
  const faces = [...walls, ...roofs];
  return {
    source: 'solar_assembled',
    estimated: true,
    faces,
    assembled: isHouseAssembled(faces),
    footprint: { length_ft: L, width_ft: W, eave_height_ft: H, pitch: `${pitch12}/12`, roof_type: isHip ? 'hip' : 'gable' },
  };
}

/**
 * Convert Hover XML into the viewer payload. Elevations use real wall extents.
 */
export function assembleHoverHouse(xml, extras = {}) {
  const parsed = typeof xml === 'string' ? parseHoverXml3d(xml) : xml;
  const faces = (parsed.faces || []).map(f => ({
    ...f,
    material: extras.materialByName?.[f.name] || f.material || inferMaterial(f),
  }));
  const walls = faces.filter(f => f.type === 'WALL');
  const wallBox = boundingBox(walls.flatMap(f => f.vertices));
  return {
    source: 'hover',
    estimated: false,
    address: parsed.address || extras.address || null,
    faces,
    assembled: isHouseAssembled(faces) || walls.length >= 3,
    footprint: {
      length_ft: round1(wallBox.size.y),
      width_ft: round1(wallBox.size.x),
      eave_height_ft: round1(wallBox.size.z),
    },
    hover: extras.hover || null,
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function photoForView(photos, viewId) {
  if (!photos?.length) return null;
  const aliases = {
    front: ['front', 'south', 's facade', 'customer'],
    right: ['right', 'east', 'e facade'],
    back: ['back', 'rear', 'north', 'n facade'],
    left: ['left', 'west', 'w facade'],
  };
  const keys = aliases[viewId] || [viewId];
  return photos.find(p => {
    const label = `${p.label || p.name || p.heading || ''}`.toLowerCase();
    return keys.some(k => label.includes(k));
  }) || null;
}

function projectWallToView(vertices, axis) {
  // axis: 'x' means width is X, height is Z (front/back). 'y' means width is Y.
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
 * Four orthographic elevations. When Hover/assembled walls exist, dimensions
 * come from those faces — never the 48×9 estimated placeholder.
 */
export function buildElevationDrawings(faces, { photos = [], estimated = false } = {}) {
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

  if (!walls.length) {
    return views.map(v => ({
      ...v,
      estimated: true,
      photographed: false,
      width_ft: DEFAULT_ESTIMATED_WIDTH_FT,
      height_ft: DEFAULT_ESTIMATED_HEIGHT_FT,
      materials: [],
      outline: [
        { u: 0, v: 0 },
        { u: DEFAULT_ESTIMATED_WIDTH_FT, v: 0 },
        { u: DEFAULT_ESTIMATED_WIDTH_FT, v: DEFAULT_ESTIMATED_HEIGHT_FT },
        { u: 0, v: DEFAULT_ESTIMATED_HEIGHT_FT },
      ],
      caption: 'NOT PHOTOGRAPHED — ESTIMATED',
    }));
  }

  return views.map(view => {
    const facing = walls
      .map(w => ({ wall: w, score: faceNormal(w.vertices).x * view.dir.x + faceNormal(w.vertices).y * view.dir.y }))
      .filter(x => x.score > 0.25)
      .sort((a, b) => b.score - a.score);

    const chosen = facing.length ? facing : walls.map(w => ({ wall: w, score: 0 }));
    const verts = chosen.flatMap(c => c.wall.vertices);
    const proj = projectWallToView(verts, view.axis);
    const photo = photoForView(photos, view.id);
    const materials = [...new Set(chosen.map(c => c.wall.material).filter(Boolean))];
    const isEstimated = Boolean(estimated) && !photo;
    return {
      id: view.id,
      label: view.label,
      estimated: isEstimated,
      photographed: Boolean(photo),
      width_ft: round1(proj.width_ft),
      height_ft: round1(proj.height_ft),
      materials,
      outline: proj.outline,
      photoUrl: photo?.url || photo?.imageUrl || null,
      caption: photo
        ? 'Photographed'
        : (estimated ? 'Assembled — not photographed' : 'From Hover model'),
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
    hover: assembled.hover || null,
    footprint: assembled.footprint || null,
    faces,
    elevations: buildElevationDrawings(faces, { photos, estimated: assembled.estimated }),
    materials: listMaterials(faces),
    facades: compassFacades(faces),
  };
}

export function applyJsonMaterials(faces, json) {
  if (!json || !faces) return faces;
  const byName = {};
  const collect = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      const name = item.name || item.facet_name || item.id;
      const mat = item.material || item.siding_type || item.cladding || item.type;
      if (name && mat) byName[String(name)] = inferMaterial({ name: mat, type: 'WALL' });
    }
  };
  collect(json.siding?.facets);
  collect(json.walls?.facets);
  collect(json.facets);
  collect(json.measurements?.siding?.facets);
  return faces.map(f => (byName[f.name] ? { ...f, material: byName[f.name] } : f));
}

export { MATERIAL_COLORS };
