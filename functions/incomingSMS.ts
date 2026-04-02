import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Normalize phone number for comparison
function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-10);
}

// Check if there's already an appointment for this phone number
async function hasExistingAppointment(base44, companyId, phone) {
    try {
        const normalizedPhone = normalizePhone(phone);
        const events = await base44.asServiceRole.entities.CalendarEvent.filter({
            company_id: companyId,
            status: 'scheduled'
        });
        
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        
        for (const event of events) {
            if (!event.start_time) continue;
            const eventDate = new Date(event.start_time);
            if (eventDate < now || eventDate > thirtyDaysFromNow) continue;
            
            const desc = (event.description || '').toLowerCase();
            const title = (event.title || '').toLowerCase();
            
            if (desc.includes(normalizedPhone) || desc.includes(phone) || title.includes(normalizedPhone)) {
                return event;
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

Deno.serve(async (req) => {
    console.log('💬 Incoming SMS webhook triggered (Optimized)');
    
    if (req.method === 'GET' || req.method === 'OPTIONS') {
        return new Response('OK', { status: 200 });
    }

    try {
        // --- 1. Parse Webhook ---
        const contentType = req.headers.get('content-type') || '';
        let from, to, body, messageSid;
        
        if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            from = formData.get('From');
            to = formData.get('To');
            body = formData.get('Body');
            messageSid = formData.get('MessageSid');
        } else {
            try {
                const json = await req.json();
                from = json.From || json.from;
                to = json.To || json.to;
                body = json.Body || json.body;
                messageSid = json.MessageSid || json.messageSid;
            } catch (e) {
                return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
            }
        }

        if (!from || !body) {
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
        }

        const base44 = createClientFromRequest(req);
        const normalizedFrom = normalizePhone(from);
        const normalizedTo = normalizePhone(to);

        // --- 2. Find Company ---
        // Efficiently find settings
        // Note: Listing all might be slow if many records, but filter usually better if indexed. 
        // TwilioSettings doesn't have normalized fields, so we list and find.
        // Optimization: In real app, we should probably have a dedicated lookup or indexed field.
        const allTwilioSettings = await base44.asServiceRole.entities.TwilioSettings.list();
        const twilioSetting = allTwilioSettings.find(s => 
            normalizePhone(s.main_phone_number) === normalizedTo || normalizePhone(s.thoughtly_phone) === normalizedTo
        );

        if (!twilioSetting) {
            console.error('❌ No company found for incoming number:', to);
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
        }

        const companyId = twilioSetting.company_id;
        const [company] = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        
        // Load Assistant Settings for Branding/Persona
        const [assistantSettings] = await base44.asServiceRole.entities.AssistantSettings.filter({
            company_id: companyId,
            assistant_name: 'sarah'
        });
        
        let companyName = assistantSettings?.brand_short_name || company?.company_name || 'our company';
        const systemPersona = assistantSettings?.system_prompt || '';
        const bookingLink = assistantSettings?.calendly_booking_url;

        // --- 3. Identify Contact ---
        const [customers, leads] = await Promise.all([
            base44.asServiceRole.entities.Customer.filter({ company_id: companyId }),
            base44.asServiceRole.entities.Lead.filter({ company_id: companyId })
        ]);

        const existingCustomer = customers.find(c => normalizePhone(c.phone) === normalizedFrom || normalizePhone(c.phone_2) === normalizedFrom);
        const existingLead = leads.find(l => normalizePhone(l.phone) === normalizedFrom || normalizePhone(l.phone_2) === normalizedFrom);

        let contactName = existingCustomer?.name || existingLead?.name || 'Unknown';
        let contactRecord = existingCustomer || existingLead;
        let isNewContact = !contactRecord;

        console.log(`👤 Contact: ${contactName} (${isNewContact ? 'New' : 'Existing'})`);

        // --- 4. Log Incoming Message ---
        try {
            await base44.asServiceRole.entities.Communication.create({
                company_id: companyId,
                contact_name: contactName,
                contact_phone: from,
                communication_type: 'sms',
                direction: 'inbound',
                subject: 'Incoming Text',
                message: body,
                twilio_sid: messageSid,
                status: 'delivered',
                cost: 0.0075
            });
        } catch (e) {
            console.error('Failed to log incoming SMS', e);
        }

        // --- 5. Quick Local Checks (Emergency / STOP) ---
        const textLower = body.toLowerCase().trim();
        
        // Emergency Check
        const emergencyKeywords = assistantSettings?.escalation_keywords || [
            "emergency", "urgent", "asap", "911", "flood", "fire", "leak",
            "water damage", "cave", "collapse", "falling", "danger", "help"
        ];
        
        if (emergencyKeywords.some(kw => textLower.includes(kw.toLowerCase()))) {
            console.log('🚨 EMERGENCY DETECTED');
            // Notify admins
            const staff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId, is_administrator: true });
            staff.forEach(s => {
                base44.asServiceRole.entities.Notification.create({
                    company_id: companyId,
                    user_email: s.user_email,
                    title: '🚨 EMERGENCY SMS',
                    message: `From ${contactName} (${from}): "${body}"`,
                    type: 'emergency',
                    link_url: '/Communication'
                }).catch(() => {});
            });

            const reply = "I understand this is urgent. I've alerted our team and someone will call you within 5 minutes. Stay safe!";
            
            // Log outgoing
            await base44.asServiceRole.entities.Communication.create({
                company_id: companyId,
                contact_name: contactName,
                contact_phone: from,
                communication_type: 'sms',
                direction: 'outbound',
                subject: 'Sarah - EMERGENCY',
                message: reply,
                status: 'sent'
            });

            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message></Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        // STOP Check
        if (textLower.match(/^(stop|unsubscribe|cancel)\b/)) {
            const reply = "You're unsubscribed. Reply START to opt back in.";
            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        // --- 6. Intelligent Processing (Single LLM Call) ---
        // Fetch recent history for context
        const recentMessages = await base44.asServiceRole.entities.Communication.filter({
            company_id: companyId,
            contact_phone: from,
            communication_type: 'sms'
        });

        const conversationContext = recentMessages.slice(0, 10).reverse()
            .map(m => `${m.direction === 'inbound' ? 'User' : 'Sarah'}: ${m.message}`)
            .join('\n');

        const prompt = `You are Sarah, the friendly AI assistant for ${companyName}.
${systemPersona ? `\nAdditional Persona Guidelines:\n"${systemPersona}"\n` : ''}

Goal:
1. Extract any new contact info (name, address, email) from the User's latest message if explicitly stated.
2. Determine User's intent (schedule, question, general).
3. Generate a friendly, concise SMS reply (under 160 chars).

Current Information:
- User Name: ${contactName}
- Has Address: ${existingLead?.street || existingCustomer?.street ? 'Yes' : 'No'}
- Has Email: ${existingLead?.email || existingCustomer?.email ? 'Yes' : 'No'}
- Booking Link: ${bookingLink || 'Not available'}

Conversation History:
${conversationContext}
User: "${body}"

Instructions:
- If User asks "Who is this?", introduce yourself as Sarah from ${companyName}.
- If User provides info, extract it.
- If User wants to schedule or book an appointment, you MUST include this exact link in your reply: ${bookingLink || 'Not available'}. Say something like "Book a time here: ${bookingLink}".
- If User asks a general question, answer it briefly.
- Be warm and professional.

Return JSON only.`;

        let aiResult = null;
        try {
            aiResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt: prompt,
                response_json_schema: {
                    type: "object",
                    properties: {
                        extracted_info: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                email: { type: "string" },
                                address: { type: "string" },
                                city: { type: "string" },
                                state: { type: "string" },
                                zip: { type: "string" }
                            }
                        },
                        intent: { type: "string", enum: ["schedule", "question", "general", "emergency"] },
                        reply_text: { type: "string", description: "The SMS reply to send to the user" }
                    }
                }
            });
        } catch (e) {
            console.error('LLM Failed:', e);
            // Fallback response
            const reply = `Hi! This is Sarah from ${companyName}. How can I help you?`;
            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }

        const { extracted_info, intent, reply_text } = aiResult || {};
        let finalReply = reply_text || `Hi! This is Sarah from ${companyName}. How can I help?`;

        // --- 7. Handle Data Updates ---
        if (extracted_info && (extracted_info.name || extracted_info.email || extracted_info.address)) {
            console.log('📝 Extracted Info:', extracted_info);
            
            if (isNewContact && extracted_info.name) {
                // Create Lead
                try {
                    const newLead = await base44.asServiceRole.entities.Lead.create({
                        company_id: companyId,
                        name: extracted_info.name,
                        phone: from,
                        email: extracted_info.email || '',
                        street: extracted_info.address || '',
                        city: extracted_info.city || '',
                        state: extracted_info.state || '',
                        zip: extracted_info.zip || '',
                        source: 'ai',
                        lead_source: 'Sarah AI SMS',
                        status: 'new',
                        notes: `Created by Sarah AI via SMS. Initial intent: ${intent}`
                    });
                    contactName = newLead.name;
                    contactRecord = newLead;
                    isNewContact = false;
                    console.log('✅ New Lead Created:', newLead.id);
                } catch (e) { console.error('Failed to create lead:', e); }
            } else if (contactRecord) {
                // Update Existing
                const updates = {};
                if (extracted_info.name && contactName === 'Unknown') updates.name = extracted_info.name;
                if (extracted_info.email && !contactRecord.email) updates.email = extracted_info.email;
                if (extracted_info.address && !contactRecord.street) updates.street = extracted_info.address;
                
                if (Object.keys(updates).length > 0) {
                    const entityType = existingCustomer ? 'Customer' : 'Lead';
                    await base44.asServiceRole.entities[entityType].update(contactRecord.id, updates);
                    console.log('✅ Contact Updated:', updates);
                }
            }
        }

        // --- 8. Handle Scheduling Intent ---
        // Ensure booking link is included if intent is schedule and link is missing
        if ((intent === 'schedule' || intent === 'question') && bookingLink) {
            // Check if link is missing from reply
            if (!finalReply.includes(bookingLink) && !finalReply.includes('BookAppointment')) {
                console.log('⚠️ Booking link missing from reply, appending it.');
                
                // If it ends with punctuation, append after space. Otherwise, append with punctuation.
                const lastChar = finalReply.trim().slice(-1);
                if (['.', '!', '?'].includes(lastChar)) {
                    finalReply += ` You can book here: ${bookingLink}`;
                } else {
                    finalReply += `. You can book here: ${bookingLink}`;
                }
            }
        }
        
        // --- 9. Send Response ---
        // Log Outgoing
        await base44.asServiceRole.entities.Communication.create({
            company_id: companyId,
            contact_name: contactName,
            contact_phone: from,
            communication_type: 'sms',
            direction: 'outbound',
            subject: 'Sarah',
            message: finalReply,
            status: 'sent',
            cost: 0.0075
        });

        // Notify Admins of interaction
        try {
            const staff = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId, is_administrator: true });
            staff.forEach(s => {
                base44.asServiceRole.entities.Notification.create({
                    company_id: companyId,
                    user_email: s.user_email,
                    title: `📱 SMS from ${contactName}`,
                    message: body.substring(0, 50),
                    type: 'sms',
                    link_url: '/Communication'
                }).catch(() => {});
            });
        } catch (e) {}

        const safeMessage = finalReply.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safeMessage}</Message></Response>`, {
            headers: { 'Content-Type': 'text/xml' }
        });

    } catch (error) {
        console.error('💥 Critical Webhook Error:', error);
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, { headers: { 'Content-Type': 'text/xml' } });
    }
});