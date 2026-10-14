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

        // --- 1b. Check if 'To' is a staff member's personal Twilio number ---
        // If it is, skip Sarah entirely — notify the rep to handle the reply themselves.
        const allStaff = await base44.asServiceRole.entities.StaffProfile.list();
        const repOwner = allStaff.find(s => s.twilio_number && normalizePhone(s.twilio_number) === normalizedTo);

        if (repOwner) {
            console.log(`📱 Reply to rep's personal number: ${to} → ${repOwner.full_name || repOwner.user_email}`);
            const repCompanyId = repOwner.company_id;

            // Identify the contact
            const [customers, leads] = await Promise.all([
                base44.asServiceRole.entities.Customer.filter({ company_id: repCompanyId }),
                base44.asServiceRole.entities.Lead.filter({ company_id: repCompanyId })
            ]);
            const contactMatch = customers.find(c => normalizePhone(c.phone) === normalizedFrom || normalizePhone(c.phone_2) === normalizedFrom)
                || leads.find(l => normalizePhone(l.phone) === normalizedFrom || normalizePhone(l.phone_2) === normalizedFrom);
            const contactName = contactMatch?.name || 'Unknown';

            // Log inbound message
            try {
                await base44.asServiceRole.entities.Communication.create({
                    company_id: repCompanyId,
                    contact_name: contactName,
                    contact_phone: from,
                    communication_type: 'sms',
                    direction: 'inbound',
                    subject: 'Incoming Text (Rep Line)',
                    message: body,
                    twilio_sid: messageSid,
                    status: 'delivered',
                    cost: 0.0075
                });
            } catch (e) { console.error('Failed to log rep-line inbound SMS', e); }

            // Notify the rep directly
            try {
                await base44.asServiceRole.entities.Notification.create({
                    company_id: repCompanyId,
                    user_email: repOwner.user_email,
                    title: `💬 Reply from ${contactName}`,
                    message: `"${body.substring(0, 80)}"`,
                    type: 'sms',
                    link_url: '/Communication'
                });
            } catch (e) { console.error('Failed to notify rep', e); }

            // Return empty TwiML — no Sarah, no auto-reply
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
        }

        // --- 2. Find Company ---
        // Efficiently find settings
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
        if (textLower.match(/^(stop|stopall|unsubscribe|cancel|end|quit)\b/)) {
            const reply = "You're unsubscribed. Reply START to opt back in.";
            return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`, { headers: { 'Content-Type': 'text/xml' } });
        }
        if (textLower.match(/^(start|unstop)\b/)) {
            const reply = "You're opted back in and can receive texts again.";
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
        // We do NOT let leads self-book — avoids double-booking, crew/weather/route
        // conflicts. Instead: collect address (if missing), create a
        // pending_appointment_approval ActionItem for staff, and send a warm
        // "we'll confirm within the hour" reply. The staff approves in Action Items,
        // which creates the real CalendarEvent — same flow as AI voice calls.
        const isScheduleIntent = intent === 'schedule';
        const lastSarahMsg = [...recentMessages].reverse().find(m => m.direction === 'outbound');
        const sarahJustAskedForAddress = !!(lastSarahMsg && /address|location|where.*located|property|street|city|zip/i.test(lastSarahMsg.message || ''));

        if (isScheduleIntent || sarahJustAskedForAddress) {
            const addressFromRecord = existingLead?.street || existingCustomer?.street || '';
            const addressFromExtracted = extracted_info?.address || '';
            // If Sarah just asked for address, treat the raw body as address input
            const addressFromBody = sarahJustAskedForAddress && !isScheduleIntent ? body : '';
            const resolvedAddress = addressFromExtracted || addressFromRecord || addressFromBody;

            if (resolvedAddress) {
                // We have address — create pending ActionItem for staff to approve
                console.log(`📅 Scheduling request from ${from}: creating ActionItem (address: ${resolvedAddress})`);

                // Idempotency: skip if a pending approval already exists for this number
                let hasPending = false;
                try {
                    const existingItems = await base44.asServiceRole.entities.ActionItem.filter({ company_id: companyId });
                    hasPending = existingItems.some((ai: any) =>
                        ai.type === 'pending_appointment_approval' &&
                        (ai.status === 'pending' || ai.status === 'snoozed') &&
                        normalizePhone(ai.proposed_appointment?.contact_phone || '') === normalizedFrom
                    );
                } catch (_) {}

                if (!hasPending) {
                    try {
                        const placeholderStart = new Date(Date.now() + 86400000).toISOString();
                        await base44.asServiceRole.entities.ActionItem.create({
                            company_id: companyId,
                            type: 'pending_appointment_approval',
                            title: `Confirm inspection: ${contactName}`,
                            description: `${contactName} requested a roof inspection via SMS at ${resolvedAddress}. Phone: ${from}. Approve to schedule and confirm with them.`,
                            status: 'pending',
                            priority: 'high',
                            due_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
                            proposed_appointment: {
                                address: resolvedAddress,
                                contact_phone: from,
                                contact_name: contactName,
                                start_time: placeholderStart,
                                end_time: new Date(Date.now() + 90000000).toISOString(),
                                title: `Roof Inspection — ${contactName}`,
                                description: `Requested via SMS. "${body}"`,
                            },
                            source: 'ai_sms',
                            created_by: 'system',
                            escalation_level: 0,
                            created_at: new Date().toISOString(),
                        });
                        console.log(`✅ Scheduling ActionItem created for ${from}`);
                    } catch (aiErr: any) { console.error('Failed to create scheduling ActionItem:', aiErr?.message); }
                } else {
                    console.log(`📅 Pending ActionItem already exists for ${from} — skipping duplicate`);
                }

                finalReply = `Perfect! I've sent your request to our team — someone will call or text you within the hour to confirm your inspection time. We look forward to helping! 🏠`;

            } else {
                // No address yet — ask for it before creating the ActionItem
                console.log(`📅 Scheduling intent from ${from}: asking for address`);
                finalReply = `Happy to get that set up! What's the property address? (Street, city, and zip)`;
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