#!/usr/bin/env node
/**
 * Multi-view photo evidence regression tests.
 *
 * Proves that the shared evidence pass:
 *  - preserves every input as an auditable record,
 *  - rejects duplicate source views from coverage/area votes,
 *  - gives corner photos both physical wall identities,
 *  - fails closed on conflicting face evidence,
 *  - keeps detail photos as supporting evidence,
 *  - exposes a material dimension contradiction instead of averaging it away.
 *  - detects re-encoded copies by perceptual hash across different face labels.
 */

'use strict';

let passed = 0;
let failed = 0;
function ok(label, condition, got, expected) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const detail = got !== undefined
      ? ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`
      : '';
    console.log(`  ✗ ${label}${detail}`);
  }
}

(async () => {
  const { buildMultiViewPhotoEvidence } = await import('../functions/utils/multiViewPhotoEvidence.js');
  const { buildSidingMeasurementGraph } = await import('../functions/utils/sidingMeasurementGraph.js');

  console.log('\nDuplicate source views are retained but only vote once');
  {
    const input = [
      {
        view_label: 'Front',
        url: 'https://example.test/front.jpg',
        confidence: 60,
        wall_width_ft: 42,
        openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 8, pos_y: 4 }],
      },
      {
        view_label: 'Front',
        url: 'https://example.test/front.jpg',
        confidence: 95,
        wall_width_ft: 42,
        openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 8, pos_y: 4 }],
      },
    ];
    const evidence = buildMultiViewPhotoEvidence(input);
    ok('all inputs remain in photo evidence', evidence.photos.length === 2, evidence.photos.length, 2);
    ok('one duplicate source is identified', evidence.duplicate_photos.length === 1);
    ok('higher-confidence source remains accepted', evidence.photos.find(p => p.confidence === 0.95)?.status === 'accepted');
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: input,
      grossWallAreaSqft: 1000,
      perimeterFt: 120,
      smallOpeningsInWaste: true,
    });
    ok('duplicate opening does not inflate canonical groups', graph.opening_groups.length === 1);
    ok('duplicate count is surfaced on the graph', graph.coverage.duplicates_removed === 1);
  }

  console.log('\nCorner overlap binds to both adjoining faces');
  {
    const evidence = buildMultiViewPhotoEvidence([
      { view_label: 'FR Corner', classification_shot_type: 'corner', confidence: 90 },
    ]);
    const photo = evidence.photos[0];
    ok('corner has both physical face identities',
      JSON.stringify(photo.faces) === JSON.stringify(['front', 'right_side']),
      photo.faces, ['front', 'right_side']);
    ok('corner is not treated as a straight elevation', photo.is_corner === true);
    ok('corner is a useful next-view quality signal', evidence.next_recommended_photos.length > 0);
  }

  console.log('\nNear-identical photos under different labels only cover one face');
  {
    const input = [
      {
        view_label: 'Front',
        perceptual_hash: '0123456789abcdef',
        confidence: 95,
        openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 8, pos_y: 4 }],
      },
      {
        view_label: 'Left Side',
        // Four changed bits simulate an ordinary resize/JPEG re-encode.
        perceptual_hash: '0123456789abcdee',
        confidence: 80,
        openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 8, pos_y: 4 }],
      },
      { view_label: 'Back', perceptual_hash: 'ffffffffffffffff', confidence: 90 },
      { view_label: 'Right Side', perceptual_hash: 'aaaaaaaaaaaaaaaa', confidence: 90 },
    ];
    const evidence = buildMultiViewPhotoEvidence(input);
    const duplicate = evidence.photos.find(photo => photo.status === 'duplicate');
    ok('near-identical hash is identified as a duplicate',
      duplicate?.duplicate_reason === 'near_identical_photo',
      duplicate?.duplicate_reason, 'near_identical_photo');
    ok('duplicate warning names both tiles',
      evidence.warnings.some(w =>
        w.code === 'duplicate_photo_observation'
        && w.label === 'Left Side'
        && w.duplicate_label === 'Front'));
    ok('the duplicate tile face is reported missing',
      evidence.missing_faces.includes('left_side'),
      evidence.missing_faces, ['left_side']);
    ok('the accepted copy still covers its face',
      evidence.covered_faces.includes('front'));

    const graph = buildSidingMeasurementGraph({
      perPhotoResults: input,
      grossWallAreaSqft: 1000,
      perimeterFt: 120,
      smallOpeningsInWaste: true,
    });
    ok('the duplicated photo contributes openings only once',
      graph.opening_groups.length === 1,
      graph.opening_groups.length, 1);
    ok('graph confidence includes the missing-face penalty',
      graph.coverage.confidence < 0.75,
      graph.coverage.confidence, '< 0.75');
  }

  console.log('\nConflicting labels fail closed');
  {
    const evidence = buildMultiViewPhotoEvidence([
      {
        view_label: 'Front',
        wall_face: 'right_side',
        confidence: 95,
        wall_width_ft: 40,
      },
    ]);
    ok('conflicting assignment is unresolved', evidence.photos[0].status === 'unresolved');
    ok('unresolved photo is reported', evidence.unresolved_photos.length === 1);
    ok('unresolved face is not coverage', evidence.covered_faces.length === 0);
    const graph = buildSidingMeasurementGraph({
      perPhotoResults: [{
        view_label: 'Front',
        wall_face: 'right_side',
        confidence: 95,
        wall_width_ft: 40,
        openings: [{ type: 'window', width_ft: 4, height_ft: 4, pos_x: 8, pos_y: 4 }],
      }],
      smallOpeningsInWaste: true,
    });
    ok('unresolved opening is not forced onto the raw face',
      graph.opening_groups[0]?.face === 'unknown');
  }

  console.log('\nDetail evidence is not a wall anchor');
  {
    const evidence = buildMultiViewPhotoEvidence([
      {
        view_label: 'Detail 1',
        classification_shot_type: 'detail',
        wall_face: 'front',
        confidence: 95,
        wall_width_ft: 40,
      },
    ]);
    ok('detail remains supporting evidence', evidence.photos[0].status === 'supporting_detail');
    ok('detail does not cover a face', evidence.covered_faces.length === 0);
    ok('detail warning explains its role',
      evidence.warnings.some(w => w.code === 'detail_photo_supporting_only'));
  }

  console.log('\nConflicting dimensions are exposed as a review signal');
  {
    const evidence = buildMultiViewPhotoEvidence([
      { view_label: 'Front', confidence: 90, wall_width_ft: 30, wall_height_ft: 9 },
      { view_label: 'Front', confidence: 90, wall_width_ft: 45, wall_height_ft: 15 },
      { view_label: 'Back', confidence: 90, wall_width_ft: 35, wall_height_ft: 9 },
      { view_label: 'Left Side', confidence: 90, wall_width_ft: 50, wall_height_ft: 9 },
      { view_label: 'Right Side', confidence: 90, wall_width_ft: 50, wall_height_ft: 9 },
    ]);
    const front = evidence.faces.find(face => face.face === 'front');
    ok('front width range is retained', JSON.stringify(front.width_range_ft) === JSON.stringify([30, 45]), front.width_range_ft, [30, 45]);
    ok('front contradiction is flagged', front.contradictory_dimensions === true);
    ok('contradiction requires review', evidence.status === 'review_required');
    ok('fused value is robust median, not a sum', front.width_ft === 37.5, front.width_ft, 37.5);
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(error => {
  console.error('\n❌ Test harness error:', error?.stack || error);
  process.exit(1);
});