import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Magic-byte MIME sniffing so Gemini never gets application/octet-stream
function sniffMime(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  if (bytes[0] === 0x3C) return 'image/svg+xml';
  return fallback.startsWith('image/') && fallback !== 'application/octet-stream'
    ? fallback : 'image/jpeg';
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const rawMime = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  const mimeType = sniffMime(bytes, rawMime);
  // Chunk to avoid call stack overflow on large images
  const CHUNK = 32768;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return { data: btoa(binary), mimeType };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { photo_url } = await req.json();
    if (!photo_url) return Response.json({ error: 'photo_url is required' }, { status: 400 });

    const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!geminiKey) return Response.json({ error: 'Gemini API key not configured' }, { status: 500 });

    console.log(`detectDoorBbox: scanning ${photo_url.substring(0, 80)}…`);

    const image = await fetchImageAsBase64(photo_url);

    const body = {
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: image.mimeType, data: image.data } },
          { text: `Detect all doors visible on the exterior of this building photo.

Return valid JSON:
{
  "doors": [
    {
      "type": "front_door" | "garage_door" | "side_door",
      "bbox": [ymin, xmin, ymax, xmax],
      "confidence": 0-100
    }
  ],
  "best_door_index": 0
}

Rules:
- bbox values use 0-1000 scale where [0,0] is top-left and [1000,1000] is bottom-right
- Prefer entry/front doors over garage doors for best_door_index (better calibration reference — known 80" height)
- If the best visible door is a garage door (no entry door visible), pick it (84" preset will be used instead)
- If no door is visible at all, return { "doors": [], "best_door_index": -1 }
- Only include doors that are at least partially visible and not obscured` }
        ]
      }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    };

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );

    const data = await resp.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      console.warn('detectDoorBbox: no text in Gemini response');
      return Response.json({ door_box: null, reason: 'no_response' });
    }

    let parsed: any;
    try { parsed = JSON.parse(rawText); } catch {
      const m = rawText.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    }

    if (!parsed?.doors?.length || parsed.best_door_index < 0) {
      console.log('detectDoorBbox: no door found in photo');
      return Response.json({ door_box: null, reason: 'no_door_detected' });
    }

    const idx = Math.max(0, Math.min(parsed.best_door_index ?? 0, parsed.doors.length - 1));
    const best = parsed.doors[idx];
    const [ymin, xmin, ymax, xmax] = best.bbox;

    // Convert 0-1000 → 0-1 normalized, then to {x, y, w, h}
    const door_box = {
      x: xmin / 1000,
      y: ymin / 1000,
      w: (xmax - xmin) / 1000,
      h: (ymax - ymin) / 1000,
    };

    // Sanity check: a door taller than wide, at least 3% of image dimension
    const plausible = door_box.h > door_box.w * 0.8 && door_box.h > 0.03 && door_box.w > 0.01;
    if (!plausible) {
      console.warn(`detectDoorBbox: implausible bbox ${JSON.stringify(door_box)} — ignoring`);
      return Response.json({ door_box: null, reason: 'implausible_bbox' });
    }

    console.log(`detectDoorBbox: ${best.type} at x=${door_box.x.toFixed(3)} y=${door_box.y.toFixed(3)} w=${door_box.w.toFixed(3)} h=${door_box.h.toFixed(3)} conf=${best.confidence}`);

    return Response.json({
      door_box,
      door_type: best.type,
      confidence: best.confidence,
    });
  } catch (e: any) {
    console.error('detectDoorBbox error:', e.message);
    return Response.json({ door_box: null, reason: e.message });
  }
});
