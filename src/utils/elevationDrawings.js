/**
 * elevationDrawings.js — to-scale 2D elevation drawings (front/back/left/right)
 * built from siding measurement data.
 *
 * This is the visual proof of what the photo analysis measured: every detected
 * opening is drawn on its wall at its zone position and measured size, walls are
 * drawn at their real width/height, and un-photographed faces are rendered
 * dashed and labeled "estimated" so coverage gaps are visible at a glance.
 *
 * Styled after carrier measurement reports: siding course lines, corner boards,
 * eave/fascia band with rake extensions, and ticked dimension lines.
 *
 * Pure string generation (no DOM) so the same SVGs render in the summary card
 * and inside the printable HTML report.
 */

const FACE_LABELS = { front: 'Front', back: 'Back', left: 'Left Side', right: 'Right Side' };
const FACE_ORDER = ['front', 'right', 'back', 'left'];

/**
 * Normalize a face token to this module's vocabulary.
 * Two vocabularies reach here and they disagree on the side walls: the analyzer
 * emits `left` / `right` while the measurement graph (wall_facets,
 * coverage.missing_faces) emits `left_side` / `right_side`. Comparing them raw
 * silently never matches for the sides.
 */
function normFace(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (s.startsWith('left')) return 'left';
  if (s.startsWith('right')) return 'right';
  if (s === 'rear') return 'back';
  return s;
}

// 5-zone horizontal placement → center of zone as a fraction of face width
const ZONE_CENTER = {
  far_left: 0.1, center_left: 0.3, center: 0.5, center_right: 0.7, far_right: 0.9,
};

const DEFAULT_OPENING_DIMS = {
  window:      { w: 3,  h: 4   },
  entry_door:  { w: 3,  h: 6.8 },
  door:        { w: 3,  h: 6.8 },
  garage_door: { w: 16, h: 7   },
};

const COURSE_EXPOSURE_FT = 0.5; // 6" siding course exposure

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openingDims(o) {
  const d = DEFAULT_OPENING_DIMS[o?.type] || DEFAULT_OPENING_DIMS.window;
  return {
    w: Math.max(0.5, Number(o?.width_ft  ?? o?.width)  || d.w),
    h: Math.max(0.5, Number(o?.height_ft ?? o?.height) || d.h),
  };
}

function isDoorType(t) { return t === 'entry_door' || t === 'door' || t === 'garage_door'; }

function plausible(v, min, max) { return Number.isFinite(v) && v > min && v < max; }

/**
 * Build the per-face drawing models from a siding-measurements object.
 * Face widths follow the siding-scale convention used elsewhere in the app:
 * front/back anchor to building width, left/right anchor to building length;
 * a photo-measured face width wins when it is plausible (< 2.2× the anchor).
 * Per-face wall height / story count win over the global values when measured.
 * Gable rise is derived from gable_area_sqft against the FINAL front+back
 * widths (total gable area = 0.5·rise·(Wfront+Wback), same rise both ends).
 */
export function buildElevationModels(sd = {}, sa = {}) {
  const W = Number(sd.building_width_ft)  || Number(sa.building_width_ft)  || 0;
  const L = Number(sd.building_length_ft) || Number(sa.building_length_ft) || 0;
  const perim = Number(sd.perimeter_ft) || (W && L ? 2 * (W + L) : 0);
  const globalH = Number(sd.story_height_ft) || 9; // analyzer total wall height
  const globalStories = Number(sd.story_count) || 1;
  const isGable = /gable/i.test(sa.roof_type || sd.roof_type || '') ||
    (Number(sd.gable_area_sqft) || 0) > 0;

  // Per-face records. The analyzer emits a rich `faces` array (per-face
  // openings, material, width/height); the measurement graph emits
  // `wall_facets`, which carries the same width/height plus a photo count.
  // Only the graph path exists on every code path, so fall back to it — without
  // this, a payload that has facets but no `faces` renders all four elevations
  // as un-photographed estimated boxes even though the walls were photographed.
  const faceRecords =
    (Array.isArray(sd.faces) && sd.faces.length ? sd.faces : null) ||
    (Array.isArray(sd.wall_facets) && sd.wall_facets.length ? sd.wall_facets : null) ||
    (Array.isArray(sd.measurement_graph?.wall_facets) ? sd.measurement_graph.wall_facets : []);
  const faceByKey = {};
  for (const f of faceRecords) {
    const key = normFace(f?.face);
    if (key && FACE_LABELS[key]) faceByKey[key] = f;
  }

  // Direct photo evidence per face, used to decide "photographed vs estimated".
  const facetList =
    (Array.isArray(sd.wall_facets) && sd.wall_facets.length ? sd.wall_facets : null) ||
    (Array.isArray(sd.measurement_graph?.wall_facets) ? sd.measurement_graph.wall_facets : []);
  const facetPhotoCount = {};
  for (const f of facetList) {
    const key = normFace(f?.face);
    if (key && FACE_LABELS[key]) facetPhotoCount[key] = Number(f.photo_count) || 0;
  }
  const hasFacetEvidence = Object.keys(facetPhotoCount).length > 0;

  const coverage = sd.coverage || sd.measurement_graph?.coverage || {};
  const hasCoverage = Array.isArray(coverage.missing_faces);
  const missing = new Set((coverage.missing_faces || []).map(f => normFace(f)));

  const openings = Array.isArray(sd.openings_detail) ? sd.openings_detail : [];

  // Fallback widths when anchors are missing: split the perimeter evenly.
  const frontW0 = W || (perim ? perim / 4 : 30);
  const sideW0  = L || (perim ? Math.max(10, (perim - 2 * frontW0) / 2) : 30);

  const finalWidth = (face) => {
    const anchor = (face === 'front' || face === 'back') ? frontW0 : sideW0;
    const measured = Number(faceByKey[face]?.wall_width_ft) || 0;
    const w = plausible(measured, 4, anchor * 2.2) ? measured : anchor;
    return Math.round(w * 2) / 2;
  };

  // Gable rise from the FINAL front/back widths so the drawn triangles' area
  // still equals gable_area_sqft:  area = 2 × (0.5 × rise × W̄) with equal rise.
  const Wf = finalWidth('front'), Wb = finalWidth('back');
  const gableArea = Number(sd.gable_area_sqft) || 0;
  const gableRise = isGable && gableArea > 0 && (Wf + Wb) > 0
    ? Math.min((2 * gableArea) / (Wf + Wb), Math.min(Wf, Wb) * 0.75)
    : 0;

  return FACE_ORDER.map(face => {
    const rec = faceByKey[face];
    const measuredH = Number(rec?.wall_height_ft) || 0;
    // Analyzer contract: on gable ends, face.wall_height_ft is the PEAK height
    // (eave + gable rise). We draw the gable triangle separately, so normalize
    // back to the eave-wall rectangle or the rise is counted twice. Only
    // subtract when the value actually looks like a peak (> global eave).
    const isGableEnd = (face === 'front' || face === 'back') && gableRise > 0;
    const eaveH = isGableEnd && measuredH > globalH + 0.5 && (measuredH - gableRise) >= 5
      ? measuredH - gableRise
      : measuredH;
    const wallHeightFt = plausible(eaveH, 5, globalH * 2) ? Math.round(eaveH * 2) / 2 : globalH;
    const storyCount = Number(rec?.story_count) || globalStories;
    const faceOpenings = openings
      .filter(o => normFace(o.wall_face) === face)
      .map(o => ({ type: o.type || 'window', zone: String(o.zone || '').toLowerCase(), ...openingDims(o) }));
    // "Photographed" must reflect real photo evidence, not merely the presence
    // of a dimension record. Precedence: a facet photo count is the most direct
    // signal; coverage.missing_faces is the next best; a bare record is the
    // legacy fallback. Coverage still vetoes, because it excludes
    // reference-only Street View imagery that a raw photo count would include.
    const photographed = hasFacetEvidence
      ? (facetPhotoCount[face] || 0) > 0 && !missing.has(face)
      : hasCoverage
        ? !missing.has(face)
        : !!rec;
    return {
      face,
      label: FACE_LABELS[face],
      widthFt: finalWidth(face),
      wallHeightFt,
      storyCount,
      gableRiseFt: (face === 'front' || face === 'back') ? Math.round(gableRise * 2) / 2 : 0,
      openings: faceOpenings,
      photographed,
      photoLabel: rec?.photo_label || null,
    };
  });
}

/** Ticked architectural dimension line (horizontal or vertical). */
function dimLine(x1, y1, x2, y2, label, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // unit perpendicular for the 45° tick marks
  const px = -dy / len, py = dx / len;
  const t = 0.55;
  const tick = (x, y) =>
    `<line x1="${(x - (dx / len) * t / 2 - px * t / 2).toFixed(2)}" y1="${(y - (dy / len) * t / 2 - py * t / 2).toFixed(2)}" x2="${(x + (dx / len) * t / 2 + px * t / 2).toFixed(2)}" y2="${(y + (dy / len) * t / 2 + py * t / 2).toFixed(2)}" stroke="${color}" stroke-width="0.28"/>`;
  const horiz = Math.abs(dy) < 0.01;
  const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2;
  const text = horiz
    ? `<text x="${lx.toFixed(2)}" y="${(ly + 1.7).toFixed(2)}" font-size="2" text-anchor="middle" fill="${color}" font-weight="600">${esc(label)}</text>`
    : `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" font-size="2" text-anchor="middle" fill="${color}" font-weight="600" transform="rotate(-90 ${lx.toFixed(2)} ${ly.toFixed(2)})">${esc(label)}</text>`;
  return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="0.18"/>`
    + tick(x1, y1) + tick(x2, y2) + text;
}

/**
 * Render one elevation as a responsive SVG string (scales to its container,
 * capped at `width` px). 1 SVG unit = 1 ft; viewBox adds margin for labels.
 */
export function elevationSVG(model, { width = 320 } = {}) {
  const W = Math.max(6, model.widthFt || 20);
  const H = Math.max(6, model.wallHeightFt || 9);
  const G = Math.max(0, model.gableRiseFt || 0);
  const m = 5;                       // margin for dimension lines (ft)
  const vw = W + m * 2, vh = H + G + m * 2 + 2;
  const groundY = m + G + H;         // y of ground line
  const wallTopY = m + G;
  const est = !model.photographed;

  const stroke = est ? '#94a3b8' : '#334155';
  const dim = '#2563eb';
  const dash = est ? ' stroke-dasharray="1.2 0.8"' : '';
  const parts = [];
  parts.push(`<rect x="0" y="0" width="${vw}" height="${vh}" fill="white"/>`);

  // Wall body
  parts.push(`<rect x="${m}" y="${wallTopY}" width="${W}" height="${H}" fill="${est ? '#f8fafc' : '#eef2f7'}" stroke="${stroke}" stroke-width="0.35"${dash}/>`);

  // Siding course lines (6" exposure), drawn under openings
  const courseColor = est ? '#e2e8f0' : '#cbd5e1';
  for (let cy = groundY - COURSE_EXPOSURE_FT; cy > wallTopY + 0.2; cy -= COURSE_EXPOSURE_FT) {
    parts.push(`<line x1="${m}" y1="${cy.toFixed(2)}" x2="${m + W}" y2="${cy.toFixed(2)}" stroke="${courseColor}" stroke-width="0.08"/>`);
  }

  // Corner boards (0.5 ft trim strips at each wall corner)
  for (const cx of [m, m + W - 0.5]) {
    parts.push(`<rect x="${cx}" y="${wallTopY}" width="0.5" height="${H}" fill="${est ? '#f1f5f9' : '#dde4ee'}" stroke="${stroke}" stroke-width="0.12"${dash}/>`);
  }

  // Eave / fascia band: bold eave line extending past the wall (overhang hint)
  // + a thin fascia board strip above it.
  const oh = 1.5;
  parts.push(`<rect x="${m - oh}" y="${wallTopY - 0.75}" width="${W + oh * 2}" height="0.75" fill="${est ? '#f1f5f9' : '#d3dcea'}" stroke="${stroke}" stroke-width="0.22"${dash}/>`);
  parts.push(`<line x1="${m - oh}" y1="${wallTopY}" x2="${m + W + oh}" y2="${wallTopY}" stroke="${stroke}" stroke-width="0.5"${dash}/>`);

  // Gable triangle + rake extensions
  if (G > 0) {
    parts.push(`<polygon points="${m},${wallTopY} ${m + W},${wallTopY} ${m + W / 2},${m}" fill="${est ? '#f8fafc' : '#e2e8f0'}" stroke="${stroke}" stroke-width="0.35"${dash}/>`);
    // course lines inside the gable — half-width grows from 0 at the apex
    // (cy = m) to W/2 at the eave (cy = wallTopY)
    for (let cy = wallTopY - COURSE_EXPOSURE_FT; cy > m + 0.4; cy -= COURSE_EXPOSURE_FT) {
      const halfW = ((cy - m) / G) * (W / 2);
      parts.push(`<line x1="${(m + W / 2 - halfW).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(m + W / 2 + halfW).toFixed(2)}" y2="${cy.toFixed(2)}" stroke="${courseColor}" stroke-width="0.08"/>`);
    }
    // rake overhang extensions past the eave corners
    const slope = G / (W / 2);
    const extX = oh, extY = oh * slope;
    parts.push(`<line x1="${(m - extX).toFixed(2)}" y1="${(wallTopY + extY).toFixed(2)}" x2="${m}" y2="${wallTopY}" stroke="${stroke}" stroke-width="0.35"${dash}/>`);
    parts.push(`<line x1="${m + W}" y1="${wallTopY}" x2="${(m + W + extX).toFixed(2)}" y2="${(wallTopY + extY).toFixed(2)}" stroke="${stroke}" stroke-width="0.35"${dash}/>`);
  }

  // Story divider line for multi-story
  if (model.storyCount > 1) {
    const perStory = H / model.storyCount;
    for (let s = 1; s < model.storyCount; s++) {
      const y = groundY - s * perStory;
      parts.push(`<line x1="${m}" y1="${y}" x2="${m + W}" y2="${y}" stroke="#94a3b8" stroke-width="0.18" stroke-dasharray="0.8 0.6"/>`);
    }
  }

  // Ground line with hatch marks
  parts.push(`<line x1="${m - 2}" y1="${groundY}" x2="${m + W + 2}" y2="${groundY}" stroke="${stroke}" stroke-width="0.45"/>`);
  for (let gx = m - 2; gx < m + W + 2; gx += 1.5) {
    parts.push(`<line x1="${gx.toFixed(2)}" y1="${groundY}" x2="${(gx - 0.6).toFixed(2)}" y2="${(groundY + 0.7).toFixed(2)}" stroke="${stroke}" stroke-width="0.12"/>`);
  }

  // Openings — grouped by zone so multiple openings in one zone fan out
  const byZone = {};
  model.openings.forEach((o, i) => {
    const z = ZONE_CENTER[o.zone] != null ? o.zone : `idx${i}`;
    (byZone[z] = byZone[z] || []).push(o);
  });
  let unknownIdx = 0;
  for (const [zone, list] of Object.entries(byZone)) {
    const centerFrac = ZONE_CENTER[zone] ?? ((unknownIdx++ + 1) / (model.openings.length + 1));
    const totalW = list.reduce((s, o) => s + o.w, 0) + (list.length - 1) * 0.8;
    let cursor = m + Math.min(Math.max(centerFrac * W - totalW / 2, 0.3), Math.max(0.3, W - totalW - 0.3));
    for (const o of list) {
      const isDoor = isDoorType(o.type);
      // Doors/garages stand on the ground; windows sit on a ~3ft sill (per story row,
      // alternating rows on multi-story walls so counts don't pile onto one floor).
      let bottomY;
      if (isDoor) bottomY = groundY;
      else {
        const sill = 3;
        const row = model.storyCount > 1 ? (model.openings.indexOf(o) % model.storyCount) : 0;
        const perStory = H / model.storyCount;
        const rowBase = groundY - row * perStory;
        bottomY = Math.max(wallTopY + o.h + 0.5, Math.min(rowBase - sill, rowBase - 1));
      }
      const x = cursor, y = bottomY - o.h;
      cursor += o.w + 0.8;
      const fill = o.type === 'garage_door' ? '#cbd5e1' : isDoor ? '#a8c5e8' : '#bfdbfe';
      // trim casing around the opening
      parts.push(`<rect x="${(x - 0.25).toFixed(2)}" y="${(y - 0.25).toFixed(2)}" width="${o.w + 0.5}" height="${o.h + 0.5}" fill="white" stroke="${stroke}" stroke-width="0.18"${dash}/>`);
      parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${o.w}" height="${o.h}" fill="${fill}" stroke="#475569" stroke-width="0.22"/>`);
      if (o.type === 'garage_door') {
        for (let p = 1; p < 4; p++) {
          parts.push(`<line x1="${x.toFixed(2)}" y1="${(y + (o.h * p) / 4).toFixed(2)}" x2="${(x + o.w).toFixed(2)}" y2="${(y + (o.h * p) / 4).toFixed(2)}" stroke="#94a3b8" stroke-width="0.12"/>`);
        }
      } else if (!isDoor) {
        // window mullions
        parts.push(`<line x1="${(x + o.w / 2).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(x + o.w / 2).toFixed(2)}" y2="${(y + o.h).toFixed(2)}" stroke="#475569" stroke-width="0.1"/>`);
        parts.push(`<line x1="${x.toFixed(2)}" y1="${(y + o.h / 2).toFixed(2)}" x2="${(x + o.w).toFixed(2)}" y2="${(y + o.h / 2).toFixed(2)}" stroke="#475569" stroke-width="0.1"/>`);
      }
      const label = `${o.type === 'entry_door' || o.type === 'door' ? 'D' : o.type === 'garage_door' ? 'G' : 'W'} ${o.w}×${o.h}`;
      parts.push(`<text x="${(x + o.w / 2).toFixed(2)}" y="${(y + o.h + 1.9).toFixed(2)}" font-size="1.5" text-anchor="middle" fill="#64748b">${esc(label)}</text>`);
    }
  }

  // Dimension lines: width below the ground line, height left of the wall
  const dimY = groundY + 2.6;
  parts.push(`<line x1="${m}" y1="${groundY + 0.9}" x2="${m}" y2="${dimY + 0.5}" stroke="${dim}" stroke-width="0.1"/>`);
  parts.push(`<line x1="${m + W}" y1="${groundY + 0.9}" x2="${m + W}" y2="${dimY + 0.5}" stroke="${dim}" stroke-width="0.1"/>`);
  parts.push(dimLine(m, dimY, m + W, dimY, `${W} ft`, dim));
  const dimX = 2.4;
  parts.push(`<line x1="${m - 0.9}" y1="${wallTopY}" x2="${dimX + 0.5}" y2="${wallTopY}" stroke="${dim}" stroke-width="0.1"/>`);
  parts.push(`<line x1="${m - 0.9}" y1="${groundY}" x2="${dimX + 0.5}" y2="${groundY}" stroke="${dim}" stroke-width="0.1"/>`);
  parts.push(dimLine(dimX, wallTopY, dimX, groundY, `${H} ft`, dim));
  // gable peak height callout
  if (G > 0) {
    parts.push(dimLine(m + W + 2.4, wallTopY, m + W + 2.4, m, `${G} ft`, '#64748b'));
  }

  if (est) {
    parts.push(`<text x="${m + W / 2}" y="${wallTopY + H / 2}" font-size="2.2" text-anchor="middle" fill="#b45309" font-weight="600">NOT PHOTOGRAPHED — ESTIMATED</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="100%" style="max-width:${width}px;height:auto;display:block" role="img" aria-label="${esc(model.label)} elevation">${parts.join('')}</svg>`;
}

/** All four elevations as [{ model, svg }]. */
export function renderElevationSet(sd = {}, sa = {}, opts = {}) {
  return buildElevationModels(sd, sa).map(model => ({ model, svg: elevationSVG(model, opts) }));
}
