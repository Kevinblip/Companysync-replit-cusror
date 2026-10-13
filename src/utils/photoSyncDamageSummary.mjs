const NON_ROOF_MATERIALS = new Set([
  'siding_aluminum',
  'siding_steel',
  'siding_vinyl',
  'siding_fiber_cement',
  'siding_wood',
  'gutter_downspout',
  'vent_soft_metal',
  'window_wrap',
  'soft_metal',
  'brick_stone',
]);

const DENT_MATERIALS = new Set([
  'siding_aluminum',
  'siding_steel',
  'gutter_downspout',
  'vent_soft_metal',
  'window_wrap',
  'soft_metal',
  'metal_roof',
]);

function normalizedPhotoType(value) {
  const type = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (type.includes('test square') || type.includes('test 10')) return 'Test Square';
  if (type.includes('close') || type.includes('macro') || type === 'actual footage') return 'Close-up';
  return 'Overview';
}

function asCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function roundedAverage(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function photoRecord(photo) {
  const analysis = photo?.ai_damage_analysis || photo?.analysis || photo || {};
  const section = String(photo?.section || photo?.roof_section || analysis.section || 'Unassigned').trim();
  const material = String(analysis.material_category || photo?.material_category || '').toLowerCase();
  const photoType = normalizedPhotoType(photo?.photo_type || analysis.photo_type);
  const isNonRoof = NON_ROOF_MATERIALS.has(material) ||
    (!['roof_shingle', 'metal_roof'].includes(material) && /\b(elevation|siding|gutter|downspout|vent|window wrap)\b/i.test(section));
  const isRoof = !isNonRoof && (
    ['roof_shingle', 'metal_roof'].includes(material) ||
    photoType === 'Test Square' ||
    /\b(slope|roof)\b/i.test(section)
  );
  const baseKey = section || 'Unassigned';
  const key = isNonRoof && material ? `${baseKey} · ${material.replaceAll('_', ' ')}` : baseKey;
  return {
    section,
    key,
    material,
    photoType,
    isRoof,
    isNonRoof,
    hail: photoType === 'Overview' ? 0 : asCount(analysis.hail_hits_counted ?? photo?.hail_hits_counted),
    wind: photoType === 'Overview' ? 0 : asCount(analysis.wind_marks_counted ?? photo?.wind_marks_counted),
    dents: photoType === 'Overview' ? 0 : asCount(analysis.dents_counted ?? photo?.dents_counted),
  };
}

/**
 * Summarize hail only from Test Square photos when present. Close-ups then
 * provide supporting evidence without being added or averaged into the square
 * count. If no square exists, the maximum close-up count is shown as raw hits,
 * not as a density. Overview photos are never used for counts.
 */
export function summarizePhotoSyncDamage(photos = []) {
  const groups = new Map();
  for (const rawPhoto of Array.isArray(photos) ? photos : []) {
    const photo = photoRecord(rawPhoto);
    if (!groups.has(photo.key)) groups.set(photo.key, []);
    groups.get(photo.key).push(photo);
  }

  const sectionSummaries = {};
  for (const [key, group] of groups) {
    const roofPhotos = group.filter(photo => photo.isRoof);
    const nonRoofPhotos = group.filter(photo => photo.isNonRoof);
    const testSquares = roofPhotos.filter(photo => photo.photoType === 'Test Square');
    const closeups = roofPhotos.filter(photo => photo.photoType === 'Close-up');
    const isRoof = roofPhotos.length > 0 || nonRoofPhotos.length === 0;

    let totalHailMarks = 0;
    let hailPerSq = 0;
    let badgeLabel = '';
    let badgeValue = 0;
    let totalHailLabel = 'total hail marks';
    let windSamples = [];

    if (nonRoofPhotos.length > 0 && roofPhotos.length === 0) {
      const dentCount = nonRoofPhotos.reduce((sum, photo) => sum + (photo.dents || (DENT_MATERIALS.has(photo.material) ? photo.hail : 0)), 0);
      const impactCount = nonRoofPhotos.reduce((sum, photo) => sum + (photo.dents ? 0 : photo.hail), 0);
      badgeValue = dentCount || impactCount;
      badgeLabel = dentCount ? 'Dents' : 'Impacts';
      totalHailMarks = badgeValue;
      totalHailLabel = dentCount ? 'total dents' : 'total impacts';
    } else if (testSquares.length > 0) {
      const squareCounts = testSquares.map(photo => photo.hail);
      const squareWindCounts = testSquares.map(photo => photo.wind);
      totalHailMarks = squareCounts.reduce((sum, value) => sum + value, 0);
      hailPerSq = roundedAverage(squareCounts);
      windSamples = squareWindCounts;
      badgeValue = hailPerSq;
      badgeLabel = 'Hail/SQ';
    } else if (closeups.length > 0) {
      totalHailMarks = Math.max(...closeups.map(photo => photo.hail));
      badgeValue = totalHailMarks;
      badgeLabel = 'Confirmed Hits (Close-Up)';
    }

    if (testSquares.length === 0 && nonRoofPhotos.length === 0) {
      windSamples = [];
    }
    const windPerSq = roundedAverage(windSamples);
    const totalWindMarks = testSquares.length > 0
      ? testSquares.reduce((sum, photo) => sum + photo.wind, 0)
      : closeups.length > 0
        ? Math.max(...closeups.map(photo => photo.wind))
        : nonRoofPhotos.reduce((sum, photo) => sum + photo.wind, 0);

    sectionSummaries[key] = {
      total_hail_marks: totalHailMarks,
      total_wind_marks: totalWindMarks,
      photo_count: group.length,
      hail_per_sq: hailPerSq,
      wind_per_sq: windPerSq,
      badge_value: badgeValue,
      badge_label: badgeLabel,
      total_hail_label: totalHailLabel,
      is_roof: isRoof,
      test_square_count: testSquares.length,
      close_up_count: closeups.length,
      overview_count: group.filter(photo => photo.photoType === 'Overview').length,
    };
  }

  const summaries = Object.values(sectionSummaries);
  const roofSamples = summaries.filter(summary => summary.is_roof && summary.test_square_count > 0);
  return {
    section_summaries: sectionSummaries,
    total_hail_hits: summaries.reduce((sum, summary) => sum + summary.total_hail_marks, 0),
    total_wind_marks: summaries.reduce((sum, summary) => sum + summary.total_wind_marks, 0),
    hail_per_sq: roundedAverage(roofSamples.map(summary => summary.hail_per_sq)),
    wind_per_sq: roundedAverage(roofSamples.map(summary => summary.wind_per_sq)),
  };
}
