import { rebuildSidingMeasurementsFromEdits } from './rebuildSidingMeasurements.js';

/**
 * Resolve the single siding payload used for comparison and persistence.
 * Photo evidence is more detailed than satellite/manual summaries, and reviewed
 * edits to that evidence are the final authority.
 */
export function selectActiveSidingMeasurement({
  photoSidingAnalysis,
  sidingMeasurements,
  manualSidingAnalysis,
  editedSidingFields = {},
} = {}) {
  if (photoSidingAnalysis) {
    return Object.keys(editedSidingFields || {}).length > 0
      ? rebuildSidingMeasurementsFromEdits(photoSidingAnalysis, editedSidingFields)
      : photoSidingAnalysis;
  }
  return sidingMeasurements || manualSidingAnalysis || null;
}

export default selectActiveSidingMeasurement;