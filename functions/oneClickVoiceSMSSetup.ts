import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function toBasicAuth(user, pass) {
  return 'Basic ' + btoa(`${user}:${pass}`);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {}

    const companyId = body.company_id || body.companyId || null;
    if (!companyId) {
      return Response.json({ error: 'company_id is required' }, { status: 400 });
    }

    // Load Twilio settings for this company
    const twilioRows = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id: companyId });
    const twilio = twilioRows[0];
    if (!twilio) {
      return Response.json({ error: 'No TwilioSettings found for company' }, { status: 404 });
    }

    const accountSid = twilio.account_sid;
    const authToken = twilio.auth_token;
    const phoneNumber = twilio.main_phone_number;

    if (!accountSid || !authToken || !phoneNumber) {
      return Response.json({ error: 'TwilioSettings missing account_sid, auth_token, or main_phone_number' }, { status: 400 });
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
    const smsWebhookUrl = `${appUrl}/api/functions/incomingSMS`;
    const voiceWebhookUrl = twilio.use_thoughtly_ai ? `${appUrl}/api/functions/thoughtlyIncomingCall` : `${appUrl}/api/functions/incomingCall`;

    // 1) Configure Twilio webhooks for the main Twilio number
    const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`;
    const searchResp = await fetch(searchUrl, { headers: { Authorization: toBasicAuth(accountSid, authToken) } });
    if (!searchResp.ok) {
      const text = await searchResp.text().catch(() => '');
      return Response.json({ error: 'Failed to query Twilio numbers', status: searchResp.status, details: text }, { status: 502 });
    }
    const searchJson = await searchResp.json();
    if (!searchJson?.incoming_phone_numbers?.length) {
      return Response.json({ error: 'Twilio phone number not found', phoneNumber }, { status: 404 });
    }
    const phoneSid = searchJson.incoming_phone_numbers[0].sid;

    const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`;
    const form = new URLSearchParams();
    form.append('SmsUrl', smsWebhookUrl);
    form.append('SmsMethod', 'POST');
    form.append('VoiceUrl', voiceWebhookUrl);
    form.append('VoiceMethod', 'POST');

    const updateResp = await fetch(updateUrl, {
      method: 'POST',
      headers: {
        Authorization: toBasicAuth(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const updateJson = await updateResp.json().catch(() => ({}));
    if (!updateResp.ok) {
      return Response.json({ error: 'Failed to update Twilio webhooks', details: updateJson }, { status: 502 });
    }

    // 2) Configure Thoughtly webhook (if agent is set)
    let thoughtlyConfigured = null;
    if (twilio.thoughtly_agent_id) {
      try {
        const res = await base44.asServiceRole.functions.invoke('configureThoughtlyWebhook', {
          agent_id: twilio.thoughtly_agent_id,
        });
        thoughtlyConfigured = res.data || res;
      } catch (e) {
        thoughtlyConfigured = { success: false, error: e?.message || 'Failed to configure Thoughtly webhook' };
      }
    }

    return Response.json({
      success: true,
      company_id: companyId,
      twilio: {
        phone_number: phoneNumber,
        sms_webhook: smsWebhookUrl,
        voice_webhook: voiceWebhookUrl,
        update_result: updateJson,
      },
      thoughtly: twilio.thoughtly_agent_id
        ? { agent_id: twilio.thoughtly_agent_id, result: thoughtlyConfigured }
        : { message: 'No thoughtly_agent_id on TwilioSettings; skipped Thoughtly webhook' },
      next_steps: [
        'Text your Twilio number and verify an SMS log appears in Communication',
        'Call your Twilio number and verify it forwards to Thoughtly (if enabled) and logs the call',
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});