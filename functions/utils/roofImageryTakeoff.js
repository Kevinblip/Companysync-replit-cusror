/**
 * roofImageryTakeoff — measure a roof FROM the imagery the reviewer selected.
 *
 * Until now Clear / Winter / Recent only re-skinned the map. The measurement
 * still came from Google Solar's own (often years-old, often tree-occluded)
 * model, so picking a clearer image could not change a single number.
 *
 * This module makes that imagery a real measurement source:
 *   1. stitch the exact tiles of the selected source into one image centred on
 *      the property, at a KNOWN ground scale (feet per pixel),
 *   2. have a vision model trace roof facet polygons in PIXEL coordinates,
 *   3. convert pixels to plan feet here, in code.
 *
 * The model is never asked for a length or an area. It is asked only where the
 * roof edges are; every foot is computed from the tile scale, which is exact
 * Web-Mercator geometry. A model that hallucinates "48 LF of ridge" cannot be
 * checked, but a traced polygon can be re-measured, re-projected and drawn back
 * onto the map for the reviewer to correct.
 */

import { ESRI_CLARITY_TILES, WAYBACK_TILES, ESRI_PLACEHOLDER_MAX_BYTES } from '../../src/lib/mapImagery.js';

const D2R = Math.PI / 180;
export const TILE_SIZE = 256;
const FT_PER_DEG_LAT = 364567.2;
const M_TO_FT = 3.280839895;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round = (v, p = 2) => { const m = 10 ** p; return Math.round(num(v) * m) / m; };

/** Ground resolution in metres per pixel at a given latitude and zoom. */
export function metersPerPixel(lat, zoom) {
  return (156543.03392804097 * Math.cos(num(lat) * D2R)) / 2 ** num(zoom);
}

/** Web-Mercator global pixel coordinates (256px tiles) for a lat/lng. */
export function latLngToGlobalPixel(lat, lng, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const s = Math.min(Math.max(Math.sin(lat * D2R), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Resolve an imagery source key to a concrete tile template.
 * Falls back to Esri Clarity when a Wayback release id is unavailable, so a
 * config outage degrades to a real image rather than a broken URL.
 */
export function resolveImagerySource(sourceKey, waybackIds = {}) {
  const key = String(sourceKey || 'google');
  if (key === 'esri_wayback_winter' && waybackIds.winter) {
    return { key, template: `${WAYBACK_TILES}/${waybackIds.winter}/{z}/{y}/{x}`, label: 'Esri Wayback (winter release)', kind: 'tiles' };
  }
  if (key === 'esri_wayback_recent' && waybackIds.recent) {
    return { key, template: `${WAYBACK_TILES}/${waybackIds.recent}/{z}/{y}/{x}`, label: 'Esri Wayback (most recent release)', kind: 'tiles' };
  }
  if (key === 'esri_clarity' || key.startsWith('esri_')) {
    return {
      key: 'esri_clarity',
      template: ESRI_CLARITY_TILES,
      label: 'Esri World Imagery (Clarity)',
      kind: 'tiles',
      downgraded_from: key !== 'esri_clarity' ? key : undefined,
    };
  }
  return { key: 'google', template: null, label: 'Google satellite (static map)', kind: 'google_static' };
}

/**
 * Plan-view conversion for a stitched image. x = feet EAST of centre,
 * y = feet NORTH of centre. Valid as a local tangent plane over a few hundred
 * feet, which is the whole image.
 */
export function pixelToPlanFeet(px, py, ctx) {
  return {
    x: round((num(px) - ctx.width_px / 2) * ctx.feet_per_pixel, 2),
    y: round((ctx.height_px / 2 - num(py)) * ctx.feet_per_pixel, 2),
  };
}

/** Inverse of pixelToPlanFeet — used to draw computed geometry back on the map. */
export function planFeetToLatLng(xFt, yFt, ctx) {
  const lat = ctx.center_lat + num(yFt) / FT_PER_DEG_LAT;
  const lng = ctx.center_lng + num(xFt) / (FT_PER_DEG_LAT * Math.cos(ctx.center_lat * D2R));
  return { lat, lng };
}

async function fetchTile(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'CompanySync-RoofTakeoff/1.0' } });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    // Esri answers a missing LOD with a tiny "no data" image rather than a 404.
    if (buf.length <= ESRI_PLACEHOLDER_MAX_BYTES) return { ok: false, reason: 'placeholder', bytes: buf.length };
    return { ok: true, buf };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Stitch a square aerial image centred exactly on the property.
 *
 * Steps DOWN a zoom level when the source has no native tiles there, rather
 * than upscaling a parent tile and presenting blur as detail. Returns null when
 * no real imagery exists at any usable zoom.
 */
export async function fetchStitchedAerial({
  latitude,
  longitude,
  sourceKey = 'esri_clarity',
  waybackIds = {},
  sizePx = 1024,
  // A whole-neighbourhood frame leaves a 60 ft house occupying under a tenth
  // of the width, so the model spends almost no attention on the roof. Frame
  // the property instead: wide enough to include a detached garage and the
  // full eave line, tight enough that the roof dominates the image.
  targetSpanFt = 220,
  maxOutputPx = 1536,
  minOutputPx = 768,
  maxZoom = 21,
  minZoom = 18,
  googleApiKey = null,
  fetchImpl = fetch,
  loadImage = null,
  createCanvas = null,
} = {}) {
  const source = resolveImagerySource(sourceKey, waybackIds);

  if (source.kind === 'google_static') {
    if (!googleApiKey) return null;
    // Pick the zoom whose 640x640@2 frame is closest to the target span, so the
    // roof fills the image instead of sitting in a block of neighbourhood.
    let zoom = minZoom;
    for (let z = Math.min(maxZoom, 21); z >= minZoom; z--) {
      const ftPerPx = (metersPerPixel(latitude, z) * M_TO_FT) / 2;
      if (ftPerPx * 1280 >= targetSpanFt) { zoom = z; break; }
      zoom = z;
    }
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${latitude},${longitude}&zoom=${zoom}&size=640x640&scale=2&maptype=satellite&key=${googleApiKey}`;
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // scale=2 renders each map pixel as two image pixels.
    const feetPerPixel = (metersPerPixel(latitude, zoom) * M_TO_FT) / 2;
    return {
      base64: buf.toString('base64'),
      mime_type: 'image/png',
      width_px: 1280,
      height_px: 1280,
      feet_per_pixel: round(feetPerPixel, 5),
      native_feet_per_pixel: round(feetPerPixel, 5),
      upscale_factor: 1,
      span_ft: Math.round(feetPerPixel * 1280),
      zoom,
      center_lat: num(latitude),
      center_lng: num(longitude),
      source_key: source.key,
      source_label: source.label,
      tiles_requested: 1,
      tiles_missing: 0,
    };
  }

  const canvasMod = createCanvas && loadImage ? { createCanvas, loadImage } : await import('@napi-rs/canvas');
  const mkCanvas = createCanvas || canvasMod.createCanvas;
  const mkImage = loadImage || canvasMod.loadImage;

  for (let zoom = maxZoom; zoom >= minZoom; zoom--) {
    const nativeFtPerPx = metersPerPixel(latitude, zoom) * M_TO_FT;
    // Only stitch the pixels the target span actually needs at this zoom.
    const cropPx = Math.max(64, Math.round(targetSpanFt / nativeFtPerPx));
    const centre = latLngToGlobalPixel(latitude, longitude, zoom);
    const half = cropPx / 2;
    const originX = centre.x - half;
    const originY = centre.y - half;
    const tileX0 = Math.floor(originX / TILE_SIZE);
    const tileY0 = Math.floor(originY / TILE_SIZE);
    // Exclusive end, so a fractional origin cannot drop the last tile the crop
    // actually overlaps.
    const tileX1 = Math.ceil((originX + cropPx) / TILE_SIZE) - 1;
    const tileY1 = Math.ceil((originY + cropPx) / TILE_SIZE) - 1;

    const jobs = [];
    for (let tx = tileX0; tx <= tileX1; tx++) {
      for (let ty = tileY0; ty <= tileY1; ty++) jobs.push({ tx, ty });
    }

    const results = await mapWithConcurrency(jobs, 6, (job) =>
      fetchTile(
        source.template.replace('{z}', zoom).replace('{x}', job.tx).replace('{y}', job.ty),
        fetchImpl,
      ),
    );

    const good = results.filter((r) => r?.ok).length;
    // A partial grid is normal at the edge of a release; a mostly-empty grid
    // means this zoom does not exist for this area.
    if (good === 0 || good < jobs.length * 0.6) continue;

    // Stitch at the source's own resolution first — never resample a tile
    // before it is placed, or seams drift by a pixel and corners stop welding.
    const nativeCanvas = mkCanvas(cropPx, cropPx);
    const nctx = nativeCanvas.getContext('2d');
    nctx.fillStyle = '#000';
    nctx.fillRect(0, 0, cropPx, cropPx);
    let drawn = 0;
    for (let i = 0; i < jobs.length; i++) {
      const r = results[i];
      if (!r?.ok) continue;
      try {
        const img = await mkImage(r.buf);
        nctx.drawImage(img, jobs[i].tx * TILE_SIZE - originX, jobs[i].ty * TILE_SIZE - originY);
        drawn++;
      } catch { /* one unreadable tile must not lose the whole stitch */ }
    }
    // A tile that downloaded but would not decode is still a hole in the
    // image. Counting it as present would report a complete stitch of a
    // partly black frame.
    if (drawn === 0) continue;

    // Present the crop at a size the model can actually attend to. This adds
    // no real detail, so the native resolution is reported alongside it and
    // the honest ground scale travels with the image.
    const outPx = Math.max(minOutputPx, Math.min(maxOutputPx, cropPx));
    let canvas = nativeCanvas;
    if (outPx !== cropPx) {
      canvas = mkCanvas(outPx, outPx);
      const octx = canvas.getContext('2d');
      octx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in octx) octx.imageSmoothingQuality = 'high';
      octx.drawImage(nativeCanvas, 0, 0, cropPx, cropPx, 0, 0, outPx, outPx);
    }

    const spanFt = cropPx * nativeFtPerPx;
    const out = canvas.toBuffer('image/jpeg', 92);
    return {
      base64: out.toString('base64'),
      mime_type: 'image/jpeg',
      width_px: outPx,
      height_px: outPx,
      // Scale of the image actually handed to the model — this is what pixel
      // coordinates must be converted with.
      feet_per_pixel: round(spanFt / outPx, 5),
      native_feet_per_pixel: round(nativeFtPerPx, 5),
      upscale_factor: round(outPx / cropPx, 3),
      span_ft: Math.round(spanFt),
      zoom,
      center_lat: num(latitude),
      center_lng: num(longitude),
      source_key: source.key,
      source_label: source.label,
      downgraded_from: source.downgraded_from || null,
      tiles_requested: jobs.length,
      tiles_missing: jobs.length - drawn,
    };
  }

  return null;
}

// ── Vision trace: prompt + parsing ───────────────────────────────────────────

export function buildRoofTracePrompt(ctx, address = '') {
  const spanFt = Math.round(ctx.width_px * ctx.feet_per_pixel);
  return `Top-down aerial photograph of a single residential property${address ? ` at ${address}` : ''}.

IMAGE FACTS (these are exact — do not re-estimate them):
- Size: ${ctx.width_px} x ${ctx.height_px} pixels. Pixel (0,0) is the TOP-LEFT.
- North is straight UP. East is right.
- Scale: 1 pixel = ${ctx.feet_per_pixel.toFixed(4)} feet. The image covers about ${spanFt} x ${spanFt} feet.
- The property to measure is the building at the CENTRE of the image (pixel ${Math.round(ctx.width_px / 2)}, ${Math.round(ctx.height_px / 2)}).

TASK: trace the roof of that centre building as a set of flat facets (planes).

RULES:
1. Trace the ROOF outline, including eave overhangs — not the walls underneath.
2. Include attached parts: attached garage, attached porch/portico roofs, wings, dormers, bay windows.
3. EXCLUDE detached buildings (a separate garage or shed with a gap around it), driveways, decks with no roof, pools, and neighbouring houses.
4. Split the roof into individual planes. A plane is one continuous flat surface that drains in ONE direction. A simple gable has 2. A hip has 4. Cross-gables, wings and dormers each add more.
5. Facets must TILE the roof: no overlaps, no gaps. Where two facets meet, they MUST use identical corner coordinates for their shared edge.
6. If a tree, shadow or glare hides part of the roof, still trace the most probable straight roof line through it and say so in "occluded_notes". Roofs are made of straight lines and consistent rectangles — use the visible parts to infer the hidden ones.
7. "downslope_azimuth_deg" is the compass direction water RUNS DOWN that plane: 0 = north, 90 = east, 180 = south, 270 = west. On a gable the two sides differ by 180. On a hip the four differ by 90. This is the single most important field after the outline — get it right by looking at which edge is the ridge (high) and which is the eave (low).

Return ONLY this JSON:
{
  "primary_building_found": true,
  "building_style": "<gable | hip | cross_gable | complex | flat | shed>",
  "stories_estimate": <1|1.5|2|3>,
  "roof_facets": [
    {
      "id": "F1",
      "outline_px": [[x,y],[x,y],[x,y], ...],
      "downslope_azimuth_deg": <0-359>,
      "pitch_estimate": "<e.g. 4/12, or 'flat'>",
      "is_flat": <true|false>,
      "confidence": <0.0-1.0>
    }
  ],
  "penetrations": [
    { "type": "<chimney|pipe_boot|box_vent|turbine|skylight|satellite_dish|hvac>", "px": [x,y], "size": "<small|medium|large>" }
  ],
  "ridge_vent_visible": <true|false>,
  "obstruction_pct": <0-100, share of the roof hidden by trees/shadow>,
  "occluded_notes": "<what was hidden and how you inferred it>",
  "observations": "<one or two sentences about the roof>"
}`;
}

/**
 * Convert a raw trace into plan-feet facets.
 *
 * `pitchResolver(azimuthDeg, visionPitchDegrees)` lets the caller supply a
 * better pitch (Google Solar's measured plane tilt) while keeping the traced
 * shape. Pitch and shape come from different sources and must stay separable.
 */
export function parseRoofTrace(rawInput, ctx, { pitchResolver = null, minFacetSqft = 40 } = {}) {
  // Callers hand us either the parsed object (JSON mode) or the raw text.
  // Silently treating a JSON string as an empty object would report "no
  // building found" for a perfectly good trace.
  let raw = rawInput;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
    } catch {
      raw = null;
    }
  }
  const facetsIn = Array.isArray(raw?.roof_facets)
    ? raw.roof_facets
    : Array.isArray(raw?.facets) ? raw.facets : [];
  const facets = [];
  const rejected = [];

  facetsIn.forEach((f, i) => {
    const pts = Array.isArray(f?.outline_px) ? f.outline_px : [];
    const polygon = pts
      .map((p) => (Array.isArray(p) ? { px: num(p[0], NaN), py: num(p[1], NaN) } : { px: num(p?.x, NaN), py: num(p?.y, NaN) }))
      .filter((p) => Number.isFinite(p.px) && Number.isFinite(p.py))
      .map((p) => pixelToPlanFeet(p.px, p.py, ctx));
    if (polygon.length < 3) { rejected.push({ id: f?.id || `F${i + 1}`, reason: 'fewer_than_3_points' }); return; }

    const isFlat = f?.is_flat === true || String(f?.pitch_estimate || '').toLowerCase() === 'flat';
    let pitchDeg = 0;
    if (!isFlat) {
      const m = String(f?.pitch_estimate || '').match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      pitchDeg = m && Number(m[2]) > 0 ? Math.atan(Number(m[1]) / Number(m[2])) / D2R : 18.43; // 4/12
    }
    const azimuth = ((num(f?.downslope_azimuth_deg, 180) % 360) + 360) % 360;
    const resolved = pitchResolver ? pitchResolver(azimuth, pitchDeg, isFlat) : null;

    facets.push({
      id: String(f?.id || `F${i + 1}`),
      polygon,
      pitch_degrees: Number.isFinite(resolved) ? resolved : pitchDeg,
      azimuth_degrees: azimuth,
      confidence: Math.min(1, Math.max(0, num(f?.confidence, 0.6))),
      vision_pitch_degrees: round(pitchDeg, 1),
      pitch_from: Number.isFinite(resolved) ? 'solar_plane_tilt' : 'vision_estimate',
    });
  });

  const penetrations = (Array.isArray(raw?.penetrations) ? raw.penetrations : [])
    .map((p) => {
      const px = Array.isArray(p?.px) ? p.px : [p?.x, p?.y];
      const plan = pixelToPlanFeet(num(px?.[0], NaN), num(px?.[1], NaN), ctx);
      return Number.isFinite(plan.x) && Number.isFinite(plan.y)
        ? { type: String(p?.type || 'unknown'), size: String(p?.size || 'small'), ...plan }
        : null;
    })
    .filter(Boolean);

  return {
    facets: facets.filter((f) => {
      const keep = Math.abs(shoelace(f.polygon)) >= minFacetSqft;
      if (!keep) rejected.push({ id: f.id, reason: 'below_min_area' });
      return keep;
    }),
    rejected,
    penetrations,
    building_style: raw?.building_style || null,
    stories_estimate: num(raw?.stories_estimate, 0) || null,
    ridge_vent_visible: raw?.ridge_vent_visible === true,
    obstruction_pct: Math.min(100, Math.max(0, num(raw?.obstruction_pct, 0))),
    // The model returns this as a string or a list depending on the run;
    // normalise so callers can always treat it as text.
    occluded_notes: Array.isArray(raw?.occluded_notes)
      ? raw.occluded_notes.join(' ')
      : (raw?.occluded_notes || ''),
    observations: Array.isArray(raw?.observations)
      ? raw.observations.join(' ')
      : (raw?.observations || ''),
    // A failed/unparsable reply is NOT a found building.
    primary_building_found: raw ? raw.primary_building_found !== false : false,
  };
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export default fetchStitchedAerial;
