import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-10);
}

Deno.serve(async (req) => {
    console.log('📞 Twilio → Thoughtly Bridge');
    console.log('Request URL:', req.url);
    console.log('Method:', req.method);
    
    try {
        const base44 = createClientFromRequest(req);
        
        // Parse form data
        const formData = await req.formData();
        const from = formData.get('From') || '';
        const to = formData.get('To') || '';
        const callSid = formData.get('CallSid') || '';
        
        console.log('From:', from);
        console.log('To:', to);
        console.log('CallSid:', callSid);
        
        // Log the incoming call to CRM immediately
        try {
            const normalizedTo = normalizePhone(to);
            const allTwilioSettings = await base44.asServiceRole.entities.TwilioSettings.list();
            const twilioSettings = allTwilioSettings.find(s => normalizePhone(s.main_phone_number) === normalizedTo);
            
            if (twilioSettings) {
                await base44.asServiceRole.entities.Communication.create({
                    company_id: twilioSettings.company_id,
                    contact_name: 'Unknown Caller',
                    contact_phone: from,
                    communication_type: 'call',
                    direction: 'inbound',
                    subject: 'Sarah AI Incoming Call',
                    message: `Call forwarded to Sarah AI at ${new Date().toLocaleString()}`,
                    status: 'completed',
                    twilio_sid: callSid
                });
                console.log('✅ Call logged to CRM');
            }
        } catch (logError) {
            console.error('⚠️ Failed to log call:', logError);
        }
        
        // Thoughtly phone number - use the inbound routing number from Thoughtly dashboard
        // The +12168590076 shown in your screenshot is Thoughtly's internal test number
        // Your actual agent number is +18885123907
        const thoughtlyPhone = '+18885123907';
        
        console.log('✅ Dialing Thoughtly:', thoughtlyPhone);
        
        // Return simple TwiML
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>${thoughtlyPhone}</Dial>
</Response>`;
        
        console.log('TwiML:', twiml);
        
        return new Response(twiml, { 
            headers: { 
                'Content-Type': 'text/xml',
                'Cache-Control': 'no-cache'
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Error connecting call.</Say>
    <Hangup/>
</Response>`, { 
            headers: { 'Content-Type': 'text/xml' }
        });
    }
});