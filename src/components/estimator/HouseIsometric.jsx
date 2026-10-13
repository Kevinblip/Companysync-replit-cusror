/**
 * HouseIsometric — SVG isometric 3D house drawing.
 * Step 1: Uses actual footprint polygon (east_ft, north_ft pairs from OSM)
 *         instead of always drawing a rectangle.
 * Step 2: 2D elevation panels (front, side, rear) below the 3D view.
 *
 * No WebGL. Renders in all browsers including Replit preview.
 */
import React, { useMemo } from 'react';

// ─── isometric math ────────────────────────────────────────────────────────
// iso(x, y, z): x=east ft, y=up ft, z=north ft → [screenX, screenY]
function makeIso(ox, oy, sx, sh, sv) {
  return (x, y, z) => [
    ox + x * sx - z * sx,
    oy - x * sh - z * sh - y * sv,
  ];
}

// normalize polygon so min-x = 0, min-z = 0 (origin at front-left)
function normalizePoly(poly) {
  const xs = poly.map(([x]) => x);
  const zs = poly.map(([, z]) => z);
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  return poly.map(([x, z]) => [x - minX, z - minZ]);
}

// bounding box of a polygon [[x,z],...]
function bbox(poly) {
  const xs = poly.map(([x]) => x), zs = poly.map(([, z]) => z);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
    W: Math.max(...xs) - Math.min(...xs),
    D: Math.max(...zs) - Math.min(...zs),
  };
}

// outward normal direction for edge A→B in a polygon wound counter-clockwise
// (OSM polygons are CCW when north_ft is treated as +Z axis)
function edgeNormal(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  // right-hand normal of (dx, dz) = (dz, -dx)
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  return [dz / len, -dx / len]; // [nx, nz]
}

// classify face: 'south'(nz<-0.1), 'east'(nx>0.1), 'north'(nz>0.1), 'west'(nx<-0.1)
function faceDir(nx, nz) {
  if (nz < -0.1) return 'south';
  if (nx > 0.1)  return 'east';
  if (nz > 0.1)  return 'north';
  return 'west';
}

const FACE_FILL = {
  south: { siding: '#c8c0b4', stone: 'url(#hi-stone-f)', dark: '#3a3836' },
  east:  { siding: '#9a9490', stone: 'url(#hi-stone-r)', dark: '#2a2826' },
  north: { siding: '#888280', stone: '#706a60',          dark: '#222020' },
  west:  { siding: '#b0aa a4', stone: '#988e82',         dark: '#2e2c2a' },
};
const FACE_OPACITY = { south: 1, east: 0.92, north: 0.55, west: 0.65 };

// svg point string from iso coords
function isoStr(isoFn, x, y, z) {
  return isoFn(x, y, z).join(',');
}

function openingPositionFraction(value, dimensionFt, opening) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const unit = String(
    opening?.position_unit || opening?.position_units || opening?.coordinate_unit || ''
  ).toLowerCase();
  // Analyses now explicitly persist "feet"; unmarked positions are also feet
  // because that is the analyzer's long-standing contract. Only records
  // explicitly identified as old fraction data use their raw 0–1 value.
  if (unit === 'fraction' || unit === 'normalized' || unit === 'ratio') {
    return Number(value);
  }
  return Number(value) / dimensionFt;
}

// ─── 2D elevation helpers ──────────────────────────────────────────────────
function Elevation2D({ label, widthFt, heightFt, pitchFt, roofType, openings, svgW, svgH }) {
  const PAD = 28;
  const scaleX = (svgW - PAD * 2) / widthFt;
  const scaleY = (svgH - PAD * 2 - 10) / (heightFt + pitchFt);

  const sx = Math.min(scaleX, scaleY);
  const wallPx  = heightFt * sx;
  const roofPx  = pitchFt  * sx;
  const widthPx = widthFt  * sx;
  const offX = (svgW - widthPx) / 2;
  const baseY = svgH - PAD;
  const wallTop = baseY - wallPx;
  const ridgeY  = wallTop - roofPx;
  const ridgeX  = svgW / 2;

  const isHip = /hip|pyramid/i.test(roofType);

  const roofPath = isHip
    ? `M${offX},${wallTop} L${ridgeX},${ridgeY} L${offX + widthPx},${wallTop} Z`
    : `M${offX},${wallTop} L${ridgeX},${ridgeY} L${offX + widthPx},${wallTop} Z`;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} width="100%" height="100%">
      <defs>
        <linearGradient id={`elev-wall-${label}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d0c8bc"/>
          <stop offset="100%" stopColor="#b8b2aa"/>
        </linearGradient>
      </defs>
      {/* ground */}
      <rect x={offX} y={baseY} width={widthPx} height={3} fill="#4a7235"/>
      {/* wall */}
      <rect x={offX} y={wallTop} width={widthPx} height={wallPx}
        fill={`url(#elev-wall-${label})`} stroke="#888" strokeWidth="1"/>
      {/* roof */}
      <path d={roofPath} fill="#5a5854" stroke="#333" strokeWidth="1.5"/>
      {/* openings */}
      {openings.map((op, i) => {
        const ow2 = (op.width_ft || 3) * sx;
        const oh2 = (op.height_ft || 4) * sx;
        const xFrac = openingPositionFraction(op.pos_x, widthFt, op);
        const yFrac = openingPositionFraction(op.pos_y, heightFt, op);
        const xMid = (xFrac ?? (i + 0.5) / (openings.length || 1)) * widthPx;
        const yMid = (yFrac ?? 0.45) * wallPx;
        const ox2 = offX + xMid - ow2 / 2;
        // pos_y is measured upward from grade, while SVG y grows downward.
        const oy2 = baseY - yMid - oh2 / 2;
        const isDoor = /door/i.test(op.type || '');
        return (
          <rect key={i} x={ox2} y={oy2} width={ow2} height={oh2}
            fill={isDoor ? '#5a4030' : '#4a6880'} stroke="#ccc" strokeWidth="0.8"/>
        );
      })}
      {/* dim labels */}
      {/* width arrow */}
      <line x1={offX} y1={baseY + 12} x2={offX + widthPx} y2={baseY + 12}
        stroke="#60a5fa" strokeWidth="0.8" markerEnd="url(#arr)"/>
      <text x={svgW / 2} y={baseY + 22} fill="#60a5fa" fontSize="9"
        textAnchor="middle" fontFamily="Inter,sans-serif" fontWeight="700">
        {Math.round(widthFt)} ft
      </text>
      {/* height */}
      <line x1={offX - 12} y1={wallTop} x2={offX - 12} y2={baseY}
        stroke="#60a5fa" strokeWidth="0.8"/>
      <text x={offX - 14} y={(wallTop + baseY) / 2} fill="#60a5fa" fontSize="9"
        textAnchor="middle" fontFamily="Inter,sans-serif" fontWeight="700"
        transform={`rotate(-90,${offX - 14},${(wallTop + baseY) / 2})`}>
        {Math.round(heightFt)} ft
      </text>
      {/* label */}
      <text x={svgW / 2} y={14} fill="#94a3b8" fontSize="10" textAnchor="middle"
        fontFamily="Inter,sans-serif" fontWeight="700" letterSpacing="1">
        {label}
      </text>
    </svg>
  );
}

// Map canonical face name → which polygon edge it sits on in iso space
// front=south(z≈0), back=north(z≈D), left=west(x≈0), right=east(x≈W)
const FACE_AXIS = {
  front: { axis: 'z', val: 0,   dir: 'x' },  // wall along z=0, openings move along x
  back:  { axis: 'z', val: 'D', dir: 'x' },  // wall along z=D
  left:  { axis: 'x', val: 0,   dir: 'z' },  // wall along x=0
  right: { axis: 'x', val: 'W', dir: 'z' },  // wall along x=W
};

// ─── main component ─────────────────────────────────────────────────────────
export default function HouseIsometric({
  buildingLength   = 40,   // east-west ft (fallback when no polygon)
  buildingWidth    = 30,   // north-south ft (fallback when no polygon)
  storyCount       = 1,
  wallHeight: whProp,
  roofType         = 'gable',
  roofPitch        = 8,
  openings         = [],   // openings_detail (flat list, fallback when no faces)
  hasStoneWainscot = false,
  footprintPolygon = null, // [[east_ft, north_ft], ...] from OSM — THE REAL SHAPE
  garagePolygon    = null,
  faces            = [],   // per-face reconciled data from multi-photo analysis
                           // [{face:'front'|'back'|'left'|'right', wall_width_ft, wall_height_ft,
                           //   story_count, openings:[...]}]
  svgWidth         = 560,
  svgHeight        = 360,
  show2D           = true, // show 2D elevation panels below
  address          = '',
  className        = '',
}) {
  // ── compute all geometry ──────────────────────────────────────────────────
  const geo = useMemo(() => {
    const H    = Math.max(Number(whProp) || (Number(storyCount) || 1) * 9, 7);
    const P    = Math.max(Number(roofPitch) || 8, 2);
    const isHip = /hip|pyramid/i.test(roofType);

    // Resolve polygon: use real footprint if available, else rectangle
    let poly;
    let usingRealPolygon = false;
    if (footprintPolygon && footprintPolygon.length >= 3) {
      poly = normalizePoly(footprintPolygon);
      usingRealPolygon = true;
    } else {
      const W = Math.max(Number(buildingLength) || 40, 10);
      const D = Math.max(Number(buildingWidth)  || 30, 10);
      poly = [[0,0],[W,0],[W,D],[0,D]];
    }

    const bb = bbox(poly);
    const { W, D } = { W: bb.W, D: bb.D };

    // Roof rise
    const halfD   = D / 2;
    const gRise   = (halfD * P) / 12;
    const hipHalf = Math.min(W, D) / 2;
    const hRise   = (hipHalf * P) / 12;
    const peakH   = isHip ? hRise : gRise;

    // Auto-scale: fit (W+D) iso projection into svgWidth × svgHeight
    const hSpan  = W + D;
    const vSpan  = hSpan * 0.5 + H + peakH + 3;
    const scaleX = (svgWidth * 0.82) / hSpan;
    const scaleV = (svgHeight * 0.82) / vSpan;
    const sx     = Math.min(scaleX, scaleV * 1.6, 9);
    const sh     = sx * 0.5;
    const sv     = sx * 1.05;

    // Origin: position so house is centered in SVG
    const totalW = hSpan * sx;
    const totalH = hSpan * sh + (H + peakH) * sv;
    const ox     = (svgWidth  - totalW) / 2 + D * sx;
    const oy     = svgHeight  - (svgHeight - totalH) / 2 - 10;

    const iso = makeIso(ox, oy, sx, sh, sv);
    const p   = (x, y, z) => iso(x, y, z).join(',');
    const iArr = iso; // returns [x, y]

    // ── build wall faces ────────────────────────────────────────────────────
    // For each edge of the polygon, create a wall quad (bottom→top)
    // then classify it by outward normal for shading
    const sH = hasStoneWainscot ? H * 0.42 : 0; // stone wainscot split height

    const wallFaces = [];
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % n];
      const [nx, nz] = edgeNormal(ax, az, bx, bz);
      const dir = faceDir(nx, nz);
      const op  = FACE_OPACITY[dir];
      const mat = hasStoneWainscot ? 'stone' : 'siding';

      // 4 corners of this wall quad
      const bl = iArr(ax, 0,  az);  // bottom-left
      const br = iArr(bx, 0,  bz);  // bottom-right
      const tr = iArr(bx, H,  bz);  // top-right
      const tl = iArr(ax, H,  az);  // top-left

      // depth key for painter sort: average iso y of corners (lower y = further back)
      const depthKey = (bl[1] + br[1] + tr[1] + tl[1]) / 4;

      if (sH > 0) {
        // stone band
        const ml = iArr(ax, sH, az);
        const mr = iArr(bx, sH, bz);
        wallFaces.push({
          pts: `${bl.join(',')} ${br.join(',')} ${mr.join(',')} ${ml.join(',')}`,
          fill: FACE_FILL[dir].stone, op, dir, depthKey: depthKey + 0.1,
          key: `stone-${i}`,
        });
        wallFaces.push({
          pts: `${ml.join(',')} ${mr.join(',')} ${tr.join(',')} ${tl.join(',')}`,
          fill: FACE_FILL[dir].siding, op, dir, depthKey,
          key: `sid-${i}`,
        });
      } else {
        wallFaces.push({
          pts: `${bl.join(',')} ${br.join(',')} ${tr.join(',')} ${tl.join(',')}`,
          fill: FACE_FILL[dir].siding, op, dir, depthKey,
          key: `wall-${i}`,
        });
      }
    }

    // Sort: furthest (smallest depthKey = smallest screen y = higher up) drawn first
    // Actually: higher screen y = lower on screen = closer to viewer
    // We want to draw further faces first: those with LOWER screen y values first
    wallFaces.sort((a, b) => a.depthKey - b.depthKey);

    // ── roof ────────────────────────────────────────────────────────────────
    // Use bounding box for roof (covers full footprint)
    let ridgeL, ridgeR, hipPeak;
    if (isHip) {
      if (Math.abs(W - D) < 6) {
        hipPeak = iArr(W / 2, H + hRise, D / 2);
      } else if (W >= D) {
        ridgeL = iArr(hipHalf,     H + hRise, D / 2);
        ridgeR = iArr(W - hipHalf, H + hRise, D / 2);
      } else {
        ridgeL = iArr(W / 2, H + hRise, hipHalf);
        ridgeR = iArr(W / 2, H + hRise, D - hipHalf);
      }
    } else {
      ridgeL = iArr(0, H + gRise, D / 2);
      ridgeR = iArr(W, H + gRise, D / 2);
    }

    // Roof eave corners (bounding box corners at wall-top)
    const rfFL = iArr(0, H, 0);
    const rfFR = iArr(W, H, 0);
    const rfBL = iArr(0, H, D);
    const rfBR = iArr(W, H, D);

    // ── openings: prefer per-face data from faces[], fall back to flat list ──
    // Helper: map a list of raw openings onto a specific wall in iso space
    function mapOpsToWall(ops, faceKey, wallWidth, wallHeight) {
      const faceWidth  = Number(wallWidth)  || W;
      const faceHeight = Number(wallHeight) || H;

      return ops.slice(0, 8).map((op, i) => {
        const n    = ops.length || 1;
        const xFrac = openingPositionFraction(op.pos_x, faceWidth, op)
          ?? (i + 0.5) / n;
        const yFrac = openingPositionFraction(op.pos_y, faceHeight, op)
          ?? 0.45;
        const ow   = Math.min(op.width_ft  || 3, faceWidth * 0.28);
        const oh   = Math.min(op.height_ft || 4, faceHeight * 0.8);
        const pos  = xFrac * faceWidth; // position along the wall's local axis
        const yMid = yFrac * faceHeight;
        const y0   = Math.max(0.2, yMid - oh / 2);
        const y1   = Math.min(faceHeight - 0.2, yMid + oh / 2);
        const p0   = pos - ow / 2, p1 = pos + ow / 2;

        let bl, br, tr, tl;
        if (faceKey === 'front') {
          bl = iArr(p0, y0, 0);  br = iArr(p1, y0, 0);
          tr = iArr(p1, y1, 0);  tl = iArr(p0, y1, 0);
        } else if (faceKey === 'back') {
          bl = iArr(p0, y0, D);  br = iArr(p1, y0, D);
          tr = iArr(p1, y1, D);  tl = iArr(p0, y1, D);
        } else if (faceKey === 'left') {
          bl = iArr(0, y0, p0);  br = iArr(0, y0, p1);
          tr = iArr(0, y1, p1);  tl = iArr(0, y1, p0);
        } else { // right
          bl = iArr(W, y0, p0);  br = iArr(W, y0, p1);
          tr = iArr(W, y1, p1);  tl = iArr(W, y1, p0);
        }

        const isGarage = /garage/i.test(op.type || '');
        const isDoor   = /door/i.test(op.type || '') && !isGarage;
        return {
          key: op.observation_id || `${faceKey}-${i}`,
          isDoor, isGarage,
          bl, br, tr, tl,
          fill: isGarage ? '#808078' : isDoor ? '#5a4030' : '#4a6880',
          faceKey,
        };
      });
    }

    // Build per-face mapped openings
    // Priority: faces[] data (multi-photo) > flat openings[] > generated defaults
    const faceLookup = Object.fromEntries((faces || []).map(f => [f.face, f]));

    // Front face openings (always shown — south face, z=0)
    const frontFaceData  = faceLookup['front'];
    const frontRawOps    = frontFaceData?.openings?.length
      ? frontFaceData.openings
      : openings.filter(o => !o.wall_face || o.wall_face === 'front' || /front|south/i.test(o.zone || ''));
    const frontWallW     = frontFaceData?.wall_width_ft || W;
    const frontWallH     = frontFaceData?.wall_height_ft || H;

    let mappedFrontOps;
    if (frontRawOps.length > 0) {
      mappedFrontOps = mapOpsToWall(frontRawOps, 'front', frontWallW, frontWallH);
    } else {
      // Generated defaults (door + windows) when no data at all
      const dx0 = W * 0.44, dx1 = W * 0.56;
      mappedFrontOps = [
        { key: 'def-door', isDoor: true, isGarage: false, fill: '#5a4030',
          bl: iArr(dx0, 0.3, 0), br: iArr(dx1, 0.3, 0),
          tr: iArr(dx1, 7, 0),   tl: iArr(dx0, 7, 0), faceKey: 'front' },
        ...(W > 24 ? [W * 0.18, W * 0.82] : [W * 0.25, W * 0.75]).map(xp => ({
          key: `def-w${xp}`, isDoor: false, isGarage: false, fill: '#4a6880',
          bl: iArr(xp-1.5, 2, 0), br: iArr(xp+1.5, 2, 0),
          tr: iArr(xp+1.5, 5.5, 0), tl: iArr(xp-1.5, 5.5, 0), faceKey: 'front',
        })),
      ];
    }

    // Right face openings (east, x=W — visible in iso view)
    const rightFaceData = faceLookup['right'];
    const rightRawOps   = rightFaceData?.openings || [];
    const rightWallW    = rightFaceData?.wall_width_ft || D;
    const rightWallH    = rightFaceData?.wall_height_ft || H;
    const mappedRightOps = rightRawOps.length > 0
      ? mapOpsToWall(rightRawOps, 'right', rightWallW, rightWallH)
      : [];

    // ── ground polygon ───────────────────────────────────────────────────────
    const groundPts = poly.map(([x, z]) => iArr(x, 0, z).join(',')).join(' ');

    // ── dimension markers ────────────────────────────────────────────────────
    const wLabel  = iArr(W / 2, -2,     0);
    const dLabel  = iArr(W,     -2,     D / 2);
    const hLabel  = iArr(-2,    H / 2,  0);
    const pitchPt = iArr(W * 0.4, H + peakH * 0.5, 0);

    // ── per-face 2D elevation data ───────────────────────────────────────────
    const elevations2D = [
      { label: 'FRONT', face: 'front',
        widthFt: faceLookup['front']?.wall_width_ft || W,
        heightFt: faceLookup['front']?.wall_height_ft || H,
        openings: frontRawOps },
      { label: 'RIGHT SIDE', face: 'right',
        widthFt: faceLookup['right']?.wall_width_ft || D,
        heightFt: faceLookup['right']?.wall_height_ft || H,
        openings: rightRawOps },
      { label: 'REAR', face: 'back',
        widthFt: faceLookup['back']?.wall_width_ft || W,
        heightFt: faceLookup['back']?.wall_height_ft || H,
        openings: faceLookup['back']?.openings || [] },
    ];

    return {
      poly, bb, W, D, H, P, usingRealPolygon,
      isHip, peakH, gRise, hRise,
      sx, sh, sv, iso: iArr, p,
      wallFaces, sH,
      ridgeL, ridgeR, hipPeak,
      rfFL, rfFR, rfBL, rfBR,
      groundPts,
      mappedFrontOps, mappedRightOps,
      wLabel, dLabel, hLabel, pitchPt,
      elevations2D,
      facesCount: faces?.length || 0,
    };
  }, [buildingLength, buildingWidth, whProp, storyCount, roofType, roofPitch,
      hasStoneWainscot, openings, footprintPolygon, faces, svgWidth, svgHeight]);

  const {
    W, D, H, P, usingRealPolygon, isHip, peakH,
    wallFaces, sH,
    ridgeL, ridgeR, hipPeak,
    rfFL, rfFR, rfBL, rfBR,
    groundPts,
    mappedFrontOps,
    wLabel, dLabel, hLabel, pitchPt,
    p, elevations2D,
  } = geo;

  const pitchStr = `${P}/12`;

  return (
    <div className={className}>
      {/* ── 3D ISOMETRIC VIEW ── */}
      <div style={{ background: '#1a2840', borderRadius: 10, overflow: 'hidden', position: 'relative' }}>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} width="100%" height="100%"
          style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="hi-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1e3a5a"/>
              <stop offset="100%" stopColor="#4a7a9a"/>
            </linearGradient>
            <linearGradient id="hi-grass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a7235"/>
              <stop offset="100%" stopColor="#355228"/>
            </linearGradient>
            <linearGradient id="hi-roof-s" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5a5854"/>
              <stop offset="100%" stopColor="#3a3836"/>
            </linearGradient>
            <linearGradient id="hi-roof-e" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3a3836"/>
              <stop offset="100%" stopColor="#282624"/>
            </linearGradient>
            <linearGradient id="hi-roof-w" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="#585654"/>
              <stop offset="100%" stopColor="#686462"/>
            </linearGradient>
            <pattern id="hi-stone-f" patternUnits="userSpaceOnUse" width="20" height="12">
              <rect width="20" height="12" fill="#c0b090"/>
              <rect y="0"  width="20" height="1"  fill="rgba(0,0,0,0.14)"/>
              <rect y="6"  width="20" height="1"  fill="rgba(0,0,0,0.14)"/>
              <rect x="10" y="1" width="1" height="5" fill="rgba(0,0,0,0.09)"/>
              <rect x="5"  y="7" width="1" height="5" fill="rgba(0,0,0,0.09)"/>
            </pattern>
            <pattern id="hi-stone-r" patternUnits="userSpaceOnUse" width="20" height="12">
              <rect width="20" height="12" fill="#a09070"/>
              <rect y="0"  width="20" height="1"  fill="rgba(0,0,0,0.15)"/>
              <rect y="6"  width="20" height="1"  fill="rgba(0,0,0,0.15)"/>
              <rect x="10" y="1" width="1" height="5" fill="rgba(0,0,0,0.10)"/>
            </pattern>
          </defs>

          {/* Sky */}
          <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="url(#hi-sky)"/>
          {/* Grass strip */}
          <rect x="0" y={svgHeight * 0.7} width={svgWidth} height={svgHeight * 0.3}
            fill="url(#hi-grass)"/>

          {/* Ground shadow under footprint */}
          <polygon points={groundPts} fill="rgba(0,0,0,0.2)"/>

          {/* Foundation ledge along front face */}
          {(() => {
            const flb = geo.iso(0, 0, 0), frb = geo.iso(W, 0, 0);
            return (
              <>
                <polygon
                  points={`${flb.join(',')} ${frb.join(',')} ${[frb[0], frb[1]+6].join(',')} ${[flb[0], flb[1]+6].join(',')}`}
                  fill="#706860"
                />
              </>
            );
          })()}

          {/* ── WALLS (sorted back-to-front) ── */}
          {wallFaces.map(f => (
            <polygon key={f.key} points={f.pts}
              fill={f.fill} opacity={f.op}
            />
          ))}

          {/* Story floor line on front face */}
          {storyCount >= 2 && (
            <line
              x1={geo.iso(0, 9, 0)[0]} y1={geo.iso(0, 9, 0)[1]}
              x2={geo.iso(W, 9, 0)[0]} y2={geo.iso(W, 9, 0)[1]}
              stroke="#908880" strokeWidth="1.3" strokeDasharray="6,4"
            />
          )}

          {/* ── WALL EDGE LINES ── */}
          {(() => {
            const poly = geo.poly;
            const n = poly.length;
            const lines = [];
            for (let i = 0; i < n; i++) {
              const [ax, az] = poly[i];
              const [bx, bz] = poly[(i + 1) % n];
              const bl = geo.iso(ax, 0, az), br = geo.iso(bx, 0, bz);
              const tl = geo.iso(ax, H, az), tr = geo.iso(bx, H, bz);
              // vertical corners
              lines.push(<line key={`vc-${i}`} x1={bl[0]} y1={bl[1]} x2={tl[0]} y2={tl[1]}
                stroke="#484440" strokeWidth="1.2"/>);
              // top plate
              lines.push(<line key={`tp-${i}`} x1={tl[0]} y1={tl[1]} x2={tr[0]} y2={tr[1]}
                stroke="#484440" strokeWidth="0.9"/>);
              // bottom (ground line)
              lines.push(<line key={`gl-${i}`} x1={bl[0]} y1={bl[1]} x2={br[0]} y2={br[1]}
                stroke="#383430" strokeWidth="1.2"/>);
            }
            return lines;
          })()}

          {/* Stone wainscot divider line on front face */}
          {hasStoneWainscot && sH > 0 && (
            <line
              x1={geo.iso(0, sH, 0)[0]} y1={geo.iso(0, sH, 0)[1]}
              x2={geo.iso(W, sH, 0)[0]} y2={geo.iso(W, sH, 0)[1]}
              stroke="#a89060" strokeWidth="1.5"
            />
          )}

          {/* ── OPENINGS on front face ── */}
          {mappedFrontOps.map(op => (
            <g key={op.key}>
              <polygon
                points={`${op.bl.join(',')} ${op.br.join(',')} ${op.tr.join(',')} ${op.tl.join(',')}`}
                fill={op.fill} opacity="0.92"
              />
              <polygon
                points={`${op.bl.join(',')} ${op.br.join(',')} ${op.tr.join(',')} ${op.tl.join(',')}`}
                fill="none" stroke="#d0ccc4" strokeWidth="1.3"
              />
              {/* mullion */}
              {!op.isDoor && !op.isGarage && (
                <>
                  <line
                    x1={(op.bl[0]+op.tl[0])/2} y1={(op.bl[1]+op.tl[1])/2}
                    x2={(op.br[0]+op.tr[0])/2} y2={(op.br[1]+op.tr[1])/2}
                    stroke="#c0bcb4" strokeWidth="0.7"/>
                  <line
                    x1={(op.bl[0]+op.br[0])/2} y1={(op.bl[1]+op.br[1])/2}
                    x2={(op.tl[0]+op.tr[0])/2} y2={(op.tl[1]+op.tr[1])/2}
                    stroke="#c0bcb4" strokeWidth="0.7"/>
                </>
              )}
              {op.isDoor && (
                <circle cx={(op.br[0]+op.tr[0])/2 - 3} cy={(op.br[1]+op.tr[1])/2 - 4}
                  r="2" fill="#c8a840"/>
              )}
            </g>
          ))}

          {/* ── GABLE TRIANGLES ── */}
          {!isHip && ridgeL && ridgeR && (
            <>
              {/* East gable */}
              <polygon
                points={`${rfFR.join(',')} ${rfBR.join(',')} ${ridgeR.join(',')}`}
                fill="#9a9890" stroke="#484440" strokeWidth="0.9"
              />
              {/* West gable (faint) */}
              <polygon
                points={`${rfFL.join(',')} ${rfBL.join(',')} ${ridgeL.join(',')}`}
                fill="#b0aaa4" opacity="0.4"
              />
            </>
          )}

          {/* ── ROOF ── */}
          {isHip ? (
            hipPeak ? (
              <>
                <polygon points={`${rfFL.join(',')} ${rfFR.join(',')} ${hipPeak.join(',')}`}
                  fill="url(#hi-roof-s)"/>
                <polygon points={`${rfFR.join(',')} ${rfBR.join(',')} ${hipPeak.join(',')}`}
                  fill="url(#hi-roof-e)"/>
                <polygon points={`${rfBL.join(',')} ${rfBR.join(',')} ${hipPeak.join(',')}`}
                  fill="#2e2c2a" opacity="0.6"/>
                <polygon points={`${rfFL.join(',')} ${rfBL.join(',')} ${hipPeak.join(',')}`}
                  fill="url(#hi-roof-w)" opacity="0.7"/>
              </>
            ) : ridgeL && ridgeR ? (
              <>
                <polygon points={`${rfFL.join(',')} ${rfFR.join(',')} ${ridgeR.join(',')} ${ridgeL.join(',')}`}
                  fill="url(#hi-roof-s)"/>
                <polygon points={`${rfFR.join(',')} ${rfBR.join(',')} ${ridgeR.join(',')}`}
                  fill="url(#hi-roof-e)"/>
                <polygon points={`${rfBR.join(',')} ${ridgeR.join(',')} ${ridgeL.join(',')}`}
                  fill="#2e2c2a" opacity="0.5"/>
              </>
            ) : null
          ) : ridgeL && ridgeR ? (
            <>
              {/* South slope */}
              <polygon points={`${rfFL.join(',')} ${rfFR.join(',')} ${ridgeR.join(',')} ${ridgeL.join(',')}`}
                fill="url(#hi-roof-s)"/>
              {/* East slope (right side view) */}
              <polygon points={`${rfFR.join(',')} ${rfBR.join(',')} ${ridgeR.join(',')}`}
                fill="url(#hi-roof-e)"/>
            </>
          ) : null}

          {/* ── ROOF EDGE LINES ── */}
          <line x1={rfFL[0]} y1={rfFL[1]} x2={rfFR[0]} y2={rfFR[1]}
            stroke="#181614" strokeWidth="3" strokeLinecap="round"/>
          {!isHip && ridgeL && ridgeR && (
            <>
              <line x1={rfFL[0]} y1={rfFL[1]} x2={ridgeL[0]} y2={ridgeL[1]}
                stroke="#181614" strokeWidth="2" strokeLinecap="round"/>
              <line x1={rfFR[0]} y1={rfFR[1]} x2={ridgeR[0]} y2={ridgeR[1]}
                stroke="#181614" strokeWidth="2" strokeLinecap="round"/>
              <line x1={rfBR[0]} y1={rfBR[1]} x2={ridgeR[0]} y2={ridgeR[1]}
                stroke="#181614" strokeWidth="1.5"/>
              <line x1={ridgeL[0]} y1={ridgeL[1]} x2={ridgeR[0]} y2={ridgeR[1]}
                stroke="#181614" strokeWidth="2.5" strokeLinecap="round"/>
            </>
          )}
          {isHip && hipPeak && (
            <>
              <line x1={rfFL[0]} y1={rfFL[1]} x2={hipPeak[0]} y2={hipPeak[1]} stroke="#181614" strokeWidth="1.8"/>
              <line x1={rfFR[0]} y1={rfFR[1]} x2={hipPeak[0]} y2={hipPeak[1]} stroke="#181614" strokeWidth="1.8"/>
              <line x1={rfBL[0]} y1={rfBL[1]} x2={hipPeak[0]} y2={hipPeak[1]} stroke="#181614" strokeWidth="1.2"/>
              <line x1={rfBR[0]} y1={rfBR[1]} x2={hipPeak[0]} y2={hipPeak[1]} stroke="#181614" strokeWidth="1.2"/>
            </>
          )}
          {isHip && ridgeL && ridgeR && (
            <>
              <line x1={rfFL[0]} y1={rfFL[1]} x2={ridgeL[0]} y2={ridgeL[1]} stroke="#181614" strokeWidth="1.8"/>
              <line x1={rfFR[0]} y1={rfFR[1]} x2={ridgeR[0]} y2={ridgeR[1]} stroke="#181614" strokeWidth="1.8"/>
              <line x1={ridgeL[0]} y1={ridgeL[1]} x2={ridgeR[0]} y2={ridgeR[1]} stroke="#181614" strokeWidth="2.2"/>
            </>
          )}

          {/* ── DIMENSION ANNOTATIONS ── */}
          {/* Width */}
          <line x1={geo.iso(0,0,0)[0]} y1={geo.iso(0,0,0)[1]+11}
                x2={geo.iso(W,0,0)[0]} y2={geo.iso(W,0,0)[1]+11}
            stroke="#60a5fa" strokeWidth="0.8" strokeDasharray="4,3"/>
          <text x={wLabel[0]} y={wLabel[1]+16} fill="#60a5fa" fontSize="10" fontWeight="700"
            textAnchor="middle" fontFamily="Inter,sans-serif"
            transform={`rotate(-27,${wLabel[0]},${wLabel[1]+16})`}>{Math.round(W)} ft</text>
          {/* Depth */}
          <line x1={geo.iso(W,0,0)[0]+8} y1={geo.iso(W,0,0)[1]}
                x2={geo.iso(W,0,D)[0]+8} y2={geo.iso(W,0,D)[1]}
            stroke="#60a5fa" strokeWidth="0.8" strokeDasharray="4,3"/>
          <text x={dLabel[0]+12} y={dLabel[1]} fill="#60a5fa" fontSize="10" fontWeight="700"
            textAnchor="middle" fontFamily="Inter,sans-serif"
            transform={`rotate(27,${dLabel[0]+12},${dLabel[1]})`}>{Math.round(D)} ft</text>
          {/* Height */}
          <line x1={geo.iso(0,0,0)[0]-8} y1={geo.iso(0,0,0)[1]}
                x2={geo.iso(0,H,0)[0]-8} y2={geo.iso(0,H,0)[1]}
            stroke="#60a5fa" strokeWidth="0.8" strokeDasharray="4,3"/>
          <text x={hLabel[0]-6} y={hLabel[1]} fill="#60a5fa" fontSize="10" fontWeight="700"
            textAnchor="middle" fontFamily="Inter,sans-serif">{Math.round(H)} ft</text>
          {/* Pitch */}
          <rect x={pitchPt[0]-22} y={pitchPt[1]-9} width="44" height="18" rx="4"
            fill="#1e2d45" stroke="#2a3a54" strokeWidth="1"/>
          <text x={pitchPt[0]} y={pitchPt[1]+5} fill="#a78bfa" fontSize="10" fontWeight="700"
            textAnchor="middle" fontFamily="Inter,sans-serif">{pitchStr} pitch</text>

          {/* Address */}
          {address && (
            <text x={svgWidth/2} y={svgHeight-6} fill="#4b6fa0" fontSize="9"
              textAnchor="middle" fontFamily="Inter,sans-serif" opacity="0.7">{address}</text>
          )}
        </svg>

        {/* Corner info badge */}
        <div style={{
          position:'absolute',top:8,left:8,
          background:'rgba(15,24,41,0.88)',border:'1px solid #2a3a54',
          borderRadius:6,padding:'3px 8px',
          fontSize:10,fontWeight:700,color:'#60a5fa',
          fontFamily:'Inter,system-ui,sans-serif',
        }}>
          {Math.round(W)}×{Math.round(D)} ft · {storyCount}{storyCount===1?' story':' stories'} · {roofType||'gable'} · {pitchStr}
        </div>
        {/* Polygon source badge */}
        <div style={{
          position:'absolute',top:8,right:8,
          background: usingRealPolygon ? 'rgba(16,42,16,0.9)' : 'rgba(42,32,10,0.9)',
          border: `1px solid ${usingRealPolygon ? '#22c55e' : '#f59e0b'}`,
          borderRadius:6,padding:'3px 8px',
          fontSize:10,fontWeight:700,
          color: usingRealPolygon ? '#4ade80' : '#fbbf24',
          fontFamily:'Inter,system-ui,sans-serif',
        }}>
          {usingRealPolygon ? '✓ Real footprint' : '⚠ Bounding box'}
        </div>
      </div>

      {/* ── 2D ELEVATION PANELS ── */}
      {show2D && (
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {(elevations2D || []).map((elev) => {
            // Pitch rise depends on which span is perpendicular to the ridge
            // front/rear: ridge runs E-W, perpendicular span is D
            // side (right): ridge runs E-W, perpendicular span is W
            const hipHalf = Math.min(W, D) / 2;
            const perpSpan = (elev.face === 'right' || elev.face === 'left') ? W / 2 : D / 2;
            const pitchFt  = isHip ? (hipHalf * P / 12) : (perpSpan * P / 12);
            return (
              <div key={elev.face} style={{
                background:'#1a2840', borderRadius:8,
                border:'1px solid #2a3a54', overflow:'hidden',
              }}>
                <Elevation2D
                  label={elev.label}
                  widthFt={elev.widthFt}
                  heightFt={elev.heightFt || H}
                  pitchFt={pitchFt}
                  roofType={roofType}
                  openings={elev.openings || []}
                  svgW={160}
                  svgH={120}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
