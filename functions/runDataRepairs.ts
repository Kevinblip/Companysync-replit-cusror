import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1) Auth
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2) Determine primary company (owned first, else staff profile)
    let primaryCompany = null;
    try {
      const ownedCompanies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
      if (ownedCompanies && ownedCompanies.length > 0) {
        primaryCompany = ownedCompanies[0];
      } else {
        const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
        if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
          const companies = await base44.asServiceRole.entities.Company.filter({ id: staffProfiles[0].company_id });
          primaryCompany = companies[0] || null;
        }
      }
    } catch (_e) {
      // continue; we'll handle null
    }

    if (!primaryCompany) {
      return Response.json({
        success: false,
        message: 'No company found for your user. Please ensure your staff profile is linked to a company.'
      }, { status: 200 });
    }

    const companyId = primaryCompany.id;

    // 3) Run cleanup first (serial), then other fixes in parallel for speed
    const results = { companyId };

    // 3a) Cleanup orphaned/duplicate data (serial)
    try {
      const cleanupRes = await base44.functions.invoke('cleanupAllOrphanedData', {
        targetCompanyId: companyId,
        dryRun: false
      });
      results.cleanupAllOrphanedData = cleanupRes.data || cleanupRes;
    } catch (e) {
      results.cleanupAllOrphanedData = { error: e.message };
    }

    // 3b) Parallel fixes
    const parallelPromises = [
      // Fix payments missing company links
      base44.functions.invoke('fixPaymentCompanyIds', {}).then(r => ({ fixPaymentCompanyIds: r.data || r })).catch(e => ({ fixPaymentCompanyIds: { error: e.message } })),
      // Link estimates to customers
      base44.functions.invoke('linkAllEstimatesToCustomers', {}).then(r => ({ linkAllEstimatesToCustomers: r.data || r })).catch(e => ({ linkAllEstimatesToCustomers: { error: e.message } })),
      // Backfill invoice commissions (force)
      base44.functions.invoke('backfillInvoiceCommissions', { companyId: companyId, forceUpdate: true }).then(r => ({ backfillInvoiceCommissions: r.data || r })).catch(e => ({ backfillInvoiceCommissions: { error: e.message } })),
      // Optional: recalc AR balances if present
      base44.functions.invoke('backfillInvoiceAR', {}).then(r => ({ backfillInvoiceAR: r.data || r })).catch(() => ({ backfillInvoiceAR: null })),
    ];

    const parallelOutcomes = await Promise.all(parallelPromises);
    for (const out of parallelOutcomes) Object.assign(results, out);

    // 4) Quick diagnostics
    const diagnostics = {};

    // Lexi backend smoke test
    try {
      const lexiTest = await base44.functions.invoke('testLexiBackend', {});
      diagnostics.lexi = lexiTest.data || lexiTest;
    } catch (e) {
      diagnostics.lexi = { error: e.message };
    }

    // Estimator readiness checks (lightweight)
    try {
      const genMatExists = await base44.functions.invoke('generateMaterialList', { estimate: { line_items: [{ description: 'Sample', quantity: 1, unit: 'EA', rate: 1, amount: 1 }] } });
      diagnostics.estimator_generateMaterialList = genMatExists.status || 200;
    } catch (e) {
      diagnostics.estimator_generateMaterialList = { error: e.message };
    }

    // Twilio settings presence check
    try {
      const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
      diagnostics.twilioConfigured = !!(twilioSettings && twilioSettings[0] && twilioSettings[0].account_sid && twilioSettings[0].auth_token && twilioSettings[0].main_phone_number);
    } catch (_e) {
      diagnostics.twilioConfigured = false;
    }

    // Stripe note (IP allowlist)
    const stripeStatus = {
      note: 'Stripe API key rejects this environment IP (allowlist). Use dashboard → Stripe settings to permit the app IP or create a restricted key.',
      action_suggested: 'Update Stripe IP allowlist or use a restricted key for server-side calls.'
    };

    return Response.json({
      success: true,
      companyId,
      results,
      diagnostics,
      stripeStatus
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});