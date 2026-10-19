import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { buildSidingMeasurementGraph } from './utils/sidingMeasurementGraph.js';
import {
  PRODUCTION_MATERIAL_SAMPLE_COUNT,
  FACE_MATERIAL_RESPONSE_SCHEMA,
  faceMaterialSystemPrompt,
  classifyFaceMaterials,
} from './utils/faceMaterialClassification.js';
import { buildMultiViewPhotoEvidence } from './utils/multiViewPhotoEvidence.js';
import { buildRoofMeasurementGraph, summarizeRoofMeasurement } from './utils/roofMeasurementGraph.js';
import { measureFromPhotoAnalysis, mergeVisionMaterialSamples, storyCountFromPhotos } from './utils/wallMaterialSections.js';
import {
  streetFacingWallAzimuths,
  alignWallAzimuthsToStreet,
  headingToWallFace as mapHeadingToWallFace,
  slotFaces,
} from './utils/photoSlotOrientation.js';

// Compatibility copy only: live requests are served by vite-functions-plugin.js.
// Keep its response shape safe for any legacy Base44 deployment that still invokes
// this file. A rectangle is intentionally returned instead of null because the 3D
// viewer uses any polygon to route through buildPolyWalls (which punches openings).
function rectanglePolygon(lengthFt: number, widthFt: number): [number, number][] {
  const halfLength = Math.max(0, Number(lengthFt) || 0) / 2;
  const halfWidth = Math.max(0, Number(widthFt) || 0) / 2;
  return [
    [-halfLength, -halfWidth],
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth],
  ];
}

// ── Street View frame usability gate (inline mirror) ────────────────────────
// Authoritative copy: lib/photoUsabilityGate.cjs, used by vite-functions-plugin.js
// (which serves both dev and production). Inlined here because this file runs in
// a Deno sandbox that cannot require() the CJS module. Any wording, category, or
// threshold change must be made in BOTH places or the model's verdict and the
// gate that reads it will disagree.
const FRAME_SUBJECT_PROMPT = `FRAME SUBJECT CHECK (MANDATORY — answer before measuring):
Auto-fetched street-level frames are aimed by map geometry, so they regularly
land on something other than the house being measured. Report what this frame
actually shows in "frame_subject":
- "subject_building": the building being measured fills a usable part of the frame
- "foliage": trees, hedges, or vegetation block the wall
- "sky": the frame is mostly sky or roofline air, not a wall
- "other_building": a different/neighbouring building fills the frame
- "obstructed": a vehicle, fence, wall, or structure blocks the wall
- "unclear": too dark, blurred, or ambiguous to judge
Also report "subject_visible_pct": roughly what percentage of the measured
building's wall face is actually visible and unobstructed (0-100).
Never guess dimensions from scenery. When frame_subject is not
"subject_building", set wall_width_ft to 0 and eave_height_ft to 0.`;

const FRAME_SUBJECT_SCHEMA_FRAGMENT = `  "frame_subject": "subject_building" | "foliage" | "sky" | "other_building" | "obstructed" | "unclear",
  "subject_visible_pct": <0-100, share of the measured building's wall face that is visible and unobstructed>,`;

const MIN_SUBJECT_VISIBLE_PCT = 35;
const MAX_RECAPTURE_ATTEMPTS = 2;
const MAX_TOTAL_RECAPTURE_ANALYSES = 4;

const REJECTION_REASON_LABELS: Record<string, string> = {
  foliage: 'Trees or foliage block the wall',
  sky: 'Frame is mostly sky, not the wall',
  other_building: 'Frame shows a different building',
  obstructed: 'The wall is blocked by vehicles, fences, or structures',
  unclear: 'The frame is too unclear to measure',
};

const RECAPTURE_STRATEGIES: Record<string, any[]> = {
  foliage: [
    { strategy: 'adjacent_panorama', search_distance_m: 45, search_radius_m: 40, heading_offset_deg: 0, pitch_deg: 15, fov_deg: 70 },
    { strategy: 'distant_panorama', search_distance_m: 115, search_radius_m: 60, heading_offset_deg: 18, pitch_deg: 8, fov_deg: 80 },
  ],
  obstructed: [
    { strategy: 'adjacent_panorama', search_distance_m: 50, search_radius_m: 40, heading_offset_deg: -15, pitch_deg: 12, fov_deg: 75 },
    { strategy: 'distant_panorama', search_distance_m: 110, search_radius_m: 60, heading_offset_deg: 20, pitch_deg: 6, fov_deg: 85 },
  ],
  sky: [
    { strategy: 'lowered_pitch', search_distance_m: 80, search_radius_m: 80, heading_offset_deg: 0, pitch_deg: 0, fov_deg: 75 },
    { strategy: 'lowered_pitch_closer', search_distance_m: 45, search_radius_m: 40, heading_offset_deg: 0, pitch_deg: -5, fov_deg: 85 },
  ],
  other_building: [
    { strategy: 'narrowed_closer', search_distance_m: 38, search_radius_m: 30, heading_offset_deg: 0, pitch_deg: 10, fov_deg: 45 },
    { strategy: 'narrowed_reaimed', search_distance_m: 60, search_radius_m: 45, heading_offset_deg: 0, pitch_deg: 10, fov_deg: 40 },
  ],
  unclear: [
    { strategy: 'reaimed', search_distance_m: 55, search_radius_m: 45, heading_offset_deg: 22, pitch_deg: 12, fov_deg: 70 },
    { strategy: 'reaimed_opposite', search_distance_m: 95, search_radius_m: 60, heading_offset_deg: -22, pitch_deg: 8, fov_deg: 80 },
  ],
};

function normalizeFrameSubject(value: any): string | null {
  const n = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['subject_building', 'foliage', 'sky', 'other_building', 'obstructed', 'unclear'].includes(n)) return n;
  if (/^(trees?|foliage|vegetation|bush(es)?|hedge)$/.test(n)) return 'foliage';
  if (/^(sky|clouds?|overhead)$/.test(n)) return 'sky';
  if (/(neighbou?r|adjacent|wrong_house|different_building|other_house)/.test(n)) return 'other_building';
  if (/(blocked|occluded|obstruct|vehicle|fence)/.test(n)) return 'obstructed';
  if (/(subject|target|house|building|facade|elevation|wall)/.test(n)) return 'subject_building';
  return null;
}

function evaluateFrameUsability(
  analysis: any,
  { label = '', sourceType = 'uploaded' }: { label?: string; sourceType?: string } = {},
): { usable: boolean; reason: string | null; detail: string } {
  const wall = label || 'This wall';
  if (!analysis || typeof analysis !== 'object') {
    return { usable: false, reason: 'unclear', detail: `${wall}: no measurable result came back for this frame.` };
  }
  const subject = normalizeFrameSubject(analysis.frame_subject);
  const rawPct = Number(analysis.subject_visible_pct);
  const visiblePct = Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : null;

  if (subject && subject !== 'subject_building') {
    return { usable: false, reason: subject, detail: `${wall}: ${REJECTION_REASON_LABELS[subject]}.` };
  }
  if (String(analysis.building_type ?? '').toLowerCase() === 'not_a_building') {
    return { usable: false, reason: 'unclear', detail: `${wall}: the frame does not show a building.` };
  }
  if (subject === 'subject_building' && visiblePct != null && visiblePct < MIN_SUBJECT_VISIBLE_PCT) {
    return { usable: false, reason: 'obstructed', detail: `${wall}: only about ${Math.round(visiblePct)}% of the wall is visible.` };
  }
  // Machine-aimed frames fail closed on a zeroed measurement; a human upload with
  // the same shape was a deliberate detail shot and is left alone.
  if (sourceType === 'street_view'
      && !(Number(analysis.wall_width_ft) > 0)
      && !(Number(analysis.eave_height_ft) > 0)) {
    return { usable: false, reason: 'unclear', detail: `${wall}: nothing measurable was visible in this frame.` };
  }
  return { usable: true, reason: null, detail: `${wall}: frame is measurable.` };
}

function buildRecapturePlan({ attempt, reason }: { attempt: number; reason: string | null }): any | null {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > MAX_RECAPTURE_ATTEMPTS) return null;
  const ladder = RECAPTURE_STRATEGIES[reason || 'unclear'] || RECAPTURE_STRATEGIES.unclear;
  const step = ladder[attempt - 1];
  return step ? { attempt, reason: reason || 'unclear', ...step } : null;
}

function captureFingerprint({ panoId, heading, pitch, fov }: any): string {
  const round = (v: any, step: number) => Math.round((Number(v) || 0) / step) * step;
  return [String(panoId || 'none'), round((((Number(heading) || 0) % 360) + 360) % 360, 5), round(pitch, 5), round(fov, 5)].join('|');
}

const STOP_REASON_LABELS: any = {
  budget_exhausted: 'the per-estimate recapture budget was already spent on other walls',
  lookup_unavailable: 'Street View lookup is not configured, so no alternative angle could be requested',
  lookup_failed: 'the Street View lookup itself failed (network, quota, or API key problem), so no alternative angle could be checked',
  analysis_failed: 'the recaptured image could not be retrieved or analyzed, so the alternative angle was never actually judged',
};

const CONFIRMED_NO_COVERAGE_STATUSES = ['ZERO_RESULTS', 'NOT_FOUND'];
function isIndeterminateLookupStatus(status: any): boolean {
  return !(status === 'OK' || CONFIRMED_NO_COVERAGE_STATUSES.includes(String(status || '')));
}

function summarizeRecapture({ label, attempts = [], initial = null, stoppedReason = null }: any): any {
  const successful = attempts.find((a: any) => a && a.usable === true);
  if (initial && initial.usable === true) {
    return {
      label, status: 'used', reason: null, stopped_reason: null, attempt_count: 0, attempts: [],
      final_image_url: initial.image_url || null, final_pano_id: initial.pano_id || null, final_heading: initial.heading ?? null,
      message: `${label}: measured from the first Street View angle.`,
    };
  }
  if (successful) {
    return {
      label, status: 'recaptured', reason: initial?.reason || null, stopped_reason: null, attempt_count: attempts.length, attempts,
      final_image_url: successful.image_url || null, final_pano_id: successful.pano_id || null, final_heading: successful.heading ?? null,
      message: `${label}: first angle was rejected (${REJECTION_REASON_LABELS[initial?.reason] || 'unusable frame'}) — measured from a recaptured ${successful.strategy || 'alternative'} angle instead.`,
    };
  }
  const rejectionLabel = REJECTION_REASON_LABELS[initial?.reason] || 'unusable frame';
  // Cut short by one of OUR limits: unmeasured, but nothing established about
  // the house, so it must not borrow the "genuinely obscured" wording.
  if (stoppedReason) {
    const triedNote = attempts.length > 0
      ? `${attempts.length} alternative angle${attempts.length === 1 ? '' : 's'} tried without success, then stopped because `
      : 'No alternative angle was tried because ';
    return {
      label, status: 'unmeasured', reason: initial?.reason || 'unclear', stopped_reason: stoppedReason,
      attempt_count: attempts.length, attempts,
      final_image_url: null, final_pano_id: null, final_heading: null,
      message: `${label}: ${rejectionLabel} — ${triedNote}${STOP_REASON_LABELS[stoppedReason] || 'the recapture could not run'}. Wall left unmeasured; a usable angle may still exist.`,
    };
  }
  return {
    label, status: 'skipped', reason: initial?.reason || 'unclear', stopped_reason: null, attempt_count: attempts.length, attempts,
    final_image_url: null, final_pano_id: null, final_heading: null,
    message: attempts.length > 0
      ? `${label}: ${REJECTION_REASON_LABELS[initial?.reason] || 'unusable frame'} — ${attempts.length} alternative angle${attempts.length === 1 ? '' : 's'} tried, none usable. Wall left unmeasured.`
      : `${label}: ${REJECTION_REASON_LABELS[initial?.reason] || 'unusable frame'} — no alternative Street View angle exists. Wall left unmeasured.`,
  };
}

function geoBearingTo(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function geoOffsetLatLng(lat: number, lng: number, distM: number, bearingDeg: number) {
  const R = 6371000;
  const b = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180, lng1 = lng * Math.PI / 180;
  const sinLat2 = Math.sin(lat1) * Math.cos(distM / R) + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(b);
  const lat2 = Math.asin(sinLat2);
  const lng2 = lng1 + Math.atan2(
    Math.sin(b) * Math.sin(distM / R) * Math.cos(lat1),
    Math.cos(distM / R) - Math.sin(lat1) * sinLat2,
  );
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

async function resolveAlternativeStreetViewFrame({ apiKey, latitude, longitude, wallAzimuth, plan }: any) {
  if (!apiKey || !plan) return null;
  const lat = Number(latitude), lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const az = Number.isFinite(Number(wallAzimuth)) ? Number(wallAzimuth) : 0;
  const pt = geoOffsetLatLng(lat, lng, plan.search_distance_m, (az + 180) % 360);
  let meta: any;
  try {
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${pt.lat},${pt.lng}`
      + `&radius=${plan.search_radius_m}&source=outdoor&key=${apiKey}`,
      { signal: AbortSignal.timeout(8000) },
    );
    meta = await resp.json();
  } catch (e) {
    return { error: (e as Error).message, indeterminate: true };
  }
  if (meta?.status !== 'OK' || !meta.pano_id) {
    // ZERO_RESULTS/NOT_FOUND answers the coverage question; anything else is an
    // outage or config fault and says nothing about the house.
    const indeterminate = isIndeterminateLookupStatus(meta?.status) || (meta?.status === 'OK' && !meta.pano_id);
    return {
      noCoverage: !indeterminate,
      indeterminate,
      status: meta?.status || 'UNKNOWN',
      error: indeterminate ? `Street View metadata returned ${meta?.status || 'an unreadable response'}` : null,
    };
  }
  const baseHeading = (meta.location?.lat != null && meta.location?.lng != null)
    ? geoBearingTo(meta.location.lat, meta.location.lng, lat, lng)
    : az;
  const heading = Math.round(((((baseHeading + plan.heading_offset_deg) % 360) + 360) % 360));
  const pitch = Math.round(plan.pitch_deg);
  const fov = Math.round(plan.fov_deg);
  return {
    panoId: meta.pano_id, heading, pitch, fov,
    strategy: plan.strategy, search_distance_m: plan.search_distance_m,
    imageUrl: `https://maps.googleapis.com/maps/api/streetview?size=640x480`
      + `&pano=${meta.pano_id}&heading=${heading}&fov=${fov}&pitch=${pitch}&key=${apiKey}`,
  };
}

async function fetchImageForGemini(url: string): Promise<{ data: string; mimeType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const arr = new Uint8Array(await resp.arrayBuffer());
  let b64str = '';
  const CHUNK = 8192;
  for (let i = 0; i < arr.length; i += CHUNK) {
    b64str += String.fromCharCode(...arr.subarray(i, Math.min(i + CHUNK, arr.length)));
  }
  // Sniff magic bytes — Gemini rejects application/octet-stream outright.
  const ct = resp.headers.get('content-type') || '';
  const mimeType = (ct && !ct.includes('octet-stream')) ? ct.split(';')[0].trim()
    : (arr[0] === 0x89 && arr[1] === 0x50) ? 'image/png'
    : (arr[0] === 0x47 && arr[1] === 0x49) ? 'image/gif'
    : 'image/jpeg';
  return { data: btoa(b64str), mimeType };
}

async function callGemini(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  images: { data: string; mimeType: string }[],
  jsonMode = true,
  temperature = 0.1,
  responseSchema: any = null,
): Promise<any> {
  const parts: any[] = images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
  parts.push({ text: prompt });

  const body: any = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(responseSchema ? { responseSchema } : {}),
    }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('No response from Gemini: ' + JSON.stringify(data).substring(0, 300));

  try { return JSON.parse(rawText); } catch {
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) { try { return JSON.parse(jsonMatch[1]); } catch {} }
    const braceMatch = rawText.match(/\{[\s\S]*\}/);
    if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch {} }
    throw new Error('Failed to parse JSON from Gemini response');
  }
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return { data, mimeType };
}

// Haversine distance in feet between two lat/lng points
function haversineFt(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902231; // Earth radius in feet
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── OSM building polygon + height tags ───────────────────────────────────────
async function getOSMBuildingFootprint(
  lat: number,
  lng: number
): Promise<{
  length_ft: number; width_ft: number; perimeter_ft: number; height_ft: number | null; source: 'osm';
  osm_levels: number | null;            // raw building:levels tag clamped to 1–4
  polygon_xy: [number, number][];       // [[east_ft, north_ft], ...] centred at building centroid
  garage_polygon_xy: [number, number][] | null; // nearby secondary building or null
} | null> {
  try {
    // Include 'tags' so we can read building:height / building:levels
    const query = `[out:json][timeout:10];way["building"](around:30,${lat},${lng});out geom tags;`;
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const res = await fetch(overpassUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { console.warn('OSM overpass HTTP error:', res.status); return null; }
    const osmData = await res.json();

    const ways = osmData.elements?.filter((el: any) => el.type === 'way' && el.geometry?.length >= 3);
    if (!ways || ways.length === 0) { console.log('OSM: no building found within 30m'); return null; }

    // Pick the largest building (by bounding box area) to handle adjacent structures
    const scoredWays = ways.map((way: any) => {
      const lats = way.geometry.map((n: any) => n.lat);
      const lngs = way.geometry.map((n: any) => n.lon);
      const latSpan = Math.max(...lats) - Math.min(...lats);
      const lngSpan = Math.max(...lngs) - Math.min(...lngs);
      return { way, area: latSpan * lngSpan };
    });
    scoredWays.sort((a: any, b: any) => b.area - a.area);
    const bestWay = scoredWays[0].way;

    // Compute true perimeter by summing Haversine edge distances
    const nodes: { lat: number; lon: number }[] = bestWay.geometry;
    let perimeterFt = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      perimeterFt += haversineFt(nodes[i].lat, nodes[i].lon, nodes[i + 1].lat, nodes[i + 1].lon);
    }
    // Close the polygon if not already closed
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (first.lat !== last.lat || first.lon !== last.lon) {
      perimeterFt += haversineFt(last.lat, last.lon, first.lat, first.lon);
    }

    // Derive length/width from bounding box for compatibility with downstream code
    const lats = nodes.map((n: any) => n.lat);
    const lngs = nodes.map((n: any) => n.lon);
    const latSpanFt = haversineFt(Math.min(...lats), lngs[0], Math.max(...lats), lngs[0]);
    const lngSpanFt = haversineFt(lats[0], Math.min(...lngs), lats[0], Math.max(...lngs));
    const length_ft = Math.round(Math.max(latSpanFt, lngSpanFt));
    const width_ft  = Math.round(Math.min(latSpanFt, lngSpanFt));

    // ── Extract building height from OSM tags ─────────────────────────────
    let osmHeightFt: number | null = null;
    let osmLevels: number | null = null;
    const tags = bestWay.tags || {};
    if (tags['building:height']) {
      const metres = parseFloat(tags['building:height']);
      if (!isNaN(metres) && metres > 0) osmHeightFt = Math.round(metres * 3.281 * 10) / 10;
    } else if (tags['building:levels']) {
      const levels = parseFloat(tags['building:levels']);
      if (!isNaN(levels) && levels > 0) osmHeightFt = Math.round(levels * 9.5 * 10) / 10;
    }
    // Extract building:levels as a separate integer story count (clamped 1–4)
    if (tags['building:levels']) {
      const lv = parseFloat(tags['building:levels']);
      if (!isNaN(lv) && lv >= 1) osmLevels = Math.min(4, Math.max(1, Math.round(lv)));
    }
    if (osmHeightFt) console.log(`OSM height tag: ${osmHeightFt}ft`);
    if (osmLevels)   console.log(`OSM building:levels tag: ${osmLevels}`);

    // ── Extract polygon XY (feet, centred at building centroid) for 3D viewer ──
    const cLat = lats.reduce((a: number, b: number) => a + b, 0) / lats.length;
    const cLng = lngs.reduce((a: number, b: number) => a + b, 0) / lngs.length;
    const isClosed = nodes.length > 1 &&
      nodes[0].lat === nodes[nodes.length - 1].lat && nodes[0].lon === nodes[nodes.length - 1].lon;
    const openNodes = isClosed ? nodes.slice(0, -1) : nodes;
    const polygon_xy: [number, number][] = openNodes.map((n: any) => [
      haversineFt(cLat, cLng, cLat, n.lon) * (n.lon >= cLng ? 1 : -1),
      haversineFt(cLat, cLng, n.lat, cLng) * (n.lat >= cLat ? 1 : -1),
    ]);

    // Detect nearby secondary building as potential garage (4–55% of main area)
    let garage_polygon_xy: [number, number][] | null = null;
    if (scoredWays.length >= 2) {
      const mainArea = scoredWays[0].area;
      const secondary = scoredWays.slice(1).find((s: any) =>
        s.area < mainArea * 0.55 && s.area > mainArea * 0.04);
      if (secondary) {
        const gNodes: { lat: number; lon: number }[] = secondary.way.geometry;
        const isGClosed = gNodes.length > 1 &&
          gNodes[0].lat === gNodes[gNodes.length - 1].lat && gNodes[0].lon === gNodes[gNodes.length - 1].lon;
        const openGNodes = isGClosed ? gNodes.slice(0, -1) : gNodes;
        garage_polygon_xy = openGNodes.map((n: any) => [
          haversineFt(cLat, cLng, cLat, n.lon) * (n.lon >= cLng ? 1 : -1),
          haversineFt(cLat, cLng, n.lat, cLng) * (n.lat >= cLat ? 1 : -1),
        ]);
      }
    }

    console.log(`OSM building found: perimeter=${Math.round(perimeterFt)} LF, bbox=${length_ft}×${width_ft} ft (${openNodes.length} polygon vertices)`);
    return {
      length_ft, width_ft, perimeter_ft: Math.round(perimeterFt),
      height_ft: osmHeightFt, source: 'osm',
      osm_levels: osmLevels,
      polygon_xy, garage_polygon_xy,
    };
  } catch (e) {
    console.warn('OSM Overpass API failed:', (e as Error).message);
    return null;
  }
}

// ── Solar API bounding-box fallback ─────────────────────────────────────────
async function getSatelliteFootprintFt(
  mapsApiKey: string,
  lat: number,
  lng: number
): Promise<{ length_ft: number; width_ft: number; perimeter_ft: number; source: 'solar' } | null> {
  try {
    const solarApiUrl =
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?` +
      `location.latitude=${lat}&location.longitude=${lng}&requiredQuality=MEDIUM&key=${mapsApiKey}`;
    const res = await fetch(solarApiUrl);
    const solarData = await res.json();

    if (solarData.boundingBox) {
      const bbox = solarData.boundingBox;
      const latDiff = Math.abs(bbox.ne.latitude - bbox.sw.latitude);
      const lngDiff = Math.abs(bbox.ne.longitude - bbox.sw.longitude);
      const latFt = latDiff * 364320;
      const lngFt = lngDiff * 364320 * Math.cos(lat * Math.PI / 180);
      // The Solar bounding box encloses the ROOF, so it overstates the wall line
      // by the eave overhang on every side. Step in by that overhang rather than
      // applying a blanket shrink factor, and measure the perimeter off the
      // resulting rectangle so the dimensions and the perimeter always agree.
      // LOCKSTEP: DEFAULT_EAVE_OVERHANG_FT in functions/utils/footprintPolygon.js.
      const EAVE_OVERHANG_FT = 1.5;
      const length_ft = Math.max(8, Math.round(Math.max(latFt, lngFt) - EAVE_OVERHANG_FT * 2));
      const width_ft  = Math.max(8, Math.round(Math.min(latFt, lngFt) - EAVE_OVERHANG_FT * 2));
      const perimeter_ft = 2 * (length_ft + width_ft);
      console.log(`Solar bbox ${Math.round(Math.max(latFt, lngFt))}×${Math.round(Math.min(latFt, lngFt))}ft → wall line ${length_ft}×${width_ft}ft (${perimeter_ft} LF)`);
      return { length_ft, width_ft, perimeter_ft, source: 'solar' };
    }
    return null;
  } catch (e) {
    console.warn('Solar API failed:', (e as Error).message);
    return null;
  }
}

// Max physically-plausible eave height by story count.
// These are hard ceilings above the spec default (9 ft/story) to allow for
// tall/vaulted stories while still catching obviously wrong AI readings.
// 1-story: up to 16 ft (vaulted ceiling); 2-story: up to 30 ft; 3-story: up to 42 ft.
const MAX_EAVE_HEIGHT_FT: Record<number, number> = { 1: 16, 2: 30, 3: 42 };
const DEFAULT_EAVE_PER_STORY = 9; // spec: 1s=9ft, 2s=18ft, 3s=27ft
// A photo calibration is a full grade-to-eave elevation measurement, not a
// per-story height. Values outside this residential range are rejected as
// anchors rather than clamped into the aggregate and allowed to inflate every
// face. The footprint/formula path remains available as the explicit fallback.
const PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT = 7;
const PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT = 28;
const PHOTO_CALIBRATION_OUTLIER_PCT = 15;

// ═══════════════════════════════════════════════════════════════════════════
// RULE 1 — EXIF COMPASS BINDING
// Parses GPSImgDirection (tag 0x0011) from JPEG APP1/EXIF bytes.
// Returns camera heading in degrees [0,360) from True North, or null.
// ═══════════════════════════════════════════════════════════════════════════
function extractExifHeading(buf: ArrayBuffer): number | null {
  const b = new Uint8Array(buf);
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let off = 2;
  while (off + 4 < b.length) {
    if (b[off] !== 0xFF) break;
    const marker = b[off + 1];
    off += 2;
    if (off + 2 > b.length) break;
    const segLen = (b[off] << 8) | b[off + 1];
    if (marker === 0xE1) { // APP1 — potential EXIF
      if (b[off+2]===0x45&&b[off+3]===0x78&&b[off+4]===0x69&&b[off+5]===0x66) {
        const result = _tiffGPSHeading(b.slice(off + 8, off + segLen));
        if (result !== null) return result;
      }
    } else if (marker === 0xDA) break; // Start of scan — no more metadata
    off += segLen;
  }
  return null;
}

function _tiffGPSHeading(d: Uint8Array): number | null {
  if (d.length < 8) return null;
  const le = d[0] === 0x49; // "II" = little-endian, "MM" = big-endian
  const r16 = (o: number) => le ? (d[o] | d[o+1]<<8) : (d[o]<<8 | d[o+1]);
  const r32 = (o: number) => le
    ? ((d[o] | d[o+1]<<8 | d[o+2]<<16 | d[o+3]<<24) >>> 0)
    : ((d[o]<<24 | d[o+1]<<16 | d[o+2]<<8 | d[o+3]) >>> 0);
  if (r16(2) !== 42) return null; // TIFF magic
  const ifd0 = r32(4);
  if (ifd0 + 2 > d.length) return null;
  const cnt0 = r16(ifd0);
  let gpsOff: number | null = null;
  for (let i = 0; i < cnt0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (e + 12 > d.length) break;
    if (r16(e) === 0x8825) { gpsOff = r32(e + 8); break; } // GPSInfo IFD pointer
  }
  if (gpsOff === null || gpsOff + 2 > d.length) return null;
  const gCnt = r16(gpsOff);
  for (let i = 0; i < gCnt; i++) {
    const e = gpsOff + 2 + i * 12;
    if (e + 12 > d.length) break;
    // GPSImgDirection = 0x0011, RATIONAL type = 5
    if (r16(e) === 0x0011 && r16(e + 2) === 5) {
      const vo = r32(e + 8);
      if (vo + 8 <= d.length) {
        const num = r32(vo), den = r32(vo + 4);
        if (den > 0) return (num / den + 360) % 360;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 2 — SATELLITE ANCHOR CONSTRAINT
// Derives the 4 outward-facing wall normals from the OSM polygon XY vertices.
// polygon_xy is in [east_ft, north_ft] local coordinates centred at centroid.
// Returns { primaryAzimuth, wallAzimuths } where azimuths are degrees from
// True North of each wall's OUTWARD normal.
// ═══════════════════════════════════════════════════════════════════════════
interface WallAzimuths { front: number; right: number; back: number; left: number; }

function computeFootprintOrientation(
  polygon_xy: [number, number][]
): { primaryAzimuth: number; wallAzimuths: WallAzimuths } | null {
  if (!polygon_xy || polygon_xy.length < 3) return null;
  // Find the longest edge — its perpendicular defines the primary wall axis.
  let longestLen = 0, longestAz = 0;
  for (let i = 0; i < polygon_xy.length; i++) {
    const [x1, y1] = polygon_xy[i];
    const [x2, y2] = polygon_xy[(i + 1) % polygon_xy.length];
    const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    if (len > longestLen) {
      longestLen = len;
      // polygon_xy is [east_ft, north_ft]. Edge direction vector: (dx=east, dy=north).
      // Outward normal (right-hand rule, polygon CCW in N-up space):
      //   rotate edge dir +90° → (dy, -dx) → azimuth = atan2(east_component, north_component)
      const dx = x2 - x1, dy = y2 - y1;
      longestAz = ((Math.atan2(dy, -dx) * 180 / Math.PI) + 360) % 360;
    }
  }
  const front = longestAz;
  const street = streetFacingWallAzimuths(front);
  return {
    primaryAzimuth: front,
    wallAzimuths: {
      front: street.front,
      right: street.right,
      back: street.back,
      left: street.left,
    },
  };
}

// Re-label "front" to match the known street-view bearing (frontH = bearing FROM
// street pano TOWARD house = the wall's outward normal pointing at the street).
function alignOrientationToStreet(
  orientation: { primaryAzimuth: number; wallAzimuths: WallAzimuths },
  streetFacingAzimuth: number
): WallAzimuths {
  return alignWallAzimuthsToStreet(orientation.wallAzimuths, streetFacingAzimuth) as WallAzimuths;
}

// ═══════════════════════════════════════════════════════════════════════════
// RULE 2 + 3 — CAMERA HEADING → WALL FACE MAPPING
// Maps the camera compass heading to the wall face being photographed.
// Camera heading h → camera faces direction h → the wall it looks at has
// outward normal ≈ (h + 180) % 360.
// When the camera is between two wall normals (angularError > OBLIQUE_THRESHOLD),
// it's an oblique corner shot spanning two planar facets.
// ═══════════════════════════════════════════════════════════════════════════
type FaceName = 'front' | 'back' | 'left_side' | 'right_side';
interface FaceMapping {
  face: FaceName;
  isOblique: boolean;
  secondaryFace: FaceName | null;
  angularError: number; // degrees from perpendicular (0 = perfectly perpendicular)
}

const OBLIQUE_THRESHOLD_DEG = 35; // >35° off perpendicular → corner shot

function headingToWallFace(
  cameraHeading: number,
  wallAz: WallAzimuths,
): FaceMapping {
  // Camera heading points at the wall. The wall's outward normal is the
  // opposite direction. Left and right follow the street-facing convention.
  const mapped = mapHeadingToWallFace(cameraHeading, wallAz);
  if (!mapped) {
    return { face: 'front', isOblique: false, secondaryFace: null, angularError: 180 };
  }
  return {
    face: mapped.face as FaceName,
    isOblique: mapped.isOblique,
    secondaryFace: mapped.secondaryFace as FaceName | null,
    angularError: mapped.angularError,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { photos, story_count_override, storyHeightFt = 9, latitude, longitude, use_satellite = true, structure_type = 'house', small_openings_in_waste = false, material_only = false, pitch_only = false, known_perimeter_ft = 0, material_samples = null } = await req.json();
    const materialSampleCount = pitch_only ? 1 : Math.max(1, Math.min(5,
      Number(material_samples) || Number(Deno.env.get('SIDING_MATERIAL_SAMPLES')) || PRODUCTION_MATERIAL_SAMPLE_COUNT));
    const isGarageMode = structure_type === 'garage';
    const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');

    if (!geminiKey) return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
    if (!photos || photos.length === 0) return Response.json({ error: 'No photos provided' }, { status: 400 });

    console.log(`analyzeHousePhotosForSiding: ${photos.length} photos, lat=${latitude}, lng=${longitude}, material_only=${material_only}`);

    // Resolve the satellite/OSM footprint before vision analysis so its physical
    // dimensions can calibrate each ground-level wall photo. Reuse this same
    // lookup during aggregate footprint calculation below.
    let resolvedFootprint: Awaited<ReturnType<typeof getOSMBuildingFootprint>> |
      Awaited<ReturnType<typeof getSatelliteFootprintFt>> = null;
    if (!isGarageMode && use_satellite && latitude && longitude && !material_only && !pitch_only) {
      resolvedFootprint = await getOSMBuildingFootprint(latitude, longitude);
      if (!resolvedFootprint && mapsKey) {
        resolvedFootprint = await getSatelliteFootprintFt(mapsKey, latitude, longitude);
      }
      if (resolvedFootprint) {
        console.log(`[SidingScaleAnchor] Resolved ${resolvedFootprint.source} footprint before AI: ${resolvedFootprint.length_ft}×${resolvedFootprint.width_ft}ft`);
      } else {
        console.log('[SidingScaleAnchor] No OSM/Solar footprint available before AI');
      }
    }

    // ── Rule 2: Compute wall-face azimuths from OSM polygon ─────────────────
    // OSM polygon_xy is in [east_ft, north_ft] local coordinates. The 4 wall
    // normals allow us to mathematically bind EXIF headings to wall faces.
    let footprintWallAzimuths: WallAzimuths | null = null;
    const osmPoly = (resolvedFootprint as any)?.polygon_xy as [number,number][] | null;
    if (osmPoly && osmPoly.length >= 3) {
      const orient = computeFootprintOrientation(osmPoly);
      if (orient) {
        footprintWallAzimuths = orient.wallAzimuths;
        console.log(`[EXIF-Bind] Footprint wall azimuths: front=${orient.wallAzimuths.front.toFixed(1)}° right=${orient.wallAzimuths.right.toFixed(1)}° back=${orient.wallAzimuths.back.toFixed(1)}° left=${orient.wallAzimuths.left.toFixed(1)}° (from OSM polygon, ${osmPoly.length} vertices)`);
      }
    }

    const widthAnchorForLabel = (label: string): number | null => {
      if (!resolvedFootprint) return null;
      const normalized = String(label || '').toLowerCase();
      // A corner/detail photo is not a straight wall-width observation.
      // Check this before front/back matching ("FR Corner" contains "front"
      // semantics in some caller labels).
      if (/corner|angle|detail|close.?up|other/.test(normalized)) return null;
      if (normalized.includes('front') || normalized.includes('back') || normalized.includes('rear')) {
        return resolvedFootprint.width_ft;
      }
      if (normalized.includes('left') || normalized.includes('right')) {
        return resolvedFootprint.length_ft;
      }
      return null;
    };

    // ═══════════════════════════════════════════════════
    // STEP 1: Download all photos + extract EXIF heading
    // ═══════════════════════════════════════════════════
    const downloadedPhotos = await Promise.all(photos.map(async (photo: any) => {
      try {
        // Rule 1: Fetch raw bytes so we can (a) convert to base64 for Gemini and
        // (b) parse GPSImgDirection (EXIF compass heading) without a second request.
        const resp = await fetch(photo.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const arr = new Uint8Array(buf);
        // Chunk-safe base64 encoding (avoids spread-operator stack overflow on large images)
        let b64str = '';
        const CHUNK = 8192;
        for (let i = 0; i < arr.length; i += CHUNK) {
          b64str += String.fromCharCode(...arr.subarray(i, Math.min(i + CHUNK, arr.length)));
        }
        const data = btoa(b64str);
        const mimeType = (() => {
          const ct = resp.headers.get('content-type') || '';
          // Sniff magic bytes if Content-Type is missing/wrong (CORS-served assets often are)
          if (ct && !ct.includes('octet-stream')) return ct.split(';')[0].trim();
          if (arr[0]===0xFF&&arr[1]===0xD8) return 'image/jpeg';
          if (arr[0]===0x89&&arr[1]===0x50) return 'image/png';
          if (arr[0]===0x47&&arr[1]===0x49) return 'image/gif';
          return 'image/jpeg';
        })();
        const image = { data, mimeType };

        // Rule 1: Prefer caller-supplied exif_heading (extracted by frontend via exifr.js),
        // then fall back to server-side parse from raw JPEG APP1/EXIF bytes.
        const callerHeading = photo.exif_heading != null ? Number(photo.exif_heading) : NaN;
        const exifHeading = Number.isFinite(callerHeading)
          ? callerHeading
          : extractExifHeading(buf);
        if (exifHeading !== null) {
          console.log(`📡 [EXIF] ${photo.label}: GPSImgDirection=${Number(exifHeading).toFixed(1)}° (${Number.isFinite(callerHeading) ? 'caller-supplied' : 'parsed-from-bytes'})`);
        }

        // Rule 2: Use EXIF heading to pick the correct satellite dimension (width_ft vs length_ft)
        // for the width anchor, overriding the label-text heuristic.
        let widthAnchor: number | null = Number(photo.satellite_wall_width_ft) > 0
          ? Number(photo.satellite_wall_width_ft)
          : null;
        if (widthAnchor === null) {
          if (exifHeading !== null && footprintWallAzimuths && resolvedFootprint) {
            // Determine face from EXIF heading, then pick the correct dimension
            const fm = headingToWallFace(exifHeading, footprintWallAzimuths);
            if (!fm.isOblique) {
              // front/back face → width_ft (perpendicular to building's primary axis)
              // left/right face → length_ft (along the primary axis)
              widthAnchor = (fm.face === 'front' || fm.face === 'back')
                ? resolvedFootprint.width_ft
                : resolvedFootprint.length_ft;
            }
          } else {
            widthAnchor = widthAnchorForLabel(photo.label);
          }
        }

        return {
          url: photo.url,
          label: photo.label || 'unknown',
          image,
          calibrated_eave_height_ft: Number(photo.calibrated_eave_height_ft) > 0 ? Number(photo.calibrated_eave_height_ft) : null,
          calibrated_gable_peak_ft: Number(photo.calibrated_gable_peak_ft) > 0 ? Number(photo.calibrated_gable_peak_ft) : null,
          satellite_wall_width_ft: widthAnchor,
          source_type: photo.source_type || 'uploaded',
          panorama_id: photo.panorama_id || photo.panoId || null,
          verified_elevation: photo.verified_elevation === true,
          // Street View recapture needs the wall azimuth to work out where to
          // stand for an alternative angle when this frame is rejected.
          wall_azimuth: Number.isFinite(Number(photo.wall_azimuth)) ? Number(photo.wall_azimuth) : null,
          heading: Number.isFinite(Number(photo.heading)) ? Number(photo.heading) : null,
          classification_confidence: Number.isFinite(Number(photo.classification_confidence))
            ? Math.max(0, Math.min(100, Number(photo.classification_confidence)))
            : null,
          classification_shot_type: typeof photo.classification_shot_type === 'string'
            ? photo.classification_shot_type
            : null,
          classification_evidence: Array.isArray(photo.classification_evidence)
            ? photo.classification_evidence.filter((item: any) => typeof item === 'string').slice(0, 8)
            : [],
          classification_reason: typeof photo.classification_reason === 'string'
            ? photo.classification_reason.slice(0, 240)
            : '',
          perceptual_hash: typeof photo.perceptual_hash === 'string'
            ? photo.perceptual_hash
            : null,
          exif_heading: Number.isFinite(exifHeading as number) ? exifHeading : null,
        };
      } catch (e) {
        console.warn(`Failed to load photo ${photo.label}:`, (e as Error).message);
        return null;
      }
    }));
    const photoImages: { url: string; label: string; image: { data: string; mimeType: string } }[] =
      downloadedPhotos.filter((p): p is { url: string; label: string; image: { data: string; mimeType: string } } => p !== null);

    if (photoImages.length === 0) return Response.json({ error: 'Failed to load any photos' }, { status: 400 });

    // ── Material-only mode (Manual Entry) ────────────────────────────────────
    // Just identify material, condition, and complexity — skip all dimension work.
    if (material_only) {
      const allImages = photoImages.map(p => p.image);
      const sysMaterial = 'You are an expert siding material identification specialist. Look at exterior building photos and identify the predominant siding material clearly and concisely.';
      const promptMaterial = `Examine these exterior building photos and identify the siding.
Return valid JSON with exactly these fields:
{
  "siding_material": one of "vinyl","fiber_cement","wood","aluminum","stucco","brick","stone","hardboard","engineered_wood","mixed",
  "siding_condition": one of "excellent","good","average","fair","poor",
  "siding_complexity": one of "simple","moderate","complex",
  "material_notes": "one sentence: describe material type, color, and any visible damage"
}`;
      try {
        const result = await callGemini(geminiKey, sysMaterial, promptMaterial, allImages);
        return Response.json({
          siding_material: result.siding_material || 'vinyl',
          siding_condition: result.siding_condition || 'average',
          siding_complexity: result.siding_complexity || 'simple',
          material_notes: result.material_notes || '',
          material_only: true,
          success: true,
        });
      } catch (e) {
        console.warn('Material-only scan failed:', (e as Error).message);
        return Response.json({ error: 'Material scan failed: ' + (e as Error).message }, { status: 500 });
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 2: Per-photo dimension analysis
    // ═══════════════════════════════════════════════════
    const sysPrompt = `You are an expert exterior building measurement specialist. Your job is to measure wall dimensions accurately using physical reference objects in the photo. You ALWAYS use siding course counting as your primary height method — this is non-negotiable. You are conservative and never overestimate.`;

    // Analyze all photos CONCURRENTLY (not sequentially) — with several photos
    // at ~18-30s of Gemini processing each, a sequential loop can take
    // minutes and blow past upstream/proxy timeouts, causing the request to
    // fail silently and the UI to render an all-zero result.
    // Extracted into a named function so a rejected Street View frame can be
    // re-analyzed with a recaptured image without duplicating the prompt.
    const analyzeOnePhoto = async (photoData: any) => {
      const structureContext = isGarageMode
        ? `⚠️ STRUCTURE TYPE DECLARED BY USER: This is a DETACHED GARAGE or outbuilding. NOT a house.
- Expect typical garage dimensions: 18-24ft wide × 18-24ft deep, 1 story, 8-10ft ceiling
- Garage doors are the dominant feature — count OPENINGS only (double-wide = 1 opening)
- The glass panes/lights IN a garage door panel are NOT wall windows. Ignore them for window count.
- There may be zero or 1 small wall windows on the side/rear wall only
- No satellite footprint was used — all measurements come from these photos`
        : `STRUCTURE TYPE: Residential house / main dwelling.
- Expect typical house dimensions: 28-50ft wide × 24-50ft deep
- May have attached garage on front or side wall`;
      const satelliteWallWidthFt = Number((photoData as any).satellite_wall_width_ft) || 0;
      const satelliteScaleContext = satelliteWallWidthFt > 0
        ? `
════════════════════════════════════════════════
SATELLITE WALL-WIDTH SCALE ANCHOR (MANDATORY)
════════════════════════════════════════════════
The exact satellite-derived width of the PRIMARY wall face in this photo is ${satelliteWallWidthFt} feet.
- Treat ${satelliteWallWidthFt} ft as FIXED ground truth. Do not estimate or replace wall_width_ft.
- Set wall_width_ft to exactly ${satelliteWallWidthFt}.
- Use the visible left and right wall boundaries to establish the horizontal pixel-to-foot scale.
- Use that calibrated scale, corrected for perspective, to measure grade-to-eave height, gable rise, every opening, and non-siding coverage.
- Report "satellite_width_${satelliteWallWidthFt}ft" in reference_anchor.
`
        : '';
      if (satelliteWallWidthFt > 0) {
        console.log(`[SidingScaleAnchor] ${photoData.label}: AI received fixed satellite width ${satelliteWallWidthFt}ft`);
      }

      const prompt = `${structureContext}

Analyze this exterior building wall photo labeled "${photoData.label}" to estimate dimensions.
${satelliteScaleContext}

${FRAME_SUBJECT_PROMPT}

════════════════════════════════════════════════
WALL HEIGHT — DUAL-ANCHOR CALIBRATION (MANDATORY, DO NOT SKIP)
════════════════════════════════════════════════
Use TWO physical scale anchors and cross-check them. Never rely on gut-feel defaults.

ANCHOR 1 — DOOR HEIGHT (PRIMARY when an entry door is visible):
1. Find a standard exterior entry door frame. Standard height = 80 inches = 6.67 ft.
2. Establish the pixels-per-foot scale from the door's visible height.
3. Apply that scale to measure the wall from GRADE (ground) to the EAVE LINE.
→ Report this as door_anchor_eave_ft (0 if no clear entry door visible).

ANCHOR 2 — SIDING COURSE COUNT (PRIMARY when no door; otherwise cross-check):
1. Find the horizontal lap siding courses on this wall.
2. Count the courses from the foundation/grade line up to the EAVE LINE (where the roof slope begins).
   → Each vinyl or aluminum lap course = 4 inches tall
   → Each wood/fiber-cement course = 4-6 inches tall
3. Multiply: (course count) × 4 inches ÷ 12 = eave height in feet

TYPICAL COURSE COUNTS:
- 1-story house: 24-36 courses → 8-12 ft eave
- 2-story house: 48-66 courses → 16-22 ft eave
- 3-story house: 72-99 courses → 24-33 ft eave  ← common in older cities
- Garage (1 story): 24-30 courses → 8-10 ft eave

ANCHOR 3 — GARAGE DOOR HEIGHT (STRONG — use whenever a garage door is visible):
- A standard sectional garage door opening is 7.0 ft (84") tall. This is one of the most reliable scale anchors in residential photos.
- Establish the pixels-per-foot scale from the garage door's visible height, then measure grade → eave with that scale.
- On a typical detached garage the eave sits only ~0.5-1.5 ft above the garage door top → eave_height_ft ≈ 8-9 ft. An eave more than 3 ft above the garage door top is almost always a measurement error.
- When this anchor sets your eave height, report height_method: "garage_door_anchor".
- Cross-check against the siding course count; if they disagree by more than 15%, prefer the garage door anchor and lower your confidence.

CROSS-CHECK RULE: If both anchors are available and agree within 15%, average them.
If they disagree by more than 15%, prefer the DOOR anchor and lower your confidence.
If neither anchor is available, use window height (~4 ft standard) as a last resort.

⚠️ CRITICAL WARNING — READ CAREFULLY:
eave_height_ft = distance from GRADE (ground) to the EAVE LINE ONLY.
The eave line is where the roof surface begins — the bottom edge of the roof overhang.
DO NOT measure to the ridge, the peak, or the top of any gable triangle.
A 1-story eave is NEVER above 12 ft. A 2-story eave is NEVER above 22 ft. A 3-story eave is NEVER above 32 ft.
If you see three distinct floor levels of windows stacked above each other → story_count = 3.

REFERENCE OBJECT STANDARD SIZES (use for width estimation):
- Double/2-car garage door: 15-16 ft wide × 7 ft tall
- Single garage door: 8-9 ft wide × 7 ft tall
- Standard entry door: 3 ft wide × 6.8 ft tall
- Standard window: 2.5-4 ft wide × 4 ft tall

INSTRUCTIONS:
1. Count siding courses → compute eave_height_ft (primary method above)
2. Identify reference objects for wall WIDTH (garage doors, entry doors, windows)
3. Use width reference to anchor wall_width_ft for THIS wall face only
4. For gable ends: gable_rise_ft = the vertical height of the TRIANGULAR section ABOVE the eave line only
5. If this is a CORNER/ANGLE shot (two walls visible), set "is_corner_shot": true; estimate the primary wall width only

CRITICAL OPENING COUNTING RULES:
- windows_count: Count ONLY wall windows — openings IN THE WALL with glass. DO NOT count glass panels IN a garage door.
- garage_doors_count: Count OPENINGS (holes in the wall), not panels. Double-wide 16ft garage door = 1 opening.
- doors_count: Count only walk-through entry doors in the wall.
- Corner shots: ONLY count openings on the PRIMARY visible wall face.
- Only count openings that are ≥50% visible in frame.
CRITICAL: You must explicitly scan for and count large multi-panel sliding glass doors and patio doors on the rear and sides of the property, as these represent significant wall area deductions. Treat them as multiple window units if necessary.

PER-OPENING ROUGH-OPENING + INDIVIDUAL-UNIT MEASUREMENT (for siding deductions, trim, and unit counts):
For EVERY rough opening in the wall, return ONE entry in "openings". A rough opening
may contain several individual window components (for example a mulled triple window).
Use the outside frame dimensions for width_ft and height_ft, and list every visible
individual window unit inside that frame in "components".
- Never split panes, grids, sashes, or garage-door lights into separate openings.
- Never merge adjacent openings merely because they have similar size or occupy the same zone.
- observation_id must identify the physical assembly consistently when the same facade
  is photographed again (for example "front_window_01").
- pos_x and pos_y are the assembly center in feet from the wall's left edge and grade.
- exposed_perimeter_lf is the outside assembly perimeter that receives J-channel.
- Mark occluded=true and lower confidence when part of the assembly is hidden.
Typical sizes as sanity reference:
- Standard window: 2.5-4 ft wide × 3-5 ft tall
- Picture/bay window: 5-8 ft wide × 4-5 ft tall
- Entry door: 3 ft wide × 6.67 ft tall
- Slider door: 5-6 ft wide × 6.67 ft tall
- Single garage door: 8-9 ft wide × 7 ft tall
- Double garage door: 15-16 ft wide × 7 ft tall
windows_count is the number of INDIVIDUAL wall-window units visible on this wall.
If several units share one outside frame, return one rough-opening entry with one
component per individual unit and count every component. Do not bank or merge
individual units merely because they are adjacent.

WALL FACE IDENTIFICATION (critical for deduplication):
Identify which side of the building this photo primarily shows:
- "front": the street-facing facade (typically has main entry door)
- "back": rear of building
- "left_side": left side when facing the front
- "right_side": right side when facing the front
- "unknown": cannot determine from photo

OPENING ZONE POSITIONS (for deduplication across multiple photos of same wall):
Divide the wall width into 5 equal horizontal zones and report which zone each opening is in:
- "far_left" = leftmost 20% of wall
- "center_left" = 20-40% from left
- "center" = middle 40-60%
- "center_right" = 60-80% from left
- "far_right" = rightmost 20%
Example: a wall with 3 evenly-spaced windows → ["far_left", "center", "far_right"]
This lets us avoid counting the same window twice if the same wall appears in multiple photos.

SIDING MATERIAL IDENTIFICATION:
- "vinyl": Plastic horizontal lap siding. Slightly shiny, uniform color. Common post-1980.
- "aluminum": Metal lap siding. Subtle metallic sheen, may show oil-canning (gentle waves). Common 1950s-1980s.
- "fiber_cement": Thick, heavy-looking lap. Very flat matte finish. Crisp edges.
- "wood": Visible wood grain, peeling paint possible.
- "brick" / "stucco": Self-explanatory.
- "stone": Natural or cultured stone veneer. Rough/irregular texture, appears heavy.
- "other": Any material not listed above.

ROOF PITCH DETECTION (when a gable end or roof rake is visible):
If this is a gable-end photo (has_gable_end: true) or has a directly visible roof rake (has_visible_rake: true), you can read the roof pitch directly:
- The gable triangle above the eave shows the roof slope. Rise over run = gable_rise_ft ÷ (wall_width_ft / 2).
- Count the visible siding reveals to establish the vertical scale before reading the rake. This is a crew-cam ground measurement, not a satellite estimate.
- Also use your visual judgment of the visible slope. Common pitches: 3/12 (shallow), 4/12, 5/12, 6/12 (typical), 7/12, 8/12, 9/12 (moderate-steep), 10/12, 12/12 (45° steep).
- Only report if confidence is "high" (clear gable triangle visible) or "medium" (slope visible, less precise).
- Set has_visible_rake=true ONLY when the actual sloped rake edge is plainly visible. Set it false for a front/rear wall with no readable slope.
- Set to null + confidence "none" if there is no gable peak/rake, or you cannot determine slope.

ROOF PLANE + EDGE MEASUREMENT (only visible, calibrated geometry):
- Return one roof_planes entry for each distinct roof plane whose full eave width and eave-to-ridge slope length can be measured in this photo.
- Use the fixed satellite wall-width anchor when supplied. Otherwise use the same door/window calibration used for the wall.
- Do not invent hidden planes, mirror a visible plane, or turn a partial close-up into a whole-roof total.
- observation_id must stay stable when the same plane appears in another view (for example "main_front_plane").
- area_sqft = width_ft × slope_length_ft. Do not add waste.
- Return roof_edges only when both endpoints are visible enough to measure. Gutters are the portions of eave that visibly carry gutter.
- roof_edge_observation_complete is true only when this elevation clearly shows every ridge/hip/valley/rake/eave/step-flashing segment that can belong to it from endpoint to endpoint; otherwise false.
- gutter_observation_complete is true only when this elevation shows its entire eave/rake condition clearly enough to confirm every guttered and non-guttered portion; otherwise false.
- Mark occluded and lower confidence when geometry is partly blocked.

MIXED MATERIALS — CRITICAL FOR ACCURATE SQUARE FOOTAGE:
Many homes have a NON-SIDING accent zone (stone wainscoting, brick base, stucco band, etc.)
on part of the wall. If this wall has TWO different materials:
1. Set has_mixed_materials = true
2. Set siding_material to the PRIMARY material that will be replaced/installed (the upper, larger area)
3. Set non_siding_material to the accent material (stone, brick, stucco, etc.)
4. Estimate non_siding_coverage_pct: what PERCENT of this wall face's total area is the NON-siding material?
   - Stone wainscoting on bottom 3ft of a 10ft wall ≈ 30%
   - Full brick lower story of a 2-story house ≈ 50%
   - Narrow decorative band ≈ 10–15%
   - Corner quoins only ≈ 5%
   IMPORTANT: Be conservative. Only count areas that are clearly a different material, not just a color change.
   Round to the nearest 5%.
If the wall is a single uniform material, set has_mixed_materials = false and non_siding_coverage_pct = 0.

WALL SECTION POLYGONS (required — each material is measured from these):
Trace every distinct material region as a polygon in wall-frame coordinates, not photo-pixel coordinates:
- x = 0 at the left edge of the wall VISIBLE IN THIS PHOTO, x = 1 at the right edge of what is visible. A close-up, a garage wing, or one slice of a long wall must not be stretched to the full footprint face.
- y = 0 at the EAVE LINE of the wall in frame, y = 1 at grade. y increases downward.
- A gable triangle sits ABOVE the eave, so its peak has y < 0. Peak y = -(gable_rise_ft / eave_height_ft). Use the eave of THIS wall, not the taller part of the house.
- Set visible_width_fraction to the share of the footprint face actually in frame (1 only when both corners of that face are visible). Set visible_x_start to where that span begins (0 at the face's left corner). Set visible_width_ft to the feet actually visible. Do not copy the satellite width anchor into those three fields.
- On a corner, split the two walls: each section's wall_face is the wall that region belongs to. A corner must not be billed as one full face.
Tag material with only: "siding", "stone", "stucco", "brick", "trim".
Vinyl, aluminum, fiber-cement, wood lap, shake, and board-and-batten are "siding".
Stone veneer, cultured stone, and ledge stone are "stone".
Do not trace windows or doors as sections. Sections of one wall meet at their edges and their areas must sum to that wall's visible area, not past it.
Set window_rows to the number of distinct horizontal rows of windows on this wall (1 on a one-story garage wing, 2 when a second story of windows is visible). Do not count garage-door lights as a row.
A one-story garage wing keeps the eave measured from the garage door (about 8-10 ft). Do not report the two-story house eave for that wing. Set height_method to garage_door_anchor and window_rows to 1.
Garage doors that open onto a driveway or the street are the FRONT, even when the photo was labeled Right Side or Left Side. Set faces_driveway=true and wall_face=front. The upload label is a hint, not the face.
On every openings[] entry, set material to the wall material that opening is cut into: "siding", "stone", "stucco", "brick", or "trim". Set pos_x to feet from the left edge of that footprint face.

MATERIAL SHARES (required — this is the quantity; the polygons above are only the overlay):
Report material_shares as the percent of the VISIBLE wall each material covers. The percents must sum to 100. Use 0 for a material that is not on this wall.
- siding: horizontal laps with a J-channel at the edges (vinyl, aluminum, fiber-cement, wood lap). Also use siding for board-and-batten.
- stone: irregular units with visible mortar joints. A painted band is not stone.
- stucco: smooth or textured cementitious plaster, no laps and no mortar joints between units.
Do not shrink these percents because the photo is a close-up. visible_width_fraction already says how much of the footprint face is in the frame. The shares describe the wall that is visible.

Return JSON ONLY:
{
  "view_label": "${photoData.label}",
${FRAME_SUBJECT_SCHEMA_FRAGMENT}
  "building_type": "house" | "garage" | "shed" | "commercial",
  "story_count": number (1, 2, or 3 — count ALL above-grade stories; 3-story older houses are common),
  "window_rows": number (distinct horizontal rows of windows on this wall),
  "siding_course_count": number (count of lap siding courses from grade to eave; 0 if not countable),
  "door_anchor_eave_ft": number (eave height computed from the 80-inch door anchor; 0 if no door visible),
  "height_method": "door_anchor" | "garage_door_anchor" | "course_count" | "door_scale" | "window_scale" | "estimate",
  "eave_height_ft": number (height from ground to eave line — NOT the ridge or peak),
  "wall_height_ft": number (eave_height_ft + gable_rise_ft if gable end, else same as eave_height_ft),
  "gable_rise_ft": number (vertical height of triangular gable ABOVE the eave line; 0 if no gable),
  "has_gable_end": boolean (true if this wall face has a triangular gable peak at top),
   "has_visible_rake": boolean (true only when an actual sloped roof rake edge is visibly measurable in this photo),
  "is_corner_shot": boolean (true if two walls are both visible at an angle),
  "wall_face": "front" | "back" | "left_side" | "right_side" | "unknown",
  "secondary_wall_face": "front" | "back" | "left_side" | "right_side" | null,
  "faces_driveway": boolean (true when garage doors on this wall face a driveway or the street),
  "visible_width_fraction": number (0-1 share of this footprint face actually in the frame),
  "visible_x_start": number (0-1, where the visible span starts along the face),
  "visible_width_ft": number (feet of this face actually visible — not the satellite anchor),
  "wall_width_ft": number (estimated TOTAL width of PRIMARY wall face; for corner shots, the more prominent wall),
  "reference_anchor": "description of what you used to estimate width and height",
   "windows_count": number (INDIVIDUAL wall windows only — NOT glass panels in garage doors),
  "window_zones": string[] (zone for each window: "far_left"|"center_left"|"center"|"center_right"|"far_right"),
  "doors_count": number (entry doors on THIS wall only, NOT garage doors),
  "door_zones": string[] (zone for each entry door: "far_left"|"center_left"|"center"|"center_right"|"far_right"),
  "garage_doors_count": number (count OPENINGS not panels — double-wide = 1, on THIS wall primary face only),
  "garage_door_zones": string[] (zone for each garage door opening: "far_left"|"center_left"|"center"|"center_right"|"far_right"),
  "openings": [{
    "observation_id": "stable physical rough-opening identifier",
    "type": "window"|"entry_door"|"slider_door"|"garage_door"|"vent",
    "material": "siding"|"stone"|"stucco"|"brick"|"trim",
    "width_ft": number,
    "height_ft": number,
    "zone": "far_left"|"center_left"|"center"|"center_right"|"far_right",
    "pos_x": number,
    "pos_y": number,
    "confidence": number (0-100),
    "occluded": boolean,
    "exposed_perimeter_lf": number,
    "components": [{ "type": "window", "width_ft": number, "height_ft": number }]
  }],
  "occluded": boolean,
  "has_mixed_materials": boolean (true if this wall has two distinct materials — siding + a stone/brick/stucco accent zone),
  "siding_material": "vinyl" | "aluminum" | "fiber_cement" | "wood" | "brick" | "stucco" | "stone" | "other",
  "non_siding_material": "stone" | "brick" | "stucco" | "wood" | "none" (the accent/base material that is NOT being sided over; "none" if uniform),
  "non_siding_coverage_pct": number (0–100: percent of THIS wall face area that is the non-siding accent material; 0 if uniform),
  "sections": [{
    "id": "stable id for this material region",
    "material": "siding" | "stone" | "stucco" | "brick" | "trim",
    "wall_face": "front" | "back" | "left_side" | "right_side" | null,
    "polygon": [[0, 0], [1, 0], [1, 1], [0, 1]],
    "confidence": number
  }],
  "material_shares": {
    "siding": number,
    "stone": number,
    "stucco": number,
    "brick": number,
    "trim": number
  },
  "siding_condition": "excellent" | "good" | "fair" | "poor",
  "complexity": "simple" | "moderate" | "complex",
  "confidence": number (0-100),
  "confidence_reason": "brief reason including height method used",
   "roof_pitch_detected": "3/12" | "4/12" | "5/12" | "6/12" | "7/12" | "8/12" | "9/12" | "10/12" | "11/12" | "12/12" | "13/12" | null (estimated roof pitch from the visible gable/rake; null if no gable visible or confidence is low),
  "roof_pitch_confidence": "high" | "medium" | "low" | "none" (high = clear gable triangle, medium = visible slope, low/none = can't determine),
   "facade_pitch_slope": number | null (rise per 12 inches from the visible siding-scaled gable/rake; null when it cannot be measured),
   "facade_pitch_confidence": "high" | "medium" | "low" | "none",
  "roof_planes": [{
    "observation_id": "stable physical roof-plane identifier",
    "face": "front" | "back" | "left_side" | "right_side" | "unknown",
    "width_ft": number,
    "slope_length_ft": number,
    "area_sqft": number,
    "pitch": "rise/12",
    "azimuth_degrees": number | null,
    "confidence": number,
    "occluded": boolean
  }],
  "roof_edges": [{
    "edge_id": "stable physical edge identifier",
    "type": "ridge" | "hip" | "valley" | "rake" | "eave" | "gutter" | "step_flashing",
    "face": "front" | "back" | "left_side" | "right_side" | "unknown",
    "length_ft": number,
    "confidence": number,
    "occluded": boolean
  }],
  "roof_edge_observation_complete": boolean,
  "gutter_observation_complete": boolean
}`;

      try {
        const photoReadCount = 1;
        const samples: any[] = [];
        for (let sampleIndex = 0; sampleIndex < photoReadCount; sampleIndex += 1) {
          try {
            const sample = await callGemini(geminiKey, sysPrompt, prompt, [photoData.image], true, 0);
            if (sample && typeof sample === 'object') samples.push(sample);
          } catch (sampleErr) {
            console.warn(`${photoData.label}: dimension read ${sampleIndex + 1}/${photoReadCount} failed`, sampleErr);
          }
        }
        if (!samples.length) throw new Error(`${photoData.label}: the dimension read failed`);
        const result = mergeVisionMaterialSamples(samples) || samples[0];

        // Use the user's story_count_override for per-photo bounds when available.
        // Gemini's per-photo story detection frequently returns 1 (it only sees one floor
        // in a cropped photo), which would wrongly apply the 1-story 16ft cap to a
        // known 2-story house. The override the user picked in the UI is authoritative.
        const photoStories = (story_count_override && story_count_override >= 1)
          ? story_count_override
          : (result.story_count || 1);
        // Expected total eave = stories × 9 ft (spec default). Used only for clamping bounds.
        const expectedEave = photoStories * DEFAULT_EAVE_PER_STORY;
        const maxEave = Math.max(MAX_EAVE_HEIGHT_FT[photoStories] ?? 30, Math.round(expectedEave * 1.5));
        // Floor: use a SINGLE-story minimum, not the full-building height.
        // A photo of a 2-story house may only capture one floor of wall in frame.
        // Using 75 % of the full 2-story expected height (= 14 ft) as the per-photo
        // floor wrongly clamps those photos up to 14 ft, dragging the aggregate
        // average below the 18 ft spec baseline and producing an under-height model.
        const minEave = Math.max(6, Math.round(DEFAULT_EAVE_PER_STORY * 0.75)); // ≈7 ft, story-count-independent
        const normalEave = expectedEave;

        // Never trust Gemini's echo of the label — grouping/face logic depends on it
        result.view_label = photoData.label;
        // Preserve a deterministic source identity for the shared multi-view
        // evidence pass. This is used for duplicate detection only and is not
        // returned in the client-facing photo breakdown.
        result.photo_ref = photoData.url;
        result.perceptual_hash = (photoData as any).perceptual_hash || null;
        result.source_type = (photoData as any).source_type || 'uploaded';
        result.panorama_id = (photoData as any).panorama_id || null;
        result.verified_elevation = (photoData as any).verified_elevation === true;
        result.classification_confidence = (photoData as any).classification_confidence;
        result.classification_shot_type = (photoData as any).classification_shot_type;
        result.classification_evidence = (photoData as any).classification_evidence || [];
        result.classification_reason = (photoData as any).classification_reason || '';
        // The upload sorter is deliberately conservative. Preserve that
        // decision server-side so a malformed or stale face label cannot turn
        // a detail/corner image into a straight-face measurement anchor.
        if (result.classification_shot_type === 'detail'
          || result.classification_shot_type === 'unknown'
          || result.classification_shot_type === 'not_a_building') {
          result.is_detail_shot = true;
        } else if (result.classification_shot_type === 'corner') {
          result.is_corner_shot = true;
        }
        // Enforce the fixed satellite scale after generation too. The prompt tells
        // Gemini to honor it; this prevents a model response from drifting anyway.
        const visibleWidthFt = Number(result.visible_width_ft);
        result.observed_wall_width_ft = Number.isFinite(visibleWidthFt) && visibleWidthFt > 0
          ? visibleWidthFt
          : (Number(result.wall_width_ft) || 0);
        result.eave_before_clamp_ft = Number(result.eave_height_ft) || 0;
        result.faces_driveway = result.faces_driveway === true;
        if (satelliteWallWidthFt > 0) {
          result.wall_width_ft = satelliteWallWidthFt;
          result.satellite_width_anchor_ft = satelliteWallWidthFt;
          result.reference_anchor = `satellite_width_${satelliteWallWidthFt}ft`;
        }
        const labelLc = (photoData.label || '').toLowerCase();
        if (/corner|angle/.test(labelLc)) result.is_corner_shot = true;

        // ── Rules 2 & 3: EXIF Compass Binding + Oblique Corner Splitting ──────
        // When GPSImgDirection is available, mathematical heading→face mapping
        // supersedes Gemini's visual wall_face guess (which relies on driveway /
        // door appearance and is systematically wrong for rear/side walls).
        const photoExifHeading = (photoData as any).exif_heading;
        if (Number.isFinite(photoExifHeading) && footprintWallAzimuths) {
          const fm = headingToWallFace(photoExifHeading, footprintWallAzimuths);
          const namedSlot = slotFaces(photoData.label);
          result.exif_heading_deg = photoExifHeading;
          result.exif_face_angular_error_deg = Math.round(fm.angularError * 10) / 10;
          // A named capture slot is the street-facing convention. EXIF may
          // fill an unlabeled photo, but it must not mirror a slot the user
          // already chose.
          if (namedSlot.length > 0 && !namedSlot.includes(fm.face)) {
            result.wall_face = namedSlot[0];
            result.exif_slot_conflict = true;
            if (namedSlot.length > 1) {
              result.is_corner_shot = true;
              result.corner_faces = namedSlot;
            }
            console.log(`📡 [${photoData.label}] EXIF=${photoExifHeading.toFixed(1)}° suggested ${fm.face}; kept street-facing slot ${namedSlot.join('|')}`);
          } else {
          result.wall_face = fm.face;
          if (fm.isOblique) {
            // Rule 3 — Oblique corner: photo spans two intersecting wall facets.
            // Mark as corner shot so area aggregation skips this as a primary face.
            // corner_faces carries both facet labels for downstream geometry splitting.
            result.is_corner_shot = true;
            result.corner_faces = [fm.face, fm.secondaryFace].filter(Boolean);
            console.log(`📡 [${photoData.label}] EXIF=${photoExifHeading.toFixed(1)}° → OBLIQUE corner [${result.corner_faces.join('|')}] err=${fm.angularError.toFixed(1)}° (threshold=${OBLIQUE_THRESHOLD_DEG}°)`);
          } else {
            // Straight shot — clear any accidental corner flag from label heuristic
            if (!(/corner|angle/.test(labelLc))) result.is_corner_shot = false;
            console.log(`📡 [${photoData.label}] EXIF=${photoExifHeading.toFixed(1)}° → face=${fm.face} err=${fm.angularError.toFixed(1)}° (satellite-anchored, overrides Gemini visual)`);
          }
          }
        } else {
          // No EXIF heading available — fall back to user label text (existing behaviour)
          if (!result.wall_face || result.wall_face === 'unknown') {
            if (!result.is_corner_shot) {
              if (labelLc.includes('front')) result.wall_face = 'front';
              else if (labelLc.includes('back') || labelLc.includes('rear')) result.wall_face = 'back';
              else if (labelLc.includes('left')) result.wall_face = 'left_side';
              else if (labelLc.includes('right')) result.wall_face = 'right_side';
            }
          }
          if (Number.isFinite(photoExifHeading) && !footprintWallAzimuths) {
            // EXIF heading present but no polygon orientation — log for diagnostics
            result.exif_heading_deg = photoExifHeading;
            console.log(`📡 [${photoData.label}] EXIF=${Number(photoExifHeading).toFixed(1)}° present but no footprint polygon — label heuristic used`);
          }
        }

        const isPhotoHeightAnchor = [
          'door_anchor',
          'garage_door_anchor',
          'course_count',
          'door_scale',
          'window_scale',
        ].includes(result.height_method);

        if (!isPhotoHeightAnchor && result.eave_height_ft > maxEave) {
          // Cap to the physical maximum for this story count — do NOT replace with the formula.
          // The formula (story_count × 9.5) is a rough average; the physical cap is a hard limit.
          console.warn(`⚠️ [${photoData.label}] eave_height_ft ${result.eave_height_ft}ft exceeds ${photoStories}-story max (${maxEave}ft) → clamping to ${maxEave}ft. height_method=${result.height_method}`);
          result.eave_height_ft = maxEave;
          result.height_clamped = true;
        } else if (!isPhotoHeightAnchor && result.eave_height_ft < minEave && result.eave_height_ft > 0) {
          console.warn(`⚠️ [${photoData.label}] Raising eave_height_ft ${result.eave_height_ft}ft → ${minEave}ft (${photoStories}-story min)`);
          result.eave_height_ft = minEave;
          result.height_clamped = true;
        }
        // NOTE: We no longer force multi-story eaves to story_count × 9.5. The dual-anchor
        // calibration (door height + siding course count) is trusted to produce a better
        // estimate than the formula. The formula is only a fallback at the aggregate level
        // when no calibrated anchors are found across all photos.

        // Normalize per-opening data — validate sizes, compute sqft & perimeter
        result.openings = (Array.isArray(result.openings) ? result.openings : [])
          .filter((o: any) => o && Number(o.width_ft) > 0.5 && Number(o.height_ft) > 0.5 &&
                              Number(o.width_ft) <= 20 && Number(o.height_ft) <= 10)
          .map((o: any) => ({
            type: o.type || 'window',
            material: o.material || null,
            observation_id: o.observation_id || null,
            width_ft: Math.round(Number(o.width_ft) * 10) / 10,
            height_ft: Math.round(Number(o.height_ft) * 10) / 10,
            zone: o.zone || 'unknown',
            pos_x: Number.isFinite(Number(o.pos_x)) ? Number(o.pos_x) : null,
            pos_y: Number.isFinite(Number(o.pos_y)) ? Number(o.pos_y) : null,
            // Opening centers are physical feet from the wall's left edge and
            // grade. Persist the unit so renderers never have to guess from
            // the coordinate's magnitude.
            position_unit: 'feet',
            confidence: Number.isFinite(Number(o.confidence)) ? Number(o.confidence) : result.confidence,
            occluded: o.occluded === true,
            sqft: Math.round(Number(o.width_ft) * Number(o.height_ft) * 10) / 10,
            perimeter_lf: Number(o.exposed_perimeter_lf) > 0
              ? Math.round(Number(o.exposed_perimeter_lf) * 10) / 10
              : Math.round(2 * (Number(o.width_ft) + Number(o.height_ft)) * 10) / 10,
            components: Array.isArray(o.components) ? o.components : [],
          }));
        const windowRows = Number(result.window_rows);
        result.window_rows = Number.isFinite(windowRows) && windowRows > 0 ? Math.round(windowRows) : null;
        result.sections = Array.isArray(result.sections) ? result.sections : [];

        // If course count was provided but eave wasn't computed from it, recompute
        if (result.siding_course_count > 0 && result.height_method === 'course_count') {
          const courseBasedEave = Math.round((result.siding_course_count * 4) / 12 * 10) / 10;
          // Only override if the course-based value is within plausible range and differs
          if (courseBasedEave >= minEave && courseBasedEave <= maxEave &&
              Math.abs(courseBasedEave - result.eave_height_ft) > 1) {
            console.log(`[${photoData.label}] Correcting eave from ${result.eave_height_ft}ft to course-based ${courseBasedEave}ft (${result.siding_course_count} courses × 4")`);
            result.eave_height_ft = courseBasedEave;
            result.height_clamped = false;
          }
        }

        // ── Manual ruler calibration wins over everything (user measured it) ──
        if ((photoData as any).calibrated_eave_height_ft) {
          const cal = (photoData as any).calibrated_eave_height_ft;
          console.log(`📏 [${photoData.label}] Using MANUAL calibrated eave ${cal}ft (was ${result.eave_height_ft}ft, ${result.height_method})`);
          result.eave_height_ft = cal;
          result.height_method = 'manual_calibration';
          result.height_clamped = false;
          result.verify_two_story_eave = false;
          result.manually_calibrated = true;
          const peak = (photoData as any).calibrated_gable_peak_ft;
          if (peak && peak > cal) result.gable_rise_ft = Math.round((peak - cal) * 10) / 10;
        }

        // A calibrated photo plane is a full grade-to-eave measurement. Reject
        // implausible anchors instead of clamping them to a story-count bound.
        // Clearing both fields makes the graph substitute the footprint height
        // for this face and marks the result for SANITY-REVIEW.
        const finalPhotoHeight = Number(result.eave_height_ft) || 0;
        const finalIsPhotoHeightAnchor = isPhotoHeightAnchor || result.manually_calibrated === true;
        if (finalIsPhotoHeightAnchor && (
          finalPhotoHeight < PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT
          || finalPhotoHeight > PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT
        )) {
          result.height_anchor_rejected = true;
          result.height_measurement_valid = false;
          result.height_anchor_rejection_reason =
            `photo full-plane height ${finalPhotoHeight}ft is outside `
            + `${PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT}–${PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT}ft`;
          console.warn(`⚠️ [${photoData.label}] Rejecting photo height anchor: ${result.height_anchor_rejection_reason}`);
          result.eave_height_ft = 0;
          result.gable_rise_ft = 0;
        } else if (finalIsPhotoHeightAnchor) {
          result.height_measurement_valid = true;
          result.height_semantics = 'full_elevation';
        } else {
          result.height_semantics = 'unknown';
        }

        // Keep wall_height_ft consistent
        const gableRise = result.gable_rise_ft || 0;
        result.wall_height_ft = result.eave_height_ft + gableRise;

        console.log(`  ${photoData.label}: ${result.wall_width_ft}ft wide × ${result.eave_height_ft}ft eave [${result.height_method}, ${result.siding_course_count} courses], ${result.garage_doors_count}gd ${result.doors_count}d ${result.windows_count}w (${result.confidence}% conf${result.height_clamped ? ', CLAMPED' : ''})`);
        result._classificationImage = photoData.image;
        return result;
      } catch (e) {
        console.warn(`Per-photo analysis failed for ${photoData.label}:`, (e as Error).message);
        return null;
      }
    };

    const perPhotoSettled = await Promise.all(photoImages.map(analyzeOnePhoto));

    // ── Street View recapture (mirror of vite-functions-plugin.js) ───────────
    // A machine-aimed frame that turned out to be trees, sky, or the
    // neighbour's house is evidence of a bad aim, not an unmeasurable wall.
    // Try a bounded set of alternative panoramas / headings / distances before
    // reporting the wall unmeasured. Bounded twice over: MAX_RECAPTURE_ATTEMPTS
    // per wall and MAX_TOTAL_RECAPTURE_ANALYSES across the request, so a
    // hopeless address fails fast instead of multiplying AI spend.
    const streetViewFrameVerdicts: any[] = [];
    {
      const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
      let recaptureBudget = MAX_TOTAL_RECAPTURE_ANALYSES;

      for (let i = 0; i < photoImages.length; i++) {
        const photoData: any = photoImages[i];
        if ((photoData.source_type || 'uploaded') !== 'street_view') continue;

        const label = photoData.label || `Photo ${i + 1}`;
        const firstVerdict = evaluateFrameUsability(perPhotoSettled[i], { label, sourceType: 'street_view' });
        const initial = {
          usable: firstVerdict.usable,
          reason: firstVerdict.reason,
          image_url: photoData.url,
          pano_id: photoData.panorama_id || null,
          heading: photoData.heading ?? null,
        };

        if (firstVerdict.usable) {
          streetViewFrameVerdicts.push(summarizeRecapture({ label, attempts: [], initial }));
          continue;
        }

        console.log(`[SVRecapture] ${firstVerdict.detail} — looking for a better angle.`);
        const attempts: any[] = [];
        // Stays null when the ladder genuinely runs out of rungs — the only
        // case that may be reported as the wall being obscured.
        let stoppedReason: string | null = null;
        const tried = new Set<string>([
          captureFingerprint({ panoId: initial.pano_id, heading: initial.heading, pitch: 20, fov: 60 }),
        ]);

        for (let attempt = 1; attempt <= MAX_RECAPTURE_ATTEMPTS; attempt++) {
          if (recaptureBudget <= 0) { stoppedReason = 'budget_exhausted'; break; }
          if (!mapsKey) { stoppedReason = 'lookup_unavailable'; break; }
          const plan = buildRecapturePlan({ attempt, reason: firstVerdict.reason });
          if (!plan) break;

          const frame: any = await resolveAlternativeStreetViewFrame({
            apiKey: mapsKey, latitude, longitude, wallAzimuth: photoData.wall_azimuth, plan,
          });
          if (!frame || frame.indeterminate) {
            // Lookup outage/quota/denied key: our problem, not the house's.
            attempts.push({
              attempt, strategy: plan.strategy, usable: false, outcome: 'lookup_failed',
              detail: frame?.error || 'Street View lookup did not return a usable answer.',
            });
            console.warn(`[SVRecapture] ${label}: lookup failed (${frame?.status || frame?.error || 'unknown'}) — wall left unmeasured, not proven obscured.`);
            stoppedReason = 'lookup_failed';
            break;
          }
          if (frame.noCoverage) {
            attempts.push({
              attempt, strategy: plan.strategy, usable: false, outcome: 'no_alternative_frame',
              detail: 'Google has no other panorama at that distance.',
            });
            continue;
          }
          const fingerprint = captureFingerprint(frame);
          if (tried.has(fingerprint)) {
            attempts.push({
              attempt, strategy: plan.strategy, usable: false, outcome: 'duplicate_frame',
              detail: 'That alternative resolved to the same view already rejected.',
            });
            continue;
          }
          tried.add(fingerprint);
          recaptureBudget -= 1;

          let retryResult: any = null;
          try {
            const image = await fetchImageForGemini(frame.imageUrl);
            retryResult = await analyzeOnePhoto({
              ...photoData, url: frame.imageUrl, image,
              panorama_id: frame.panoId, heading: frame.heading,
            });
          } catch (e) {
            console.warn(`[SVRecapture] ${label} attempt ${attempt} failed:`, (e as Error).message);
          }

          if (!retryResult) {
            // Fetch or vision call failed, so this angle was never judged.
            // Recording it as "rejected" would manufacture evidence.
            attempts.push({
              attempt, strategy: frame.strategy, usable: false, outcome: 'analysis_failed',
              detail: 'The recaptured frame could not be retrieved or analyzed.',
              image_url: frame.imageUrl, pano_id: frame.panoId, heading: frame.heading,
            });
            stoppedReason = 'analysis_failed';
            break;
          }

          const retryVerdict = evaluateFrameUsability(retryResult, { label, sourceType: 'street_view' });
          attempts.push({
            attempt, strategy: frame.strategy,
            usable: retryVerdict.usable,
            outcome: retryVerdict.usable ? 'measured' : 'rejected',
            reason: retryVerdict.reason, detail: retryVerdict.detail,
            image_url: frame.imageUrl, pano_id: frame.panoId, heading: frame.heading,
            pitch: frame.pitch, fov: frame.fov, search_distance_m: frame.search_distance_m,
          });

          if (retryVerdict.usable) {
            retryResult.recaptured_from = initial.image_url;
            retryResult.recapture_strategy = frame.strategy;
            retryResult.recapture_attempt = attempt;
            perPhotoSettled[i] = retryResult;
            break;
          }
        }

        const summary = summarizeRecapture({ label, attempts, initial, stoppedReason });
        if (summary.status === 'skipped' || summary.status === 'unmeasured') {
          // Unmeasured either way — drop the frame so a scenery reading cannot
          // vote in the aggregate. The statuses differ only in what we claim.
          perPhotoSettled[i] = null;
          console.log(`[SVRecapture] ${summary.message}`);
        }
        streetViewFrameVerdicts.push(summary);
      }
    }

    let perPhotoResults: any[] = perPhotoSettled.filter((r) => r !== null);

    if (perPhotoResults.length === 0) {
      return Response.json({ error: 'All photo analyses failed', street_view_frame_verdicts: streetViewFrameVerdicts }, { status: 500 });
    }
    const allPerPhotoResults = perPhotoResults;
    const preAggregateEvidence = buildMultiViewPhotoEvidence(allPerPhotoResults);
    perPhotoResults = allPerPhotoResults.filter((_, index) =>
      preAggregateEvidence.photos[index]?.status !== 'duplicate');

    let faceMaterialByFace: Record<string, any> = {};
    if (!pitch_only) {
      try {
        faceMaterialByFace = await classifyFaceMaterials({
          results: perPhotoResults,
          sampleCount: materialSampleCount,
          imageForResult: (photo: any) => photo?._classificationImage || null,
          callModel: ({ images, prompt }: { images: { data: string; mimeType: string }[]; prompt: string }) => callGemini(
            geminiKey,
            faceMaterialSystemPrompt(),
            prompt,
            images,
            true,
            0,
            FACE_MATERIAL_RESPONSE_SCHEMA,
          ),
          log: (line: string) => console.log(line),
        });
      } finally {
        for (const result of allPerPhotoResults) delete result._classificationImage;
      }
    } else {
      for (const result of allPerPhotoResults) delete result._classificationImage;
    }

    // Track photos that didn't make it through (download or analysis failure) so
    // partial reads are visible instead of silently producing an undercounted result
    const analyzedLabels = perPhotoResults.map((r) => r.view_label);
    const failedPhotoLabels: string[] = [];
    {
      const remaining = [...analyzedLabels];
      for (const p of photos) {
        const lbl = p.label || 'unknown';
        const idx = remaining.indexOf(lbl);
        if (idx >= 0) remaining.splice(idx, 1);
        else failedPhotoLabels.push(lbl);
      }
    }
    if (failedPhotoLabels.length > 0) {
      console.warn(`⚠️ ${failedPhotoLabels.length}/${photos.length} photos failed to analyze: ${failedPhotoLabels.join(', ')}`);
    }

    // ═══════════════════════════════════════════════════
    // STEP 3: Build floor plan from per-photo data
    // ═══════════════════════════════════════════════════
    // Use the analyzer's structured classification first, then fall back to
    // the uploader/Gemini labels. This keeps corner shots out of straight-wall
    // dimension votes even when the label is "FR", "front_right", or absent.
    const photoLabel = (r: any) => String(r?.view_label || r?.label || '').toLowerCase()
      .trim().replace(/[\s-]+/g, '_');
    const faceToken = (r: any): string => {
      const explicit = String(r?.wall_face || '').toLowerCase().trim();
      if (explicit) {
        if (/front|south/.test(explicit)) return 'front';
        if (/back|rear|north/.test(explicit)) return 'back';
        if (/left|west/.test(explicit)) return 'left';
        if (/right|east/.test(explicit)) return 'right';
      }
      const text = photoLabel(r);
      if (/(^|_)(front|south|fr|fl|front_right|front_left)(_|$)/.test(text)) return 'front';
      if (/(^|_)(back|rear|north|br|bl|back_right|back_left)(_|$)/.test(text)) return 'back';
      if (/(^|_)(left|left_side|west)(_|$)/.test(text)) return 'left';
      if (/(^|_)(right|right_side|east)(_|$)/.test(text)) return 'right';
      return 'unknown';
    };
    const isCornerShot = (r: any) => {
      const shotType = String(r?.classification_shot_type || r?.shot_type || '').toLowerCase();
      const evidence = Array.isArray(r?.evidence) ? r.evidence.map((v: any) => String(v).toLowerCase()) : [];
      return r?.is_corner_shot === true
        || shotType === 'corner'
        || /corner|angle/.test(photoLabel(r))
        || evidence.includes('two_wall_planes')
        || evidence.includes('visible_corner')
        || (Array.isArray(r?.corner_faces) && r.corner_faces.length > 1);
    };
    const straightFace = (r: any) => isCornerShot(r) ? 'unknown' : faceToken(r);
    const frontViews = perPhotoResults.filter(r => straightFace(r) === 'front');
    const backViews  = perPhotoResults.filter(r => straightFace(r) === 'back');
    const leftViews  = perPhotoResults.filter(r => straightFace(r) === 'left');
    const rightViews = perPhotoResults.filter(r => straightFace(r) === 'right');
    const unlabeledViews = perPhotoResults.filter(r => straightFace(r) === 'unknown');

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    // Robust aggregation helpers — mirror db/siding-aggregate.cjs (MUST stay in lockstep).
    const median = (arr: number[]): number => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    // MAD-based outlier rejection, then mean of survivors.  One bad photo must
    // not drag the aggregate (mean 9.5 vs true ~8 on the Hover garage benchmark).
    const robustAvg = (values: number[]): { value: number; kept: number[]; rejected: number[] } => {
      if (values.length <= 2) return { value: avg(values), kept: [...values], rejected: [] };
      const m = median(values);
      const mad = median(values.map(v => Math.abs(v - m)));
      const within = mad > 0
        ? (v: number) => Math.abs(v - m) / (1.4826 * mad) <= 2.5
        : (v: number) => Math.abs(v - m) <= Math.max(0.15 * Math.abs(m), 1);
      const kept = values.filter(within);
      const rejected = values.filter(v => !within(v));
      if (kept.length === 0) return { value: avg(values), kept: [...values], rejected: [] };
      return { value: avg(kept), kept, rejected };
    };
    // Height anchors have a stricter contract than widths. A single bad
    // elevation must not pull a valid 9–12 ft plane into a fake 22 ft average.
    // Reject anchors more than 15% from the median, then use the median of the
    // survivors (not their mean) so one remaining edge case cannot inflate the
    // full-elevation height.
    const robustPhotoHeightAvg = (values: number[]): {
      value: number; kept: number[]; rejected: number[];
    } => {
      if (values.length === 0) return { value: 0, kept: [], rejected: [] };
      const center = median(values);
      const allowed = Math.max(center * (PHOTO_CALIBRATION_OUTLIER_PCT / 100), 0.75);
      const kept = values.filter(v => Math.abs(v - center) <= allowed);
      const rejected = values.filter(v => !kept.includes(v));
      const survivors = kept.length > 0 ? kept : [center];
      return { value: median(survivors), kept: survivors, rejected };
    };
    // Mirror db/siding-aggregate.cjs deriveBuildingDimensions exactly:
    //   • detail/close-up shots excluded (too cropped for wall-width estimation)
    //   • width minimum: > 5 ft (< 5 ft is a crop artifact, not a wall measurement)
    //   • robust (MAD-outlier-rejected) mean, not plain average
    // Mirror db/siding-aggregate.cjs label helper: view_label OR label (Gemini uses either field)
    const dimLabel = (r: any) => (r.view_label || r.label || '').toLowerCase();
    const isDetailShot = (r: any) =>
      r.is_detail_shot === true || /detail|close.?up|close up/i.test(dimLabel(r));
    // Two separate filter passes so each predicate is individually readable and testable:
    const dimResults = perPhotoResults
      .filter((r: any) => !isCornerShot(r))
      .filter(r => !isDetailShot(r));
    const frontBackWidths = dimResults.filter((r: any) => /front|back|north|south/i.test(dimLabel(r)))
      .map((r: any) => Number(r.wall_width_ft) || 0).filter(w => w > 5);
    const sideWidths = dimResults.filter((r: any) => /side|left|right|east|west/i.test(dimLabel(r)))
      .map((r: any) => Number(r.wall_width_ft) || 0).filter(w => w > 5);
    const allWidths = dimResults.map((r: any) => Number(r.wall_width_ft) || 0).filter(w => w > 5);
    const robustWidth = (ws: number[]) => Math.round(robustAvg(ws).value);
    const depthRatio = isGarageMode ? 0.9 : 0.75; // garage tend to be squarer than houses
    // Keep a photo-derived baseline available before the satellite/roof-eave
    // overrides below. This also ensures a conservative detail exclusion is
    // effective when the analysis runs without a footprint service.
    const robustFrontBackWidthFt = robustWidth(frontBackWidths);
    const robustSideWidthFt = robustWidth(sideWidths);
    const robustAnyWidthFt = robustWidth(allWidths);
    let buildingWidthFt: number = robustFrontBackWidthFt || robustAnyWidthFt;
    let buildingLengthFt: number = robustSideWidthFt || Math.round(buildingWidthFt * depthRatio);
    let depthMissing = sideWidths.length === 0; // flagged when no side photos were uploaded

    const hasGableRakeEvidence = (result: any) =>
      result?.has_gable_end === true
      || result?.has_visible_rake === true
      || Number(result?.gable_rise_ft) > 0;
    const pitchReadings = perPhotoResults
      .filter((r: any) =>
        hasGableRakeEvidence(r)
        && r.roof_pitch_detected
        && ['high', 'medium'].includes(r.roof_pitch_confidence || ''))
      .map((r: any) => ({ pitch: r.roof_pitch_detected as string, conf: r.roof_pitch_confidence as string }));

    const pitchRiseFromPhoto = (value: unknown): number | null => {
      const match = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*\/\s*12/);
      const rise = match ? Number(match[1]) : Number(value);
      return Number.isFinite(rise) && rise >= 2 && rise <= 20 ? Math.round(rise * 10) / 10 : null;
    };
    const rawFacadePitchSlopes = perPhotoResults
      .flatMap((r: any) => {
        const explicitConfidence = r.facade_pitch_confidence || '';
        const explicit = pitchRiseFromPhoto(r.facade_pitch_slope);
        // A clearly identified rake can be valid even when the whole triangular
        // gable is not in frame, but it must use the explicit facade field.
        if (explicit != null && hasGableRakeEvidence(r) && ['high', 'medium'].includes(explicitConfidence)) return [explicit];
        const detected = pitchRiseFromPhoto(r.roof_pitch_detected);
        return hasGableRakeEvidence(r)
          && detected != null
          && ['high', 'medium'].includes(r.roof_pitch_confidence || '')
          ? [detected]
          : [];
      });
    const selectConsistentSlopes = (slopes: number[]) => {
      if (slopes.length < 2) return slopes;
      const sorted = [...slopes].sort((a, b) => a - b);
      const clusters = sorted.map((start, index) =>
        sorted.slice(index).filter((pitch) => pitch - start <= 2));
      const largest = Math.max(...clusters.map((cluster) => cluster.length));
      const candidates = [...new Map(
        clusters.filter((cluster) => cluster.length === largest)
          .map((cluster) => [cluster.join(','), cluster]),
      ).values()];
      return candidates.length === 1 ? candidates[0] : [];
    };
    const facadePitchSlopes = selectConsistentSlopes(rawFacadePitchSlopes);
    let detectedRoofPitch: string | null = null;
    let detectedRoofPitchConfidence: string = 'none';

    if (pitchReadings.length > 0) {
      const highConf = pitchReadings.filter((r: any) => r.conf === 'high');
      const useReadings = highConf.length > 0 ? highConf : pitchReadings;
      const pitchCounts: Record<string, number> = {};
      for (const r of useReadings) pitchCounts[r.pitch] = (pitchCounts[r.pitch] || 0) + 1;
      const winner = Object.entries(pitchCounts).sort((a, b) => b[1] - a[1])[0];
      if (winner) {
        detectedRoofPitch = winner[0];
        detectedRoofPitchConfidence = highConf.length > 0 ? 'high' : 'medium';
        console.log(`📐 Roof pitch from photos: ${detectedRoofPitch} (${detectedRoofPitchConfidence} confidence, ${pitchReadings.length} reading(s))`);
      }
    }

    // ── Pitch-only mode: skip full wall measurement, return pitch reading immediately ──
    // Used by the inspection-photo pitch detection path (linked job photos).
    // Callers pass pitch_only=true when they only need the roof pitch and don't want
    // to run the full siding dimension analysis on non-siding inspection photos.
    // footprintSource must be initialized here (before the early return) to avoid TDZ.
    let footprintSource = 'photos';
    if (pitch_only) {
    const roofMeasurementGraph = buildRoofMeasurementGraph({
      perPhotoResults,
      buildingWidthFt,
      buildingLengthFt,
      footprintSource,
    });
      return Response.json({
        success: true,
        pitch_only: true,
        roof_pitch_detected: detectedRoofPitch,
        roof_pitch_confidence: detectedRoofPitchConfidence,
        facade_pitch_slopes: facadePitchSlopes,
        facade_pitch_source: facadePitchSlopes.length > 0 ? 'crew_cam_elevation' : null,
        roof_measurement_graph: roofMeasurementGraph,
        roof_measurement: summarizeRoofMeasurement(roofMeasurementGraph),
        photo_count: perPhotoResults.length,
      });
    }

    // Story count precedence (highest → lowest authority):
    //   1. story_count_override — sent by the UI only when the user explicitly chose
    //      a value (the Stories dropdown). When null/omitted, the backend decides.
    //   2. Well-supported photo window rows / story count. The highest reading
    //      that at least two photos (or 1.4 combined confidence) agree on wins,
    //      so a 1-story garage wing cannot pull a 2-story house down.
    //   3. OSM building:levels — used only when the photos did not produce a story.
    const photoStory = storyCountFromPhotos(perPhotoResults.map((r: any) => ({
      window_rows: r.window_rows,
      story_count: r.story_count,
      confidence: Number(r.confidence) > 1 ? Number(r.confidence) / 100 : r.confidence,
    })));
    const aiStoryCount = photoStory.story_count || Math.max(...perPhotoResults.map(r => r.story_count || 1));
    const osmLevelsFromFootprint = resolvedFootprint?.source === 'osm'
      ? (resolvedFootprint as any).osm_levels as number | null
      : null;
    const storyCount = (story_count_override && story_count_override >= 1)
      ? story_count_override
      : (aiStoryCount || osmLevelsFromFootprint || 1);
    console.log(
      `📐 Story count: ${storyCount}` +
      (story_count_override ? ` (user override=${story_count_override})` :
        photoStory.story_count ? ` (photos well-supported=${photoStory.story_count}, reads=${photoStory.reads.join(',')})` :
          osmLevelsFromFootprint ? ` (OSM building:levels=${osmLevelsFromFootprint})` :
          ` (AI detected=${aiStoryCount})`)
    );

    // ── Wall height: trust calibrated photo measurements, formula is last resort ──
    // Priority: manual calibration > photo anchors (door/course) > formula fallback
    const manualEaves = perPhotoResults
      .filter(r => r.manually_calibrated
        && r.height_measurement_valid !== false
        && !r.height_anchor_rejected)
      .map(r => r.eave_height_ft)
      .filter((h: number) =>
        h >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT
        && h <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT,
      );
    let wallHeightFt: number;
    let heightSource: string;
    if (manualEaves.length > 0) {
      // User-measured heights are authoritative.
      const { value, kept, rejected } = robustPhotoHeightAvg(manualEaves);
      wallHeightFt = Math.round(value * 2) / 2; // round to nearest 0.5ft
      heightSource = rejected.length > 0
        ? `manual_calibration (${kept.length} photo(s), ${rejected.length} outlier(s) rejected)`
        : `manual_calibration (${kept.length} photo(s))`;
      console.log(`📏 Wall height from manual calibration: ${wallHeightFt}ft (median of [${kept.join(', ')}]ft, rejected [${rejected.join(', ')}]ft)`);
    } else {
      // Use calibrated photo anchors: door_anchor, course_count, door_scale.
      // Skip photos that were hard-clamped (their eave was forced to the boundary, not measured).
      const calibratedEaves = perPhotoResults
        .filter(r => [
          'door_anchor',
          'garage_door_anchor',
          'course_count',
          'door_scale',
          'window_scale',
        ].includes(r.height_method)
          && r.height_measurement_valid !== false
          && !r.height_anchor_rejected
          && !r.height_clamped)
        .map(r => r.eave_height_ft)
        .filter((h: number) =>
          h >= PHOTO_CALIBRATION_MIN_FULL_HEIGHT_FT
          && h <= PHOTO_CALIBRATION_MAX_FULL_HEIGHT_FT,
        );

      if (calibratedEaves.length >= 1) {
        // Photo anchors are already full grade-to-eave elevations. Reject
        // >15%-from-median readings and use the median survivor; never raise a
        // valid photo height to storyCount × 9ft and never average an outlier
        // into a fake full-building height.
        const { value, kept, rejected } = robustPhotoHeightAvg(calibratedEaves);
        wallHeightFt = Math.round(value * 2) / 2; // nearest 0.5ft
        heightSource = rejected.length > 0
          ? `photo_calibration_full_elevation (${kept.length} anchor(s), ${rejected.length} outlier(s) rejected)`
          : `photo_calibration_full_elevation (${kept.length} anchor(s))`;
        console.log(`📐 Wall height from photo calibration: ${wallHeightFt}ft (kept [${kept.join(', ')}]ft, rejected [${rejected.join(', ')}]ft)`);
        console.log(`📏 Full-plane photo height semantics: ${wallHeightFt}ft × 1 (story chip is descriptive only)`);
        // OSM height cross-check: if the pre-analysis footprint included a building
        // height and it differs by >20%, the post-footprint section logs a warning.
      } else {
        // No calibration anchors at all — fall back to spec formula: story_count × 9 ft.
        wallHeightFt = storyCount * DEFAULT_EAVE_PER_STORY; // 1s=9, 2s=18, 3s=27
        heightSource = `formula_fallback (no anchors found, ${storyCount} × ${DEFAULT_EAVE_PER_STORY}ft)`;
        console.warn(`⚠️ No calibrated height anchors in any photo — falling back to formula: ${wallHeightFt}ft. Ensure photos contain a visible door or count siding courses.`);
      }
    }
    let osmHeightFt: number | null = null;   // populated after footprint block, used for cross-check
    let osmLevelsDetected: number | null = null; // building:levels from OSM, returned in response

    // Flag if any photo required clamping
    const anyHeightClamped = perPhotoResults.some(r => r.height_clamped);
    const verifyTwoStoryEave = perPhotoResults.some(r => r.verify_two_story_eave);

    // Fix #3 (spec): Aggregate openings from ALL 8 uploaded slots.
    // Each upload slot (Front, Back, Left Side, Right Side, Front-Left Corner, etc.)
    // is a distinct camera position — its windows/doors are independent of every
    // other slot and must ALL be summed.  The only deduplication needed is between
    // multiple shots of the *exact same slot*, which never happens in normal use.
    //
    // Previous face-based grouping dropped corner photos whenever any straight
    // elevation covered that face, causing up to 4 of 8 photos to be ignored.
    const bySlot: Record<string, any[]> = {};
    perPhotoResults.forEach((r, photoIndex) => {
      // Prefer an uploader slot/id when available. The deterministic index
      // fallback keeps retries in the same slot from creating random keys.
      const key = r.slot_label || r.upload_slot || r.view_label || r.photo_id || r.id || `photo_${photoIndex}`;
      if (!bySlot[key]) bySlot[key] = [];
      bySlot[key].push(r);
    });
    let totalWindows = 0, totalDoors = 0, totalGarageDoors = 0;
    const allOpenings: any[] = []; // per-opening list across all slots (for trim math)

    // Non-siding accent deduction: per slot, collect coverage% and face width so we
    // can deduct stone/brick/stucco zones from the gross wall area.
    // Structure: { pct: number, widthFt: number, material: string }
    const nonSidingBySlot: Array<{ pct: number; widthFt: number; material: string }> = [];

    for (const slotPhotos of Object.values(bySlot)) {
      // Multiple entries for the same label = re-runs; take the best-populated one.
      const best = slotPhotos.reduce((b: any, r: any) =>
        ((r.openings?.length || 0) > (b?.openings?.length || 0) ? r : b), slotPhotos[0]);
      if (Array.isArray(best?.openings)) {
        // Attach wall_face from the parent photo result to each opening so
        // HouseModel3D can route it to the correct polygon edge.  Without this,
        // all openings fall back to zone='far_left'|'center'|… which
        // zoneToAzimuth can't map, defaults to 180° (south), and every
        // window/door lands on the front wall.
        const wf = best.wall_face || 'unknown';
        allOpenings.push(...best.openings.map((o: any) => ({ ...o, wall_face: wf })));
      }
      totalWindows     += Number(best.windows_count)      || 0;
      totalDoors       += Number(best.doors_count)        || 0;
      totalGarageDoors += Number(best.garage_doors_count) || 0;

      // Collect non-siding coverage if AI detected mixed materials on this face.
      // Masonry deductions are only for visible brick/stone wainscot. Keep the
      // cap conservative so a texture or shadow cannot erase a whole elevation.
      const pct = Math.min(60, Math.max(0, Number(best.non_siding_coverage_pct) || 0));
      const mat = String(best.non_siding_material || '').toLowerCase();
      if (pct > 0 && best.has_mixed_materials && (mat === 'brick' || mat === 'stone')) {
        const widthFt = Number(best.wall_width_ft) || 0;
        nonSidingBySlot.push({ pct, widthFt, material: mat });
        console.log(`🪨 Masonry accent on "${best.view_label}": ${pct}% ${mat} (wall_width=${widthFt}ft)`);
      }
    }

    // ── Per-face reconciliation: build faces[] from bySlot data ─────────────
    const canonicalFace = (value: unknown): string => {
      const raw = String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
      // Resolve corners before generic substring aliases so `front_right`
      // cannot be mistaken for a side wall.
      if (/(^|_)(fr|front_right|front_left|frontright|frontleft)(_|$)/.test(raw) || /(^|_)front(_|$)/.test(raw)) return 'front';
      if (/(^|_)(br|back_right|back_left|backright|backleft)(_|$)/.test(raw) || /(^|_)(back|rear)(_|$)/.test(raw)) return 'back';
      if (/(^|_)(left|left_side|west)(_|$)/.test(raw)) return 'left';
      if (/(^|_)(right|right_side|east)(_|$)/.test(raw)) return 'right';
      if (/(^|_)(south)(_|$)/.test(raw)) return 'front';
      if (/(^|_)(north)(_|$)/.test(raw)) return 'back';
      return 'unknown';
    };
    const facesMap: Record<string, any> = {};
    for (const slotPhotos of Object.values(bySlot)) {
      const best = slotPhotos.reduce((b: any, r: any) =>
        ((r.openings?.length || 0) > (b?.openings?.length || 0) ? r : b), slotPhotos[0]);
      if (!best) continue;
      const canonFace = canonicalFace(best.wall_face || best.view_label);
      if (canonFace === 'unknown') continue;
      const existing = facesMap[canonFace];
      const openingKey = (opening: any): string | null => {
        const type = String(opening?.type || 'opening').toLowerCase();
        const id = opening?.observation_id || opening?.id;
        if (id) return `id:${id}`;
        const zone = opening?.zone || opening?.position_label;
        const width = Number(opening?.width_ft);
        const height = Number(opening?.height_ft);
        const x = Number(opening?.pos_x);
        const y = Number(opening?.pos_y);
        if (zone || (Number.isFinite(x) && Number.isFinite(y))) {
          return `${type}:${zone || ''}:${Number.isFinite(x) ? x.toFixed(2) : ''}:${Number.isFinite(y) ? y.toFixed(2) : ''}:${Number.isFinite(width) ? width.toFixed(2) : ''}:${Number.isFinite(height) ? height.toFixed(2) : ''}`;
        }
        // Without a stable position/identity, preserve the observation rather
        // than collapsing two real openings that happen to share dimensions.
        return null;
      };
      const mappedOpenings = (Array.isArray(best.openings) ? best.openings : []).map((o: any) => ({
        ...o,
        wall_face: canonFace,
        source_label: best.view_label || canonFace,
      }));
      if (!existing) {
        facesMap[canonFace] = {
          face:           canonFace,
          photo_label:    best.view_label || canonFace,
          wall_width_ft:  Number(best.wall_width_ft)  || 0,
          wall_height_ft: Number(best.wall_height_ft || best.eave_height_ft) || 0,
          story_count:    Number(best.story_count)    || 1,
          photo_labels:   [best.view_label || canonFace],
          openings:       mappedOpenings,
          siding_material: best.siding_material || null,
          has_mixed_materials: !!best.has_mixed_materials,
          confidence:     Number(best.confidence)     || 70,
        };
      } else {
        const seen = new Set(existing.openings.map((o: any) => openingKey(o)).filter(Boolean));
        for (const opening of mappedOpenings) {
          const key = openingKey(opening);
          if (!key || !seen.has(key)) {
            existing.openings.push(opening);
            if (key) seen.add(key);
          }
        }
        if (!existing.photo_labels.includes(best.view_label || canonFace)) {
          existing.photo_labels.push(best.view_label || canonFace);
        }
        if ((Number(best.wall_width_ft) || 0) > existing.wall_width_ft) {
          existing.wall_width_ft = Number(best.wall_width_ft) || existing.wall_width_ft;
          existing.photo_label = best.view_label || existing.photo_label;
        }
        existing.has_mixed_materials = existing.has_mixed_materials || !!best.has_mixed_materials;
        existing.confidence = Math.max(existing.confidence, Number(best.confidence) || 70);
      }
    }
    const faces = Object.values(facesMap).filter((f: any) => f.face !== 'unknown');
    // Sort: front, back, left, right
    const FACE_ORDER = ['front', 'back', 'left', 'right'];
    faces.sort((a: any, b: any) => FACE_ORDER.indexOf(a.face) - FACE_ORDER.indexOf(b.face));

    const materialVotes: Record<string, number> = {};
    for (const r of perPhotoResults) {
      if (r.siding_material) materialVotes[r.siding_material] = (materialVotes[r.siding_material] || 0) + 1;
    }
    const sidingMaterial  = Object.entries(materialVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
    const sidingCondition = perPhotoResults.find(r => r.siding_condition)?.siding_condition || 'unknown';
    const complexity      = perPhotoResults.find(r => r.complexity)?.complexity || 'simple';
    const avgConfidence   = Math.round(avg(perPhotoResults.map(r => r.confidence || 70)));
    const hasMixedMaterials = nonSidingBySlot.length > 0;
    const accentMaterials   = [...new Set(nonSidingBySlot.map(s => s.material).filter(m => m && m !== 'none'))];
    const accentMaterialLabel = accentMaterials.join(' / ') || '';

    // ═══════════════════════════════════════════════════
    // STEP 4: Footprint — OSM first, Solar API fallback
    // ═══════════════════════════════════════════════════
    let usingSatellite   = false;
    let usingOSM         = false;
    let usingRoofEave    = false;
    // footprintSource already declared above the pitch_only early-return to avoid TDZ.
    let satelliteWarning = '';
    let satelliteRejectionReason: string | null = null;
    // True polygon perimeter when the footprint came from a real building
    // outline (OSM) — a rectangle recompute (2×(W+L)) discards the jogs and
    // understates complex homes by 30%+.
    let polygonPerimeterFt = 0;
    const photoPerimeterFt = 2 * (buildingWidthFt + buildingLengthFt);

    const photoBuildingTypes = perPhotoResults.map(r => r.building_type || 'house');
    const isGarageJob = isGarageMode || photoBuildingTypes.every(t => t === 'garage' || t === 'shed');
    const mixedTypes  = !isGarageMode && photoBuildingTypes.some(t => t === 'garage') && photoBuildingTypes.some(t => t === 'house');

    // ── Roof eave perimeter cross-reference (highest precedence) ─────────────
    // When the caller provides known_perimeter_ft (the eave LF from a roof
    // measurement already run for the same address), skip the OSM/Solar lookup
    // entirely — it is the most accurate building-perimeter source available,
    // more reliable than OSM tag estimates or the Solar bounding-box heuristic.
    if (!isGarageJob && known_perimeter_ft >= 40 && known_perimeter_ft <= 600) {
      // Preserve the photo-estimated width/depth ratio when both dimensions
      // came from labeled photos; fall back to a 55/45 split for a typical
      // slightly-wider-than-deep US house when only one direction was captured.
      const photoRatio = (buildingWidthFt > 0 && buildingLengthFt > 0)
        ? buildingWidthFt / (buildingWidthFt + buildingLengthFt)
        : 0.55;
      const half       = known_perimeter_ft / 2;
      buildingWidthFt  = Math.round(half * photoRatio);
      buildingLengthFt = Math.round(half * (1 - photoRatio));
      footprintSource  = 'roof_eave';
      depthMissing     = false;
      usingRoofEave    = true;
      console.log(`✅ Roof-eave perimeter override: ${known_perimeter_ft} LF → ${buildingWidthFt}ft × ${buildingLengthFt}ft (ratio=${photoRatio.toFixed(2)})`);
    }

    if (!usingRoofEave && use_satellite && latitude && longitude) {
      // ── Fix #2a: Try OSM building polygon first (true perimeter) ──────────
      const osmFootprint = resolvedFootprint?.source === 'osm' ? resolvedFootprint : null;
      if (osmFootprint) {
        // Spec: OSM polygon is authoritative — always use it when found.
        // Solar API is NOT called as a fallback when OSM finds a polygon.
        const ratio = osmFootprint.perimeter_ft / photoPerimeterFt;
        const osmFootprintSqft = osmFootprint.length_ft * osmFootprint.width_ft;
        const maxSqft = isGarageJob ? 1200 : Infinity;

        console.log(`OSM footprint: ${osmFootprint.length_ft}×${osmFootprint.width_ft}ft (${osmFootprint.perimeter_ft} LF) | photo est: ${photoPerimeterFt} LF | ratio: ${ratio.toFixed(2)}`);

        if (isGarageJob && osmFootprintSqft > maxSqft) {
          // Special case: for garage mode, OSM likely traced the main house — skip to photos
          satelliteWarning = `OSM building footprint (${osmFootprint.length_ft}×${osmFootprint.width_ft}ft) is too large for a garage — it likely traced the main house. Using photo measurements.`;
          satelliteRejectionReason = `Satellite footprint rejected: OSM footprint (${osmFootprint.length_ft}×${osmFootprint.width_ft}ft) is too large for a garage structure — it likely traced the main house. Measurement is based on photos only. Use Manual Entry to specify exact garage dimensions.`;
          console.warn('⚠️ OSM rejected (garage too large):', satelliteWarning);
        } else {
          // Always use OSM when it returns a polygon (per spec)
          buildingWidthFt  = osmFootprint.width_ft;
          buildingLengthFt = osmFootprint.length_ft;
          usingOSM         = true;
          usingSatellite   = true;
          footprintSource  = 'osm';
          polygonPerimeterFt = Math.round(osmFootprint.perimeter_ft) || 0;
          depthMissing     = false; // OSM gave us both dimensions
          console.log(`✅ Using OSM footprint (ratio vs photos: ${ratio.toFixed(2)})`);
        }
        // Capture OSM height and story count for cross-check / response
        if (osmFootprint.height_ft) osmHeightFt = osmFootprint.height_ft;
        if (osmFootprint.osm_levels) osmLevelsDetected = osmFootprint.osm_levels;

        if (mixedTypes) {
          console.warn('⚠️ Mixed building types detected in photos (house + garage).');
        }
      } else if (mapsKey) {
        // No OSM result — go straight to Solar API
        const sat = resolvedFootprint?.source === 'solar'
          ? resolvedFootprint
          : await getSatelliteFootprintFt(mapsKey, latitude, longitude);
        if (sat) {
          const ratio = sat.perimeter_ft / photoPerimeterFt;
          const satFootprintSqft = sat.length_ft * sat.width_ft;
          const maxRatio   = isGarageJob ? 1.2 : 1.5;
          const minRatio   = isGarageJob ? 0.8 : 0.65;
          const maxSatSqft = isGarageJob ? 1200 : Infinity;

          console.log(`Solar (OSM unavailable): ${sat.length_ft}×${sat.width_ft}ft (${sat.perimeter_ft} LF) | ratio: ${ratio.toFixed(2)}`);

          if (isGarageJob && satFootprintSqft > maxSatSqft) {
            satelliteWarning = `Solar API footprint too large for garage — likely captured main house. Using photo measurements.`;
            satelliteRejectionReason = `Satellite footprint rejected: Solar API footprint (${sat.length_ft}×${sat.width_ft}ft) is too large for a garage structure — it likely captured the main house. Measurement is based on photos only. Use Manual Entry to specify exact garage dimensions.`;
            console.warn('⚠️ Solar rejected (garage too large)');
          } else {
            // Fix #2 (spec): Satellite Assisted mode ALWAYS uses the satellite footprint
            // for horizontal wall lengths. Photos are only used for openings, trim, and
            // story count — never to override the satellite perimeter.
            buildingWidthFt  = sat.width_ft;
            buildingLengthFt = sat.length_ft;
            usingSatellite   = true;
            footprintSource  = 'solar';
            depthMissing     = false; // Solar gave us both dimensions
            const pct = ratio > 1 ? `${Math.round((ratio - 1) * 100)}% larger` : `${Math.round((1 - ratio) * 100)}% smaller than`;
            console.log(`✅ Using Solar footprint (corrected, ratio ${ratio.toFixed(2)} — ${pct} photo estimate)`);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 5: Calculate net wall area
    // ═══════════════════════════════════════════════════
    // Prefer the true polygon perimeter (OSM building outline) over the
    // rectangular 2×(W+L) recompute — the rectangle erases jog walls.
    const perimeterFt = polygonPerimeterFt > 0
      ? polygonPerimeterFt
      : 2 * (buildingWidthFt + buildingLengthFt);
    const roofMeasurementGraph = buildRoofMeasurementGraph({
      perPhotoResults,
      buildingWidthFt,
      buildingLengthFt,
      footprintSource,
    });

    const gablePhotos = perPhotoResults.filter(r => r.has_gable_end === true && (r.gable_rise_ft || 0) > 0);
    const avgGableRiseFt = gablePhotos.length > 0 ? avg(gablePhotos.map(r => r.gable_rise_ft)) : 0;
    const gableEndCount = gablePhotos.length > 0 ? 2 : 0;
    // ── Fix: use the correct face dimension as the gable base ────────────────
    // A gable on a FRONT/BACK photo → base is the building depth (buildingLengthFt).
    // A gable on a SIDE photo        → base is the building width (buildingWidthFt).
    // If unknown, average both (better than always using width).
    let gableBaseFt = buildingWidthFt; // fallback
    if (gablePhotos.length > 0) {
      const gableFaces = gablePhotos.map(r => r.wall_face || r.view_label?.toLowerCase() || '');
      const hasFrontBackGable = gableFaces.some(f => f.includes('front') || f.includes('back'));
      const hasSideGable = gableFaces.some(f => f.includes('left') || f.includes('right') || f.includes('side'));
      if (hasFrontBackGable && !hasSideGable) {
        gableBaseFt = buildingWidthFt; // gable is on front/back wall face → base = front width
      } else if (hasSideGable && !hasFrontBackGable) {
        gableBaseFt = buildingLengthFt; // gable is on side wall face → base = building depth
      } else {
        gableBaseFt = Math.round((buildingWidthFt + buildingLengthFt) / 2); // mixed/unknown → average
      }
    }
    const gableAreaSqft = gableEndCount > 0
      ? Math.round(gableEndCount * (gableBaseFt * avgGableRiseFt) / 2)
      : 0;

    // NOTE: the old "garage wing supplement" lived here. It bolted a synthetic
    // garage onto the wall area whenever the footprint came from Solar, to make
    // up for the bounding box that had erased the real wing. Footprints are now
    // traced (see functions/utils/footprintPolygon.js), so the wing is measured
    // rather than guessed at, and adding it again would double-count it.

    const usesFullElevationPhotoHeight = heightSource.startsWith('photo_calibration_full_elevation')
      || heightSource.startsWith('manual_calibration');
    const storiesMultiplier = usesFullElevationPhotoHeight ? 1 : storyCount;
    const perStoryHeightFt = usesFullElevationPhotoHeight
      ? wallHeightFt
      : DEFAULT_EAVE_PER_STORY;
    const extrusionHeightFt = usesFullElevationPhotoHeight
      ? wallHeightFt
      : perStoryHeightFt * storiesMultiplier;
    const grossWallAreaSqft = Math.round(perimeterFt * extrusionHeightFt + gableAreaSqft);

    console.log(`📐 Walls: ${perimeterFt}LF × ${extrusionHeightFt}ft = ${perimeterFt * extrusionHeightFt} sqft | height semantics=${usesFullElevationPhotoHeight ? 'full elevation × 1' : `${storiesMultiplier} × ${perStoryHeightFt}ft`} | Gables: ${gableAreaSqft} sqft | Gross: ${grossWallAreaSqft} sqft`);

    // ── Non-siding accent deduction (stone, brick, stucco wainscoting, etc.) ──
    // For each slot where AI detected mixed materials, compute that face's non-siding
    // sqft = wall_width × wallHeightFt × pct/100.  If AI didn't return a width for
    // that face, fall back to perimeterFt / numSlots as a per-face width estimate.
    const numSlots = Object.keys(bySlot).length || 1;
    const fallbackFaceWidthFt = perimeterFt / numSlots;
    let accentDeductionSqft = 0;
    for (const s of nonSidingBySlot) {
      const faceWidthFt = s.widthFt > 0 ? s.widthFt : fallbackFaceWidthFt;
      const faceSqft    = faceWidthFt * wallHeightFt;
      const deductSqft  = Math.round(faceSqft * (s.pct / 100));
      accentDeductionSqft += deductSqft;
      console.log(`🪨  Accent deduction: ${faceWidthFt.toFixed(1)}ft × ${wallHeightFt}ft × ${s.pct}% = ${deductSqft} sqft (${s.material})`);
    }
    // Cap: never deduct more than 60% of gross (guards against Gemini over-reporting)
    accentDeductionSqft = Math.min(accentDeductionSqft, Math.round(grossWallAreaSqft * 0.60));
    if (accentDeductionSqft > 0) {
      console.log(`🪨  Photo-measured masonry/accent deduction: ${accentDeductionSqft} sqft (${accentMaterialLabel})`);
    }

    const dblGarDoorSqft    = 16 * 7;
    const sglGarDoorSqft    = 9 * 7;
    const entryDoorSqft     = 3 * 6.8;
    // Standard siding deduction rule: openings < 20 sqft are NOT individually deducted
    // (absorbed into the waste multiplier). Standard window = 3×4 = 12 sqft → below threshold → 0.
    // This constant is only used in the count-based fallback (no measured opening data).
    const windowSqft        = 0;

    const measurementGraph = buildSidingMeasurementGraph({
      perPhotoResults: allPerPhotoResults,
      footprint: resolvedFootprint?.source === 'osm' ? resolvedFootprint.polygon_xy : null,
      storyCount,
       wallHeightFt,
       wallHeightSemantics: usesFullElevationPhotoHeight ? 'full_elevation' : 'per_story',
       storiesMultiplier,
      grossWallAreaSqft,
      accentDeductionSqft,
      perimeterFt,
      buildingWidthFt,
      buildingLengthFt,
      footprintSource,
      smallOpeningsInWaste: small_openings_in_waste,
    });
    // The customer-facing count is individual window units. Assembly banking is
    // retained only as a separate descriptive field and must not turn 14 real
    // windows into a smaller assembly count.
    totalWindows = measurementGraph.counts.window_units;
    totalDoors = measurementGraph.counts.entry_doors;
    totalGarageDoors = measurementGraph.counts.garage_doors;
    const totalDeductionSqft = measurementGraph.totals.opening_deduction_sqft;
    const deductionSource = measurementGraph.opening_groups.length > 0 ? 'canonical_rough_openings' : 'none';
    const jChannelLf = measurementGraph.totals.j_channel_lf;
    const starterStripLf = measurementGraph.totals.starter_strip_lf;
    const canonicalOpenings = measurementGraph.opening_groups.map((group: any) => ({
      id: group.id,
      type: group.type,
      wall_face: group.face,
      zone: group.zone,
      width_ft: group.width_ft,
      height_ft: group.height_ft,
      pos_x: group.pos_x,
      pos_y: group.pos_y,
      position_unit: group.position_unit,
      sqft: group.area_sqft,
      perimeter_lf: group.perimeter_lf,
      deductible: group.deductible,
      confidence: group.confidence,
      component_count: group.component_ids.length || (group.type === 'window' ? 1 : 0),
    }));

    // Corners: complexity-driven counts × eave height
    const outsideCornersCount = complexity === 'complex' ? 8 : complexity === 'moderate' ? 6 : 4;
    const insideCornersCount  = complexity === 'complex' ? 4 : complexity === 'moderate' ? 2 : 0;
    const outsideCornerLf = Math.round(outsideCornersCount * wallHeightFt);
    const insideCornerLf  = Math.round(insideCornersCount * wallHeightFt);

    const netWallAreaSqft = Math.round(measurementGraph.totals.net_siding_area_sqft);

    // ── Fix #3: Sanity ratio check against roof footprint ───────────────────
    const roofFootprintSqft = buildingWidthFt * buildingLengthFt;
    let sanityWarning = '';
    const sanityCorrected = false;

    if (roofFootprintSqft > 0 && !isGarageJob) {
      const sidingToRoofRatio = netWallAreaSqft / roofFootprintSqft;
      // Scale ratio limits by story count.
      // A 3-story house on a compact footprint can legitimately have a wall/footprint
      // ratio of 4–5×; the old fixed 2.2 ceiling incorrectly fires on every tall house.
      // Example: 100 LF perimeter × 27 ft eave = 2700 sqft walls / 624 sqft footprint = 4.3
      const MIN_RATIO = storyCount >= 3 ? 1.5 : storyCount === 2 ? 1.0 : 0.7;
      const MAX_RATIO = storyCount >= 3 ? 5.5 : storyCount === 2 ? 3.5 : 2.0;

      console.log(`📊 Sanity check: siding=${netWallAreaSqft} sqft, roof footprint=${roofFootprintSqft} sqft, ratio=${sidingToRoofRatio.toFixed(2)} (expect ${MIN_RATIO}–${MAX_RATIO})`);

      if (sidingToRoofRatio > MAX_RATIO) {
        sanityWarning = `⚠️ Wall-area ratio ${sidingToRoofRatio.toFixed(2)} is outside the expected range; verify measurements before ordering.`;
        console.warn(sanityWarning);
      } else if (sidingToRoofRatio < MIN_RATIO) {
        sanityWarning = `⚠️ Wall-area ratio ${sidingToRoofRatio.toFixed(2)} is below the expected range; verify measurements before ordering.`;
        console.warn(sanityWarning);
      }
    }

    const netWallAreaSq = Math.round((netWallAreaSqft / 100) * 100) / 100;

    // ═══════════════════════════════════════════════════
    // STEP 6: Confidence grade
    // ═══════════════════════════════════════════════════
    const photoCount = photoImages.length;
    let grade     = 'D';
    let tolerance = 25;

    if      (photoCount >= 4 && avgConfidence >= 80 && usingOSM)        { grade = 'A'; tolerance = 8; }
    else if (photoCount >= 4 && avgConfidence >= 80 && usingSatellite)  { grade = 'A'; tolerance = 10; }
    else if (photoCount >= 4 && avgConfidence >= 75)                    { grade = 'B'; tolerance = 12; }
    else if (photoCount >= 3 && avgConfidence >= 65)                    { grade = 'B'; tolerance = 15; }
    else if (photoCount >= 2 && avgConfidence >= 60)                    { grade = 'C'; tolerance = 18; }
    else if (photoCount >= 2)                                           { grade = 'C'; tolerance = 22; }
    else                                                                { grade = 'D'; tolerance = 28; }

    // Coverage honesty: unseen elevations mean window/door counts and wall
    // areas for those faces are estimated, not measured — say so in the grade.
    const missingFaceCount = measurementGraph.coverage?.missing_faces?.length || 0;

    // ── Grade B promotion: a corroborated photo measurement ──────────────────
    // The ladder above only asks "how many photos, and how sure was the model?".
    // A house measured from three good elevations can be genuinely accurate and
    // still be pinned at C. Two independent cross-checks can earn Grade B — and
    // neither one invents a single square, because both compare numbers that
    // were already measured:
    //
    //   1. SANITY BAND. The photo-measured siding total sits within ±15 % of
    //      the footprint-extrusion sanity total:
    //        sanity_net   = (perimeter × wall_height + gables) × siding_share
    //                       − siding-allocated openings
    //        sanity_delta = |net_siding − sanity_net| ÷ sanity_net × 100
    //      Inside the band, two independent derivations agree.
    //
    //   2. MATERIAL SPLIT + CONSISTENT OPENINGS. Every required elevation is
    //      classified (material map complete, nothing flagged for review), the
    //      opening deduction cap never engaged (no double-counted windows), and
    //      no elevation is missing.
    //
    // Both paths additionally require the hero wall area to actually come from
    // photo wall planes — a footprint extrusion can never be promoted, however
    // well it agrees with itself. Promotion never touches Grade A and never
    // lowers a grade. Tolerance restarts at the Grade B base so the warning
    // adders below still apply on top of it.
    const graphTotals: any = measurementGraph.totals || {};
    const heroFromPhotoPlanes = graphTotals.gross_wall_area_source === 'photo_wall_planes';
    const withinSanityBand = graphTotals.within_sanity_band === true;
    const materialSplitComplete = measurementGraph.material_map?.complete === true;
    const openingsConsistent = graphTotals.opening_deduction_capped !== true
      && missingFaceCount === 0
      && measurementGraph.coverage?.review_required !== true;

    // Path 1 needs the photo hero, because when the extrusion is the hero both
    // sides of the sanity check are the same arithmetic. Path 2 does not — the
    // material map is photo-derived however the wall area was resolved.
    const gradeBBySanityBand = withinSanityBand;
    // A clean material split is useful evidence, but it cannot override a
    // siding-area mismatch. There is no silent "user confirmed" path: until a
    // person explicitly confirms the chips in the UI, Grade B requires the
    // independent ±15% sanity band.
    const gradeBByMaterialSplit = materialSplitComplete && openingsConsistent && withinSanityBand;

    if (grade === 'C' && photoCount >= 3 && (gradeBBySanityBand || gradeBByMaterialSplit)) {
      console.log(`📈 Siding grade C→B: sanityΔ=${graphTotals.sanity_delta_pct}% (band ±${graphTotals.sanity_band_pct}%), materialSplitComplete=${materialSplitComplete}, openingsConsistent=${openingsConsistent}`);
      grade = 'B';
      tolerance = 15;
    }

    // Hard grade contract: a photo siding total outside the corroboration band
    // cannot remain A/B merely because there were many photos or a satellite
    // footprint. More than 25% is an explicit SANITY-REVIEW condition.
    const sanityDeltaPct = Number(graphTotals.sanity_delta_pct);
    const sanityDeltaKnown = Number.isFinite(sanityDeltaPct);
    const sanityReviewRequired = graphTotals.sanity_review_required === true
      || (sanityDeltaKnown && sanityDeltaPct > 25);
    if (sanityReviewRequired) {
      sanityWarning = [
        sanityWarning,
        `⚠️ SANITY-REVIEW: photo siding ${Math.round(graphTotals.photo_candidate_net_siding_area_sqft || 0)} sqft vs footprint sanity ${Math.round(graphTotals.sanity_net_siding_area_sqft || 0)} sqft (${sanityDeltaPct}% difference).`,
      ].filter(Boolean).join(' ');
      if (grade === 'A' || grade === 'B') grade = 'C';
      tolerance = Math.max(tolerance, 25);
    } else if (!sanityDeltaKnown || sanityDeltaPct > 15) {
      // A/B confidence from photo count alone is not enough. This is the
      // non-review version of the same guard: retain at most C until the
      // independent siding sanity comparison is inside ±15%.
      if (grade === 'A' || grade === 'B') grade = 'C';
      tolerance = Math.max(tolerance, 18);
    }

    if (satelliteWarning) tolerance = Math.min(tolerance + 5, 30);
    if (anyHeightClamped) tolerance = Math.min(tolerance + 3, 30);
    if (sanityWarning)    tolerance = Math.min(tolerance + 4, 30);
    if (depthMissing)     tolerance = Math.min(tolerance + 5, 30); // depth was estimated, not measured
    if (missingFaceCount > 0) tolerance = Math.min(tolerance + 4 * missingFaceCount, 35);

    // ── OSM height cross-check ────────────────────────────────────────────────
    let osmHeightWarning = '';
    if (osmHeightFt && manualEaves.length === 0) {
      const diff = Math.abs(wallHeightFt - osmHeightFt) / osmHeightFt;
      if (diff > 0.20) {
        osmHeightWarning = `⚠️ Wall height mismatch: photos suggest ${wallHeightFt}ft but OSM building tags indicate ${osmHeightFt}ft (${Math.round(diff * 100)}% difference). Verify on-site.`;
        console.warn(osmHeightWarning);
      } else {
        console.log(`✅ OSM height cross-check passed: photo=${wallHeightFt}ft, OSM=${osmHeightFt}ft (${Math.round(diff * 100)}% diff)`);
      }
    }

    const perPhotoBreakdown = allPerPhotoResults.map((r, photoIndex) => {
      const evidence = measurementGraph.coverage?.photo_evidence?.find(
        (photo: any) => photo.photo_index === photoIndex,
      );
      return {
      label: r.view_label || 'unknown',
      photo_index: photoIndex,
      story_count: r.story_count || 1,
      windows_count: r.windows_count || 0,
      doors_count: r.doors_count || 0,
      garage_doors_count: r.garage_doors_count || 0,
      wall_width_ft: r.wall_width_ft || 0,
      eave_height_ft: r.eave_height_ft || 0,
      wall_height_semantics: r.height_semantics || null,
      height_measurement_valid: r.height_measurement_valid !== false,
      height_anchor_rejected: r.height_anchor_rejected === true,
      height_anchor_rejection_reason: r.height_anchor_rejection_reason || null,
      siding_course_count: r.siding_course_count || 0,
      door_anchor_eave_ft: r.door_anchor_eave_ft || 0,
      height_method: r.height_method || 'estimate',
      height_clamped: r.height_clamped || false,
      openings: r.openings || [],
      calculated_facade_sqft: Math.round((r.wall_width_ft || 0) * (r.wall_height_ft || r.eave_height_ft || 0)),
      confidence: r.confidence || 70,
      evidence_status: evidence?.status || null,
      evidence_faces: evidence?.faces || [],
      evidence_assignment_source: evidence?.assignment_source || null,
      evidence_duplicate_of: evidence?.duplicate_of || null,
      evidence_duplicate_label: evidence?.duplicate_label || null,
      evidence_reason: evidence?.reason || null,
      };
    });

    const footprintPolygonXY = resolvedFootprint?.source === 'osm'
      ? resolvedFootprint.polygon_xy
      : rectanglePolygon(buildingLengthFt, buildingWidthFt);

    const footprintLabel = usingRoofEave ? `Roof eave perimeter (${known_perimeter_ft} LF from roof measurement)` : usingOSM ? 'OpenStreetMap polygon (true perimeter)' : (usingSatellite ? 'Solar API (corrected bounding box)' : 'Photo-derived dimensions');

    const analysisNotes = [
      `${photoCount} of ${photos.length} photo${photos.length !== 1 ? 's' : ''} analyzed (${perPhotoResults.map(r => r.view_label).join(', ')})`,
      failedPhotoLabels.length > 0 ? `⚠️ ${failedPhotoLabels.length} photo${failedPhotoLabels.length !== 1 ? 's' : ''} could not be analyzed: ${failedPhotoLabels.join(', ')} — window/door counts may be low` : '',
      usesFullElevationPhotoHeight
        ? `wallHt=${wallHeightFt}ft full plane [${heightSource}; stories multiplier=1]${anyHeightClamped ? ' (some non-photo heights clamped)' : ''}`
        : `${storyCount} stor${storyCount !== 1 ? 'ies' : 'y'} × ${perStoryHeightFt}ft story height [${heightSource}]${anyHeightClamped ? ' (some photos clamped to story max)' : ''}`,
      depthMissing ? `⚠️ Depth estimated (no side photos) — upload left/right photos for better accuracy` : '',
      gableAreaSqft > 0 ? `+${gableAreaSqft} sqft gable area (${gableEndCount} ends, ${avgGableRiseFt.toFixed(1)}ft rise)` : 'No gable area detected',
      `${totalWindows} window${totalWindows !== 1 ? 's' : ''} + ${totalDoors} door${totalDoors !== 1 ? 's' : ''} + ${totalGarageDoors} garage door${totalGarageDoors !== 1 ? 's' : ''} deducted`,
      accentDeductionSqft > 0 ? `${accentDeductionSqft} sqft deducted for ${accentMaterialLabel} accent (not siding)` : '',
      !use_satellite ? 'Photos Only mode (satellite disabled)' : `Footprint: ${footprintLabel}`,
      sanityWarning,
    ].filter(Boolean).join('. ');

    console.log(`✅ Result: ${netWallAreaSq} SQ (${netWallAreaSqft} sqft net), ${perimeterFt}LF, ${buildingWidthFt}×${buildingLengthFt}ft, Grade ${grade} ±${tolerance}% | footprint=${footprintSource}${sanityWarning ? ' | SANITY REVIEW' : ''}${accentDeductionSqft > 0 ? ` | accent deduction=${accentDeductionSqft} sqft (${accentMaterialLabel})` : ''}`);

    const wallMaterialSections = measureFromPhotoAnalysis({
      photos: perPhotoResults.filter((r: any) => r?.is_detail_shot !== true),
      footprintPolygon: footprintPolygonXY,
      footprintPerimeterFt: perimeterFt,
      buildingWidthFt,
      buildingLengthFt,
    });

    return Response.json({
      success: true,
      wall_area_sq: netWallAreaSq,
      wall_area_sqft: netWallAreaSqft,
      // Gross must stay in the same frame of reference as net: when the photo
      // wall planes became the hero, the extrusion is reported separately as
      // the sanity number rather than masquerading as the gross.
      gross_wall_area_sqft: Math.round(graphTotals.gross_wall_area_sqft ?? grossWallAreaSqft),
      wall_area_source: graphTotals.gross_wall_area_source || 'footprint_extrusion',
      wall_height_semantics: graphTotals.wall_height_semantics
        || (usesFullElevationPhotoHeight ? 'full_elevation' : 'per_story'),
      stories_multiplier: graphTotals.stories_multiplier ?? storiesMultiplier,
      extrusion_wall_area_sqft: Math.round(graphTotals.extrusion_wall_area_sqft ?? grossWallAreaSqft),
      roof_area_sqft: Math.round(roofMeasurementGraph.totals?.observed_roof_area_sqft || 0),
      roof_area_sq: Number(roofMeasurementGraph.totals?.observed_roof_area_sq || 0),
      // Only populated when the photo prism is authoritative — this is the field
      // the Present gate and the provenance banner key on.
      photo_wall_area_sqft: graphTotals.photo_wall_area_usable
        ? graphTotals.photo_wall_area_sqft : null,
      photo_wall_area_measured_sqft: graphTotals.photo_wall_area_sqft ?? null,
      photo_measured_faces: graphTotals.photo_measured_faces || [],
      photo_substituted_faces: graphTotals.photo_substituted_faces || [],
      photo_measured_perimeter_coverage: graphTotals.photo_measured_perimeter_coverage ?? null,
      photo_vs_extrusion_delta_pct: graphTotals.photo_vs_extrusion_delta_pct ?? null,
      photo_candidate_net_siding_area_sqft: graphTotals.photo_candidate_net_siding_area_sqft ?? null,
      sanity_net_siding_area_sqft: graphTotals.sanity_net_siding_area_sqft ?? null,
      sanity_delta_pct: graphTotals.sanity_delta_pct ?? null,
      sanity_band_pct: graphTotals.sanity_band_pct ?? null,
      within_sanity_band: graphTotals.within_sanity_band === true,
      sanity_review_required: sanityReviewRequired,
      siding_facade_area_sqft: graphTotals.siding_facade_area_sqft ?? null,
      masonry_area_sqft: graphTotals.masonry_area_sqft ?? null,
      gable_area_sqft: gableAreaSqft,
      gable_rise_ft: avgGableRiseFt > 0 ? Math.round(avgGableRiseFt * 10) / 10 : 0,
      perimeter_ft: perimeterFt,
      building_length_ft: buildingLengthFt,
      building_width_ft: buildingWidthFt,
      story_count: storyCount,
      story_count_source: (story_count_override && story_count_override >= 1)
        ? 'user_override'
        : (photoStory.story_count ? 'photos_well_supported' : (osmLevelsFromFootprint ? 'osm' : 'photos')),
      wall_material_sections: wallMaterialSections,
      story_height_ft: wallHeightFt,
      windows_count: totalWindows,
      doors_count: totalDoors,
      garage_door_count: totalGarageDoors,
      opening_deduction_sqft: totalDeductionSqft,
      opening_deduct_sqft: totalDeductionSqft,
      deduction_source: deductionSource,
      has_mixed_materials: hasMixedMaterials,
      accent_material: accentMaterialLabel || null,
      accent_deduction_sqft: accentDeductionSqft,
      masonry_deduction_sqft: accentDeductionSqft,
      masonry_deduct_sqft: accentDeductionSqft,
      measurement_graph: measurementGraph,
      coverage: measurementGraph.coverage,
      window_assemblies_count: measurementGraph.counts.window_assemblies,
      window_units_count: measurementGraph.counts.window_units,
      rough_openings_count: measurementGraph.counts.rough_openings,
      openings_detail: canonicalOpenings,
      order_qty_10_percent_waste_sq: Math.round(netWallAreaSq * 1.10 * 100) / 100,
      trim_totals: {
        j_channel_lf: jChannelLf,
        starter_strip_lf: starterStripLf,
        outside_corner_lf: outsideCornerLf,
        inside_corner_lf: insideCornerLf,
        outside_corners_count: outsideCornersCount,
        inside_corners_count: insideCornersCount,
      },
      calibrated_eave_height_ft: wallHeightFt,
      verify_two_story_eave: verifyTwoStoryEave,
      photos_received: photos.length,
      photos_analyzed: perPhotoResults.length,
      // Per-wall record of what happened to each auto-fetched Street View frame:
      // used as-is, recovered by a recapture, or skipped after every alternative
      // angle failed.
      street_view_frame_verdicts: streetViewFrameVerdicts,
      street_view_recaptured_count: streetViewFrameVerdicts.filter((v: any) => v.status === 'recaptured').length,
      street_view_skipped_count: streetViewFrameVerdicts.filter((v: any) => v.status === 'skipped').length,
      street_view_unmeasured_count: streetViewFrameVerdicts.filter((v: any) => v.status === 'unmeasured').length,
      failed_photo_labels: failedPhotoLabels,
      siding_material: sidingMaterial,
      siding_condition: sidingCondition,
      complexity: complexity,
      wall_complexity: complexity,
      overall_confidence: avgConfidence,
      confidence_grade: grade,
      tolerance_pct: tolerance,
      used_satellite_footprint: usingSatellite && !usingOSM,
      used_satellite: usingSatellite,
      satellite_rejection_reason: satelliteRejectionReason,
      osm_perimeter_used: usingOSM,
      roof_eave_perimeter_used: usingRoofEave,
      roof_eave_perimeter_ft: usingRoofEave ? known_perimeter_ft : null,
      footprint_source: footprintSource,
      footprint_polygon_xy: footprintPolygonXY,
      garage_polygon_xy: resolvedFootprint?.source === 'osm' ? resolvedFootprint.garage_polygon_xy : null,
      satellite_warning: satelliteWarning || null,
      sanity_corrected: sanityCorrected,
      sanity_warning: sanityWarning || null,
      face_material_classification: faceMaterialByFace,
      material_review_flags: measurementGraph.material_map?.material_review_flags || [],
      material_rep_review_message: (measurementGraph.material_map?.material_review_flags || []).length
        ? `Needs rep review. Material fractions are low confidence. ${(measurementGraph.material_map?.material_review_flags || []).map((flag: any) => flag.message).join(' ')}`
        : null,
      height_clamped: anyHeightClamped,
      height_adjusted: heightSource.includes('raised_to_'),
      height_source: heightSource,
      depth_missing: depthMissing,
      osm_height_ft: osmHeightFt,
      osm_levels: osmLevelsDetected,
      osm_height_warning: osmHeightWarning || null,
      analysis_notes: analysisNotes,
      per_photo_breakdown: perPhotoBreakdown,
      photo_details: perPhotoBreakdown,
      building_type: isGarageJob ? 'garage' : (perPhotoResults[0]?.building_type || 'unknown'),
      is_garage_job: isGarageJob,
      roof_pitch_detected: detectedRoofPitch,
      roof_pitch_confidence: detectedRoofPitchConfidence,
      roof_pitch_source: detectedRoofPitch ? 'crew_cam_elevation' : null,
      facade_pitch_slopes: facadePitchSlopes,
      facade_pitch_source: facadePitchSlopes.length > 0 ? 'crew_cam_elevation' : null,
      facade_pitch_confidence: facadePitchSlopes.length > 0
        ? (pitchReadings.some((reading: any) => reading.conf === 'high') ? 'high' : 'medium')
        : 'none',
      roof_measurement_graph: roofMeasurementGraph,
      roof_measurement: summarizeRoofMeasurement(roofMeasurementGraph),
      // Per-face reconciliation: each uploaded face contributes its own
      // dimensions and openings, making the 3D/2D drawing photo-accurate
      // per wall instead of just averaging into a single rectangle.
      faces,
    });

  } catch (err: any) {
    console.error('analyzeHousePhotosForSiding error:', err);
    return Response.json({ error: err.message || 'Analysis failed' }, { status: 500 });
  }
});
