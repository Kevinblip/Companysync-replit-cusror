#!/usr/bin/env node
/**
 * Diagnostic for the imagery takeoff: saves the exact stitched image the model
 * is shown and prints its raw reply, so a bad trace can be told apart from a
 * bad image.
 */
const fs = require('fs');
const path = require('path');

const ADDRESS = process.env.BENCH_ADDRESS || '3554 Atherstone Rd, Cleveland Heights, OH 44121';
const SOURCE = process.env.BENCH_IMAGERY || 'esri_clarity';
const MODEL = process.env.BENCH_MODEL || 'gemini-3.1-pro-preview';

(async () => {
  const { fetchStitchedAerial, buildRoofTracePrompt, parseRoofTrace } =
    await import('../functions/utils/roofImageryTakeoff.js');
  const { buildTracedRoofGraph } = await import('../functions/utils/roofTracedFacetGraph.js');

  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;

  const geo = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ADDRESS)}&key=${mapsKey}`
  ).then((r) => r.json());
  const loc = geo.results[0].geometry.location;
  console.log(`Coords: ${loc.lat}, ${loc.lng}`);

  const aerial = await fetchStitchedAerial({
    latitude: loc.lat, longitude: loc.lng, sourceKey: SOURCE, waybackIds: {}, googleApiKey: mapsKey,
  });
  if (!aerial) { console.error('No aerial'); process.exit(1); }

  const outDir = path.join(__dirname, '..', 'tmp-roof-debug');
  fs.mkdirSync(outDir, { recursive: true });
  const imgPath = path.join(outDir, 'stitched.png');
  fs.writeFileSync(imgPath, Buffer.from(aerial.base64, 'base64'));
  console.log(`Stitched: ${aerial.width_px}x${aerial.height_px}px, z${aerial.zoom}, ${aerial.feet_per_pixel} ft/px, ${aerial.tiles_missing} missing`);
  console.log(`Saved image -> ${imgPath}`);
  console.log(`Ground coverage: ${(aerial.width_px * aerial.feet_per_pixel).toFixed(0)} ft across`);

  const prompt = buildRoofTracePrompt(aerial, ADDRESS);
  fs.writeFileSync(path.join(outDir, 'prompt.txt'), prompt);
  console.log(`Prompt chars: ${prompt.length} -> ${path.join(outDir, 'prompt.txt')}`);

  const body = {
    systemInstruction: { parts: [{ text: 'You are a professional roof estimator producing a measurement takeoff from aerial imagery. You trace geometry precisely and return ONLY JSON.' }] },
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: aerial.mime_type, data: aerial.base64 } },
      { text: prompt },
    ] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await resp.json();
  if (data.error) { console.error('Gemini error:', JSON.stringify(data.error, null, 2)); process.exit(1); }
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  console.log(`\nFinish reason: ${data.candidates?.[0]?.finishReason}`);
  console.log(`Raw reply chars: ${text.length}`);
  fs.writeFileSync(path.join(outDir, 'raw-reply.json'), text);
  console.log(text.slice(0, 3000));

  let parsedJson = null;
  try { parsedJson = JSON.parse(text); } catch (e) { console.log('\n(not valid JSON: ' + e.message + ')'); }
  if (parsedJson) {
    console.log('\nTop-level keys:', Object.keys(parsedJson));
    console.log('facets:', Array.isArray(parsedJson.facets) ? parsedJson.facets.length : typeof parsedJson.facets);
  }

  const trace = parseRoofTrace(text, aerial, {});
  console.log('\n--- parseRoofTrace ---');
  console.log('primary_building_found:', trace.primary_building_found);
  console.log('facets parsed:', trace.facets.length);
  console.log('obstruction_pct:', trace.obstruction_pct);
  console.log('building_style:', trace.building_style);
  if (trace.facets.length) {
    const g = buildTracedRoofGraph({ facets: trace.facets });
    console.log('graph facets:', g.totals.facet_count, 'roof sqft:', g.totals.roof_area_sqft, 'edges:', JSON.stringify(g.edge_totals));
  }
})().catch((e) => { console.error('crashed', e); process.exit(1); });
