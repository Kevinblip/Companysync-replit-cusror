import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function normalizePhoneNumber(phone) {
    if (!phone) return null;
    
    const cleaned = phone.replace(/\D/g, '');
    const formats = [];
    
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        formats.push('+' + cleaned);
        formats.push('+1' + cleaned.substring(1));
    }
    
    if (cleaned.length === 10) {
        formats.push(`(${cleaned.substring(0,3)}) ${cleaned.substring(3,6)}-${cleaned.substring(6)}`);
        formats.push(cleaned);
        formats.push('+1' + cleaned);
    }
    
    // This condition is redundant with the first one and might cause duplicates.
    // However, as per the instruction, I'm preserving the existing logic structure.
    // If '1' is considered optional for 10-digit numbers for North America, the first condition
    // (+cleaned and +1cleaned.substring(1)) should cover it.
    // The previous implementation has this check which creates new formats for a 10-digit number.
    // The most robust way would be to normalize to E.164 (+1xxxxxxxxxx) early and then derive other formats.
    // For now, I'm keeping the original function as is to preserve existing behavior as per instructions.
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        const tenDigit = cleaned.substring(1);
        formats.push(`(${tenDigit.substring(0,3)}) ${tenDigit.substring(3,6)}-${tenDigit.substring(6)}`);
        formats.push(tenDigit);
        formats.push(cleaned); // This one is already covered by '+cleaned' from the first if block
    }
    
    return formats;
}

Deno.serve(async (req) => {
    try {
        const formData = await req.formData();
        const from = formData.get('From');
        const to = formData.get('To');
        const body = formData.get('Body');
        const messageSid = formData.get('MessageSid');

        console.log('📱 Incoming SMS from:', from, 'to:', to, 'body:', body);

        const base44 = createClientFromRequest(req);

        const twilioSettings = await base44.asServiceRole.entities.TwilioSettings.list();
        
        let companyId = null;
        for (const setting of twilioSettings) {
            if (
                setting.main_phone_number === to ||
                setting.thoughtly_phone === to ||
                (setting.available_numbers && setting.available_numbers.some(n => n.phone_number === to))
            ) {
                companyId = setting.company_id;
                break;
            }
        }

        if (!companyId) {
            console.error('❌ No company found for number:', to);
            return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
                headers: { 'Content-Type': 'text/xml' }
            });
        }

        console.log('✅ Found company:', companyId);

        const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        const company = companies[0];

        const phoneFormats = normalizePhoneNumber(from);
        console.log('🔍 Checking phone formats:', phoneFormats);

        const customers = await base44.asServiceRole.entities.Customer.filter({ 
            company_id: companyId 
        });
        const leads = await base44.asServiceRole.entities.Lead.filter({ 
            company_id: companyId 
        });

        let contactName = 'Unknown';
        let contactEmail = null;
        
        const customer = customers.find(c => 
            phoneFormats.some(fmt => fmt === c.phone || fmt === c.phone_2)
        );
        
        const lead = leads.find(l => 
            phoneFormats.some(fmt => fmt === l.phone || fmt === l.phone_2)
        );
        
        if (customer) {
            contactName = customer.name;
            contactEmail = customer.email;
            console.log('✅ Found customer:', contactName);
        } else if (lead) {
            contactName = lead.name;
            contactEmail = lead.email;
            console.log('✅ Found lead:', contactName);
        } else {
            console.log('⚠️ No contact found for phone:', from);
        }

        const knowledgeArticles = await base44.asServiceRole.entities.KnowledgeBaseArticle.filter({
            company_id: companyId,
            is_ai_training: true,
            is_published: true
        });

        const knowledgeContext = knowledgeArticles
            .slice(0, 10)
            .map(article => `${article.title}: ${article.summary || article.content.substring(0, 200)}`)
            .join('\n');

        const recentMessages = await base44.asServiceRole.entities.Communication.filter({
            company_id: companyId,
            contact_phone: from,
            communication_type: 'sms'
        });

        const conversationHistory = recentMessages
            .slice(0, 5)
            .reverse()
            .map(m => `${m.direction === 'inbound' ? contactName : company?.company_name || 'Our Team'}: ${m.message}`)
            .join('\n');

        await base44.asServiceRole.entities.Communication.create({
            company_id: companyId,
            contact_name: contactName,
            contact_email: contactEmail,
            contact_phone: from,
            communication_type: 'sms',
            direction: 'inbound',
            subject: 'Incoming Text',
            message: body,
            twilio_sid: messageSid,
            status: 'delivered',
            cost: 0.0075
        });

        console.log('✅ Communication logged');

        try {
            const twilioConfig = twilioSettings.find(s => s.company_id === companyId);
            
            if (twilioConfig && twilioConfig.use_thoughtly_ai) {
                console.log('🤖 Triggering AI auto-response...');
                
                const schedulingKeywords = ['schedule', 'appointment', 'book', 'meet', 'visit', 'inspection', 'estimate', 'come out', 'available', 'when can', 'time', 'date', 'tomorrow', 'today', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
                const isSchedulingRequest = schedulingKeywords.some(keyword => 
                    body.toLowerCase().includes(keyword)
                );

                let aiResponseText = '';

                if (isSchedulingRequest) {
                    console.log('📅 Scheduling request detected');
                    
                    const extractResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                        prompt: `Analyze this scheduling request and extract details:

Customer message: "${body}"

Extract:
1. Has the customer provided a SPECIFIC date/time? (e.g., "tomorrow at 2pm", "Friday at 10am")
2. If yes, what is the proposed date/time?
3. What type of service? (inspection, estimate, repair, consultation, etc.)

Return JSON.`,
                        response_json_schema: {
                            type: "object",
                            properties: {
                                has_specific_time: { type: "boolean" },
                                proposed_date_description: { type: "string" },
                                service_type: { type: "string" },
                                is_urgent: { type: "boolean" }
                            }
                        }
                    });

                    console.log('🔍 Extracted scheduling info:', extractResponse);

                    if (extractResponse.has_specific_time && extractResponse.proposed_date_description) {
                        try {
                            let proposedStartTime = new Date();
                            const lower = extractResponse.proposed_date_description.toLowerCase();
                            
                            if (lower.includes('tomorrow')) {
                                proposedStartTime.setDate(proposedStartTime.getDate() + 1);
                            } else if (lower.includes('monday')) {
                                const dayDiff = (1 + 7 - proposedStartTime.getDay()) % 7 || 7;
                                proposedStartTime.setDate(proposedStartTime.getDate() + dayDiff);
                            } else if (lower.includes('tuesday')) {
                                const dayDiff = (2 + 7 - proposedStartTime.getDay()) % 7 || 7;
                                proposedStartTime.setDate(proposedStartTime.getDate() + dayDiff);
                            } else if (lower.includes('wednesday')) {
                                const dayDiff = (3 + 7 - proposedStartTime.getDay()) % 7 || 7;
                                proposedStartTime.setDate(proposedStartTime.getDate() + dayDiff);
                            } else if (lower.includes('thursday')) {
                                const dayDiff = (4 + 7 - proposedStartTime.getDay()) % 7 || 7;
                                proposedStartTime.setDate(proposedStartTime.getDate() + dayDiff);
                            } else if (lower.includes('friday')) {
                                const dayDiff = (5 + 7 - proposedStartTime.getDay()) % 7 || 7;
                                proposedStartTime.setDate(proposedStartTime.getDate() + dayDiff);
                            }
                            
                            const timeMatch = lower.match(/(\d{1,2})(:\d{2})?\s*(am|pm)?/);
                            if (timeMatch) {
                                let hour = parseInt(timeMatch[1]);
                                const minutes = timeMatch[2] ? parseInt(timeMatch[2].substring(1)) : 0;
                                
                                if (timeMatch[3] && timeMatch[3].includes('pm') && hour < 12) hour += 12;
                                if (timeMatch[3] && timeMatch[3].includes('am') && hour === 12) hour = 0;
                                proposedStartTime.setHours(hour, minutes, 0, 0);
                            } else {
                                proposedStartTime.setHours(10, 0, 0, 0);
                            }

                            if (proposedStartTime < new Date()) {
                                proposedStartTime.setDate(proposedStartTime.getDate() + 1);
                            }
                            
                            const proposedEndTime = new Date(proposedStartTime);
                            proposedEndTime.setHours(proposedEndTime.getHours() + 1);

                            // CHECK FOR CONFLICTS
                            const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ 
                                company_id: companyId,
                                status: 'scheduled'
                            });

                            const conflicts = allEvents.filter(event => {
                                const eventStart = new Date(event.start_time);
                                const eventEnd = new Date(event.end_time);
                                // Check for overlap: (start1 < end2 && end1 > start2)
                                return (proposedStartTime < eventEnd && proposedEndTime > eventStart);
                            });

                            const hasConflict = conflicts.length > 0;
                            console.log(`📅 SMS Conflict check: ${conflicts.length} conflict(s) found`);

                            const newEvent = await base44.asServiceRole.entities.CalendarEvent.create({
                                company_id: companyId,
                                title: `${extractResponse.service_type || 'Appointment'} - ${contactName}`,
                                description: `Customer request: ${body}\n\nProposed by customer via SMS. Please confirm.${hasConflict ? '\n\n⚠️ CALENDAR CONFLICT DETECTED!' : ''}`,
                                start_time: proposedStartTime.toISOString(),
                                end_time: proposedEndTime.toISOString(),
                                event_type: 'appointment',
                                status: 'scheduled',
                                related_customer: contactName,
                                color: hasConflict ? '#ef4444' : '#f59e0b', // Red for conflict, orange otherwise
                                location: customer?.address || lead?.address || ''
                            });

                            console.log(`✅ Calendar event created: ${newEvent.id}${hasConflict ? ' (WITH CONFLICT)' : ''}`);

                            const staffMembers = await base44.asServiceRole.entities.StaffProfile.filter({ 
                                company_id: companyId,
                                is_active: true 
                            });

                            for (const staff of staffMembers) {
                                await base44.asServiceRole.entities.Notification.create({
                                    company_id: companyId,
                                    user_email: staff.user_email,
                                    title: hasConflict ? '🔴 CONFLICT: Appointment Request' : '📅 New Appointment Request', // Different title for conflict
                                    message: `${contactName} requested ${extractResponse.service_type || 'appointment'} on ${proposedStartTime.toLocaleDateString()} at ${proposedStartTime.toLocaleTimeString()}${hasConflict ? ` - ${conflicts.length} CONFLICTS!` : ''}`, // Add conflict count
                                    type: 'general',
                                    related_entity_type: 'CalendarEvent',
                                    related_entity_id: newEvent.id,
                                    link_url: '/calendar',
                                    is_read: false
                                });
                            }

                            console.log('✅ Staff notified');

                            // SEND TO GOOGLE CHAT IF CONFLICT
                            if (hasConflict) {
                                try {
                                    const googleChatSettings = await base44.asServiceRole.entities.GoogleChatSettings.filter({
                                        company_id: companyId,
                                        send_conflict_alerts: true,
                                        is_active: true
                                    });

                                    for (const chatWebhook of googleChatSettings) {
                                        await base44.asServiceRole.functions.invoke('sendGoogleChatMessage', {
                                            message: `🔴 SCHEDULING CONFLICT - TEXT CUSTOMER BACK!\n\n${contactName} (${from}) requested appointment on ${proposedStartTime.toLocaleDateString()} at ${proposedStartTime.toLocaleTimeString()}\n\n⚠️ ${conflicts.length} existing event(s) overlap!\n\nAction: Text them back to pick another time`,
                                            webhookUrl: chatWebhook.webhook_url,
                                            companyId: companyId,
                                            cardTitle: '🔴 Calendar Conflict - SMS', // Custom card title
                                            cardSubtitle: `Customer: ${contactName}` // Custom card subtitle
                                        });
                                    }
                                    console.log('✅ Google Chat conflict alert sent');
                                } catch (gcError) {
                                    console.error('⚠️ Google Chat notification failed (non-critical):', gcError);
                                }
                            }

                            const dateStr = proposedStartTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                            const timeStr = proposedStartTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

                            aiResponseText = hasConflict 
                                ? `Thanks for your interest! That time has a conflict. Our team will text you shortly with available times. - ${company?.company_name || 'Our Team'}`
                                : `Perfect! ✅ I've scheduled your ${extractResponse.service_type || 'appointment'} for ${dateStr} at ${timeStr}.\n\nOur team will confirm within 1 hour. See you soon! - ${company?.company_name || 'Our Team'}`;

                        } catch (eventError) {
                            console.error('❌ Failed to create event:', eventError);
                            const requestUrl = new URL(req.url);
                            const appBaseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
                            const bookingLink = `${appBaseUrl}/book-appointment?company_id=${companyId}&phone=${encodeURIComponent(from)}`;
                            
                            aiResponseText = `I'd love to help you schedule! Click here to choose your preferred time:\n\n${bookingLink}\n\nTakes just 30 seconds! 📅`;
                        }
                    } else {
                        const requestUrl = new URL(req.url);
                        const appBaseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
                        const bookingLink = `${appBaseUrl}/book-appointment?company_id=${companyId}&phone=${encodeURIComponent(from)}`;
                        
                        console.log('📅 Sending booking link:', bookingLink);

                        aiResponseText = `Hi ${contactName}! 👋 I can help you schedule.\n\nClick here to book your appointment:\n${bookingLink}\n\nChoose your date & time - takes 30 seconds!`;
                    }
                    
                    console.log('✅ Sending scheduling response');
                } else {
                    const aiPrompt = `You are an AI assistant for ${company?.company_name || 'our company'}.

${knowledgeContext ? `COMPANY KNOWLEDGE:\n${knowledgeContext}\n\n` : ''}

CUSTOMER: ${contactName}
${conversationHistory ? `\nCONVERSATION HISTORY:\n${conversationHistory}\n` : ''}

CUSTOMER MESSAGE: "${body}"

CRITICAL RULE: DO NOT tell customers they are scheduled unless you actually created an appointment!

Generate a helpful, professional SMS response (max 160 chars).
- Answer their question using company knowledge
- Be friendly and conversational
- If they want to schedule, ask "What day/time works for you?" or say "Text 'book' for a link"
- NEVER say "you're scheduled" or "appointment confirmed"
- Keep it brief for SMS

Return ONLY the SMS text, nothing else.`;

                    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                        prompt: aiPrompt
                    });

                    aiResponseText = typeof aiResponse === 'string' 
                        ? aiResponse 
                        : String(aiResponse);
                }

                console.log('📤 Sending response:', aiResponseText);

                await base44.asServiceRole.functions.invoke('sendSMS', {
                    to: from,
                    message: aiResponseText,
                    contactName: contactName,
                    companyId: companyId
                });

                console.log('✅ AI response sent successfully');

                return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
                    headers: { 'Content-Type': 'text/xml' }
                });
            }
        } catch (error) {
            console.error('⚠️ AI auto-response failed:', error);
            console.error('Error details:', error.message, error.stack);
        }

        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
            headers: { 'Content-Type': 'text/xml' }
        });

    } catch (error) {
        console.error('❌ Webhook Error:', error);
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
            headers: { 'Content-Type': 'text/xml' }
        });
    }
});