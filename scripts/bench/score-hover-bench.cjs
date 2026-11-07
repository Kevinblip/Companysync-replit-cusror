#!/usr/bin/env node
/**
 * Score bench-results/<jobid>.json against Hover truth in uploads-bench/truth/.
 *   node scripts/bench/score-hover-bench.cjs --set dev
 *   node scripts/bench/score-hover-bench.cjs --set holdout   (release check only)
 * Writes bench-results/score-<set>.json. PASS = |error| <= 5% (stories: exact 1 vs >1; counts: within 5% too).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const BENCH = process.env.BENCH_DIR || path.join(ROOT, 'uploads-bench');
const RES = path.join(ROOT, 'bench-results');
const TOL = Number(process.env.BENCH_TOL || 0.05);
const set = (() => { const i = process.argv.indexOf('--set'); return i < 0 ? 'dev' : process.argv[i + 1]; })();
const split = JSON.parse(fs.readFileSync(path.join(BENCH, 'split.json'), 'utf8'));
const jobs = set === 'all' ? [...split.dev, ...split.holdout] : split[set];
const MATS = ['siding', 'brick', 'stone', 'stucco'];
const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function predict(r) {
  const g = r.wall_material_sections?.totals_gross_sqft || {};
  return {
    roof_ft2: n(r.roof_area_sqft) || null,
    perimeter_ft: n(r.perimeter_ft),
    stories_gt1: r.story_count == null ? null : Number(r.story_count) > 1,
    siding_ft2: n(g.siding) ?? 0, brick_ft2: n(g.brick) ?? 0, stone_ft2: n(g.stone) ?? 0, stucco_ft2: n(g.stucco) ?? 0,
    total_wall_ft2: n(r.gross_wall_area_sqft),
    windows: n(r.windows_count), doors: n(r.doors_count),
  };
}
const NUM = ['roof_ft2', 'perimeter_ft', 'siding_ft2', 'brick_ft2', 'stone_ft2', 'stucco_ft2', 'total_wall_ft2', 'windows', 'doors'];
const agg = {}; for (const k of [...NUM, 'stories_gt1']) agg[k] = { errs: [], pass: 0, n: 0 };
const pres = {}; for (const m of MATS) pres[m] = { tp: 0, fp: 0, fn: 0 };
const PRESENT_MIN = 25; // ft2 threshold to call a material present
const houses = [];
for (const job of jobs) {
  const tf = path.join(BENCH, 'truth', `${job}.json`);
  const rf = path.join(RES, `${job}.json`);
  if (!fs.existsSync(rf)) { console.log(`${job}: no result`); continue; }
  const truth = JSON.parse(fs.readFileSync(tf, 'utf8'));
  const raw = JSON.parse(fs.readFileSync(rf, 'utf8'));
  if (!raw.result?.success) { console.log(`${job}: run failed`); continue; }
  const p = predict(raw.result);
  const row = { job, name: truth.name, outbuilding: truth.outbuilding, metrics: {} };
  for (const k of NUM) {
    const t = truth[k]; const v = p[k];
    let err = null; let pass = false;
    if (t != null && v != null) {
      err = t === 0 ? (v === 0 ? 0 : null) : (v - t) / t;
      pass = t === 0 ? v <= PRESENT_MIN : Math.abs(err) <= TOL;
    }
    row.metrics[k] = { truth: t, pred: v, err, pass };
    if (t != null) { agg[k].n += 1; if (pass) agg[k].pass += 1; if (err != null && t > 0) agg[k].errs.push(err); }
  }
  const sp = p.stories_gt1 === truth.stories_gt1;
  row.metrics.stories_gt1 = { truth: truth.stories_gt1, pred: p.stories_gt1, pass: sp };
  agg.stories_gt1.n += 1; if (sp) agg.stories_gt1.pass += 1;
  for (const m of MATS) {
    const t = (truth[`${m}_ft2`] || 0) >= PRESENT_MIN; const v = (p[`${m}_ft2`] || 0) >= PRESENT_MIN;
    if (t && v) pres[m].tp += 1; else if (v) pres[m].fp += 1; else if (t) pres[m].fn += 1;
  }
  houses.push(row);
}
const pct = (e) => (e == null ? '   —  ' : `${e >= 0 ? '+' : ''}${(e * 100).toFixed(1)}%`.padStart(7));
console.log(`\nHover bench — set=${set}, tolerance ±${TOL * 100}%`);
console.log(['job'.padEnd(9), 'name'.padEnd(14), ...NUM.map((k) => k.replace('_ft2', '').replace('_ft', '').slice(0, 7).padStart(7)), 'story'].join(' '));
for (const h of houses) {
  console.log([h.job.padEnd(9), (h.name + (h.outbuilding ? '*' : '')).slice(0, 14).padEnd(14),
    ...NUM.map((k) => { const m = h.metrics[k]; return m.truth === 0 ? (m.pass ? '   0 ok' : `  0!${Math.round(m.pred || 0)}`.slice(0, 7).padStart(7)) : pct(m.err); }),
    h.metrics.stories_gt1.pass ? '  ok' : ' MISS'].join(' '));
}
console.log('\nAggregate (MAPE over houses with truth>0; pass = within tolerance)');
const summary = {};
for (const k of [...NUM, 'stories_gt1']) {
  const a = agg[k]; const mape = a.errs.length ? a.errs.reduce((s, e) => s + Math.abs(e), 0) / a.errs.length : null;
  const bias = a.errs.length ? a.errs.reduce((s, e) => s + e, 0) / a.errs.length : null;
  summary[k] = { mape, bias, pass: a.pass, n: a.n };
  console.log(`  ${k.padEnd(15)} MAPE ${mape == null ? '—' : (mape * 100).toFixed(1) + '%'}  bias ${pct(bias)}  pass ${a.pass}/${a.n}`);
}
console.log(`\nMaterial presence (>= ${PRESENT_MIN} ft²)`);
for (const m of MATS) {
  const { tp, fp, fn } = pres[m];
  const prec = tp + fp ? tp / (tp + fp) : null; const rec = tp + fn ? tp / (tp + fn) : null;
  summary[`presence_${m}`] = { tp, fp, fn, precision: prec, recall: rec };
  console.log(`  ${m.padEnd(7)} precision ${prec == null ? '—' : (prec * 100).toFixed(0) + '%'}  recall ${rec == null ? '—' : (rec * 100).toFixed(0) + '%'}  (tp ${tp} fp ${fp} fn ${fn})`);
}
fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, `score-${set}.json`), JSON.stringify({ set, tolerance: TOL, summary, houses }, null, 1));
console.log(`\n* = outbuilding. Saved bench-results/score-${set}.json`);
