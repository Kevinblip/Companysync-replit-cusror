import { createClient } from 'npm:@base44/sdk@0.8.6';
import { validateSignupEmail } from './signupSafety.ts';

/**
 * Public first step of signup. It creates a pending company and owner
 * profile, then invites the owner to finish account creation. Trial fields
 * are set server-side and never come from the browser as billing data.
 */
Deno.serve(async (req) => {
  try {
    const { email, full_name, selected_plan, onboarding_data } = await req.json();
    
    const emailCheck = validateSignupEmail(email);
    const emailLower = emailCheck.email;
    if (!emailCheck.allowed) {
      return Response.json({ error: emailCheck.reason }, { status: 400 });
    }

    const allowedPlans = new Set(['basic', 'business', 'enterprise', 'professional', 'starter']);
    const planInput = typeof selected_plan === 'object' ? selected_plan?.name : selected_plan;
    const normalizedPlan = String(planInput || 'basic').toLowerCase();
    const plan = allowedPlans.has(normalizedPlan) ? normalizedPlan : 'basic';
    const source = onboarding_data && typeof onboarding_data === 'object' ? onboarding_data : {};
    const companyName = String(source.company_name || `${full_name || 'New'}'s Company`).trim().slice(0, 200);
    const fullName = String(full_name || '').trim().slice(0, 160);
    if (!fullName) return Response.json({ error: 'Your full name is required' }, { status: 400 });
    let timezone = String(source.timezone || '').trim();
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    } catch {
      timezone = 'America/New_York';
    }
    if (!timezone) timezone = 'America/New_York';

    console.log('📧 Public signup request for:', emailLower);

    const appId = Deno.env.get('BASE44_APP_ID');
    const serviceKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    
    if (!appId || !serviceKey) {
      console.error('❌ Missing signup service configuration');
      return Response.json({ 
        success: false, 
        error: 'Server configuration error' 
      }, { status: 500 });
    }

    const base44 = createClient(appId, serviceKey);
    const existingUsers = await base44.asServiceRole.users.list();
    if (existingUsers.some(user => String(user.email || '').toLowerCase() === emailLower)) {
      return Response.json({ success: false, error: 'already_exists', email: emailLower });
    }
    const existingStaff = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: emailLower });
    if (existingStaff.length > 0) {
      return Response.json({ success: false, error: 'already_exists', email: emailLower });
    }

    const company = await base44.asServiceRole.entities.Company.create({
      company_name: companyName,
      name: companyName,
      email: emailLower,
      created_by: emailLower,
      phone: String(source.phone || '').trim(),
      address: String(source.address || '').trim(),
      city: String(source.city || '').trim(),
      state: String(source.state || '').trim(),
      zip: String(source.zip || '').trim(),
      industry: String(source.industry || 'roofing').trim(),
      timezone,
      settings: { time_zone: timezone },
      subscription_plan: plan,
      subscription_status: 'pending',
      trial_end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      setup_completed: false,
      onboarding_completed: false,
      data: { onboarding_data: { ...source, timezone, full_name: fullName, email: emailLower, selected_plan: plan }, signup_source: 'public_onboarding' }
    });
    await base44.asServiceRole.entities.StaffProfile.create({
      company_id: company.id,
      name: fullName,
      full_name: fullName,
      email: emailLower,
      user_email: emailLower,
      role: 'admin',
      position: 'Owner',
      is_administrator: true,
      is_super_admin: true,
      is_active: true
    });

    const trialStartResult = await base44.asServiceRole.functions.invoke('startCompanyTrial', {
      companyId: company.id,
      plan,
      internalSecret: serviceKey,
    });
    const trialStart = trialStartResult?.data || trialStartResult;
    if (!trialStart?.success) {
      throw new Error(trialStart?.error || 'Unable to start the free trial');
    }

    const appUrl = (Deno.env.get('APP_URL') || 'https://getcompanysync.com').replace(/\/+$/, '');
    try {
      // Base44's service-role SDK does not expose inviteUser consistently, so
      // use its documented invite endpoint with the server-held service key.
      const inviteResponse = await fetch(`https://api.base44.com/v1/apps/${appId}/users/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
          'X-App-Id': appId
        },
        body: JSON.stringify({
          email: emailLower,
          role: 'admin',
          redirectUrl: `${appUrl}/QuickSetup?plan=${encodeURIComponent(plan)}&new_signup=true`
        })
      });
      const inviteResult = await inviteResponse.json().catch(() => ({}));
      if (!inviteResponse.ok && !inviteResult.success) {
        throw new Error(inviteResult.error || inviteResult.message || 'Invitation failed');
      }
    } catch (inviteErr) {
      console.error('❌ Invite error:', inviteErr.message);
      return Response.json({ success: false, error: 'Unable to send the account invitation. Please try again.' }, { status: 502 });
    }

    return Response.json({
      success: true,
      action: 'complete_signup',
      company_id: company.id,
      plan,
      redirect: `/QuickSetup?plan=${encodeURIComponent(plan)}&new_signup=true`,
      email: emailLower
    });
  } catch (error) {
    console.error('❌ Public signup error:', error);
    return Response.json({ 
      error: error.message || 'Signup failed. Please try again.' 
    }, { status: 500 });
  }
});