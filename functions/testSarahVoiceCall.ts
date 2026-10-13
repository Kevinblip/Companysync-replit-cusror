import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import twilio from 'npm:twilio@5.10.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { phone_number, company_id } = await req.json();
    if (!phone_number) {
      return Response.json({ error: 'phone_number required' }, { status: 400 });
    }

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const appUrl = Deno.env.get('APP_URL');

    if (!accountSid || !authToken || !appUrl) {
      return Response.json({ error: 'Twilio credentials not configured' }, { status: 500 });
    }

    // Find company to get correct Twilio number
    let fromPhone = Deno.env.get('TWILIO_PHONE_NUMBER');
    let companyName = 'CompanySync';
    let resolvedCompanyId = company_id;

    // Try to find company from staff profile if not provided
    if (!resolvedCompanyId) {
      const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      if (staffProfiles.length > 0) {
        resolvedCompanyId = staffProfiles[0].company_id;
      }
    }

    if (resolvedCompanyId) {
      // Get company details
      const companies = await base44.asServiceRole.entities.Company.filter({ id: resolvedCompanyId });
      if (companies.length > 0) {
        companyName = companies[0].company_name || 'CompanySync';
      }

      // Get Twilio settings for this company
      const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: resolvedCompanyId });
      if (twilioSettings.length > 0 && twilioSettings[0].main_phone_number) {
        fromPhone = twilioSettings[0].main_phone_number;
      }
    }

    if (!fromPhone) {
      return Response.json({ error: 'No Twilio phone number configured' }, { status: 500 });
    }

    console.log(`📞 Initiating test call to ${phone_number} from ${fromPhone} for company ${companyName}`);

    const client = twilio(accountSid, authToken);

    // Pass company ID and name to the voice handler
    // CRITICAL: Use the BASE44_APP_ID env var to build proper URL, not APP_URL which may be wrong
    const appId = Deno.env.get('BASE44_APP_ID');
    const baseUrl = appUrl.replace(/\/$/, '');
    const callbackUrl = `${baseUrl}/api/functions/sarahVoiceCallHandler?companyId=${resolvedCompanyId || 'default'}&companyName=${encodeURIComponent(companyName)}`;

    const call = await client.calls.create({
      to: phone_number,
      from: fromPhone,
      url: callbackUrl
    });

    return Response.json({ 
      success: true, 
      call_sid: call.sid,
      from_number: fromPhone,
      company_name: companyName,
      message: 'Call initiated with Sarah voice'
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});