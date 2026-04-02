import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-10);
}

Deno.serve(async (req) => {
    console.log('📞 Thoughtly Incoming Call Handler');
    
    try {
        const base44 = createClientFromRequest(req);
        
        const contentType = req.headers.get('content-type') || '';
        let from, to;
        
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await req.formData();
            from = formData.get('From');
            to = formData.get('To');
        } else if (contentType.includes('application/json')) {
            const json = await req.json();
            from = json.From || json.from;
            to = json.To || json.to;
        }
        
        const normalizedTo = normalizePhone(to);
        console.log('📞 Call from:', from, 'to:', to);

        const allTwilioSettings = await base44.asServiceRole.entities.TwilioSettings.list();
        
        // Find all matching settings for this phone number
        const matches = allTwilioSettings.filter(s => 
            normalizePhone(s.main_phone_number) === normalizedTo || normalizePhone(s.thoughtly_phone) === normalizedTo
        );

        // Prioritize settings that have Thoughtly enabled AND an agent ID configured
        const twilioSettings = matches.find(s => s.use_thoughtly_ai && s.thoughtly_agent_id) || matches[0];

        if (!twilioSettings || !twilioSettings.use_thoughtly_ai || !twilioSettings.thoughtly_agent_id) {
            console.log('❌ Thoughtly not enabled for this number');
            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you for calling. Please try again later.</Say><Hangup/></Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({ 
            company_id: twilioSettings.company_id, 
            assistant_name: 'sarah' 
        });
        const sarahSettings = settingsRows[0];
        
        // Use thoughtly_phone from TwilioSettings (preferred) or AssistantSettings (fallback)
        const forwardTo = twilioSettings.thoughtly_phone || sarahSettings?.thoughtly_phone;

        if (!forwardTo) {
            console.error('❌ No Thoughtly phone number configured');
            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>System configuration error. Please contact support.</Say><Hangup/></Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        console.log('✅ Forwarding to Thoughtly:', forwardTo);
        
        // REMOVED callerId temporarily to rule out verification errors.
        // If this works, we can re-add it if needed.
        
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>${forwardTo}</Dial>
    <Say>Sarah is currently unavailable. Please leave a message.</Say>
    <Record />
</Response>`;
        return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });

    } catch (error) {
        console.error('❌ Error:', error);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>System error. Please try again.</Say><Hangup/></Response>`, { headers: { 'Content-Type': 'text/xml' } });
    }
});