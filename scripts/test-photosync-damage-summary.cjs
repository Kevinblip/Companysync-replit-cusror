'use strict';

const assert = require('node:assert/strict');

(async () => {
  const { summarizePhotoSyncDamage } = await import('../src/utils/photoSyncDamageSummary.mjs');

  const mixedRoofPhotos = [
    { roof_section: 'North Slope', photo_type: 'Test Square', material_category: 'roof_shingle', hail_hits_counted: 4, wind_marks_counted: 2 },
    { roof_section: 'North Slope', photo_type: 'Close-up', material_category: 'roof_shingle', hail_hits_counted: 7, wind_marks_counted: 3 },
    { roof_section: 'North Slope', photo_type: 'Overview', material_category: 'roof_shingle', hail_hits_counted: 18, wind_marks_counted: 9 },
  ];
  const mixedSummary = summarizePhotoSyncDamage(mixedRoofPhotos);
  assert.equal(mixedSummary.section_summaries['North Slope'].hail_per_sq, 4);
  assert.equal(mixedSummary.section_summaries['North Slope'].total_hail_marks, 4);
  assert.equal(mixedSummary.section_summaries['North Slope'].total_wind_marks, 2);
  assert.equal(mixedSummary.section_summaries['North Slope'].badge_label, 'Hail/SQ');

  const closeUpOnly = summarizePhotoSyncDamage([
    { roof_section: 'South Slope', photo_type: 'roof_closeup', material_category: 'roof_shingle', hail_hits_counted: 5 },
    { roof_section: 'South Slope', photo_type: 'Close-up', material_category: 'roof_shingle', hail_hits_counted: 3 },
  ]).section_summaries['South Slope'];
  assert.equal(closeUpOnly.hail_per_sq, 0);
  assert.equal(closeUpOnly.total_hail_marks, 5);
  assert.equal(closeUpOnly.badge_label, 'Confirmed Hits (Close-Up)');

  const overviewOnly = summarizePhotoSyncDamage([
    { roof_section: 'East Slope', photo_type: 'Overview', material_category: 'roof_shingle', hail_hits_counted: 14 },
  ]).section_summaries['East Slope'];
  assert.equal(overviewOnly.hail_per_sq, 0);
  assert.equal(overviewOnly.total_hail_marks, 0);
  assert.equal(overviewOnly.overview_count, 1);

  const siding = summarizePhotoSyncDamage([
    { roof_section: 'Front Elevation', photo_type: 'Close-up', material_category: 'siding_aluminum', hail_hits_counted: 3 },
  ]).section_summaries['Front Elevation · siding aluminum'];
  assert.equal(siding.hail_per_sq, 0);
  assert.equal(siding.badge_label, 'Dents');
  assert.equal(siding.badge_value, 3);

  const vinyl = summarizePhotoSyncDamage([
    { roof_section: 'Rear Elevation', photo_type: 'Close-up', material_category: 'siding_vinyl', hail_hits_counted: 2 },
  ]).section_summaries['Rear Elevation · siding vinyl'];
  assert.equal(vinyl.hail_per_sq, 0);
  assert.equal(vinyl.badge_label, 'Impacts');

  console.log('PhotoSync summaries: Test Square-only density, close-up support, overview exclusion, and nonroof labels passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
