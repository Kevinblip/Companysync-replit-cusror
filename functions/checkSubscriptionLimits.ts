import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { company_id, entity_type } = await req.json();

    if (!company_id || !entity_type) {
      return Response.json({ error: 'Missing company_id or entity_type' }, { status: 400 });
    }

    // Subscription plan limits - MUST match Pricing page plans exactly
    const planLimits = {
      // Actual plans from Pricing page
      basic:      { max_users: 5,  max_customers: 100,    max_leads: 250 },
      business:   { max_users: 10, max_customers: 1000,   max_leads: 999999 },
      enterprise: { max_users: 25, max_customers: 999999, max_leads: 999999 },
      // Trial gets Basic-level limits
      trial:      { max_users: 5,  max_customers: 100,    max_leads: 250 },
      // Legacy aliases (kept for backwards compatibility)
      freelance:  { max_users: 5,  max_customers: 100,    max_leads: 250 },
      starter:    { max_users: 5,  max_customers: 100,    max_leads: 250 },
      professional: { max_users: 10, max_customers: 1000, max_leads: 999999 },
      legacy:     { max_users: 999999, max_customers: 999999, max_leads: 999999 },
      lifetime:   { max_users: 999999, max_customers: 999999, max_leads: 999999 },
      unlimited:  { max_users: 999999, max_customers: 999999, max_leads: 999999 }
    };

    // Get company
    const companies = await base44.entities.Company.filter({ id: company_id });
    if (!companies || companies.length === 0) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    const company = companies[0];
    const plan = (company.subscription_plan || 'trial').toLowerCase();
    const limits = planLimits[plan] || planLimits['trial'];

    // Check for manual overrides from SaaS admin
    const overrides = company.subscription_overrides || {};

    // Handle "all" entity_type - return summary of all limits
    if (entity_type === 'all') {
      const [staffProfiles, customers, leads] = await Promise.all([
        base44.entities.StaffProfile.filter({ company_id }),
        base44.entities.Customer.filter({ company_id }),
        base44.entities.Lead.filter({ company_id })
      ]);

      // Also fetch subscription usage for AI/SMS/Call tracking
      let usageRecords = [];
      try {
        usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id });
      } catch (e) {
        console.error('Failed to fetch SubscriptionUsage:', e);
      }
      const usage = usageRecords[0];

      const staffOverride = overrides['staff']?.value;
      const customerOverride = overrides['customers']?.value;
      const leadOverride = overrides['leads']?.value;

      return Response.json({
        success: true,
        plan,
        // Staff
        users_current: staffProfiles.length,
        users_limit: staffOverride || limits.max_users,
        users_override: staffOverride || null,
        // Customers
        customers_current: customers.length,
        customers_limit: customerOverride || limits.max_customers,
        customers_override: customerOverride || null,
        // Leads
        leads_current: leads.length,
        leads_limit: leadOverride || limits.max_leads,
        leads_override: leadOverride || null,
        // Usage (AI/SMS/Calls) - from SubscriptionUsage entity
        ai_used: usage?.ai_used || 0,
        ai_limit: usage?.ai_limit || 0,
        sms_used: usage?.sms_used || 0,
        sms_limit: usage?.sms_limit || 0,
        call_minutes_used: usage?.call_minutes_used || 0,
        call_minutes_limit: usage?.call_minutes_limit || 0,
      });
    }

    let currentCount = 0;
    let limitKey = '';

    if (entity_type === 'staff') {
      const staffProfiles = await base44.entities.StaffProfile.filter({ company_id });
      currentCount = staffProfiles.length;
      limitKey = 'max_users';
    } else if (entity_type === 'customer') {
      const customers = await base44.entities.Customer.filter({ company_id });
      currentCount = customers.length;
      limitKey = 'max_customers';
    } else if (entity_type === 'lead') {
      const leads = await base44.entities.Lead.filter({ company_id });
      currentCount = leads.length;
      limitKey = 'max_leads';
    } else {
      return Response.json({ error: 'Invalid entity_type' }, { status: 400 });
    }

    const override = overrides[entity_type];
    let effectiveLimit = limits[limitKey];
    let hasOverride = false;

    if (override && override.value) {
      effectiveLimit = override.value;
      hasOverride = true;
    }

    const remaining = Math.max(0, effectiveLimit - currentCount);
    const isAtLimit = currentCount >= effectiveLimit;

    return Response.json({
      success: true,
      entity_type,
      plan,
      current_count: currentCount,
      limit: effectiveLimit,
      remaining,
      is_at_limit: isAtLimit,
      can_create: !isAtLimit,
      has_override: hasOverride,
      override_reason: override?.reason || null
    });
  } catch (error) {
    console.error('Subscription limit check error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});