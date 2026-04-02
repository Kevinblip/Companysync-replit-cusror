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
        let accountSid = body.accountSid;
        let authToken = body.authToken;
        let phoneNumber = body.phoneNumber;

        // Fallback to saved settings or Environment Variables
        if (!accountSid || !authToken) {
            // Try Env Vars first (Secrets)
            accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
            authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
            phoneNumber = body.phoneNumber || Deno.env.get('TWILIO_PHONE_NUMBER');

            // If not in Env, try DB
            if (!accountSid || !authToken) {
                const twilioSettings = await base44.entities.TwilioSettings.list();
                if (twilioSettings.length > 0) {
                    const settings = twilioSettings[0];
                    accountSid = accountSid || settings.account_sid;
                    authToken = authToken || settings.auth_token;
                    phoneNumber = phoneNumber || settings.main_phone_number;
                }
            }
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
                correctUrl: correctWebhookUrl 
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
                correctUrl: correctWebhookUrl 
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