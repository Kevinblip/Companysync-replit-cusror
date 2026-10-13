#!/usr/bin/env node
/**
 * test-photo-slot-assignment.cjs
 *
 * A contractor uploads a dozen exterior photos and only one shows up in the
 * grid. Three separate silent drops caused it:
 *   1. the loop walked the AI's response, so any photo the model forgot to
 *      mention was never placed at all;
 *   2. everything past "Detail 2" hit a `break` and was discarded;
 *   3. a second shot of the same wall collapsed into that same overflow.
 * All three reported success afterwards.
 *
 * The invariant under test is blunt: EVERY uploaded photo ends up in the grid,
 * no matter what the classifier says or fails to say.
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

const mkUploads = (n) => Array.from({ length: n }, (_, i) => ({
  url: `https://cdn.test/p${i}.jpg`, name: `p${i}.jpg`, preview: `blob:${i}`, index: i,
}));

// Every uploaded URL must be findable in the resulting grid.
function assertNoneDropped(label, uploads, merged) {
  const urls = new Set(merged.map(p => p.url));
  const missing = uploads.filter(u => !urls.has(u.url)).map(u => u.name);
  check(`${label}: all ${uploads.length} photos survive`, missing.length === 0, { missing });
}

async function main() {
  const out = path.join(os.tmpdir(), `photoslots-${Date.now()}.mjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'utils', 'photoSlotAssignment.js')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
  });
  const { splitBatchIntoSlots, mergeIntoPhotos, detailSlotCount, MAIN_SLOTS } =
    await import('file://' + out);
  fs.unlinkSync(out);

  console.log('\n\u2500\u2500 1. The reported bug: AI labels almost nothing \u2500\u2500');
  {
    // 12 photos uploaded, model returned a single entry (the real failure).
    const uploads = mkUploads(12);
    const labels = new Map([[3, 'FR Corner']]);
    const { assigned, overflow } = splitBatchIntoSlots(uploads, labels);
    const merged = mergeIntoPhotos([], assigned, overflow);
    assertNoneDropped('one label for 12 photos', uploads, merged);
    check('the one classified photo took its face slot',
      merged.find(p => p.label === 'FR Corner')?.url === 'https://cdn.test/p3.jpg');
    check('the other 11 became numbered detail slots',
      merged.filter(p => /^Detail \d+$/.test(p.label)).length === 11);
    check('placed count reported to the user matches reality',
      assigned.length + overflow.length === 12);
  }

  console.log('\n\u2500\u2500 2. Classifier returns nothing at all \u2500\u2500');
  {
    const uploads = mkUploads(20);
    const merged = (() => {
      const { assigned, overflow } = splitBatchIntoSlots(uploads, new Map());
      return mergeIntoPhotos([], assigned, overflow);
    })();
    assertNoneDropped('empty classification', uploads, merged);
    check('20 photos produce 20 detail slots (no cap at 2)',
      merged.filter(p => /^Detail \d+$/.test(p.label)).length === 20,
      { got: merged.length });
    check('detail slots are numbered uniquely',
      new Set(merged.map(p => p.label)).size === merged.length);
  }

  console.log('\n\u2500\u2500 3. Several shots of the same wall \u2500\u2500');
  {
    // Contractors routinely take 3-4 photos per elevation.
    const uploads = mkUploads(6);
    const labels = new Map([[0, 'Front'], [1, 'Front'], [2, 'Front'], [3, 'Left Side'], [4, 'Left Side'], [5, 'Back']]);
    const { assigned, overflow } = splitBatchIntoSlots(uploads, labels);
    const merged = mergeIntoPhotos([], assigned, overflow);
    assertNoneDropped('duplicate faces', uploads, merged);
    check('first Front wins the Front slot',
      merged.find(p => p.label === 'Front')?.url === 'https://cdn.test/p0.jpg');
    check('exactly one photo per face slot',
      MAIN_SLOTS.every(s => merged.filter(p => p.label === s).length <= 1));
    check('the 3 extra shots are kept as details',
      merged.filter(p => /^Detail \d+$/.test(p.label)).length === 3);
  }

  console.log('\n\u2500\u2500 4. A second batch must not destroy the first \u2500\u2500');
  {
    const first = mkUploads(3);
    const firstMerged = (() => {
      const { assigned, overflow } = splitBatchIntoSlots(first, new Map([[0, 'Front']]));
      return mergeIntoPhotos([], assigned, overflow);
    })();
    check('first batch produced Detail 1 and Detail 2',
      firstMerged.some(p => p.label === 'Detail 1') && firstMerged.some(p => p.label === 'Detail 2'));

    const second = mkUploads(4).map(u => ({ ...u, url: `https://cdn.test/b2-${u.index}.jpg`, name: `b2-${u.index}.jpg` }));
    const { assigned, overflow } = splitBatchIntoSlots(second, new Map([[0, 'Back']]));
    const merged = mergeIntoPhotos(firstMerged, assigned, overflow);

    assertNoneDropped('second batch', second, merged);
    check('first batch photos are still present',
      first.every(u => merged.some(p => p.url === u.url)));
    check('no duplicate slot labels after two batches',
      new Set(merged.map(p => p.label)).size === merged.length,
      merged.map(p => p.label));
    check('new details continued numbering instead of overwriting',
      merged.filter(p => /^Detail \d+$/.test(p.label)).length === 5);
  }

  console.log('\n\u2500\u2500 5. Re-shooting a face replaces only that face \u2500\u2500');
  {
    const existing = [
      { url: 'old-front', label: 'Front' },
      { url: 'old-back', label: 'Back' },
      { url: 'old-d1', label: 'Detail 1' },
    ];
    const uploads = [{ url: 'new-front', name: 'nf', index: 0 }];
    const { assigned, overflow } = splitBatchIntoSlots(uploads, new Map([[0, 'Front']]));
    const merged = mergeIntoPhotos(existing, assigned, overflow);
    check('Front was replaced', merged.find(p => p.label === 'Front').url === 'new-front');
    check('Back untouched', merged.find(p => p.label === 'Back').url === 'old-back');
    check('existing Detail 1 untouched', merged.find(p => p.label === 'Detail 1').url === 'old-d1');
    check('no slots added', merged.length === 3);
  }

  console.log('\n\u2500\u2500 6. Junk input cannot crash or silently swallow \u2500\u2500');
  {
    const uploads = mkUploads(3);
    check('a non-Map label argument still places every photo',
      mergeIntoPhotos([], ...(() => { const r = splitBatchIntoSlots(uploads, null); return [r.assigned, r.overflow]; })()).length === 3);
    const bogus = new Map([[0, 'Roof'], [1, 'front'], [2, null]]);
    const { assigned, overflow } = splitBatchIntoSlots(uploads, bogus);
    const merged = mergeIntoPhotos([], assigned, overflow);
    assertNoneDropped('unrecognised labels', uploads, merged);
    check('unrecognised labels become details, not face slots',
      merged.every(p => /^Detail \d+$/.test(p.label)), merged.map(p => p.label));
    check('empty upload list is handled', mergeIntoPhotos([], ...[[], []]).length === 0);
    const withJunk = [null, { name: 'no-url', index: 9 }, { url: 'ok', index: 10 }];
    const r = splitBatchIntoSlots(withJunk, new Map());
    check('entries without a URL are skipped without throwing',
      r.assigned.length + r.overflow.length === 1);
  }

  console.log('\n\u2500\u2500 7. The grid renders enough detail slots \u2500\u2500');
  {
    check('empty grid still offers 2 detail slots', detailSlotCount([]) === 2);
    check('null-safe', detailSlotCount(null) === 2);
    check('grows to the highest detail number present',
      detailSlotCount([{ label: 'Detail 7' }, { label: 'Front' }]) === 7);
    check('a gap in numbering still renders every slot',
      detailSlotCount([{ label: 'Detail 5' }]) === 5);
    // The renderer must have a slot for every detail photo, or photos that were
    // saved would still be invisible — the original symptom.
    const uploads = mkUploads(14);
    const { assigned, overflow } = splitBatchIntoSlots(uploads, new Map([[0, 'Front']]));
    const merged = mergeIntoPhotos([], assigned, overflow);
    const rendered = new Set([
      ...MAIN_SLOTS,
      ...Array.from({ length: detailSlotCount(merged) }, (_, i) => `Detail ${i + 1}`),
    ]);
    check('every stored photo has a slot the grid will draw',
      merged.every(p => rendered.has(p.label)),
      merged.filter(p => !rendered.has(p.label)).map(p => p.label));
  }

  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log('\n── 8. Confidence-aware classifications ──');
  {
    const uploads = mkUploads(5);
    const labels = new Map([
      [0, { label: 'Front', shot_type: 'straight_elevation', confidence: 96, evidence: ['entry_or_garage'], reason: 'Entry facade is straight-on.' }],
      [1, { label: 'FR Corner', shot_type: 'corner', confidence: 91, evidence: ['two_wall_planes', 'visible_corner'], reason: 'Two planes meet at the front-right corner.' }],
      [2, { label: 'Front', shot_type: 'straight_elevation', confidence: 54, evidence: ['uncertain_orientation'], reason: 'Orientation is uncertain.' }],
      [3, { label: 'Left Side', shot_type: 'detail', confidence: 98, evidence: ['close_up'], reason: 'Close-up does not show the full wall.' }],
      [4, { label: 'Back', shot_type: 'straight_elevation', confidence: 88, evidence: ['usable_wall_boundaries'], reason: 'Rear wall boundaries are visible.' }],
    ]);
    const { assigned, overflow } = splitBatchIntoSlots(uploads, labels);
    const merged = mergeIntoPhotos([], assigned, overflow);
    check('high-confidence straight face takes its face slot',
      merged.find(p => p.url === 'https://cdn.test/p0.jpg')?.label === 'Front');
    check('high-confidence corner takes its corner slot',
      merged.find(p => p.url === 'https://cdn.test/p1.jpg')?.label === 'FR Corner');
    check('low-confidence face guess becomes a reviewable detail',
      merged.find(p => p.url === 'https://cdn.test/p2.jpg')?.classification_review_required === true
      && /^Detail \d+$/.test(merged.find(p => p.url === 'https://cdn.test/p2.jpg')?.label || ''));
    check('detail shot cannot become a face slot',
      /^Detail \d+$/.test(merged.find(p => p.url === 'https://cdn.test/p3.jpg')?.label || ''));
    check('classification evidence and reason are retained',
      merged.find(p => p.url === 'https://cdn.test/p3.jpg')?.classification_evidence?.includes('close_up')
      && merged.find(p => p.url === 'https://cdn.test/p3.jpg')?.classification_reason === 'Close-up does not show the full wall.');
  }

  console.log('\n── 9. Manual slot protection ──');
  {
    const existing = [{ url: 'manual-front', label: 'Front', source: 'manual', manually_assigned: true }];
    const uploads = [{ url: 'ai-front', name: 'ai-front', index: 0 }];
    const { assigned, overflow } = splitBatchIntoSlots(uploads, new Map([[
      0,
      { label: 'Front', shot_type: 'straight_elevation', confidence: 97, reason: 'Straight-on facade.' },
    ]]));
    const merged = mergeIntoPhotos(existing, assigned, overflow);
    check('manual face remains in its slot', merged.find(p => p.label === 'Front')?.url === 'manual-front');
    check('AI replacement is retained as a detail instead of discarded',
      merged.some(p => p.url === 'ai-front' && /^Detail \d+$/.test(p.label)));
  }

  console.log(`${passed + failed} checks \u2014 ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\u274c FAILED'); process.exit(1); }
  console.log('\u2705 No uploaded photo is ever dropped');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
