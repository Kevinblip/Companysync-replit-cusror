function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function createEstimateSourceContext({ customerId, inspectionJobId, propertyAddress } = {}) {
  return [
    normalized(customerId),
    normalized(inspectionJobId),
    normalized(propertyAddress),
  ].join('|');
}

export function uploadedFilesMatchEstimateContext(files, contextKey) {
  return Array.isArray(files)
    && files.length > 0
    && files.every((file) => file?.estimateContextKey === contextKey);
}