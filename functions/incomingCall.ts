import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-10);
}

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
        
        const contentType = req.headers.get('content-type') || '';
        let from, to;
        
        // Parse Twilio request
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await req.formData();
            from = formData.get('From');
            to = formData.get('To');
        } else if (contentType.includes('application/json')) {
            const json = await req.json();
            from = json.From || json.from;
            to = json.To || json.to;
        } else {
            // Fallback for query params
            const url = new URL(req.url);
            to = url.searchParams.get('To');
            from = url.searchParams.get('From');
        }
        
        console.log('📞 Incoming call from:', from, 'to:', to);

        // 1. Find Settings for this number
        const normalizedTo = normalizePhone(to);
        console.log('🔍 Looking for normalized number:', normalizedTo);
        
        const allTwilioSettings = await base44.asServiceRole.entities.TwilioSettings.list('-created_date', 100);
        console.log(`📋 Found ${allTwilioSettings.length} total Twilio settings`);
        
        // Match either main number or thoughtly number
        const matches = allTwilioSettings.filter(s => 
            normalizePhone(s.main_phone_number) === normalizedTo || 
            normalizePhone(s.thoughtly_phone) === normalizedTo
        );
        console.log(`✅ Matched ${matches.length} settings for this number`);

        // Prioritize: settings with a company_id, then most recently updated
        const settings = matches
            .filter(s => s.company_id)
            .sort((a, b) => new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date))[0] 
            || matches[0];

        if (settings) {
            console.log('⚙️ Using settings for company:', settings.company_id);
            
            // Fetch the actual company name
            const companies = await base44.asServiceRole.entities.Company.filter({ id: settings.company_id });
            const companyName = companies[0]?.company_name || 'CompanySync';
            console.log('🏢 Company name:', companyName);
            
            // 2. Route to Gemini Live API for speech-to-speech
            const sarahSettings = await base44.asServiceRole.entities.AssistantSettings.filter({ 
                company_id: settings.company_id, 
                assistant_name: 'sarah' 
            });
            
            const sarah = sarahSettings[0];
            console.log('🤖 Sarah settings:', sarah ? `voice_enabled=${sarah.voice_enabled}` : 'NOT FOUND');
            
            // Route to Railway WebSocket bridge for Gemini Live speech-to-speech
            const railwayHost = Deno.env.get('RAILWAY_WS_URL') || 'wss://sarah-media-stream-bridge-production.up.railway.app';
            const isCompanySyncNumber = normalizePhone(to) === '2167777154';
            const scenarioParam = isCompanySyncNumber ? '&scenario=saas_demo' : '';
            const wsUrl = `${railwayHost}/ws/twilio?companyId=${encodeURIComponent(settings.company_id)}${scenarioParam}`;
            console.log('📍 Railway WebSocket URL:', wsUrl);
            
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${escapeXml(wsUrl)}">
            <Parameter name="companyId" value="${escapeXml(settings.company_id)}" />
        </Stream>
    </Connect>
</Response>`;
            return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
        } else {
            console.log('❌ No Twilio settings found for this number');
        }

        // 4. Fallback: Default Greeting if no AI configured or Settings not found
        console.log('ℹ️ No AI forwarding configured, playing default message');
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Thank you for calling. We are currently unavailable. Please leave a message or try again later.</Say>
    <Hangup/>
</Response>`;

        return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });

    } catch (error) {
        console.error('Error in incomingCall:', error);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>We are experiencing technical difficulties.</Say>
    <Hangup/>
</Response>`;
        return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
    }
});