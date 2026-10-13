import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

/**
 * One-time backfill: for every InspectionJob in the caller's company that
 * is missing related_customer_id, find a Customer whose normalized name
 * matches the job's client_name. Only set the link when EXACTLY one
 * Customer matches — ambiguous matches (multiple customers with the same
 * name) are skipped so we never silently mis-associate an inspection with
 * the wrong customer.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Resolve caller's company strictly from server-side records — never trust
    // a client-supplied header here, since this function performs service-role
    // writes and must not be coerced into touching another company's data.
    let companyId: string | null = null;
    const owned = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
    if (owned && owned.length > 0) {
      companyId = owned[0].id;
    } else {
      const profiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      if (profiles && profiles.length > 0) companyId = profiles[0].company_id;
    }

    if (!companyId) {
      return Response.json({ error: 'No company found for this user' }, { status: 404 });
    }

    const norm = (s: string | null | undefined) =>
      (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

    // Page through every record so companies with very large inspection or
    // customer histories are still fully covered (no silent 10k cap).
    const PAGE = 1000;
    const fetchAll = async (entity: any) => {
      const out: any[] = [];
      for (let page = 0; page < 1000; page++) {
        const batch = await entity.filter(
          { company_id: companyId },
          '-created_date',
          PAGE,
          page * PAGE,
        );
        if (!batch || batch.length === 0) break;
        out.push(...batch);
        if (batch.length < PAGE) break;
      }
      return out;
    };
    const [jobs, customers] = await Promise.all([
      fetchAll(base44.asServiceRole.entities.InspectionJob),
      fetchAll(base44.asServiceRole.entities.Customer),
    ]);

    // Build name -> customer[] map so we can detect ambiguous matches.
    const customersByName = new Map<string, any[]>();
    for (const customer of customers || []) {
      const k = norm(customer.name);
      if (!k) continue;
      if (!customersByName.has(k)) customersByName.set(k, []);
      customersByName.get(k)!.push(customer);
    }

    const unlinked = (jobs || []).filter((j: any) => !j.related_customer_id && j.client_name);

    let updated = 0;
    let ambiguous = 0;
    let unmatched = 0;
    let failed = 0;

    for (const job of unlinked) {
      const k = norm(job.client_name);
      const candidates = customersByName.get(k) || [];
      if (candidates.length === 0) { unmatched++; continue; }
      if (candidates.length > 1) { ambiguous++; continue; }
      try {
        await base44.asServiceRole.entities.InspectionJob.update(job.id, {
          related_customer_id: candidates[0].id,
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
      unlinkedBefore: unlinked.length,
      updated,
      ambiguous,
      unmatched,
      failed,
    });
  } catch (error) {
    console.error('Backfill error:', error);
    return Response.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
});
