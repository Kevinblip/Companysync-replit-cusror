#!/usr/bin/env node
/**
 * Solar dataLayers roof trace: polygon area, edge classes, 8% gate,
 * compact per-address cache, and the estimator timeout.
 * No network and no database.
 */
const { Buffer } = require('node:buffer');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}

(async () => {
const {
  traceRoofFromRasters,
  solarTraceAccepted,
  solarTraceAreaDelta,
  maskPlanSlopeSqft,
  maskPitchAreaAccepted,
  SOLAR_AREA_GATE,
} = await import('../functions/utils/solarDataLayers.js');
const {
  normalizeSolarAddress,
  solarTraceCacheId,
  withTimeout,
  writeSolarTraceCache,
  readSolarTraceCache,
  readCompanySolarDataLayersEnabled,
  solarDataLayersAllowed,
  SOLAR_DATALAYERS_SETTING,
} = await import('../functions/utils/solarRoofTraceCache.js');

check('area gate is 8%', SOLAR_AREA_GATE === 0.08);
check('trace within 8% of Solar is kept', solarTraceAccepted({ area_sqft: 2450 }, 2345));
check('trace beyond 8% of Solar is discarded', !solarTraceAccepted({ area_sqft: 2800 }, 2345));
check('missing area is not accepted', !solarTraceAccepted({ area_sqft: 0 }, 2345));
check('delta is relative to Building Insights', Math.abs(solarTraceAreaDelta(2500, 2345) - (155 / 2345)) < 0.001);
check('5/12 mask plan slopes to the roof surface', Math.abs(maskPlanSlopeSqft(2292, '5/12') - 2483) < 1.5, String(maskPlanSlopeSqft(2292, '5/12')));
check('mask pitch within 25% of Building Insights can correct an undercount', maskPitchAreaAccepted(1683, 1477));
check('a mask from a different building is rejected', !maskPitchAreaAccepted(2000, 1000));
check('missing plan area is not a mask pitch', maskPlanSlopeSqft(0, '6/12') == null);

check('address cache key is normalized', normalizeSolarAddress('  5688 Gemini Ct, Solon, OH  ', 1, 2) === '5688 gemini ct solon oh');
const keyA = normalizeSolarAddress('1721 Oak St, Girard, OH 44420', 0, 0);
const keyB = normalizeSolarAddress('1721   oak st. girard oh 44420', 0, 0);
check('punctuation and case share one address key', keyA === keyB, `${keyA} vs ${keyB}`);
check('missing address falls back to rounded coordinates', normalizeSolarAddress('', 41.405791, -81.455736) === 'geo:41.40579,-81.45574');
check('cache id is company plus address', solarTraceCacheId('co-1', keyA) !== solarTraceCacheId('co-2', keyA));
check('setting name is the company toggle', SOLAR_DATALAYERS_SETTING === 'solar_datalayers_enabled');

function gableRasters() {
  const width = 80;
  const height = 50;
  const mask = new Uint8Array(width * height);
  const dsm = new Float64Array(width * height);
  const slope = 5 / 12;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      mask[i] = 1;
      const east = x * 0.1;
      dsm[i] = east <= 4 ? 10.333 + slope * east : 12 - slope * (east - 4);
    }
  }
  return { dsm, mask, width, height };
}

const gable = await traceRoofFromRasters(gableRasters());
const gableBytes = Buffer.byteLength(JSON.stringify(gable));
const gableRh = gable.linears.ridge + gable.linears.hip;
check('gable trace returns facets', gable.facets.length >= 2, JSON.stringify(gable.facets.map((f) => f.pitch)));
check('gable area is slope-adjusted', gable.area_sqft > 430 && gable.area_sqft < 520, String(gable.area_sqft));
check('gable ridge is present and hips are not', gable.linears.ridge > 10 && gable.linears.hip < 8, JSON.stringify(gable.linears));
check('gable ridge+hip is the ridge', Math.abs(gableRh - gable.linears.ridge) < 0.2);
check('gable has a per-pitch area breakdown', gable.pitch_areas.some((row) => row.pitch === '5/12' && row.area_sqft > 400), JSON.stringify(gable.pitch_areas));
check('gable polygons are stored', gable.facets.every((facet) => facet.polygon.length >= 3));
check('derived cache payload stays under 8 KB', gableBytes < 8000, `${gableBytes} bytes`);
check('payload has no raster fields', !('dsm' in gable) && !('mask' in gable) && !JSON.stringify(gable).includes('dsmUrl'));
check('trace keeps the center-building plan area', gable.v === 2 && gable.plan_sqft > 400, String(gable.plan_sqft));

const memory = new Map();
const query = async (sql, params) => {
  if (sql.includes('INSERT INTO solar_roof_trace_cache')) {
    memory.set(`${params[1]}|${params[2]}`, {
      payload: JSON.parse(params[3]),
      payload_bytes: params[4],
      trace_ms: params[5],
    });
    return { rows: [] };
  }
  if (sql.includes('FROM solar_roof_trace_cache')) {
    const row = memory.get(`${params[0]}|${params[1]}`);
    return { rows: row ? [row] : [] };
  }
  if (sql.includes('FROM companies')) {
    return { rows: [{ settings: { solar_datalayers_enabled: params[0] === 'on' } }] };
  }
  throw new Error(`unexpected sql ${sql}`);
};

const bytes = await writeSolarTraceCache(query, 'co-1', keyA, gable);
const cached = await readSolarTraceCache(query, 'co-1', keyA);
check('cache write reports payload bytes', bytes === gableBytes && cached.payload_bytes === gableBytes, String(bytes));
check('cache round-trip keeps linears and pitch areas', cached.payload.linears.ridge === gable.linears.ridge && cached.payload.pitch_areas.length === gable.pitch_areas.length);
check('a second company does not see the first cache row', (await readSolarTraceCache(query, 'co-2', keyA)) == null);
check('toggle defaults off', (await readCompanySolarDataLayersEnabled(query, 'off')) === false);
check('toggle reads the company setting', (await readCompanySolarDataLayersEnabled(query, 'on')) === true);
check('toggle without a company stays off', (await readCompanySolarDataLayersEnabled(null, null)) === false);
check('an explicit false still disables the trace', (await solarDataLayersAllowed(query, 'off', true)) === false);
check('a missing setting runs when the measurement asks', (await solarDataLayersAllowed(async () => ({ rows: [{ settings: {} }] }), 'co', true)) === true);
check('a missing setting stays off without that ask', (await solarDataLayersAllowed(async () => ({ rows: [{ settings: {} }] }), 'co', false)) === false);

const slow = new Promise((resolve) => setTimeout(() => resolve('finished'), 80));
const timed = await withTimeout(slow, 20);
check('timeout resolves before a slow trace', timed.timedOut === true);
const finished = await slow;
check('timed-out work still finishes for the cache', finished === 'finished');
const fast = await withTimeout(Promise.resolve({ status: 'traced' }), 200);
check('a fast trace is not a timeout', fast.timedOut === false && fast.value.status === 'traced');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
