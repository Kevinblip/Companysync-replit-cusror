'use strict';

const GENERIC_SECTIONS = new Set([
  '', 'all photos', 'unknown', 'general', 'other', 'needs section',
  'unsorted', 'unassigned', 'not set',
]);

function isUsableDamageSection(section) {
  const value = String(section || '').trim().toLowerCase();
  return !GENERIC_SECTIONS.has(value);
}

function materialAllowsDetection(category, detection) {
  const type = String(detection?.type || '').toLowerCase();
  const kind = String(detection?.damage_kind || '').toLowerCase();
  const evidence = Array.isArray(detection?.evidence) ? detection.evidence.map(v => String(v).toLowerCase()) : [];
  if (type === 'wind') {
    if (category === 'roof_shingle') return ['crease', 'lifted_tab', 'torn_tab', 'missing_tab'].includes(kind);
    if (['metal_roof', 'siding_aluminum', 'siding_steel', 'siding_vinyl', 'siding_fiber_cement', 'siding_wood'].includes(category)) {
      return ['lifted_panel', 'torn_panel', 'missing_panel', 'separated_seam'].includes(kind);
    }
    if (category === 'gutter_downspout') return ['bent_section', 'detached_section'].includes(kind);
    if (category === 'brick_stone') return kind === 'displaced_section';
    return false;
  }
  if (type !== 'hail') return false;

  if (['metal_roof', 'siding_aluminum', 'siding_steel', 'gutter_downspout', 'vent_soft_metal', 'window_wrap', 'soft_metal'].includes(category)) {
    return ['round_dent', 'dent'].includes(kind);
  }
  if (category === 'siding_vinyl') return ['crack', 'puncture', 'hole'].includes(kind);
  if (category === 'roof_shingle') {
    return ['round_impact', 'hail_hit'].includes(kind) &&
      evidence.some(item => ['granule_loss', 'bruising', 'fractured_mat'].includes(item));
  }
  return false;
}

function qualifyDamageCandidates(candidates, materialCategory, materialConfirmed = false) {
  const qualified = [];
  const possible = [];
  for (const item of Array.isArray(candidates) ? candidates : []) {
    if (!Array.isArray(item?.box_2d) || item.box_2d.length !== 4) continue;
    const confidence = Math.max(0, Math.min(100, Number(item.confidence) || 0));
    const safeItem = { ...item, confidence };
    if (confidence >= 70 && (materialConfirmed || materialCategory !== 'unknown') &&
      materialAllowsDetection(materialCategory, item)) {
      qualified.push(safeItem);
    } else {
      possible.push({
        ...safeItem,
        review_reason: confidence < 70 ? 'Below the 70% count threshold' :
          materialCategory === 'unknown' ? 'Confirm material before counting' :
            'Damage type does not match the confirmed material rules',
      });
    }
  }
  return { qualified, possible };
}

function filterSpatiallySuspiciousHailDetections(candidates, options = {}) {
  const minimumAligned = Math.max(20, Number(options.minimumAligned) || 20);
  const minimumRatio = Math.max(0.5, Math.min(1, Number(options.minimumRatio) || 0.65));
  const lineTolerance = Math.max(1, Number(options.lineTolerance) || 8);
  const minimumSpan = Math.max(100, Number(options.minimumSpan) || 250);
  const original = Array.isArray(candidates) ? candidates : [];
  const accepted = [...original];
  const suppressed = [];

  // Bound the pair search so a malformed/model-runaway response cannot create
  // an expensive O(n^3) pass. Normal PhotoSync output is far below this cap.
  while (accepted.length >= minimumAligned) {
    const points = accepted.map((item, index) => {
      const box = item?.box_2d;
      if (!Array.isArray(box) || box.length !== 4) return null;
      const values = box.map(Number);
      if (!values.every(Number.isFinite)) return null;
      return { index, x: (values[1] + values[3]) / 2, y: (values[0] + values[2]) / 2 };
    }).filter(Boolean).slice(0, 240);
    if (points.length < minimumAligned) break;

    let best = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const dx = points[j].x - points[i].x;
        const dy = points[j].y - points[i].y;
        const length = Math.hypot(dx, dy);
        if (length < minimumSpan / 2) continue;
        const inliers = [];
        let minProjection = Infinity;
        let maxProjection = -Infinity;
        for (const point of points) {
          const distance = Math.abs(dx * (points[i].y - point.y) - (points[i].x - point.x) * dy) / length;
          if (distance <= lineTolerance) {
            const projection = ((point.x - points[i].x) * dx + (point.y - points[i].y) * dy) / length;
            minProjection = Math.min(minProjection, projection);
            maxProjection = Math.max(maxProjection, projection);
            inliers.push(point.index);
          }
        }
        const span = maxProjection - minProjection;
        const ratio = inliers.length / points.length;
        if (inliers.length >= minimumAligned && ratio >= minimumRatio && span >= minimumSpan &&
            inliers.length > best.length) {
          best = inliers;
        }
      }
    }

    if (!best.length) break;
    const suspiciousIndexes = new Set(best);
    const suspicious = accepted.filter((_, index) => suspiciousIndexes.has(index));
    suppressed.push(...suspicious);
    for (let index = accepted.length - 1; index >= 0; index -= 1) {
      if (suspiciousIndexes.has(index)) accepted.splice(index, 1);
    }
  }

  return { accepted, suppressed };
}

function qualifyChalkDamageObservations(observations) {
  let hail = 0;
  let wind = 0;
  let rejected = 0;
  for (const observation of Array.isArray(observations) ? observations : []) {
    if (observation?.underlying_damage_visible !== true) {
      rejected += 1;
      continue;
    }
    const normalize = value => String(value || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    const kind = normalize(observation.damage_kind);
    const evidence = (Array.isArray(observation.evidence) ? observation.evidence : []).map(normalize);
    const hasHailEvidence = evidence.some(item => [
      'granule_loss', 'bruising', 'fractured_mat', 'visible_dent',
      'metal_deformation', 'crack', 'puncture', 'hole',
    ].includes(item));
    const hasWindEvidence = evidence.some(item => [
      'visible_crease', 'crease', 'creased_fibers', 'lifted_tab',
      'torn_tab', 'missing_tab', 'lifted_panel', 'torn_panel',
      'missing_panel', 'separated_seam',
    ].includes(item));
    if (['round_impact', 'hail_hit', 'round_dent', 'dent', 'crack', 'puncture', 'hole'].includes(kind) && hasHailEvidence) {
      hail += 1;
    } else if (['crease', 'lifted_tab', 'torn_tab', 'missing_tab', 'lifted_panel', 'torn_panel', 'separated_seam'].includes(kind) && hasWindEvidence) {
      wind += 1;
    } else {
      rejected += 1;
    }
  }
  return { hail, wind, rejected };
}

function normalizePhotoType(photoType) {
  const value = String(photoType || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (value === 'test square') return 'Test Square';
  if (value.includes('close up') || value.includes('closeup') ||
      value.includes('macro') || value === 'actual footage') return 'Close-up';
  return 'Overview';
}

function parseInspectorCorrection(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return {};
  const isNegated = (term) => new RegExp(`\\b(?:not|no|rather than|instead of)\\s+(?:the\\s+)?${term}\\b`, 'i').test(value);
  const facts = {};
  const materials = [
    ['siding_aluminum', /\baluminum(?:\s+siding)?\b/i, 'Aluminum siding'],
    ['siding_steel', /\bsteel(?:\s+siding)?\b/i, 'Steel siding'],
    ['siding_vinyl', /\bvinyl(?:\s+siding)?\b/i, 'Vinyl siding'],
    ['siding_fiber_cement', /\bfiber[\s-]?cement\b/i, 'Fiber-cement siding'],
    ['siding_wood', /\bwood(?:en)?\s+siding\b/i, 'Wood siding'],
    ['metal_roof', /\bmetal\s+roof\b/i, 'Metal roofing'],
    ['gutter_downspout', /\bgutter(?:s|\/downspout)?\b/i, 'Gutter/downspout'],
    ['vent_soft_metal', /\b(?:vent|soft metal)\b/i, 'Vent/soft metal'],
    ['window_wrap', /\bwindow wrap\b/i, 'Window wrap'],
    ['roof_shingle', /\bshingles?\b/i, 'Roof shingles'],
  ];
  const material = materials.find(([, pattern, label]) => pattern.test(value) && !isNegated(label.split(/[ /-]/)[0]));
  if (material) {
    facts.material_category = material[0];
    facts.material_type_identified = material[2];
    facts.material_confidence = 100;
    facts.material_confirmed = true;
    facts.inspector_confirmed = true;
  }
  const shingleTypes = [
    ['3-tab', /\b3[\s-]?tab\b/i],
    ['dimensional', /\bdimensional\b/i],
    ['architectural', /\barchitectural\b/i],
    ['organic', /\borganic\b/i],
    ['t-lock', /\bt[\s-]?lock\b/i],
  ];
  const shingleType = shingleTypes.find(([, pattern]) => pattern.test(value));
  if (shingleType) facts.shingle_type = shingleType[0];
  const exposure = value.match(/\b(\d+(?:\.\d+)?)\s*(?:-?\s*in(?:ch(?:es)?)?\.?|")?\s*exposure\b/i);
  if (exposure) facts.shingle_exposure_inches = Number(exposure[1]);
  const layers = value.match(/\b(\d+)\s+layers?\b/i);
  if (layers) facts.roof_layers = Number(layers[1]);
  return facts;
}

module.exports = {
  isUsableDamageSection,
  materialAllowsDetection,
  qualifyDamageCandidates,
  filterSpatiallySuspiciousHailDetections,
  qualifyChalkDamageObservations,
  normalizePhotoType,
  parseInspectorCorrection,
};
