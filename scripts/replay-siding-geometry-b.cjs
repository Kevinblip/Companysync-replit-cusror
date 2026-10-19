#!/usr/bin/env node
/**
 * Mode B replay for a recorded siding bench (default siding-20261018t).
 * Footprint edges summed per face, story height (9 ft × stories + 1 ft band
 * joist), pitch gables, and confirmed shares rescaled onto the new face
 * gross so a bigger wall does not inflate the siding the rep already signed.
 * No live Gemini.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BENCH = process.env.SIDING_BENCH || '/tmp/bench-t/siding-20261018t';
const CONFIRMED_FILE = process.env.SIDING_CONFIRMED
  || '/tmp/bench-s/siding-20261018s/confirmed_face_materials.json';
const HOVER = {
  21235571: { name: 'Malec', net: 1806, band: 0.10 },
  21510907: { name: 'Opperman', net: 1347, band: 0.10 },
  22005438: { name: 'Coleman', net: 1003, band: 0.10 },
  21252991: { name: 'Walsh', net: 183, band: 40, absolute: true },
};

function visionPhotos(file) {
  const groups = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!row.ok || !row.text) continue;
    let body;
    try { body = JSON.parse(row.text); } catch { continue; }
    const text = (body?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    let value;
    try { value = JSON.parse(text); } catch { continue; }
    if (value.stone_percent != null && value.wall_width_ft == null) continue;
    if (!groups.has(row.h)) groups.set(row.h, []);
    groups.get(row.h).push(value);
  }
  return [...groups.values()].map((samples) => samples[0]);
}

function frontAzimuth(result) {
  for (const line of result.debug_logs || []) {
    const match = String(line).match(/nearest road at (\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function rescaleConfirmed(oldFaces, widths, height, gableByFace, shares) {
  // make_confirmed.py sets siding% = Hover siding on that elevation / face gross.
  // The signed file was built on the previous face gross, so the siding area
  // (percent × that gross) is what the rep confirmed. A taller wall or a gable
  // must not multiply it. The remainder is the same masonry mix; a face that
  // was all siding takes the house mix, or the biller treats a zero masonry
  // share as 100% siding and the rescale is lost.
  const faces = ['front', 'back', 'left_side', 'right_side'];
  const masonryNames = ['stone', 'stucco', 'brick'];
  const houseMasonry = { stone: 0, stucco: 0, brick: 0 };
  for (const face of faces) {
    const prev = shares[face]?.shares || {};
    for (const name of masonryNames) houseMasonry[name] += Number(prev[name]) || 0;
  }
  const houseMasonrySum = masonryNames.reduce((sum, name) => sum + houseMasonry[name], 0);
  const rebuilt = {};
  for (const face of faces) {
    const oldGross = Number(oldFaces?.[face]?.gross_wall_area_sqft) || 0;
    const newGross = (Number(widths[face]) || 0) * height + (Number(gableByFace?.[face]) || 0);
    const prev = shares[face]?.shares || {};
    const scale = oldGross > 0 && newGross > 0 ? oldGross / newGross : 1;
    const siding = Math.max(0, Math.min(100, (Number(prev.siding) || 0) * scale));
    const faceMasonrySum = masonryNames.reduce((sum, name) => sum + (Number(prev[name]) || 0), 0);
    const mix = faceMasonrySum > 0 ? prev : houseMasonry;
    const mixSum = faceMasonrySum > 0 ? faceMasonrySum : houseMasonrySum;
    const room = Math.max(0, 100 - siding);
    const next = { stone: 0, stucco: 0, brick: 0, siding: Math.round(siding * 10) / 10 };
    if (mixSum > 0 && room > 0) {
      for (const name of masonryNames) {
        next[name] = Math.round((room * (Number(mix[name]) || 0) / mixSum) * 10) / 10;
      }
    } else {
      next.siding = 100;
    }
    const drift = Math.round((100 - (next.stone + next.stucco + next.brick + next.siding)) * 10) / 10;
    if (next.siding + drift >= 0) next.siding = Math.round((next.siding + drift) * 10) / 10;
    rebuilt[face] = {
      confirmed: true,
      shares: next,
      old_gross: Math.round(oldGross),
      new_gross: Math.round(newGross),
    };
  }
  return rebuilt;
}

(async () => {
  const { buildSidingMeasurementGraph, fitFacesToGross, applyBilledWallIdentity } = await import('../functions/utils/sidingMeasurementGraph.js');
  const { faceWidthsFromFootprint } = await import('../src/utils/footprintCorners.js');
  const { medianPhotoEaveFt, houseEaveFt, gableAreaFromPitch, cappedWallGross } = await import('../db/siding-aggregate.cjs');
  const { storyCountFromPhotos } = await import('../functions/utils/wallMaterialSections.js');
  const { resolveGutterQuantity } = await import('../functions/utils/elevationAccessories.js');
  const confirmedAll = JSON.parse(fs.readFileSync(
    fs.existsSync(path.join(BENCH, 'confirmed_face_materials.json'))
      ? path.join(BENCH, 'confirmed_face_materials.json')
      : CONFIRMED_FILE,
    'utf8',
  ));
  const runs = fs.readdirSync(path.join(BENCH, 'rec')).filter((name) => name.startsWith('B_'));
  let failures = 0;
  for (const rec of runs.sort()) {
    const job = rec.split('_')[1];
    const set = rec.replace(/^B_/, '').replace(/\.jsonl$/, '');
    const saved = JSON.parse(fs.readFileSync(path.join(BENCH, 'results', 'B', `${set}.json`), 'utf8')).result;
    const photos = visionPhotos(path.join(BENCH, 'rec', rec));
    const confirmed = confirmedAll[job];
    for (const photo of photos) {
      photo.face_materials = { ...(photo.face_materials || {}) };
      for (const [face, row] of Object.entries(confirmed)) {
        photo.face_materials[face] = {
          confirmed: true,
          billed_from: 'rep_confirmed',
          photo_count: 0,
          sample_count: 3,
          review_notes: [],
          spread: {},
          spread_max: 0,
          shares: row.shares,
        };
      }
    }
    const azimuth = frontAzimuth(saved);
    const widths = faceWidthsFromFootprint(saved.footprint_polygon_xy, azimuth);
    const story = storyCountFromPhotos(photos);
    const medianEave = medianPhotoEaveFt(photos);
    const decided = houseEaveFt({
      storyCount: story.story_count || saved.story_count,
      storyReads: story.reads,
      medianEaveFt: medianEave,
    });
    const height = decided.eaveFt;
    const gable = gableAreaFromPitch({
      bearings: widths.bearings,
      widths,
      pitch: saved.roof_pitch_predominant,
      roofFacets: saved.measurement_graph?.roof_facets || [],
    });
    const rebuilt = rescaleConfirmed(saved.material_map?.faces, widths, height, gable.byFace, confirmed);
    for (const photo of photos) {
      for (const [face, row] of Object.entries(rebuilt)) {
        photo.face_materials[face] = {
          ...photo.face_materials[face],
          confirmed: true,
          billed_from: 'rep_confirmed',
          shares: row.shares,
        };
      }
    }
    const cap = cappedWallGross({
      perimeterFt: widths.perimeter_ft,
      wallHeightFt: height,
      gableSqft: gable.gableAreaSqft,
    });
    const grosses = [];
    let graph;
    for (let i = 0; i < 3; i += 1) {
      graph = buildSidingMeasurementGraph({
        perPhotoResults: photos,
        storyCount: saved.story_count,
        wallHeightFt: height,
        grossWallAreaSqft: cap,
        perimeterFt: widths.perimeter_ft,
        faceWidthsFt: widths,
        gableByFace: gable.byFace,
        roofFacets: saved.measurement_graph?.roof_facets || [],
      });
      grosses.push(graph.totals.gross_wall_area_sqft);
    }
    fitFacesToGross(graph.material_map, cap);
    applyBilledWallIdentity(graph, cap);
    const net = Math.round(graph.totals.net_siding_area_sqft);
    const gutters = resolveGutterQuantity({
      perPhotoResults: photos,
      eaveLf: saved.gutter_eave_lf,
      eaveBasisSource: saved.gutter_eave_source,
    });
    const hover = HOVER[job];
    const lo = hover.absolute ? hover.net - hover.band : Math.round(hover.net * (1 - hover.band));
    const hi = hover.absolute ? hover.net + hover.band : Math.round(hover.net * (1 + hover.band));
    const inside = net >= lo && net <= hi;
    const same = grosses[0] === grosses[1] && grosses[1] === grosses[2];
    const flags = (graph.material_map?.material_review_flags || []).map((flag) => flag.message).join(' | ');
    const widthFlags = graph.totals?.width_review_flags || [];
    const zeroPhoto = /only 0 photos/.test(flags);
    if (!inside || !same || zeroPhoto) failures += 1;
    const edgeNote = ['front', 'back', 'left_side', 'right_side'].map((face) => {
      const parts = (widths.edges?.[face] || []).map((edge) => edge.length_ft).join('+');
      return `${face[0]}${Math.round(widths[face] * 10) / 10}(${parts})`;
    }).join(' ');
    const shareNote = ['front', 'back', 'left_side', 'right_side'].map((face) => {
      const row = rebuilt[face];
      return `${face[0]} sid ${row.shares.siding} (${row.old_gross}->${row.new_gross})`;
    }).join(' ');
    console.log([
      hover.name,
      set,
      inside ? 'IN' : 'OUT',
      `net ${net} (${lo}-${hi})`,
      `gross ${Math.round(cap)}`,
      `ht ${height} stories ${story.story_count || saved.story_count} median ${medianEave} ${decided.source}`,
      `gable ${gable.gableAreaSqft} ${gable.reason} ${JSON.stringify(gable.byFace)}`,
      `open ${Math.round(graph.totals.opening_deduction_sqft)}`,
      `sid ${Math.round(graph.totals.siding_material_area_sqft)}`,
      `gut ${gutters.gutter_lf} ${gutters.gutter_source}`,
      same ? 'gross x3' : 'GROSS DRIFT',
      zeroPhoto ? 'ZERO-PHOTO FLAG' : 'confirmed-clean',
      widthFlags.length ? `WIDTH ${widthFlags.map((flag) => flag.message).join('; ')}` : 'width-clean',
      edgeNote,
      shareNote,
      `counts ${JSON.stringify(graph.counts.by_face)}`,
    ].join(' | '));
  }
  process.exitCode = failures ? 1 : 0;
})();
