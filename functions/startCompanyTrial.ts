import { createClient } from 'npm:@base44/sdk@0.8.6';
import { isSyntheticSignupEmail } from './signupSafety.ts';
import { sendEmail } from './_sendEmail.ts';

/** Deployed counterpart of the local trial transition.  The event id is the
 * durable claim: only the caller that creates it is allowed to alert staff. */
Deno.serve(async (req) => {
  try {
    const { companyId, plan: requestedPlan, internalSecret } = await req.json();
    if (!companyId) return Response.json({ success: false, error: 'Company is required' }, { status: 400 });
    const appId = Deno.env.get('BASE44_APP_ID');
    const serviceKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    if (!appId || !serviceKey) throw new Error('Signup service configuration is missing');
    if (internalSecret !== serviceKey) return Response.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    const base44 = createClient(appId, serviceKey).asServiceRole;
    const companies = await base44.entities.Company.filter({ id: companyId });
    const company = companies[0];
    if (!company) return Response.json({ success: false, error: 'Company not found' }, { status: 404 });
    const owner = (await base44.entities.StaffProfile.filter({ company_id: companyId }))
      .find((staff) => staff.is_active !== false && (staff.is_administrator || staff.role === 'admin'));
    if (!owner?.user_email && !owner?.email) return Response.json({ success: false, error: 'Owner profile is required' }, { status: 400 });
    const email = String(owner.user_email || owner.email).toLowerCase();
    const plan = ['basic', 'business', 'enterprise', 'professional', 'starter'].includes(String(requestedPlan).toLowerCase())
      ? String(requestedPlan).toLowerCase() : 'basic';
    const trialEnds = new Date(Date.now() + 14 * 86400000).toISOString();
    await base44.entities.Company.update(companyId, {
      subscription_status: 'trial', subscription_plan: plan,
      trial_ends_at: trialEnds, trial_end_date: trialEnds,
    });

    // Reserved fixture domains intentionally produce neither events nor mail.
    if (Deno.env.get('REPLIT_DEPLOYMENT') === '1' && !isSyntheticSignupEmail(email)) {
      let claimed = false;
      try {
        await base44.entities.TrialSignupEvent.create({
          id: `trial_signup_${companyId}`, company_id: companyId, owner_email: email, plan,
          event_type: 'trial_started', created_at: new Date().toISOString(),
        });
        claimed = true;
      } catch (error) {
        // A duplicate id means another retry already owns delivery.
        if (!String(error?.message || '').toLowerCase().includes('duplicate')) throw error;
      }
      if (claimed) {
        const admins = await base44.users.list();
        const adminEmail = Deno.env.get('ADMIN_EMAIL') || admins.find((user) => user.is_super_admin)?.email;
        if (adminEmail) {
          await sendEmail({
            to: [adminEmail],
            subject: `New Trial Started: ${company.company_name || company.name}`,
            html: `<p><strong>${company.company_name || company.name}</strong> started a ${plan} trial.</p><p>${email}</p>`,
          });
        }
        const adminPhone = Deno.env.get('ADMIN_PHONE');
        const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
        const auth = Deno.env.get('TWILIO_AUTH_TOKEN');
        const from = Deno.env.get('TWILIO_PHONE_NUMBER');
        if (adminPhone && sid && auth && from) {
          const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${sid}:${auth}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              To: adminPhone, From: from,
              Body: `New trial: ${company.company_name || company.name} (${plan}) — ${email}`,
            }),
          });
          if (!response.ok) console.error('[startCompanyTrial] admin SMS failed:', await response.text());
        }
      }
    }
    return Response.json({ success: true, company_id: companyId, plan });
  } catch (error) {
    console.error('[startCompanyTrial] failed:', error);
    return Response.json({ success: false, error: error.message || 'Unable to start the free trial' }, { status: 500 });
  }
});