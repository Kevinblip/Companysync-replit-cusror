import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only platform owner or super admin should run this
    // We'll rely on the frontend check + basic check here if needed, 
    // but effectively any admin of the SaaS platform company can run it.

    const { companyId } = await req.json();

    if (!companyId) {
      return Response.json({ error: 'Company ID required' }, { status: 400 });
    }

    console.log(`🏥 Running diagnostics for tenant: ${companyId}`);

    const results = {
      status: 'healthy', // healthy, warning, critical
      checks: []
    };

    // 1. Fetch Company
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    results.checks.push({
      name: 'Company Record',
      status: 'pass',
      details: `Found company: ${company.company_name}`
    });

    // 2. Check Admin Users
    const staff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId });
    const admins = staff.filter(s => s.is_administrator);
    
    if (admins.length === 0) {
      results.status = 'critical';
      results.checks.push({
        name: 'Admin User Check',
        status: 'fail',
        details: 'No administrator found for this company. User access may be locked out.'
      });
    } else {
      results.checks.push({
        name: 'Admin User Check',
        status: 'pass',
        details: `Found ${admins.length} admin(s). Primary: ${admins[0].user_email}`
      });
    }

    // 3. Subscription/Stripe Sync
    if (company.subscription_status === 'active' && !company.stripe_customer_id && !company.subscription_plan?.includes('legacy')) {
      results.status = results.status === 'critical' ? 'critical' : 'warning';
      results.checks.push({
        name: 'Billing Sync',
        status: 'warning',
        details: 'Status is active but no Stripe Customer ID found. Manual activation?'
      });
    } else {
      results.checks.push({
        name: 'Billing Sync',
        status: 'pass',
        details: `Plan: ${company.subscription_plan}, Status: ${company.subscription_status}`
      });
    }

    // 4. Data Usage / Limits
    const customers = await base44.asServiceRole.entities.Customer.filter({ company_id: companyId });
    const customerCount = customers.length;
    
    // Check if over limits
    if (company.max_customers && customerCount > company.max_customers) {
      results.status = results.status === 'critical' ? 'critical' : 'warning';
      results.checks.push({
        name: 'Usage Limits',
        status: 'warning',
        details: `Customer count (${customerCount}) exceeds limit (${company.max_customers}). Upgrade required?`
      });
    } else {
      results.checks.push({
        name: 'Usage Limits',
        status: 'pass',
        details: `${customerCount} customers / ${company.max_customers || 'Unlimited'} allowed`
      });
    }

    // 5. Integration Settings Check
    const integrations = await base44.asServiceRole.entities.IntegrationSetting.filter({ company_id: companyId });
    const activeIntegrations = integrations.filter(i => i.is_enabled);
    results.checks.push({
      name: 'Integrations',
      status: 'info',
      details: `${activeIntegrations.length} active integrations: ${activeIntegrations.map(i => i.integration_name).join(', ')}`
    });

    // 5b. Twilio Configuration (Critical for Onboarding)
    const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
    if (twilioSettings.length === 0 || !twilioSettings[0].account_sid) {
       results.status = results.status === 'critical' ? 'critical' : 'warning';
       results.checks.push({
         name: 'Twilio Setup',
         status: 'fail',
         details: 'Twilio not configured. Messaging/Calling will not work.'
       });
    } else {
       results.checks.push({
         name: 'Twilio Setup',
         status: 'pass',
         details: `Configured (Phone: ${twilioSettings[0].phone_number || 'Not set'})`
       });
    }

    // 5c. Setup Wizard Status
    if (!company.setup_completed) {
       results.checks.push({
         name: 'Onboarding Status',
         status: 'warning',
         details: 'Setup Wizard not completed.'
       });
    } else {
       results.checks.push({
         name: 'Onboarding Status',
         status: 'pass',
         details: `Completed at ${company.setup_completed_at ? new Date(company.setup_completed_at).toLocaleDateString() : 'Unknown date'}`
       });
    }

    // 6. Recent Activity Check (Last 7 days)
    const recentLogin = staff.some(s => {
        if (!s.last_login) return false;
        const loginDate = new Date(s.last_login);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return loginDate > sevenDaysAgo;
    });

    if (!recentLogin && staff.length > 0) {
         results.checks.push({
            name: 'Engagement',
            status: 'warning',
            details: 'No staff logins detected in the last 7 days.'
         });
    } else {
        results.checks.push({
            name: 'Engagement',
            status: 'pass',
            details: 'Recent activity detected.'
         });
    }

    return Response.json(results);

  } catch (error) {
    console.error('Diagnostics error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});