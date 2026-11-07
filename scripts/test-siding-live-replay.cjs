#!/usr/bin/env node
/**
 * Replay recorded Gemini reads from the fee5510 bench (siding-20261018n),
 * the earlier patch bench (siding-20261018m), and the 7c25020 live bench
 * (siding-20261018o). No Solar and no live Gemini: the jsonl files are the
 * vision responses, and geometry.json is the footprint the handler already had.
 * The o recordings are a holdout. They are per-photo reads, so they do not
 * exercise the face call, and they are not a pass gate.
 * The p recordings are the 670b429 live run. Each photo was sampled three
 * times and each face was classified three times. The replay merges the
 * photo samples and stamps the saved face classification.
 *
 * The billed wall is the rounded net the estimator returns. Hover bands:
 * Malec ±15% of 1806 (1535–2077), Opperman and Coleman ±10%, Walsh no
 * worse than the fee5510 miss of 26 sqft against Hover 183 (157–209).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXTURES = path.join(__dirname, 'fixtures', 'siding-live-20261018');

let passed = 0;
let failed = 0;
function ok(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    failed += 1;
  }
}

function visionBodies(file) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!row.ok || !row.text) continue;
    let body;
    try { body = JSON.parse(row.text); } catch { continue; }
    const text = (body?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    if (!text) continue;
    try { rows.push({ hash: row.h, value: JSON.parse(text) }); } catch { /* one truncated vision body is dropped, as the live parser dropped it */ }
  }
  return rows;
}

function photosFromJsonl(file) {
  return visionBodies(file).map((row) => row.value);
}

function mergedPhotosFromJsonl(file, classifications, mergeVisionMaterialSamples) {
  const groups = new Map();
  for (const row of visionBodies(file)) {
    if (row.value.stone_percent != null && row.value.wall_width_ft == null) continue;
    if (!groups.has(row.hash)) groups.set(row.hash, []);
    groups.get(row.hash).push(row.value);
  }
  const photos = [];
  for (const samples of groups.values()) {
    const merged = mergeVisionMaterialSamples(samples) || samples[0];
    if (merged) photos.push(merged);
  }
  if (classifications) stampFaceClassifications(photos, classifications);
  return photos;
}

function canonicalFace(raw) {
  const text = String(raw || '').toLowerCase();
  if (text.includes('front')) return 'front';
  if (text.includes('back') || text.includes('rear')) return 'back';
  if (text.includes('left')) return 'left_side';
  if (text.includes('right')) return 'right_side';
  return null;
}

function stampFaceClassifications(photos, classifications) {
  for (const photo of photos) {
    const faces = new Set();
    const primary = canonicalFace(photo.wall_face);
    const secondary = canonicalFace(photo.secondary_wall_face);
    if (primary) faces.add(primary);
    if (secondary) faces.add(secondary);
    for (const face of faces) {
      if (!classifications[face]?.shares) continue;
      photo.face_materials = photo.face_materials || {};
      photo.face_materials[face] = classifications[face];
    }
  }
}

function bandFor(row) {
  if (row.band === 'abs') {
    return {
      lo: row.hover_wall_sqft - row.tolerance,
      hi: row.hover_wall_sqft + row.tolerance,
    };
  }
  const span = row.hover_wall_sqft * row.tolerance / 100;
  return {
    lo: Math.round(row.hover_wall_sqft - span),
    hi: Math.round(row.hover_wall_sqft + span),
  };
}

(async () => {
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');
  const { mergeVisionMaterialSamples } = await import('../functions/utils/wallMaterialSections.js');
  const { resolveGutterQuantity, selectGutterEaveLf, gutterRunsEchoWallWidth, levelOutlineEaveLf } = await import('../functions/utils/elevationAccessories.js');
  const { cornersFromFacetOutline, countFootprintCorners } = await import('../src/utils/footprintCorners.js');
  const geometry = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'geometry.json'), 'utf8'));
  const pClassifications = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'p', 'classifications.json'), 'utf8'));

  for (const [key, row] of Object.entries(geometry)) {
    const file = path.join(FIXTURES, row.set, `${key.split('/')[1]}.jsonl`);
    const photos = row.set === 'p'
      ? mergedPhotosFromJsonl(file, pClassifications[key.split('/')[1]], mergeVisionMaterialSamples)
      : photosFromJsonl(file);
    ok(`${key} has recorded vision reads`, photos.length >= 4, photos.length, '>= 4');
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: photos,
      storyCount: row.story_count,
      wallHeightFt: row.story_height_ft,
      grossWallAreaSqft: row.gross_wall_area_sqft,
      perimeterFt: row.perimeter_ft,
      buildingWidthFt: row.building_width_ft,
      buildingLengthFt: row.building_length_ft,
    });
    const net = graph.totals.net_siding_area_sqft;
    const billed = Math.round(net);
    const { lo, hi } = bandFor(row);
    const flags = graph.material_map?.material_review_flags || [];
    const reasons = JSON.stringify(flags);
    ok(`${key} does not pretend the vision pass ran three times`, !/fewer than 3 times/.test(reasons), reasons, 'no short-sample flag');
    if (row.set === 'p' && row.house === 'Malec') {
      const left = graph.material_map.faces.left_side;
      ok(`${key} left side reports the classifier photo count`, (left?.photo_count || 0) >= 1 && !/only 0 photos/.test(reasons), left?.photo_count, '>= 1');
    }
    if (row.set === 'p' && row.house === 'Coleman') {
      const leftFlag = flags.find((flag) => flag.face === 'left_side');
      ok(`${key} left side flag counts the one classified photo`, leftFlag?.photo_count === 1 && /only 1 photo/.test(leftFlag?.reasons?.join(' ') || ''), leftFlag, '1 photo');
    }
    if (row.set === 'p' && row.house === 'Opperman') {
      const front = graph.material_map.faces.front;
      const brick = (front?.regions || []).find((region) => region.material === 'brick');
      ok(`${key} front stays on the face-call median and does not restore a photo brick band`, !brick, front?.regions, 'no brick');
    }
    if (row.set === 'p' && row.house === 'Walsh') {
      const front = graph.material_map.faces.front;
      const stucco = (front?.regions || []).find((region) => region.material === 'stucco');
      const brick = (front?.regions || []).find((region) => region.material === 'brick');
      ok(`${key} front keeps the face-call stucco share`, (stucco?.percent || 0) >= 20 && (brick?.percent || 0) < 90, front?.regions, 'stucco kept');
    }
    // These two recordings were inside the Hover band because a window box
    // was far too big (Malec back 12×16 = 192 sqft, Coleman 9×4.5). The
    // standard-size clamp removes that deduction, so the net moves. The
    // pinned net is the wall after that clamp, not a new Hover target.
    const clampedNet = {
      'n/21235571_s2': 2107,
      'n/22005438_s2': 1143,
    };
    if (clampedNet[key] != null) {
      const windows = graph.opening_groups.filter((group) => group.type === 'window');
      ok(
        `${key} ${row.house} windows are no larger than a standard opening`,
        windows.every((group) => group.area_sqft <= 30),
        windows.map((group) => group.area_sqft),
        '<= 30',
      );
      ok(
        `${key} ${row.house} billed ${billed} is the wall after that clamp (Hover ${row.hover_wall_sqft}, was ${row.saved_wall_area_sqft})`,
        billed === clampedNet[key],
        billed,
        clampedNet[key],
      );
    } else if (row.gate) {
      ok(
        `${key} ${row.house} billed ${billed} is inside ${lo}–${hi} (Hover ${row.hover_wall_sqft}, was ${row.saved_wall_area_sqft})`,
        billed >= lo && billed <= hi,
        billed,
        [lo, hi],
      );
    } else {
      const mark = billed >= lo && billed <= hi ? 'inside' : 'outside';
      const role = row.holdout ? 'holdout' : 'recorded';
      console.log(`  · ${key} ${row.house} billed ${billed} is ${mark} ${lo}–${hi} (Hover ${row.hover_wall_sqft}, saved ${row.saved_wall_area_sqft}) and is ${role}, not a pass gate`);
    }
  }

  const malecPhotos = photosFromJsonl(path.join(FIXTURES, 'n', '21235571_s1.jsonl'));
  ok('Malec photo gutter runs echo the wall width', gutterRunsEchoWallWidth(malecPhotos) === true);
  const malecBasis = selectGutterEaveLf({
    facetEaveLf: 211.1,
    facetTraceUsable: false,
    roofEaveLf: 0,
    footprintFallbackLf: 176,
  });
  ok('an unusable Malec facet eave is still the basis when no roof eave was passed', malecBasis.eave_lf === 211 && malecBasis.source === 'roof_facet_eave', malecBasis, 211);
  const malecGutters = resolveGutterQuantity({ perPhotoResults: malecPhotos, eaveLf: malecBasis.eave_lf });
  ok('echoed Malec runs are replaced by the longer roof eave', malecGutters.gutter_source === 'roof_eave' && malecGutters.gutter_lf === 211, malecGutters, 211);
  ok('that eave is longer than the old half-box gutter', malecGutters.gutter_lf > 175, malecGutters.gutter_lf, '> 175');
  const longerRoof = selectGutterEaveLf({
    facetEaveLf: 211.1,
    facetTraceUsable: true,
    roofEaveLf: 351,
    footprintFallbackLf: 176,
  });
  ok('a longer roof eave wins even when the facet trace is usable', longerRoof.eave_lf === 351 && longerRoof.source === 'roof_eave', longerRoof, 351);
  const levelEave = selectGutterEaveLf({
    facetEaveLf: 211.1,
    facetTraceUsable: false,
    roofEaveLf: 0,
    footprintFallbackLf: 132.9,
    levelBoundaryLf: 343,
  });
  ok('a level roof outline replaces a labeled eave that covers less than 70% of it', levelEave.eave_lf === 343 && levelEave.source === 'roof_level_outline', levelEave, 343);
  const keptEave = selectGutterEaveLf({
    facetEaveLf: 92.3,
    facetTraceUsable: false,
    roofEaveLf: 0,
    footprintFallbackLf: 92,
    levelBoundaryLf: 112,
  });
  ok('Coleman keeps the labeled eave when it already covers the level outline', keptEave.eave_lf === 92 && keptEave.source === 'roof_facet_eave', keptEave, 92);
  ok('level outline length ignores a shared edge', levelOutlineEaveLf([
    { edges: [{ x1: 0, y1: 0, x2: 10, y2: 0, h1: 1, h2: 1, length_ft: 10 }] },
    { edges: [{ x1: 0, y1: 0, x2: 10, y2: 0, h1: 1, h2: 1, shared_with: 'other', length_ft: 10 }] },
  ]) === 10, null, 10);
  ok('level outline keeps level eaves and drops a sloped rake', levelOutlineEaveLf([
    {
      area_sqft: 800,
      edges: [
        { type: 'eave', x1: 0, y1: 0, x2: 40, y2: 0, h1: 10, h2: 10 },
        { type: 'ridge', x1: 0, y1: 15, x2: 40, y2: 15, h1: 18, h2: 18 },
        { type: 'rake', x1: 0, y1: 0, x2: 0, y2: 12, h1: 10, h2: 16 },
        { type: 'rake', x1: 40, y1: 0, x2: 40, y2: 12, h1: 10, h2: 10.4 },
      ],
    },
    {
      area_sqft: 40,
      edges: [{ type: 'eave', x1: 0, y1: -8, x2: 12, y2: -8, h1: 9, h2: 9 }],
    },
  ]) === 104, null, 104);

  const wallRing = countFootprintCorners([[0, 0], [40, 0], [40, 20], [0, 20]], 15);
  const outline = cornersFromFacetOutline([
    [0, 0], [40, 0], [40, 12], [28, 12], [28, 4], [16, 4], [16, 12], [8, 12], [8, 24], [0, 24],
  ], 15, wallRing, 4);
  ok('a simplified 4-corner ring does not take roof-outline corners', outline == null, outline, null);

  const colemanPhotos = photosFromJsonl(path.join(FIXTURES, 'n', '22005438_s2.jsonl'));
  const colemanGutters = resolveGutterQuantity({ perPhotoResults: colemanPhotos, eaveLf: 92 });
  ok('Coleman keeps the photo gutter tape when it is already longer than the eave', colemanGutters.gutter_source === 'photos' && colemanGutters.gutter_lf === 109, colemanGutters, 109);

  const plugin = fs.readFileSync(path.join(__dirname, '../vite-functions-plugin.js'), 'utf8');
  ok('the handler logs the gutter source, the facet, and the footprint fallback',
    plugin.includes('Gutters ${gutterTakeoff.gutter_lf} LF from ${gutterTakeoff.gutter_source}')
    && plugin.includes('footprint fallback')
    && plugin.includes('gutter_eave_lf: gutterEaveLf')
    && plugin.includes('gutter_eave_source: gutterBasis.source'));
  ok('the handler bills siding-meets-siding corners and publishes material proposals',
    plugin.includes('countSidingOutsideCorners')
    && plugin.includes('confirmedByFace: params.confirmed_face_materials')
    && plugin.includes('confirmed_face_heights')
    && plugin.includes('applyConfirmedFaceHeights')
    && plugin.includes('material_proposals: materialProposalsFromMap(materialMap)')
    && !plugin.includes('maskOutsideCorners'));

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
