import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

async function callGemini(
  apiKey: string,
  systemInstruction: string,
  prompt: string,
  images: { data: string; mimeType: string }[],
  jsonMode = true
): Promise<any> {
  const parts: any[] = images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }));
  parts.push({ text: prompt });

  const body: any = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
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

// ── Fix #2: OSM building polygon (true perimeter, not bounding box) ──────────
async function getOSMBuildingFootprint(
  lat: number,
  lng: number
): Promise<{ length_ft: number; width_ft: number; perimeter_ft: number; source: 'osm' } | null> {
  try {
    // Overpass API query: find building ways within 30 m of the point
    const query = `[out:json][timeout:10];way["building"](around:30,${lat},${lng});out geom;`;
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

    console.log(`OSM building found: perimeter=${Math.round(perimeterFt)} LF, bbox=${length_ft}×${width_ft} ft (${nodes.length} nodes)`);
    return { length_ft, width_ft, perimeter_ft: Math.round(perimeterFt), source: 'osm' };
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
      // Solar bounding-box inflates by ~15-20% on average vs actual perimeter.
      // Apply a correction factor: for houses the true perimeter is about 85% of the bbox perimeter.
      const rawPerimeter = 2 * (Math.round(Math.max(latFt, lngFt)) + Math.round(Math.min(latFt, lngFt)));
      const correctedPerimeter = Math.round(rawPerimeter * 0.85);
      const length_ft = Math.round(Math.max(latFt, lngFt) * 0.925); // shrink each side
      const width_ft  = Math.round(Math.min(latFt, lngFt) * 0.925);
      console.log(`Solar bbox: raw perimeter=${rawPerimeter} LF → corrected=${correctedPerimeter} LF`);
      return { length_ft, width_ft, perimeter_ft: correctedPerimeter, source: 'solar' };
    }
    return null;
  } catch (e) {
    console.warn('Solar API failed:', (e as Error).message);
    return null;
  }
}

// Max physically-plausible eave height by story count
const MAX_EAVE_HEIGHT_FT: Record<number, number> = { 1: 12, 2: 22, 3: 32 };
const DEFAULT_EAVE_PER_STORY = 9;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { photos, storyHeightFt = 9, latitude, longitude, use_satellite = true, structure_type = 'house' } = await req.json();
    const isGarageMode = structure_type === 'garage';
    const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    const mapsKey = Deno.env.get('GOOGLE_MAPS_API_KEY');

    if (!geminiKey) return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });
    if (!photos || photos.length === 0) return Response.json({ error: 'No photos provided' }, { status: 400 });

    console.log(`analyzeHousePhotosForSiding: ${photos.length} photos, lat=${latitude}, lng=${longitude}`);

    // ═══════════════════════════════════════════════════
    // STEP 1: Download all photos
    // ═══════════════════════════════════════════════════
    const photoImages: { url: string; label: string; image: { data: string; mimeType: string } }[] = [];
    for (const photo of photos) {
      try {
        const image = await fetchImageAsBase64(photo.url);
        photoImages.push({ url: photo.url, label: photo.label || 'unknown', image });
      } catch (e) {
        console.warn(`Failed to load photo ${photo.label}:`, (e as Error).message);
      }
    }

    if (photoImages.length === 0) return Response.json({ error: 'Failed to load any photos' }, { status: 400 });

    // ═══════════════════════════════════════════════════
    // STEP 2: Per-photo dimension analysis
    // ═══════════════════════════════════════════════════
    const sysPrompt = `You are an expert exterior building measurement specialist. Your job is to measure wall dimensions accurately using physical reference objects in the photo. You ALWAYS use siding course counting as your primary height method — this is non-negotiable. You are conservative and never overestimate.`;

    const perPhotoResults: any[] = [];
    for (const photoData of photoImages) {
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

      const prompt = `${structureContext}

Analyze this exterior building wall photo labeled "${photoData.label}" to estimate dimensions.

════════════════════════════════════════════════
WALL HEIGHT — PRIMARY METHOD (MANDATORY, DO NOT SKIP)
════════════════════════════════════════════════
You MUST use siding course counting as your first and primary method for eave_height_ft:

1. Find the horizontal lap siding courses on this wall.
2. Count the courses from the foundation/grade line up to the EAVE LINE (where the roof slope begins).
   → Each vinyl or aluminum lap course = 4 inches tall
   → Each wood/fiber-cement course = 4-6 inches tall
3. Multiply: (course count) × 4 inches ÷ 12 = eave height in feet

TYPICAL COURSE COUNTS:
- 1-story house: 24-36 courses → 8-12 ft eave
- 2-story house: 48-66 courses → 16-22 ft eave
- Garage (1 story): 24-30 courses → 8-10 ft eave

If siding is not visible, use door/window heights:
- Standard entry door = 6.8 ft tall (scale the wall from the door top to eave)
- Standard window = ~4 ft tall

⚠️ CRITICAL WARNING — READ CAREFULLY:
eave_height_ft = distance from GRADE (ground) to the EAVE LINE ONLY.
The eave line is where the roof surface begins — the bottom edge of the roof overhang.
DO NOT measure to the ridge, the peak, or the top of any gable triangle.
A 2-story house eave is NEVER above 22 ft. A 1-story eave is NEVER above 12 ft.

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
- "other": Any material not listed above.

Return JSON ONLY:
{
  "view_label": "${photoData.label}",
  "building_type": "house" | "garage" | "shed" | "commercial",
  "story_count": number (1 or 2, rarely 3),
  "siding_course_count": number (count of lap siding courses from grade to eave; 0 if not countable),
  "height_method": "course_count" | "door_scale" | "window_scale" | "estimate",
  "eave_height_ft": number (height from ground to eave line — NOT the ridge or peak),
  "wall_height_ft": number (eave_height_ft + gable_rise_ft if gable end, else same as eave_height_ft),
  "gable_rise_ft": number (vertical height of triangular gable ABOVE the eave line; 0 if no gable),
  "has_gable_end": boolean (true if this wall face has a triangular gable peak at top),
  "is_corner_shot": boolean (true if two walls are both visible at an angle),
  "wall_face": "front" | "back" | "left_side" | "right_side" | "unknown",
  "wall_width_ft": number (estimated TOTAL width of PRIMARY wall face; for corner shots, use the more prominent wall),
  "reference_anchor": "description of what you used to estimate width and height",
  "windows_count": number (WALL windows only — NOT glass panels in garage doors),
  "window_zones": string[] (zone for each window: "far_left"|"center_left"|"center"|"center_right"|"far_right"),
  "doors_count": number (entry doors on THIS wall only, NOT garage doors),
  "door_zones": string[] (zone for each entry door: "far_left"|"center_left"|"center"|"center_right"|"far_right"),
  "garage_doors_count": number (count OPENINGS not panels — double-wide = 1, on THIS wall primary face only),
  "garage_door_zones": string[] (zone for each garage door opening: "far_left"|"center_left"|"center"|"center_right"|"far_right"),
  "siding_material": "vinyl" | "aluminum" | "fiber_cement" | "wood" | "brick" | "stucco" | "other",
  "siding_condition": "excellent" | "good" | "fair" | "poor",
  "complexity": "simple" | "moderate" | "complex",
  "confidence": number (0-100),
  "confidence_reason": "brief reason including height method used"
}`;

      try {
        const result = await callGemini(geminiKey, sysPrompt, prompt, [photoData.image]);

        // ── Fix #1: Replace over-cap eave with story_count × 9 (spec requirement) ──
        const photoStories = result.story_count || 1;
        const maxEave = MAX_EAVE_HEIGHT_FT[photoStories] ?? 22;
        const minEave = photoStories === 1 ? 7 : 14;
        const normalEave = photoStories * 9; // canonical replacement per spec

        if (result.eave_height_ft > maxEave) {
          console.warn(`⚠️ [${photoData.label}] eave_height_ft ${result.eave_height_ft}ft exceeds ${photoStories}-story max → replacing with ${normalEave}ft. height_method=${result.height_method}`);
          result.eave_height_ft = normalEave;
          result.height_clamped = true;
        } else if (result.eave_height_ft < minEave && result.eave_height_ft > 0) {
          console.warn(`⚠️ [${photoData.label}] Raising eave_height_ft ${result.eave_height_ft}ft → ${minEave}ft (${photoStories}-story min)`);
          result.eave_height_ft = minEave;
          result.height_clamped = true;
        }

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

        // Keep wall_height_ft consistent
        const gableRise = result.gable_rise_ft || 0;
        result.wall_height_ft = result.eave_height_ft + gableRise;

        perPhotoResults.push(result);
        console.log(`  ${photoData.label}: ${result.wall_width_ft}ft wide × ${result.eave_height_ft}ft eave [${result.height_method}, ${result.siding_course_count} courses], ${result.garage_doors_count}gd ${result.doors_count}d ${result.windows_count}w (${result.confidence}% conf${result.height_clamped ? ', CLAMPED' : ''})`);
      } catch (e) {
        console.warn(`Per-photo analysis failed for ${photoData.label}:`, (e as Error).message);
      }
    }

    if (perPhotoResults.length === 0) return Response.json({ error: 'All photo analyses failed' }, { status: 500 });

    // ═══════════════════════════════════════════════════
    // STEP 3: Build floor plan from per-photo data
    // ═══════════════════════════════════════════════════
    const isCornerShot = (r: any) => r.is_corner_shot === true ||
      (r.view_label?.toLowerCase().includes('corner') || r.view_label?.toLowerCase().includes('angle'));

    const frontViews = perPhotoResults.filter(r => !isCornerShot(r) && r.view_label?.toLowerCase().includes('front'));
    const backViews  = perPhotoResults.filter(r => !isCornerShot(r) && r.view_label?.toLowerCase().includes('back'));
    const leftViews  = perPhotoResults.filter(r => !isCornerShot(r) && r.view_label?.toLowerCase().includes('left'));
    const rightViews = perPhotoResults.filter(r => !isCornerShot(r) && r.view_label?.toLowerCase().includes('right'));
    const unlabeledViews = perPhotoResults.filter(r => !isCornerShot(r) &&
      !r.view_label?.toLowerCase().match(/front|back|left|right/));

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const frontBackWidths = [...frontViews, ...backViews].map(r => r.wall_width_ft).filter(w => w > 0);
    const sideWidths      = [...leftViews, ...rightViews].map(r => r.wall_width_ft).filter(w => w > 0);
    const allWidths       = perPhotoResults.filter(r => !isCornerShot(r)).map(r => r.wall_width_ft).filter(w => w > 0);

    let buildingWidthFt  = frontBackWidths.length > 0 ? Math.round(avg(frontBackWidths)) : 0;
    let buildingLengthFt = sideWidths.length > 0 ? Math.round(avg(sideWidths)) : 0;

    if (buildingWidthFt === 0 && buildingLengthFt === 0) {
      buildingWidthFt = allWidths.length > 0 ? Math.round(avg(allWidths)) : 24;
      buildingLengthFt = buildingWidthFt;
    } else if (buildingWidthFt === 0) {
      buildingWidthFt = buildingLengthFt;
    } else if (buildingLengthFt === 0) {
      buildingLengthFt = buildingWidthFt;
    }

    // Story count and wall height (already clamped per photo)
    const storyCount   = Math.max(...perPhotoResults.map(r => r.story_count || 1));
    const eaveHeights  = perPhotoResults.map(r => r.eave_height_ft).filter(h => h > 0);
    const wallHeightFt = eaveHeights.length > 0
      ? Math.round(avg(eaveHeights))
      : storyCount * (storyHeightFt || DEFAULT_EAVE_PER_STORY);

    // Flag if any photo required clamping
    const anyHeightClamped = perPhotoResults.some(r => r.height_clamped);

    // Aggregate openings — deduplicate by wall face + zone so the same window isn't
    // counted twice when the same wall appears in multiple photos from slightly different angles
    const nonCornerResults = perPhotoResults.filter(r => !r.is_corner_shot);
    const openingSource    = nonCornerResults.length > 0 ? nonCornerResults : perPhotoResults;
    const byFace: Record<string, typeof openingSource> = {};
    for (const r of openingSource) {
      const face = (r.wall_face as string) || 'unknown';
      if (!byFace[face]) byFace[face] = [];
      byFace[face].push(r);
    }
    let totalWindows = 0, totalDoors = 0, totalGarageDoors = 0;
    for (const facePhotos of Object.values(byFace)) {
      if (facePhotos.length === 1) {
        totalWindows     += Number(facePhotos[0].windows_count)      || 0;
        totalDoors       += Number(facePhotos[0].doors_count)        || 0;
        totalGarageDoors += Number(facePhotos[0].garage_doors_count) || 0;
      } else {
        // Multiple photos of same face — union zones to deduplicate, fall back to max()
        const hasWinZones = facePhotos.every(r => Array.isArray(r.window_zones) && r.window_zones.length > 0);
        totalWindows += hasWinZones
          ? new Set(facePhotos.flatMap((r: any) => r.window_zones as string[])).size
          : Math.max(...facePhotos.map(r => Number(r.windows_count) || 0));
        const hasDoorZones = facePhotos.every(r => Array.isArray(r.door_zones));
        totalDoors += hasDoorZones
          ? new Set(facePhotos.flatMap((r: any) => r.door_zones as string[] || [])).size
          : Math.max(...facePhotos.map(r => Number(r.doors_count) || 0));
        const hasGdZones = facePhotos.every(r => Array.isArray(r.garage_door_zones));
        totalGarageDoors += hasGdZones
          ? new Set(facePhotos.flatMap((r: any) => r.garage_door_zones as string[] || [])).size
          : Math.max(...facePhotos.map(r => Number(r.garage_doors_count) || 0));
      }
    }

    const materialVotes: Record<string, number> = {};
    for (const r of perPhotoResults) {
      if (r.siding_material) materialVotes[r.siding_material] = (materialVotes[r.siding_material] || 0) + 1;
    }
    const sidingMaterial  = Object.entries(materialVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
    const sidingCondition = perPhotoResults.find(r => r.siding_condition)?.siding_condition || 'unknown';
    const complexity      = perPhotoResults.find(r => r.complexity)?.complexity || 'simple';
    const avgConfidence   = Math.round(avg(perPhotoResults.map(r => r.confidence || 70)));

    // ═══════════════════════════════════════════════════
    // STEP 4: Footprint — OSM first, Solar API fallback
    // ═══════════════════════════════════════════════════
    let usingSatellite   = false;
    let usingOSM         = false;
    let footprintSource  = 'photos';
    let satelliteWarning = '';
    const photoPerimeterFt = 2 * (buildingWidthFt + buildingLengthFt);

    const photoBuildingTypes = perPhotoResults.map(r => r.building_type || 'house');
    const isGarageJob = isGarageMode || photoBuildingTypes.every(t => t === 'garage' || t === 'shed');
    const mixedTypes  = !isGarageMode && photoBuildingTypes.some(t => t === 'garage') && photoBuildingTypes.some(t => t === 'house');

    if (use_satellite && latitude && longitude) {
      // ── Fix #2a: Try OSM building polygon first (true perimeter) ──────────
      const osmFootprint = await getOSMBuildingFootprint(latitude, longitude);
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
          console.warn('⚠️ OSM rejected (garage too large):', satelliteWarning);
        } else {
          // Always use OSM when it returns a polygon (per spec)
          buildingWidthFt  = osmFootprint.width_ft;
          buildingLengthFt = osmFootprint.length_ft;
          usingOSM         = true;
          usingSatellite   = true;
          footprintSource  = 'osm';
          console.log(`✅ Using OSM footprint (ratio vs photos: ${ratio.toFixed(2)})`);
        }

        if (mixedTypes) {
          console.warn('⚠️ Mixed building types detected in photos (house + garage).');
        }
      } else if (mapsKey) {
        // No OSM result — go straight to Solar API
        const sat = await getSatelliteFootprintFt(mapsKey, latitude, longitude);
        if (sat) {
          const ratio = sat.perimeter_ft / photoPerimeterFt;
          const satFootprintSqft = sat.length_ft * sat.width_ft;
          const maxRatio   = isGarageJob ? 1.2 : 1.5;
          const minRatio   = isGarageJob ? 0.8 : 0.65;
          const maxSatSqft = isGarageJob ? 1200 : Infinity;

          console.log(`Solar (OSM unavailable): ${sat.length_ft}×${sat.width_ft}ft (${sat.perimeter_ft} LF) | ratio: ${ratio.toFixed(2)}`);

          if (isGarageJob && satFootprintSqft > maxSatSqft) {
            satelliteWarning = `Solar API footprint too large for garage — likely captured main house. Using photo measurements.`;
            console.warn('⚠️ Solar rejected (garage too large)');
          } else if (ratio >= minRatio && ratio <= maxRatio) {
            buildingWidthFt  = sat.width_ft;
            buildingLengthFt = sat.length_ft;
            usingSatellite   = true;
            footprintSource  = 'solar';
            console.log(`✅ Using Solar footprint (corrected, ratio ${ratio.toFixed(2)})`);
          } else {
            const pct = ratio > 1 ? `${Math.round((ratio - 1) * 100)}% larger` : `${Math.round((1 - ratio) * 100)}% smaller`;
            satelliteWarning = `Solar API footprint (${sat.perimeter_ft} LF) was ${pct} than photo estimate — likely a different structure. Using photo measurements.`;
            console.warn('⚠️ Solar mismatch:', satelliteWarning);
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 5: Calculate net wall area
    // ═══════════════════════════════════════════════════
    const perimeterFt = 2 * (buildingWidthFt + buildingLengthFt);

    const gablePhotos = perPhotoResults.filter(r => r.has_gable_end === true && (r.gable_rise_ft || 0) > 0);
    const avgGableRiseFt = gablePhotos.length > 0 ? avg(gablePhotos.map(r => r.gable_rise_ft)) : 0;
    const gableEndCount = gablePhotos.length > 0 ? 2 : 0;
    const gableAreaSqft = gableEndCount > 0
      ? Math.round(gableEndCount * (buildingWidthFt * avgGableRiseFt) / 2)
      : 0;

    const grossWallAreaSqft = Math.round(perimeterFt * wallHeightFt + gableAreaSqft);

    console.log(`📐 Walls: ${perimeterFt}LF × ${wallHeightFt}ft = ${perimeterFt * wallHeightFt} sqft | Gables: ${gableEndCount} ends × (${buildingWidthFt}ft × ${avgGableRiseFt.toFixed(1)}ft rise)/2 = ${gableAreaSqft} sqft | Gross: ${grossWallAreaSqft} sqft`);

    const dblGarDoorSqft    = 16 * 7;
    const sglGarDoorSqft    = 9 * 7;
    const entryDoorSqft     = 3 * 6.8;
    const windowSqft        = 3 * 4;

    const hasDblGarage = perPhotoResults.some(r => r.garage_doors_count >= 1 && (r.wall_width_ft || 0) >= 18);
    const garageDoorDeduction = totalGarageDoors * (hasDblGarage ? dblGarDoorSqft : sglGarDoorSqft);
    const doorDeduction       = totalDoors * entryDoorSqft;
    const windowDeduction     = totalWindows * windowSqft;
    const totalDeductionSqft  = Math.round(garageDoorDeduction + doorDeduction + windowDeduction);

    let netWallAreaSqft = Math.max(0, Math.round(grossWallAreaSqft - totalDeductionSqft));

    // ── Fix #3: Sanity ratio check against roof footprint ───────────────────
    const roofFootprintSqft = buildingWidthFt * buildingLengthFt;
    let sanityWarning = '';
    let sanityCorrected = false;

    if (roofFootprintSqft > 0 && !isGarageJob) {
      const sidingToRoofRatio = netWallAreaSqft / roofFootprintSqft;
      const MIN_RATIO = 1.0;  // wall area should be at least equal to footprint
      const MAX_RATIO = 2.2;  // wall area should not exceed 2.2× footprint

      console.log(`📊 Sanity check: siding=${netWallAreaSqft} sqft, roof footprint=${roofFootprintSqft} sqft, ratio=${sidingToRoofRatio.toFixed(2)} (expect ${MIN_RATIO}–${MAX_RATIO})`);

      if (sidingToRoofRatio > MAX_RATIO) {
        // Wall area is unrealistically large — scale it down
        const targetSqft = Math.round(roofFootprintSqft * 1.6); // center of expected range
        const correctionFactor = targetSqft / netWallAreaSqft;
        console.warn(`⚠️ Sanity correction: ratio=${sidingToRoofRatio.toFixed(2)} > ${MAX_RATIO} — scaling ${netWallAreaSqft} → ${targetSqft} sqft (×${correctionFactor.toFixed(2)})`);
        netWallAreaSqft = targetSqft;
        sanityCorrected = true;
        sanityWarning = `⚠️ Wall area estimate was adjusted — photo data suggested an implausible ratio.`;
      } else if (sidingToRoofRatio < MIN_RATIO) {
        // Wall area is suspiciously small
        const targetSqft = Math.round(roofFootprintSqft * 1.1);
        console.warn(`⚠️ Sanity correction: ratio=${sidingToRoofRatio.toFixed(2)} < ${MIN_RATIO} — raising ${netWallAreaSqft} → ${targetSqft} sqft`);
        netWallAreaSqft = targetSqft;
        sanityCorrected = true;
        sanityWarning = `⚠️ Wall area estimate was adjusted — photo data suggested an implausible ratio.`;
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

    if (satelliteWarning) tolerance = Math.min(tolerance + 5, 30);
    if (anyHeightClamped) tolerance = Math.min(tolerance + 3, 30);
    if (sanityCorrected)  tolerance = Math.min(tolerance + 4, 30);

    const perPhotoBreakdown = perPhotoResults.map(r => ({
      label: r.view_label || 'unknown',
      story_count: r.story_count || 1,
      windows_count: r.windows_count || 0,
      doors_count: r.doors_count || 0,
      garage_doors_count: r.garage_doors_count || 0,
      wall_width_ft: r.wall_width_ft || 0,
      eave_height_ft: r.eave_height_ft || 0,
      siding_course_count: r.siding_course_count || 0,
      height_method: r.height_method || 'estimate',
      height_clamped: r.height_clamped || false,
      confidence: r.confidence || 70,
    }));

    const footprintLabel = usingOSM ? 'OpenStreetMap polygon (true perimeter)' : (usingSatellite ? 'Solar API (corrected bounding box)' : 'Photo-derived dimensions');

    const analysisNotes = [
      `${photoCount} photo${photoCount !== 1 ? 's' : ''} (${perPhotoResults.map(r => r.view_label).join(', ')})`,
      `${storyCount} stor${storyCount !== 1 ? 'ies' : 'y'} × ${wallHeightFt}ft eave${anyHeightClamped ? ' (height auto-corrected)' : ''}`,
      gableAreaSqft > 0 ? `+${gableAreaSqft} sqft gable area (${gableEndCount} ends, ${avgGableRiseFt.toFixed(1)}ft rise)` : 'No gable area detected',
      `${totalWindows} window${totalWindows !== 1 ? 's' : ''} + ${totalDoors} door${totalDoors !== 1 ? 's' : ''} + ${totalGarageDoors} garage door${totalGarageDoors !== 1 ? 's' : ''} deducted`,
      !use_satellite ? 'Photos Only mode (satellite disabled)' : `Footprint: ${footprintLabel}`,
      sanityCorrected ? sanityWarning : '',
    ].filter(Boolean).join('. ');

    console.log(`✅ Result: ${netWallAreaSq} SQ (${netWallAreaSqft} sqft net), ${perimeterFt}LF, ${buildingWidthFt}×${buildingLengthFt}ft, Grade ${grade} ±${tolerance}% | footprint=${footprintSource}${sanityCorrected ? ' | SANITY CORRECTED' : ''}`);

    return Response.json({
      success: true,
      wall_area_sq: netWallAreaSq,
      wall_area_sqft: netWallAreaSqft,
      gross_wall_area_sqft: Math.round(grossWallAreaSqft),
      gable_area_sqft: gableAreaSqft,
      gable_rise_ft: avgGableRiseFt > 0 ? Math.round(avgGableRiseFt * 10) / 10 : 0,
      perimeter_ft: perimeterFt,
      building_length_ft: buildingLengthFt,
      building_width_ft: buildingWidthFt,
      story_count: storyCount,
      story_height_ft: wallHeightFt,
      windows_count: totalWindows,
      doors_count: totalDoors,
      garage_door_count: totalGarageDoors,
      opening_deduction_sqft: totalDeductionSqft,
      opening_deduct_sqft: totalDeductionSqft,
      siding_material: sidingMaterial,
      siding_condition: sidingCondition,
      complexity: complexity,
      wall_complexity: complexity,
      overall_confidence: avgConfidence,
      confidence_grade: grade,
      tolerance_pct: tolerance,
      used_satellite_footprint: usingSatellite && !usingOSM,
      used_satellite: usingSatellite,
      osm_perimeter_used: usingOSM,
      footprint_source: footprintSource,
      satellite_warning: satelliteWarning || null,
      sanity_corrected: sanityCorrected,
      sanity_warning: sanityWarning || null,
      height_clamped: anyHeightClamped,
      analysis_notes: analysisNotes,
      per_photo_breakdown: perPhotoBreakdown,
      photo_details: perPhotoBreakdown,
      building_type: isGarageJob ? 'garage' : (perPhotoResults[0]?.building_type || 'unknown'),
      is_garage_job: isGarageJob,
    });

  } catch (err: any) {
    console.error('analyzeHousePhotosForSiding error:', err);
    return Response.json({ error: err.message || 'Analysis failed' }, { status: 500 });
  }
});
