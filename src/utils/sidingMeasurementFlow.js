/**
 * Complete a siding measurement step without coupling the transition to React.
 *
 * `autoBuild` prices the measurement in the same step. Callers that only
 * refresh a review panel pass autoBuild false.
 */
export async function completeSidingMeasurement({
  measurements,
  stateMeasurements = measurements,
  autoBuild = false,
  setMeasurements,
  buildEstimate,
  resolveMaterial,
}) {
  const apply = (record) => (typeof resolveMaterial === 'function' ? resolveMaterial(record) : record);
  const pricedMeasurements = apply(measurements);
  const stored = stateMeasurements === measurements ? pricedMeasurements : apply(stateMeasurements);
  setMeasurements(stored);
  if (autoBuild) {
    const pricing = await buildEstimate(pricedMeasurements);
    return { measurements: stored, priced: pricing?.priced !== false, block: pricing?.block || null };
  }
  return { measurements: stored, priced: false, block: null };
}
