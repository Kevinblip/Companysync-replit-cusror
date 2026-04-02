import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req, { skipAuth: true });
    
    const { id } = await req.json();
    if (!id) {
      return Response.json({ error: 'Missing id' }, { status: 400 });
    }

    // Use service role to fetch estimate bypassing RLS
    const estimates = await base44.asServiceRole.entities.Estimate.filter({ id });
    const estimate = estimates[0];

    if (!estimate) {
      return Response.json({ error: 'Estimate not found' }, { status: 404 });
    }

    // Also fetch company details for branding
    let company = null;
    if (estimate.company_id) {
        const companies = await base44.asServiceRole.entities.Company.filter({ id: estimate.company_id });
        company = companies[0];
    }

    return Response.json({
      estimate: estimate,
      company: company
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});