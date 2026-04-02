import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Check if action param says to update
        let body = {};
        try { body = await req.json(); } catch (_) {}
        const action = body.action; // 'test' to point to test webhook, 'fix' to restore
        
        const settings = await base44.asServiceRole.entities.TwilioSettings.list();
        const targetNumber = '+12167777154';
        
        const setting = settings.find(s => 
            s.main_phone_number === targetNumber || 
            s.thoughtly_phone === targetNumber ||
            s.available_numbers?.some(n => n.phone_number === targetNumber)
        );

        if (!setting) {
            return Response.json({ error: "Settings not found locally" });
        }

        const accountSid = setting.account_sid;
        const authToken = setting.auth_token;
        const appUrl = (Deno.env.get('APP_URL') || 'https://getcompanysync.com').replace(/\/+$/, '');

        const query = new URLSearchParams({ PhoneNumber: targetNumber });
        const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?${query}`;
        
        const listResp = await fetch(listUrl, {
            headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) }
        });
        
        const listData = await listResp.json();
        
        if (!listData.incoming_phone_numbers || listData.incoming_phone_numbers.length === 0) {
            return Response.json({ error: "Number not found in Twilio" });
        }
        
        const phoneData = listData.incoming_phone_numbers[0];
        const phoneSid = phoneData.sid;
        
        // If action is 'fix', update the webhook
        if (action === 'fix') {
            const voiceUrl = `${appUrl}/api/functions/incomingCall`;
            const smsUrl = `${appUrl}/api/functions/incomingSMS`;
            
            const formParams = new URLSearchParams();
            formParams.append('VoiceUrl', voiceUrl);
            formParams.append('VoiceMethod', 'POST');
            formParams.append('SmsUrl', smsUrl);
            formParams.append('SmsMethod', 'POST');
            formParams.append('StatusCallback', ''); // Clear the bad status callback
            
            const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`;
            const updateResp = await fetch(updateUrl, {
                method: 'POST',
                headers: {
                    'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: formParams.toString()
            });
            
            const updateData = await updateResp.json();
            
            return Response.json({
                action: 'fix',
                success: updateResp.ok,
                new_voice_url: updateData.voice_url,
                new_sms_url: updateData.sms_url,
                new_status_callback: updateData.status_callback
            });
        }
        
        return Response.json({
            phone_number: phoneData.phone_number,
            phone_sid: phoneSid,
            voice_url: phoneData.voice_url,
            voice_method: phoneData.voice_method,
            voice_fallback_url: phoneData.voice_fallback_url,
            status_callback: phoneData.status_callback,
            sms_url: phoneData.sms_url,
            friendly_name: phoneData.friendly_name,
            expected_base_url: appUrl
        });

    } catch (e) {
        return Response.json({ error: e.message });
    }
});