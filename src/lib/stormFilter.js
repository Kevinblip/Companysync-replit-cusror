// Storm Mode chip predicate. Pulled out of `src/pages/Leads.jsx` so it can be
// covered by automated tests independently of the very large Leads page.
//
// Filter keys must stay in sync with the chip definitions in Leads.jsx.

export const STORM_FILTER_KEYS = [
  'all',
  'not_inspected',
  'scheduled_today',
  'inspected_no_estimate',
  'sold',
];

export function matchesStormFilter(lead, job, filterKey, today = new Date()) {
  if (filterKey === 'all') return true;

  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  switch (filterKey) {
    case 'not_inspected':
      return !job;
    case 'scheduled_today': {
      // Only count jobs that are actually scheduled (or assigned/in-progress)
      // and explicitly scheduled for today. Completed jobs whose
      // inspection_date happens to be today should NOT show here.
      if (!job) return false;
      const scheduledStatuses = new Set(['scheduled', 'assigned', 'in_progress', 'draft']);
      if (job.status && !scheduledStatuses.has(job.status)) return false;
      if (!job.scheduled_date) return false;
      const d = new Date(job.scheduled_date);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === startOfToday.getTime();
    }
    case 'inspected_no_estimate':
      return !!job && job.status === 'completed' && (lead.value == null || Number(lead.value) === 0);
    case 'sold':
      return lead.status === 'won';
    default:
      return true;
  }
}
