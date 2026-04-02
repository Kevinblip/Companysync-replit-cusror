import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Normalize phone number for comparison
function normalizePhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-10);
}

// Extract info from conversation using AI
async function extractLeadInfo(base44, recentMessages, currentMessage) {
    const conversationText = recentMessages
        .slice(0, 20)
        .reverse()
        .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Sarah'}: ${m.message}`)
        .join('\n');
    
    const fullConversation = conversationText + `\nCustomer: ${currentMessage}`;
    
    try {
        const extraction = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: `Extract contact information from this SMS conversation. Only extract info that was EXPLICITLY stated by the customer.

Conversation:
${fullConversation}

Extract ANY information the customer has provided. Be strict - only mark has_X as true if you found a CLEAR, COMPLETE piece of information:
- Name must be an actual name (not "me", "I", etc.)
- Address must include a street number and street name
- Email must be a valid email format with @`,
            response_json_schema: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Customer's name if mentioned (first and/or last)" },
                    email: { type: "string", description: "Email address if mentioned" },
                    address: { type: "string", description: "Property/street address if mentioned (must have street number)" },
                    city: { type: "string", description: "City if mentioned" },
                    state: { type: "string", description: "State abbreviation if mentioned" },
                    zip: { type: "string", description: "ZIP code if mentioned" },
                    has_name: { type: "boolean", description: "True ONLY if a real name was explicitly provided" },
                    has_email: { type: "boolean", description: "True ONLY if a valid email was provided" },
                    has_address: { type: "boolean", description: "True ONLY if a street address with number was provided" }
                }
            }
        });
        return extraction;
    } catch (e) {
        console.error('❌ Failed to extract lead info:', e.message);
        return null;
    }
}

// Determine what info is still missing - ALL are required for scheduling
function getMissingInfo(leadInfo) {
    const missing = [];
    if (!leadInfo?.has_name || !leadInfo?.name || leadInfo?.name === 'Unknown') missing.push('name');
    if (!leadInfo?.has_address || !leadInfo?.address) missing.push('address');
    if (!leadInfo?.has_email || !leadInfo?.email) missing.push('email');
    return missing;
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
    console.log('🧪 Test Sarah Conversation');
    
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { phone_number, message, company_id } = body;
        
        if (!phone_number || !message) {
            return Response.json({ error: 'Missing phone_number or message' }, { status: 400 });
        }
        
        // If no company_id provided, try to find one from staff profile or first company
        let resolvedCompanyId = company_id;
        if (!resolvedCompanyId) {
            console.log('⚠️ No company_id provided, attempting to resolve...');
            try {
                // Try to find staff profile for user
                const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
                    user_email: user.email 
                });
                if (staffProfiles.length > 0 && staffProfiles[0].company_id) {
                    resolvedCompanyId = staffProfiles[0].company_id;
                    console.log('📋 Resolved company_id from staff profile:', resolvedCompanyId);
                } else {
                    // Fallback: get first company created by user
                    const companies = await base44.asServiceRole.entities.Company.filter({
                        created_by: user.email
                    });
                    if (companies.length > 0) {
                        resolvedCompanyId = companies[0].id;
                        console.log('📋 Resolved company_id from owned companies:', resolvedCompanyId);
                    }
                }
            } catch (e) {
                console.log('⚠️ Could not resolve company_id:', e.message);
            }
        }
        
        if (!resolvedCompanyId) {
            return Response.json({ error: 'Could not determine company_id. Please select a company.' }, { status: 400 });
        }

        const from = phone_number;
        const text = message.trim();
        const lower = text.toLowerCase();
        const normalizedFrom = normalizePhone(from);

        // Debug object we'll build up
        const debug = {
            contactName: 'Unknown',
            isNewContact: false,
            extractedInfo: null,
            missingInfo: [],
            wantsSchedule: false,
            hasExistingAppt: false,
            leadAction: 'None',
            responseReason: ''
        };

        // Get company
        const companies = await base44.asServiceRole.entities.Company.filter({ id: resolvedCompanyId });
        const company = companies[0];
        // Use brand_short_name from Sarah settings if available
        let companyName = company?.company_name || 'our company';
        
        // Find Sarah settings for this specific company only
        let settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({
            company_id: resolvedCompanyId,
            assistant_name: 'sarah'
        });
        
        const settings = settingsRows[0] || {};
        console.log('📋 Sarah settings loaded:', settings.system_prompt ? 'Has prompt' : 'No prompt', 
                    'Knowledge base:', settings.knowledge_base ? 'Yes' : 'No',
                    'Website URLs:', settings.website_urls?.length || 0);
        
        if (settings.brand_short_name) {
            companyName = settings.brand_short_name;
        }

        // Extract agent name from system prompt
        let agentName = 'Sarah';
        if (settings.system_prompt) {
            // Improved regex to skip "You are" if it appears after Role:
            const nameMatch = settings.system_prompt.match(/(?:You are|Your name is|I am|Role:)[:\s]*(?:You are\s+)?([A-Z][a-z]+)/i);
            if (nameMatch && nameMatch[1]) {
                // Avoid capturing "You"
                if (nameMatch[1].toLowerCase() === 'you') {
                     // Try to look ahead
                     const remainder = settings.system_prompt.substring(nameMatch.index + nameMatch[0].length);
                     const nextWord = remainder.match(/^\s+([A-Z][a-z]+)/);
                     if (nextWord) agentName = nextWord[1];
                } else {
                    agentName = nameMatch[1];
                }
            }
        }

        // Get existing contacts
        const customers = await base44.asServiceRole.entities.Customer.filter({ company_id: resolvedCompanyId });
        const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: resolvedCompanyId });

        // Check for existing contact by phone
        const existingCustomer = customers.find(c => 
            normalizePhone(c.phone) === normalizedFrom || normalizePhone(c.phone_2) === normalizedFrom
        );
        const existingLead = leads.find(l => 
            normalizePhone(l.phone) === normalizedFrom || normalizePhone(l.phone_2) === normalizedFrom
        );

        let contactName = existingCustomer?.name || existingLead?.name || 'Unknown';
        let contactRecord = existingCustomer || existingLead;
        let isNewContact = !contactRecord;

        debug.contactName = contactName;
        debug.isNewContact = isNewContact;

        // Get recent test messages (from Communication entity)
        const recentMessages = await base44.asServiceRole.entities.Communication.filter({
            company_id: resolvedCompanyId,
            contact_phone: from,
            communication_type: 'sms'
        });

        let responseText = '';

        // Handle STOP
        if (lower.match(/^(stop|unsubscribe|cancel)\b/)) {
            responseText = `You're unsubscribed. Reply START to opt back in.`;
            debug.responseReason = 'STOP command detected';
        } else {
            // Extract lead info from conversation
            const leadInfo = await extractLeadInfo(base44, recentMessages, message);
            debug.extractedInfo = leadInfo;

            const missingInfo = getMissingInfo(leadInfo);
            debug.missingInfo = missingInfo;

            // Check if customer wants to schedule (enhanced time detection)
            const timeKeywords = /(\d{1,2})\s*(am|pm|:)/i.test(text) || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i.test(lower);
            const scheduleKeywords = lower.includes('schedule') || lower.includes('appointment') || 
                                     lower.includes('book') || lower.includes('come out') || 
                                     lower.includes('inspection') || lower.includes('estimate');
            const wantsSchedule = scheduleKeywords || timeKeywords;
            debug.wantsSchedule = wantsSchedule;

            // Check for existing appointment
            const existingAppt = await hasExistingAppointment(base44, resolvedCompanyId, from);
            debug.hasExistingAppt = !!existingAppt;

            // Lead creation/update logic (simulated - not actually creating in test)
            if (leadInfo && (leadInfo.has_name || leadInfo.has_address || leadInfo.has_email)) {
                if (isNewContact && leadInfo.name && leadInfo.name !== 'Unknown') {
                    debug.leadAction = 'Would CREATE new lead';
                } else if (existingLead) {
                    debug.leadAction = 'Would UPDATE existing lead';
                }
            }

            // Check for time in message
            const hasTimeInMessage = /(\d{1,2})\s*(am|pm|:)/i.test(text) || 
                                     /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b/i.test(lower);
            
            debug.hasTimeInMessage = hasTimeInMessage;
            
            // RESPONSE LOGIC - Check existing appointment FIRST
            if (existingAppt && hasTimeInMessage) {
                // Customer has existing appt AND mentioned a new time = RESCHEDULE
                const firstName = contactName !== 'Unknown' ? contactName.split(' ')[0] : '';
                responseText = `[TEST MODE] Would cancel existing appointment and rebook for: "${message}". Response would be: "Perfect ${firstName}! I've rescheduled your inspection to [NEW TIME]. See you then!"`;
                debug.responseReason = 'RESCHEDULE: Has existing appt + new time in message';
            } else if (existingAppt && !hasTimeInMessage) {
                // Has appt but no new time - ask for preferred time
                const apptDate = new Date(existingAppt.start_time);
                const formattedDate = apptDate.toLocaleDateString('en-US', { 
                    weekday: 'long', month: 'short', day: 'numeric' 
                });
                const formattedTime = apptDate.toLocaleTimeString('en-US', { 
                    hour: 'numeric', minute: '2-digit' 
                });
                const firstName = contactName !== 'Unknown' ? contactName.split(' ')[0] : '';
                responseText = `Sure ${firstName}! Your current inspection is ${formattedDate} at ${formattedTime}. What day and time works better for you?`;
                debug.responseReason = 'Has existing appt, no new time - asking for preferred time';
            } else if (wantsSchedule) {
                if (missingInfo.includes('name')) {
                    responseText = `I'd love to help schedule that! First, can I get your full name?`;
                    debug.responseReason = 'Scheduling requested but MISSING NAME';
                } else if (missingInfo.includes('address')) {
                    responseText = `Thanks ${leadInfo?.name?.split(' ')[0]}! What's the property address for the inspection? (Include street, city, state, zip)`;
                    debug.responseReason = 'Scheduling requested but MISSING ADDRESS';
                } else if (missingInfo.includes('email')) {
                    responseText = `Great! And what's your email address so we can send you the appointment confirmation?`;
                    debug.responseReason = 'Scheduling requested but MISSING EMAIL';
                } else {
                    // We have ALL required info - SIMULATE booking (test mode)
                    const firstName = leadInfo?.name?.split(' ')[0] || contactName?.split(' ')[0];
                    responseText = `Perfect! I have all your info. [In live mode, would book and send: "Great news, ${firstName}! I've scheduled your inspection for [DATE] at [TIME]. [STAFF] will meet you at ${leadInfo?.address}. Confirmation email coming shortly!"]`;
                    debug.responseReason = 'ALL INFO COLLECTED - Ready to book!';
                }
            } else {
                // Fetch Knowledge Base context for Sarah
                let knowledgeBaseContext = '';
                try {
                    const kbArticles = await base44.asServiceRole.entities.KnowledgeBaseArticle.filter({
                        company_id: resolvedCompanyId,
                        is_ai_training: true
                    });
                    
                    if (kbArticles.length > 0) {
                        const topArticles = kbArticles.slice(0, 5);
                        knowledgeBaseContext = '\nKnowledge Base Context:\n' + 
                            topArticles.map(a => `- ${a.title}: ${a.content?.substring(0, 200)}`).join('\n');
                    }
                } catch (e) {
                    console.log('KB fetch optional:', e.message);
                }
                
                // Also fetch AITrainingData for additional context - try company-specific first, then all active
                let trainingContext = '';
                try {
                    let trainingData = await base44.asServiceRole.entities.AITrainingData.filter({
                        company_id: resolvedCompanyId,
                        is_active: true
                    });
                    
                    if (!trainingData) trainingData = [];
                    
                    if (trainingData.length > 0) {
                        trainingContext = '\nCompany Training Data:\n' + 
                            trainingData.slice(0, 5).map(t => t.content?.substring(0, 500)).filter(Boolean).join('\n');
                        console.log('📚 Training context length:', trainingContext.length);
                    }
                } catch (e) {
                    console.log('Training data fetch optional:', e.message);
                }
                
                // Fetch company website info
                let websiteInfo = '';
                try {
                    const profiles = await base44.asServiceRole.entities.CompanyProfile.filter({ company_id: resolvedCompanyId });
                    if (profiles[0]?.website) {
                        websiteInfo = `\nCompany Website: ${profiles[0].website}`;
                    }
                } catch (e) {}
                
                // Check if Sarah has website_urls or knowledge_base in settings
                let sarahKnowledge = '';
                if (settings.website_urls && settings.website_urls.length > 0) {
                    sarahKnowledge += `\nCompany Websites: ${settings.website_urls.join(', ')}`;
                }
                if (settings.knowledge_base) {
                    sarahKnowledge += `\nSarah's Knowledge Base:\n${settings.knowledge_base}`;
                }

                // General conversation
                const recentContext = recentMessages.slice(0, 8).reverse()
                    .map(m => `${m.direction === 'inbound' ? 'Customer' : 'Sarah'}: ${m.message}`)
                    .join('\n');

                let collectPrompt = '';
                if (isNewContact && missingInfo.includes('name')) {
                    collectPrompt = `\n- You don't know their name yet. Naturally ask for it early in conversation.`;
                }

                // Use the custom system prompt if available, otherwise default with dynamic name
                const baseInstructions = settings.system_prompt || `You are ${agentName}, a friendly AI assistant for ${companyName}, a roofing company.`;

                // Build combined knowledge context
                const combinedKnowledge = [
                    knowledgeBaseContext,
                    trainingContext,
                    websiteInfo,
                    sarahKnowledge
                ].filter(Boolean).join('\n');
                
                console.log('🧠 Combined knowledge length:', combinedKnowledge.length);

                const aiPrompt = `${baseInstructions}

IMPORTANT KNOWLEDGE ABOUT ${companyName.toUpperCase()}:
${combinedKnowledge || 'No additional knowledge loaded.'}

Recent conversation:
${recentContext}

Customer just said: "${message}"

What you know about this customer:
- Name: ${contactName !== 'Unknown' ? contactName : 'Not yet collected'}
- Has address: ${leadInfo?.has_address ? 'Yes' : 'No'}
- Has email: ${leadInfo?.has_email ? 'Yes' : 'No'}
${collectPrompt}

Guidelines:
- Be warm, conversational, and helpful
- If they mention roof damage/issues, express concern and ask about scheduling an inspection
- Keep responses under 160 characters
- NEVER repeat questions they already answered
- If this seems like a new inquiry, introduce yourself and ask how you can help

Respond with ONLY your message:`;

                try {
                    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
                        prompt: aiPrompt
                    });
                    responseText = aiResponse || `Hi! This is ${agentName} from ${companyName}. How can I help you today?`;
                    debug.responseReason = 'AI-generated general response';
                } catch (e) {
                    if (isNewContact) {
                        responseText = `Hi! This is ${agentName} from ${companyName}. How can I help you with your roofing needs?`;
                    } else {
                        responseText = `Thanks for reaching out! How can I help you today?`;
                    }
                    debug.responseReason = 'Fallback response (AI failed)';
                }
            }
        }

        // Limit length
        if (responseText.length > 300) {
            responseText = responseText.slice(0, 297) + '...';
        }

        // Log test messages to Communication (so context builds up in test)
        await base44.asServiceRole.entities.Communication.create({
            company_id: resolvedCompanyId,
            contact_name: contactName,
            contact_phone: from,
            communication_type: 'sms',
            direction: 'inbound',
            subject: 'Test SMS',
            message: message,
            status: 'delivered'
        });

        await base44.asServiceRole.entities.Communication.create({
            company_id: resolvedCompanyId,
            contact_name: contactName,
            contact_phone: from,
            communication_type: 'sms',
            direction: 'outbound',
            subject: 'Sarah Test',
            message: responseText,
            status: 'sent'
        });

        return Response.json({
            success: true,
            response: responseText,
            debug
        });

    } catch (error) {
        console.error('❌ Test error:', error.message);
        return Response.json({ 
            error: error.message,
            debug: { responseReason: 'Error: ' + error.message }
        }, { status: 500 });
    }
});