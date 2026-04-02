import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Twilio } from "npm:twilio";

function escapeXml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe).replace(/[<>&"']/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
        }
    });
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { to, voice_id, text, company_id } = await req.json();

        if (!to || !voice_id || !company_id) {
            return Response.json({ error: 'Missing required fields' }, { status: 400 });
        }

        // 1. Get Twilio Credentials (prefer secrets, then settings)
        let accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
        let authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
        let fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

        // Fetch company settings to check for overrides
        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.filter({ company_id });
        const ts = twilioSettings[0];

        if (ts) {
            // If settings exist, prefer the main number from settings
            if (ts.main_phone_number) fromNumber = ts.main_phone_number;
            
            // Note: If using BYOC Twilio, we'd need to decrypt auth_token here. 
            // For now, we assume the secrets are set correctly for the platform or the user provided them.
            if (ts.account_sid) accountSid = ts.account_sid;
            // We can't easily decrypt auth_token here without a helper, so we fallback to secret or assume environment matches.
        }

        if (!accountSid || !authToken || !fromNumber) {
            return Response.json({ error: 'Twilio credentials or phone number not found' }, { status: 500 });
        }

        const client = new Twilio(accountSid, authToken);

        // 2. Construct TwiML
        // Use the selected voice to say the text
        // ADDED: Typing sound to match "Normal" speed behavior so user hears what they expect
        const typingSound = "https://cdn.pixabay.com/audio/2022/03/24/audio_3f76015500.mp3";
        
        const twiml = `
<Response>
    <Play>${typingSound}</Play>
    <Say voice="${escapeXml(voice_id)}">
        ${escapeXml(text || "This is a test of your selected voice.")}
    </Say>
</Response>
        `;

        // 3. Initiate Call
        console.log(`📞 Initiating test call to ${to} from ${fromNumber} with voice ${voice_id}`);
        
        const call = await client.calls.create({
            twiml: twiml,
            to: to,
            from: fromNumber,
        });

        return Response.json({ 
            success: true, 
            message: 'Call initiated', 
            callSid: call.sid 
        });

    } catch (error) {
        console.error('❌ Test Call Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});