import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * One-time backfill: for every InspectionJob in the caller's company that
 * has a `last_notified_at` timestamp but no `notification_count`, set
 * `notification_count = 1` to establish a baseline.
 *
 * ## Runbook
 * - **Who can trigger**: company owners only (the account whose email matches
 *   Company.created_by). Staff members without ownership receive a 403.
 * - **Scope**: tenant-scoped — operates only on the authenticated caller's
 *   company. Each company owner should trigger this once for their own data.
 * - **Idempotency**: safe to re-run. Jobs that already have any
 *   `notification_count` value (including 0) are never overwritten.
 * - **Expected response fields**: `totalJobs`, `eligibleForBackfill`,
 *   `updated`, `failed`, `skipped`.
 * - **Success signal**: `updated` equals `eligibleForBackfill` and `failed`
 *   is 0. A non-zero `failed` count means some jobs should be re-run after
 *   investigating the logged errors for those job IDs.
 */

interface InspectionJobPartial {
  id: string;
  company_id: string;
  last_notified_at?: string | null;
  notification_count?: number | null;
}

interface Company {
  id: string;
  created_by: string;
}

interface StaffProfile {
  company_id: string;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve the caller's company server-side — never trust a client-supplied
    // header since this function performs service-role writes.
    const owned: Company[] = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });

    // Restrict to company owners only. Staff members who are not the account
    // owner cannot trigger a bulk write across all of the company's jobs.
    if (!owned || owned.length === 0) {
      return Response.json(
        { error: 'Forbidden: only the company owner can run this backfill' },
        { status: 403 },
      );
    }

    const companyId = owned[0].id;

    // Page through every record so companies with very large inspection
    // histories are still fully covered (no silent API cap).
    const PAGE = 1000;
    const jobs: InspectionJobPartial[] = [];
    for (let page = 0; page < 1000; page++) {
      const batch: InspectionJobPartial[] = await base44.asServiceRole.entities.InspectionJob.filter(
        { company_id: companyId },
        '-created_date',
        PAGE,
        page * PAGE,
      );
      if (!batch || batch.length === 0) break;
      jobs.push(...batch);
      if (batch.length < PAGE) break;
    }

    // Only touch jobs that were notified at least once but have no count
    // recorded. Jobs with notification_count already set (any value including
    // 0) are skipped so the function is safe to re-run.
    const needsBackfill = jobs.filter(
      (j) => j.last_notified_at && (j.notification_count === null || j.notification_count === undefined),
    );

    let updated = 0;
    let failed = 0;

    for (const job of needsBackfill) {
      try {
        await base44.asServiceRole.entities.InspectionJob.update(job.id, {
          notification_count: 1,
        });
        updated++;
      } catch (e) {
        console.error('Failed to update job', job.id, (e as Error).message);
        failed++;
      }
    }

    return Response.json({
      success: true,
      companyId,
      totalJobs: jobs.length,
      eligibleForBackfill: needsBackfill.length,
      updated,
      failed,
      skipped: jobs.length - needsBackfill.length,
    });
  } catch (error) {
    console.error('Backfill error:', error);
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
});
