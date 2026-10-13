import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
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
        const appUrl = (Deno.env.get('APP_URL') || 'https://getcompanysync.com').replace(/\/$/, '');
        const incomingUrl = `${appUrl}/api/functions/incomingCall`;

        console.log(`Reverting ${targetNumber} to ${incomingUrl}`);

        // 1. Get Number SID
        const query = new URLSearchParams({ PhoneNumber: targetNumber });
        const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?${query}`;
        
        const listResp = await fetch(listUrl, {
            headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) }
        });
        
        const listData = await listResp.json();
        if (!listData.incoming_phone_numbers || listData.incoming_phone_numbers.length === 0) {
            return Response.json({ error: "Number not found in Twilio" });
        }
        
        const numberSid = listData.incoming_phone_numbers[0].sid;

        // 2. Update to incomingCall
        const updateResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${numberSid}.json`, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                VoiceUrl: incomingUrl,
                VoiceMethod: 'POST'
            })
        });

        const updateData = await updateResp.json();
        
        return Response.json({
            success: true, 
            message: "Reverted Webhook to incomingCall",
            new_url: updateData.voice_url
        });

    } catch (e) {
        return Response.json({ error: e.message });
    }
});