#!/usr/bin/env node
/**
 * test-opening-counts.cjs
 *
 * The Measurement Summary showed an em-dash for Windows and Doors even though
 * the elevation drawings right below it were rendering real windows, and it
 * never showed shutters at all — while Hover returned 33 windows, 12 doors and
 * 8 shutters for the same house.
 *
 * Cause: the rows read ONLY `estimated_windows`/`estimated_doors`, which just
 * the satellite path sets. Photo analysis — the one producer with exact counts
 * — writes `windows_count`/`doors_count`/`shutter_*`, so uploading photos made
 * the numbers disappear.
 *
 * Invariant: if a producer knows a count, the summary shows it; if nobody
 * knows, it shows "—" and never invents a confident zero.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; console.log(`  \u2717 ${name}${extra !== undefined ? ' \u2014 ' + JSON.stringify(extra) : ''}`); }
}

async function main() {
  const out = path.join(os.tmpdir(), `opencounts-${Date.now()}.mjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'utils', 'openingCounts.js')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  });
  const { resolveOpeningCounts, hasOpeningInventory, formatShutters, summaryCaption } = await import('file://' + out);
  fs.unlinkSync(out);

  console.log('\n\u2500\u2500 1. Photo analysis: exact counts must be shown \u2500\u2500');
  {
    // Shape returned by the live photo analyzer.
    const sd = {
      windows_count: 33,
      window_assemblies_count: 33,
      doors_count: 12,
      garage_door_count: 2,
      shutters_count: 8,
      shutter_panel_count: 8,
      shutter_pair_count: 4,
      openings_detail: [{ type: 'window' }],
      measurement_graph: { counts: {} },
    };
    const r = resolveOpeningCounts(sd);
    check('windows come through (33)', r.windows === 33, r);
    check('doors come through (12)', r.doors === 12, r);
    check('garage doors come through (2)', r.garageDoors === 2, r);
    check('shutter panels come through (8)', r.shutterPanels === 8, r);
    check('shutter pairs come through (4)', r.shutterPairs === 4, r);
    check('flagged exact, so the label drops "(est.)"', r.windowsExact && r.doorsExact);
    check('caption stops calling them estimates', r.countsAreEstimates === false);
  }

  console.log('\n\u2500\u2500 2. The reported bug: exact counts with no estimated_* fields \u2500\u2500');
  {
    // Exactly the user's case — photo path sets no estimated_* at all.
    const sd = { windows_count: 14, doors_count: 3, openings_detail: [{ type: 'window' }] };
    const r = resolveOpeningCounts(sd);
    check('windows are NOT em-dashed', r.windows === 14, r);
    check('doors are NOT em-dashed', r.doors === 3, r);
  }

  console.log('\n\u2500\u2500 3. Satellite-only: fall back to the estimate \u2500\u2500');
  {
    const sd = { estimated_windows: 12, estimated_doors: 3 };
    const r = resolveOpeningCounts(sd);
    check('uses the estimate for windows', r.windows === 12, r);
    check('uses the estimate for doors', r.doors === 3, r);
    check('marked as an estimate', r.countsAreEstimates === true);
    check('not claimed as exact', !r.windowsExact && !r.doorsExact);
    check('no shutters invented', r.shutterPanels === null);
  }

  console.log('\n\u2500\u2500 4. Roof-footprint fallback must not report a confident zero \u2500\u2500');
  {
    // buildRoofFootprintFallback hardcodes 0 while knowing nothing about openings.
    const sd = { windows_count: 0, doors_count: 0, _estimated_from_roof_footprint: true };
    check('inventory correctly rejected', hasOpeningInventory(sd) === false);
    const r = resolveOpeningCounts(sd);
    check('windows show "unknown" (null), not 0', r.windows === null, r);
    check('doors show "unknown" (null), not 0', r.doors === null, r);
    check('flagged as estimate', r.countsAreEstimates === true);
  }

  console.log('\n\u2500\u2500 5. A genuine zero from real photo analysis IS shown \u2500\u2500');
  {
    // A garage with no windows really does have 0 — that is a fact, not a gap.
    const sd = { windows_count: 0, doors_count: 1, window_assemblies_count: 0, openings_detail: [] };
    const r = resolveOpeningCounts(sd);
    check('a real 0 is reported as 0', r.windows === 0, r);
    check('and counts as exact', r.windowsExact === true);
  }

  console.log('\n\u2500\u2500 6. Assemblies beat raw window count \u2500\u2500');
  {
    // A mulled triple window in one frame is ONE assembly, three units.
    const sd = { windows_count: 9, window_assemblies_count: 5, doors_count: 2, measurement_graph: {} };
    const r = resolveOpeningCounts(sd);
    check('prefers assemblies (5) over raw count (9)', r.windows === 5, r);
  }

  console.log('\n\u2500\u2500 7. Junk / empty input \u2500\u2500');
  {
    check('null is safe', resolveOpeningCounts(null).windows === null);
    check('empty object is safe', resolveOpeningCounts({}).windows === null);
    check('empty object is an estimate', resolveOpeningCounts({}).countsAreEstimates === true);
    check('hasOpeningInventory(null) is false', hasOpeningInventory(null) === false);
  }

  console.log('\n\u2500\u2500 8. Shutter formatting \u2500\u2500');
  {
    check('none renders nothing', formatShutters(0, 0) === null);
    check('null renders nothing', formatShutters(null, null) === null);
    check('8 panels / 4 pairs', formatShutters(8, 4) === '8 panels (4 pairs)');
    check('1 panel singular', formatShutters(1, 0) === '1 panel');
    check('lone panels with no pairs', formatShutters(3, 0) === '3 panels');
    check('one pair singular', formatShutters(2, 1) === '2 panels (1 pair)');
  }

  console.log('\n\u2500\u2500 9. Caption must not overclaim OR underclaim \u2500\u2500');
  {
    const both = summaryCaption({ windowsExact: true, doorsExact: true, hasShutters: true });
    check('both exact mentions shutters', /exact from photo analysis/.test(both) && /shutter/i.test(both), both);
    check('both exact never says windows are estimates', !/Windows, doors & trim are estimates/.test(both), both);

    const noShutters = summaryCaption({ windowsExact: true, doorsExact: true, hasShutters: false });
    check('no shutters present -> not mentioned', !/shutter/i.test(noShutters), noShutters);

    const neither = summaryCaption({ windowsExact: false, doorsExact: false });
    check('neither exact asks for photos', /add wall photos/.test(neither), neither);

    // Mixed provenance: a blanket "these are estimates" would understate real data.
    const winOnly = summaryCaption({ windowsExact: true, doorsExact: false });
    check('windows-only credits windows as exact', /Window counts are exact/.test(winOnly), winOnly);
    check('windows-only still flags doors', /doors/i.test(winOnly), winOnly);

    const doorOnly = summaryCaption({ windowsExact: false, doorsExact: true });
    check('doors-only credits doors as exact', /Door counts are exact/.test(doorOnly), doorOnly);
    check('doors-only still flags windows', /windows/i.test(doorOnly), doorOnly);

    check('empty args are safe', typeof summaryCaption() === 'string');
  }

  console.log('\n\u2500\u2500 10. Mixed provenance counts \u2500\u2500');
  {
    // Exact windows, no door data at all.
    const r1 = resolveOpeningCounts({ window_assemblies_count: 7, openings_detail: [], estimated_doors: 3 });
    check('windows exact', r1.windowsExact === true && r1.windows === 7, r1);
    check('doors fall back to the estimate', r1.doors === 3 && r1.doorsExact === false, r1);

    // Exact doors, windows genuinely absent from a photo inventory.
    const r2 = resolveOpeningCounts({ doors_count: 2, measurement_graph: {} });
    check('doors exact', r2.doorsExact === true && r2.doors === 2, r2);
    check('windows unknown -> null, not a fake 0', r2.windows === null, r2);
  }

  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`${passed + failed} checks \u2014 ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\u274c FAILED'); process.exit(1); }
  console.log('\u2705 Exact counts win, unknowns stay honest');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
