import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get credentials from request or database
        const body = await req.json();
        const companyId = body.companyId;
        let accountSid = body.accountSid;
        let authToken = body.authToken;
        let phoneNumber = body.phoneNumber;

        if (!companyId) {
            return Response.json({ error: 'companyId is required' }, { status: 400 });
        }

        const memberships = await base44.asServiceRole.entities.StaffProfile.filter({
            company_id: companyId,
            user_email: user.email
        });
        if (!memberships.some(profile => profile.is_active !== false)) {
            return Response.json({ error: 'Not authorized for this company' }, { status: 403 });
        }

        const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        const company = companies[0];
        const protectedName = String(company?.company_name || '').toLowerCase();
        if (!company) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }
        if (
            companyId === 'companysync_master_001' ||
            protectedName.includes('yicn') ||
            protectedName.includes('insurance claims network')
        ) {
            return Response.json({ error: 'Twilio settings for this protected company cannot be changed here' }, { status: 403 });
        }

        const duplicateSidRows = await base44.asServiceRole.entities.TwilioSettings.filter({
            account_sid: accountSid
        });
        if (duplicateSidRows.some(row => row.company_id && row.company_id !== companyId)) {
            return Response.json({ error: 'This Twilio Account SID is already assigned to another company' }, { status: 409 });
        }

        // Get the correct app URL from environment
        let appUrl = Deno.env.get('APP_URL') || 'https://getcompanysync.com';
        // Remove trailing slash if present to avoid double slash
        if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);
        
        const smsWebhookUrl = `${appUrl}/api/functions/incomingSMS`;
        const voiceWebhookUrl = `${appUrl}/api/functions/incomingCall`;
        
        console.log('✅ SMS Webhook:', smsWebhookUrl);
        console.log('✅ Voice Webhook:', voiceWebhookUrl);

        if (!accountSid || !authToken || !phoneNumber) {
            return Response.json({ 
                error: 'Twilio credentials incomplete',
                smsUrl: smsWebhookUrl,
                voiceUrl: voiceWebhookUrl
            }, { status: 400 });
        }

        // Update Twilio phone number via API
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json`;
        
        // First, find the phone number SID
        const searchResponse = await fetch(`${twilioUrl}?PhoneNumber=${encodeURIComponent(phoneNumber)}`, {
            headers: {
                'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`)
            }
        });

        const searchData = await searchResponse.json();
        
        if (!searchData.incoming_phone_numbers || searchData.incoming_phone_numbers.length === 0) {
            return Response.json({ 
                error: 'Phone number not found in Twilio',
                smsUrl: smsWebhookUrl,
                voiceUrl: voiceWebhookUrl
            }, { status: 404 });
        }

        const phoneSid = searchData.incoming_phone_numbers[0].sid;

        // Update the webhook
        const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`;
        
        const formData = new URLSearchParams();
        formData.append('SmsUrl', smsWebhookUrl);
        formData.append('SmsMethod', 'POST');
        formData.append('VoiceUrl', voiceWebhookUrl);
        formData.append('VoiceMethod', 'POST');

        const updateResponse = await fetch(updateUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString()
        });

        const updateData = await updateResponse.json();

        if (!updateResponse.ok) {
            return Response.json({ 
                error: 'Failed to update Twilio webhook',
                details: updateData,
                smsUrl: smsWebhookUrl,
                voiceUrl: voiceWebhookUrl
            }, { status: 500 });
        }

        return Response.json({ 
            success: true,
            message: '✅ Twilio webhooks configured successfully!',
            phoneNumber: phoneNumber,
            smsWebhookUrl: smsWebhookUrl,
            voiceWebhookUrl: voiceWebhookUrl,
            twilioResponse: updateData
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});