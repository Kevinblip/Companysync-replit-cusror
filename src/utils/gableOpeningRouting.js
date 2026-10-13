/**
 * Identify the small subset of wall openings that belongs in a parametric
 * gable triangle rather than the rectangular wall below it.
 *
 * Photo analyzers report opening centers from grade. A side-facing opening is
 * only a gable opening when that measured assembly sits completely above the
 * wall plate; a direction alone is not enough because it also describes
 * ordinary side-wall windows.
 */

function openingCenterHeight(opening, wallHeight) {
  const value = Number(opening?.pos_y);
  if (!Number.isFinite(value)) return null;
  const unit = String(
    opening?.position_unit || opening?.position_units || opening?.coordinate_unit || '',
  ).toLowerCase();
  return unit === 'fraction' || unit === 'normalized' || unit === 'ratio'
    ? value * wallHeight
    : value;
}

function gableSideFromDirection(opening) {
  const face = String(opening?.wall_face || opening?.zone || '').toLowerCase().trim();
  if (['west', 'w', 'left', 'left_side'].includes(face)) return 'west';
  if (['east', 'e', 'right', 'right_side'].includes(face)) return 'east';

  const azimuth = Number(opening?.azimuth_degrees);
  if (!Number.isFinite(azimuth)) return null;
  const normalized = ((azimuth % 360) + 360) % 360;
  if (normalized >= 225 && normalized <= 315) return 'west';
  if (normalized >= 45 && normalized <= 135) return 'east';
  return null;
}

/**
 * @returns {{ west: object[], east: object[], wall: object[] }}
 */
export function partitionGableEndOpenings(openings, wallHeight) {
  const partitioned = { west: [], east: [], wall: [] };
  for (const opening of openings || []) {
    const side = gableSideFromDirection(opening);
    const centerY = openingCenterHeight(opening, wallHeight);
    const height = Math.max(Number(opening?.height_ft) || 3.5, 0);

    // Missing positions (including synthetic count-only openings) remain on
    // their normal wall. A gable window must have an observed vertical center
    // and its full frame must sit above the eave/wall-plate line.
    if (!side || centerY == null || centerY - height / 2 < wallHeight + 0.05) {
      partitioned.wall.push(opening);
      continue;
    }
    partitioned[side].push(opening);
  }
  return partitioned;
}