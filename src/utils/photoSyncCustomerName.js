// PhotoSync keeps a client_name snapshot for standalone jobs, but a linked
// customer is the source of truth for that person's current name.
export function photoSyncClientName(job, customer, companyId) {
  const snapshot = job?.client_name || '';
  if (!companyId || !job?.related_customer_id || !customer?.id ||
      job.related_customer_id !== customer.id ||
      job.company_id !== companyId || customer.company_id !== companyId) {
    return snapshot;
  }
  return customer.name?.trim() || snapshot;
}

export async function syncPhotoSyncClientNames(inspectionJobs, customer, companyId) {
  if (!companyId || !customer?.id || customer.company_id !== companyId || !customer.name?.trim()) {
    throw new Error('The customer and company must be verified before updating PhotoSync jobs.');
  }
  const jobs = await inspectionJobs.filter(
    { related_customer_id: customer.id, company_id: companyId },
    '-created_date',
    5000,
  );
  if (!Array.isArray(jobs) || jobs.length >= 5000) {
    throw new Error('Could not verify all linked PhotoSync jobs.');
  }
  let updated = 0;
  let failed = 0;
  for (const job of jobs) {
    if (job.related_customer_id !== customer.id || job.company_id !== companyId ||
        job.client_name === customer.name.trim()) continue;
    try {
      await inspectionJobs.update(job.id, { client_name: customer.name.trim() });
      updated++;
    } catch (_) {
      failed++;
    }
  }
  if (failed) throw new Error(`${failed} linked PhotoSync job${failed === 1 ? '' : 's'} could not be updated.`);
  return updated;
}