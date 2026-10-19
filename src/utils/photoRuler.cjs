'use strict';

/**
 * The in-app ruler (PhotoCalibrationCanvas) measures an eave from a known
 * door. Line A is the door. Line B is grade to the eave.
 * height_ft = (lineB_px / lineA_px) × (reference_inches / 12).
 * The estimator uses the same ratio, so a rep correction and an automatic
 * door box cannot drift apart.
 */

const ENTRY_DOOR_INCHES = 80; // 6 ft 8 in
const GARAGE_DOOR_INCHES = 84; // 7 ft
const TALL_GARAGE_DOOR_INCHES = 96; // 8 ft
const SIDING_PRESET_INCHES = 45;

function linePixels(line, width, height) {
  if (!line) return 0;
  const dx = (Number(line.x2) - Number(line.x1)) * width;
  const dy = (Number(line.y2) - Number(line.y1)) * height;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  return Math.hypot(dx, dy);
}

/**
 * @param {number} referencePx length of the known object
 * @param {number} targetPx length of grade-to-eave (or grade-to-peak)
 * @param {number} referenceInches real height of the known object
 * @param {{ minReferencePx?: number }} [options]
 */
function eaveFeetFromRatio(referencePx, targetPx, referenceInches, options = {}) {
  const minReference = Number.isFinite(options.minReferencePx) ? options.minReferencePx : 2;
  if (!(referencePx > minReference) || !(targetPx > 0) || !(referenceInches > 0)) return 0;
  return (targetPx / referencePx) * (referenceInches / 12);
}

function referenceInchesForDoor(kind) {
  const text = String(kind || '').toLowerCase();
  if (!text) return ENTRY_DOOR_INCHES;
  if (text === 'siding') return SIDING_PRESET_INCHES;
  if (text === 'custom') return null;
  if (/tall/.test(text) && /garage/.test(text)) return TALL_GARAGE_DOOR_INCHES;
  if (/garage/.test(text)) return GARAGE_DOOR_INCHES;
  return ENTRY_DOOR_INCHES;
}

/**
 * Door box and eave line are normalized (0 at the top of the photo).
 * A vertical door and a vertical eave cancel the image height, so a missing
 * pixel size still measures the ratio. Pass the real size when it is known.
 */
function eaveFeetFromDoorBox({
  doorBox,
  eaveY,
  gradeY,
  doorKind,
  imageWidth = 1,
  imageHeight = 1,
} = {}) {
  if (!doorBox || !(Number(doorBox.h) > 0)) return 0;
  const inches = referenceInchesForDoor(doorKind);
  if (!(inches > 0)) return 0;
  const height = imageHeight > 2 ? imageHeight : 1;
  const width = imageWidth > 2 ? imageWidth : 1;
  const grade = Number.isFinite(Number(gradeY))
    ? Number(gradeY)
    : Number(doorBox.y) + Number(doorBox.h);
  const eave = Number(eaveY);
  if (!Number.isFinite(eave) || !Number.isFinite(grade)) return 0;
  const doorPx = Number(doorBox.h) * height;
  const eavePx = Math.abs(grade - eave) * height;
  // Normalized boxes are fractions. Pixel boxes are already longer than 2px.
  const minReference = height > 2 ? 2 : 0.02;
  void width;
  return eaveFeetFromRatio(doorPx, eavePx, inches, { minReferencePx: minReference });
}

function eaveFeetFromCalibration(calibration, imageWidth = 0, imageHeight = 0) {
  const lines = calibration?.lines;
  if (!lines?.a || !lines?.b) return 0;
  const preset = calibration.presetId || 'door';
  const inches = preset === 'custom'
    ? Number(calibration.customInches) || 0
    : referenceInchesForDoor(preset === 'garage' ? 'garage' : preset === 'siding' ? 'siding' : 'entry');
  if (!(inches > 0)) return 0;
  const width = imageWidth > 2 ? imageWidth : 1;
  const height = imageHeight > 2 ? imageHeight : 1;
  const referencePx = linePixels(lines.a, width, height);
  const targetPx = linePixels(lines.b, width, height);
  const minReference = height > 2 ? 2 : 0.02;
  return eaveFeetFromRatio(referencePx, targetPx, inches, { minReferencePx: minReference });
}

module.exports = {
  ENTRY_DOOR_INCHES,
  GARAGE_DOOR_INCHES,
  TALL_GARAGE_DOOR_INCHES,
  linePixels,
  eaveFeetFromRatio,
  referenceInchesForDoor,
  eaveFeetFromDoorBox,
  eaveFeetFromCalibration,
};
