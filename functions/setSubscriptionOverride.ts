import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.platform_role !== 'super_admin') {
      return Response.json({ error: 'Unauthorized - SaaS admin only' }, { status: 403 });
    }

    const { company_id, entity_type, override_value, reason } = await req.json();

    if (!company_id || !entity_type || override_value === undefined) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const companies = await base44.entities.Company.filter({ id: company_id });
    if (!companies || companies.length === 0) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    const company = companies[0];
    const overrides = company.subscription_overrides || {};

    // Update override for the entity type
    overrides[entity_type] = {
      value: override_value,
      reason: reason || 'Manual override by SaaS admin',
      set_at: new Date().toISOString(),
      set_by: user.email
    };

    // Update company with new overrides
    await base44.entities.Company.update(company_id, {
      subscription_overrides: overrides
    });

    return Response.json({
      success: true,
      company_id,
      entity_type,
      override_value,
      message: `Override set: ${entity_type} max = ${override_value}`
    });
  } catch (error) {
    console.error('Override error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});