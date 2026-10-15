#!/usr/bin/env node
/**
 * Before/after Hover score for the Solar dataLayers trace.
 * Building Insights responses are local fixtures passed to the current handler.
 * dataLayers rasters, when present, are read once into memory and not stored.
 */
const fs = require('node:fs');
const path = require('node:path');

const SITES = [
  {
    id: 'gemini',
    label: '5688 Gemini Ct',
    address: '5688 Gemini Ct, Solon, OH 44139',
    latitude: 41.4057912,
    longitude: -81.455736,
    hover: { area: 2481, rh: 68.4167, valley: 4.4167, rake: 123.0833, eave: 171.0833, pitches: '5/12' },
  },
  {
    id: 'oak',
    label: '1721 Oak St',
    address: '1721 Oak St, Girard, OH 44420',
    latitude: 41.1781556,
    longitude: -80.7066223,
    hover: { area: 1778, rh: 63.9167, valley: 25, rake: 130.8333, eave: 105.6667, pitches: '4/12 1411, 3/12 339, 5/12 28' },
  },
  {
    id: 'holmes',
    label: '15402 Holmes Ave',
    address: '15402 Holmes Ave, Cleveland, OH 44110',
    latitude: 41.5600987,
    longitude: -81.5739567,
    hover: { area: 1126, rh: 51.0833, valley: 0, rake: 86.4167, eave: 94.75, pitches: '11/12 889, 4/12 190, 7/12 24, 5/12 23' },
  },
];

function pct(actual, expected) {
  if (!expected) return actual === 0 ? 0 : null;
  return Math.round(((actual - expected) / expected) * 1000) / 10;
}

(async () => {
  const { functionHandlers } = await import('../vite-functions-plugin.js');
  const { decodeSolarGeotiff, traceRoofFromRasters, solarTraceAccepted, solarTraceAreaDelta } = await import('../functions/utils/solarDataLayers.js');
  const rows = [];
  for (const site of SITES) {
    const biPath = `/tmp/solar-probe/${site.id}-bi.json`;
    const bi = JSON.parse(fs.readFileSync(biPath, 'utf8'));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes('buildingInsights')) {
        return new Response(JSON.stringify(bi), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (requestUrl.includes('overpass-api.de')) {
        return new Response(JSON.stringify({ elements: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (requestUrl.includes('dataLayers')) {
        throw new Error('baseline handler requested dataLayers');
      }
      return new Response('', { status: 404 });
    };
    let before;
    try {
      before = await functionHandlers._aiRoofMeasurementImpl({
        latitude: site.latitude,
        longitude: site.longitude,
        address: site.address,
      }, null, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const dsmPath = `/tmp/solar-probe/${site.id}-dsm.tif`;
    const maskPath = `/tmp/solar-probe/${site.id}-mask.tif`;
    let trace = null;
    if (fs.existsSync(dsmPath) && fs.existsSync(maskPath)) {
      const dsm = decodeSolarGeotiff(fs.readFileSync(dsmPath));
      const mask = decodeSolarGeotiff(fs.readFileSync(maskPath));
      trace = await traceRoofFromRasters({
        dsm: dsm.data,
        mask: mask.data,
        width: dsm.width,
        height: dsm.height,
      });
    }
    const solarArea = Number(before.roof_area_sqft);
    const accepted = trace ? solarTraceAccepted(trace, solarArea) : false;
    const beforeRh = Number(before.ridge_lf || 0) + Number(before.hip_lf || 0);
    const traceRh = trace ? trace.linears.ridge + trace.linears.hip : null;
    const shipped = accepted ? {
      area: trace.area_sqft,
      rh: traceRh,
      valley: trace.linears.valley,
      rake: trace.linears.rake,
      eave: trace.linears.eave,
      pitches: trace.pitch_areas.map((row) => `${row.pitch} ${row.area_sqft}`).join(', '),
      source: 'solar_datalayers',
    } : {
      area: solarArea,
      rh: beforeRh,
      valley: Number(before.valley_lf || 0),
      rake: Number(before.rake_lf || 0),
      eave: Number(before.eave_lf || 0),
      pitches: (before.pitch_areas || []).map((row) => `${row.pitch} ${row.area_sqft}`).join(', '),
      source: 'building_insights',
    };
    rows.push({
      label: site.label,
      hover: site.hover,
      before: {
        area: Math.round(solarArea * 10) / 10,
        pitch: before.pitch,
        rh: Math.round(beforeRh * 10) / 10,
        valley: before.valley_lf,
        rake: before.rake_lf,
        eave: before.eave_lf,
        source: before.roof_linear_source,
        datalayers: before.datalayers_status,
      },
      trace: trace ? {
        area: trace.area_sqft,
        rh: Math.round(traceRh * 10) / 10,
        valley: trace.linears.valley,
        rake: trace.linears.rake,
        eave: trace.linears.eave,
        pitches: trace.pitch_areas,
        bytes: Buffer.byteLength(JSON.stringify(trace)),
        ms: trace.trace_ms,
        delta_pct: Math.round(solarTraceAreaDelta(trace.area_sqft, solarArea) * 1000) / 10,
        accepted,
      } : null,
      shipped,
      hover_delta: {
        area: pct(shipped.area, site.hover.area),
        rh: pct(shipped.rh, site.hover.rh),
      },
    });
  }
  const out = path.join('/tmp/solar-probe', 'hover-score.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
})().catch((error) => {
  console.error(String(error && error.stack || error).replace(/key=[^&\s]+/gi, 'key=REDACTED'));
  process.exit(1);
});
