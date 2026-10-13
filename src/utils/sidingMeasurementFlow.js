/**
 * Complete a siding measurement step without coupling the transition to React.
 *
 * Measurement entry points store results for review and leave estimate state
 * untouched. Generate Estimate callers opt into building in the same step.
 */
export async function completeSidingMeasurement({
  measurements,
  stateMeasurements = measurements,
  autoBuild = false,
  setMeasurements,
  buildEstimate,
}) {
  setMeasurements(stateMeasurements);
  if (autoBuild) {
    await buildEstimate(measurements);
  }
  return stateMeasurements;
}