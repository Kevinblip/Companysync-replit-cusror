import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { id, approved } = await req.json();
    if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

    const arr = await base44.entities.ReviewRequest.filter({ id });
    const rr = arr[0];
    if (!rr) return Response.json({ error: 'ReviewRequest not found' }, { status: 404 });

    // Optional: enforce only assigned rep or admin can approve
    let canApprove = true;
    const staff = await base44.entities.StaffProfile.filter({ user_email: user.email });
    const rrCompanyId = rr.company_id;
    let isOwnerOfTargetCompany = false;
    if (rrCompanyId) {
      const targetCompanies = await base44.entities.Company.filter({ id: rrCompanyId });
      isOwnerOfTargetCompany = targetCompanies?.[0]?.created_by === user.email;
    }
    if (!isOwnerOfTargetCompany && !staff[0]?.is_super_admin && rr.sale_agent_email && rr.sale_agent_email !== user.email) {
      canApprove = false;
    }
    if (!canApprove) return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (approved) {
      const now = new Date().toISOString();
      await base44.entities.ReviewRequest.update(rr.id, {
        status: 'approved',
        next_send_at: now
      });
    } else {
      await base44.entities.ReviewRequest.update(rr.id, { status: 'declined' });
    }

    return Response.json({ status: 'ok' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});