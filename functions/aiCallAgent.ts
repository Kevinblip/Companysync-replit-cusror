import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const url = new URL(req.url);
        const companyId = url.searchParams.get('companyId'); // From query string
        
        const formData = await req.formData();
        const from = formData.get('From');
        const to = formData.get('To');
        const callSid = formData.get('CallSid');
        const speechResult = formData.get('SpeechResult');
        
        console.log('🤖 AI Agent - From:', from, 'CompanyId:', companyId, 'Speech:', speechResult);
        
        if (!companyId) {
            console.error('❌ No companyId provided');
            const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Sorry, configuration error. Goodbye.</Say>
</Response>`;
            return new Response(errorTwiml, { headers: { 'Content-Type': 'text/xml' } });
        }

        const baseUrl = new URL(req.url).origin;
        
        // First call - no speech yet, greet the caller
        if (!speechResult) {
            console.log('🎤 First call, greeting caller');
            
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" action="${baseUrl}/api/functions/aiCallAgent?companyId=${companyId}" method="POST" timeout="5" speechTimeout="auto" language="en-US">
        <Say voice="Polly.Joanna">Hello! Thank you for calling. How can I help you today?</Say>
    </Gather>
    <Say voice="Polly.Joanna">I didn't hear anything. Please call back. Goodbye.</Say>
</Response>`;

            console.log('📤 Sending TwiML:', twiml);
            return new Response(twiml, {
                headers: { 'Content-Type': 'text/xml' }
            });
        }
        
        // Process the caller's speech
        console.log('💬 Caller said:', speechResult);
        
        // Find caller info
        const contactInfo = await findContact(base44, from, companyId);
        
        // Generate AI response
        const aiResponse = await generateAIResponse(base44, speechResult, contactInfo, companyId, callSid);
        
        // Build TwiML response - use Twilio's built-in TTS for now
        let twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">${escapeXml(aiResponse.message)}</Say>`;

        // If conversation should continue, gather more input
        if (!aiResponse.shouldEnd) {
            twiml += `
    <Gather input="speech" action="${baseUrl}/api/functions/aiCallAgent?companyId=${companyId}" method="POST" timeout="5" speechTimeout="auto" language="en-US">
        <Say voice="Polly.Joanna">Is there anything else?</Say>
    </Gather>`;
        }
        
        twiml += `
    <Say voice="Polly.Joanna">Thank you for calling. Goodbye.</Say>
</Response>`;

        return new Response(twiml, {
            headers: { 'Content-Type': 'text/xml' }
        });

    } catch (error) {
        console.error('❌ AI Agent Error:', error);
        
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">I apologize, but I'm having technical difficulties. Please try again later or leave a message. Goodbye.</Say>
</Response>`;
        
        return new Response(errorTwiml, {
            headers: { 'Content-Type': 'text/xml' }
        });
    }
});

// Find contact in CRM
async function findContact(base44, phoneNumber, companyId) {
    const normalizePhone = (phone) => phone?.replace(/\D/g, '').slice(-10) || '';
    const normalized = normalizePhone(phoneNumber);
    
    // Check customers
    const customers = await base44.asServiceRole.entities.Customer.filter({ 
        company_id: companyId 
    });
    
    const customer = customers.find(c => 
        normalizePhone(c.phone) === normalized || 
        normalizePhone(c.phone_2) === normalized
    );
    
    if (customer) {
        return {
            name: customer.name,
            type: 'customer',
            email: customer.email,
            id: customer.id
        };
    }
    
    // Check leads
    const leads = await base44.asServiceRole.entities.Lead.filter({ 
        company_id: companyId 
    });
    
    const lead = leads.find(l => 
        normalizePhone(l.phone) === normalized || 
        normalizePhone(l.phone_2) === normalized
    );
    
    if (lead) {
        return {
            name: lead.name,
            type: 'lead',
            email: lead.email,
            id: lead.id
        };
    }
    
    return {
        name: 'Unknown Caller',
        type: 'unknown',
        phone: phoneNumber
    };
}

// Generate personalized greeting
async function generateGreeting(base44, phoneNumber, companyId) {
    const contact = await findContact(base44, phoneNumber, companyId);
    
    // Get company info
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const companyName = companies[0]?.company_name || 'our company';
    
    if (contact.type === 'customer') {
        return `Hello ${contact.name}! Thank you for calling ${companyName}. I'm your AI assistant.`;
    } else if (contact.type === 'lead') {
        return `Hello ${contact.name}! Thanks for calling ${companyName}. I'm your AI assistant.`;
    } else {
        return `Hello! Thank you for calling ${companyName}. I'm your AI assistant.`;
    }
}

// Generate AI response using OpenAI
async function generateAIResponse(base44, userMessage, contactInfo, companyId, callSid) {
    const openaiKey = Deno.env.get('Open_AI_Api_Key');
    
    // Get company info for context
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const companyName = companies[0]?.company_name || 'the company';
    
    // Build conversation history from previous calls
    const previousComms = await base44.asServiceRole.entities.Communication.filter({
        company_id: companyId,
        contact_phone: contactInfo.phone || '',
        communication_type: 'call'
    });
    
    const recentHistory = previousComms
        .slice(-3)
        .map(c => c.message || '')
        .join('\n');
    
    const systemPrompt = `You are a friendly AI phone assistant for ${companyName}. 
Your role is to:
- Greet callers warmly
- Answer basic questions about the business
- Schedule appointments or take messages
- Transfer urgent calls to a human agent

Contact info: ${contactInfo.name} (${contactInfo.type})
${recentHistory ? 'Recent history:\n' + recentHistory : ''}

Keep responses SHORT (1-2 sentences) since this is a phone call.
If the caller needs human help, suggest transferring them.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 150
        })
    });
    
    const data = await response.json();
    const aiMessage = data.choices[0].message.content;
    
    // Log this interaction
    await base44.asServiceRole.entities.Communication.create({
        company_id: companyId,
        contact_name: contactInfo.name,
        contact_phone: contactInfo.phone,
        contact_email: contactInfo.email,
        communication_type: 'call',
        direction: 'inbound',
        subject: `AI Call - ${contactInfo.name}`,
        message: `Caller: "${userMessage}"\nAI: "${aiMessage}"`,
        twilio_sid: callSid,
        status: 'completed'
    });
    
    // Check if caller wants to end or needs transfer
    const lowerMessage = userMessage.toLowerCase();
    const shouldEnd = lowerMessage.includes('goodbye') || 
                     lowerMessage.includes('bye') || 
                     lowerMessage.includes('thanks') ||
                     lowerMessage.includes('that\'s all');
    
    return {
        message: aiMessage,
        shouldEnd,
        needsTransfer: lowerMessage.includes('speak to someone') || 
                      lowerMessage.includes('human') ||
                      lowerMessage.includes('representative')
    };
}

// Helper to escape XML special characters
function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}