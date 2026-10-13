import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role to get ALL active companies (bypass RLS)
    const companies = await base44.asServiceRole.entities.Company.filter({ is_deleted: { $ne: true } }, '-created_date', 10000);

    return Response.json({
      success: true,
      companies: companies
    });

  } catch (error) {
    console.error('❌ Get all companies error:', error);
    return Response.json({
      error: error.message || 'Failed to fetch companies',
      details: error.toString()
    }, { status: 500 });
  }
});