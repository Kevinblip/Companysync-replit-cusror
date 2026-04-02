import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// Helper function to normalize phone numbers to just digits
const normalizePhone = (phone) => {
  if (!phone) return '';
  // Remove all non-digit characters and keep the last 10 digits for US numbers
  return phone.replace(/\D/g, '').slice(-10); 
};

Deno.serve(async (req) => {
    // Initialize client from request
    // We use asServiceRole for all operations since this is a public webhook
    try {
        const base44 = createClientFromRequest(req);
        const raw = await req.json();
        console.log('✅ Received Thoughtly webhook (raw):', JSON.stringify(raw, null, 2));
        const dataIsObject = raw && typeof raw.data === 'object' && raw.data !== null && !Array.isArray(raw.data);
        const webhookData = dataIsObject ? raw.data : raw;
        console.log('🔍 Parsed Thoughtly payload:', JSON.stringify(webhookData, null, 2));

        const agentId = 
            (webhookData && (webhookData.agent_id || webhookData.agentId || webhookData.agent?.id)) ||
            (raw && (raw.agent_id || raw.agentId)) ||
            (typeof raw?.data === 'string' ? raw.data : undefined);
        const from = webhookData.from || webhookData.customer?.phone || webhookData.phone || webhookData.caller?.phone || webhookData.customer_phone;
        const mainTwilioNumber = webhookData.to || webhookData.organization?.phone || webhookData.called_number || webhookData.to_number;
        let companyId = null;
        let contactName = webhookData.customer_name || webhookData.customer?.name || webhookData.name || 'Unknown Caller';

        if (!from || !mainTwilioNumber) {
            console.warn('⚠️ Missing from/to in Thoughtly webhook. Will try to proceed using agent/company mapping. Payload:', webhookData);
        }
        
        const normalizedWebhookNumber = normalizePhone(mainTwilioNumber);
        console.log(`📞 Incoming call to normalized number: ${normalizedWebhookNumber || 'unknown'}`);

        // 1. Try identify by Agent ID first (most reliable)
        const allTwilioSettings = await base44.asServiceRole.entities.TwilioSettings.list();
        if (!companyId && agentId) {
            const tsByAgent = allTwilioSettings.find(s => (s.thoughtly_agent_id && s.thoughtly_agent_id === agentId));
            if (tsByAgent) {
                companyId = tsByAgent.company_id;
                console.log(`✅ Identified company via Thoughtly Agent ID: ${agentId}`);
            }
        }

        // 2. Try Twilio Settings (Main/Thoughtly Number)
        let twilioSetting;
        if (!companyId) {
            twilioSetting = allTwilioSettings.find(s => (
                normalizePhone(s.main_phone_number) === normalizedWebhookNumber ||
                normalizePhone(s.thoughtly_phone) === normalizedWebhookNumber
            ));
        }

        if (twilioSetting) {
            companyId = twilioSetting.company_id;
            console.log(`✅ Identified company via Twilio Number: ${normalizedWebhookNumber}`);
        } else {
            // 2. Try Assistant Settings (Thoughtly Number)
            console.log(`⚠️ Number ${normalizedWebhookNumber} not found in Twilio settings. Checking Assistant settings...`);
            const allAssistantSettings = await base44.asServiceRole.entities.AssistantSettings.list();
            const assistantSetting = allAssistantSettings.find(s => normalizePhone(s.thoughtly_phone) === normalizedWebhookNumber);
            
            if (assistantSetting) {
                companyId = assistantSetting.company_id;
                console.log(`✅ Identified company via Thoughtly Number: ${normalizedWebhookNumber}`);
            }
        }

        // 3) If still no company and we have assistant settings thoughtly_phone
        if (!companyId) {
            console.log(`⚠️ Number ${normalizedWebhookNumber} not found in Twilio settings. Checking Assistant settings...`);
            const allAssistantSettings = await base44.asServiceRole.entities.AssistantSettings.list();
            const assistantSetting = allAssistantSettings.find(s => normalizePhone(s.thoughtly_phone) === normalizedWebhookNumber);
            
            if (assistantSetting) {
                companyId = assistantSetting.company_id;
                console.log(`✅ Identified company via Thoughtly Number in Assistant Settings: ${normalizedWebhookNumber}`);
            }
        }

        if (!companyId) {
            console.error(`❌ No company found for phone number: ${normalizedWebhookNumber}`);
            // Return 200 OK even on error to prevent Thoughtly from hanging up due to webhook failure
            return new Response(JSON.stringify({ success: false, error: 'Company not found', debug: { agentId, to: mainTwilioNumber, normalized: normalizedWebhookNumber } }), { status: 200 });
        }
        
        const company = await base44.asServiceRole.entities.Company.get(companyId);
        console.log(`✅ Found company: ${company.company_name} (ID: ${companyId})`);

        // Find or create lead using service role
        let lead;
        const existingLeads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId, phone: from });
        
        if (existingLeads.length > 0) {
            lead = existingLeads[0];
            contactName = lead.name;
            console.log(`✅ Found existing lead: ${lead.name} (ID: ${lead.id})`);
        } else {
            console.log(`⏳ Creating new lead for ${from}...`);
            const newLeadData = {
                company_id: companyId,
                name: contactName,
                phone: from,
                email: webhookData.email || webhookData.customer?.email || '',
                source: 'ai',
                lead_source: 'Sarah AI Assistant',
                status: 'new',
                notes: webhookData.notes || webhookData.summary || ''
            };
            lead = await base44.asServiceRole.entities.Lead.create(newLeadData);
            console.log(`✅ Successfully created new lead: ${lead.name} (ID: ${lead.id})`);
        }

        // Log the communication (call or SMS) using service role
        console.log('✍️ Logging communication...');
        const eventType = ((raw?.type || webhookData?.type) || '').toString().toLowerCase();
        const channel = ((webhookData?.channel || webhookData?.source) || '').toString().toLowerCase();
        const hasRecording = !!(webhookData.recording_url || webhookData.recordingUrl || webhookData.recording?.url);
        const isSms = channel.includes('sms') || eventType.includes('sms') || eventType.includes('text') || (!!webhookData.message && !hasRecording);
        const contactPhone = isSms
          ? (webhookData.customer_phone || webhookData.customer?.phone || webhookData.to || from)
          : (from);
        const directionRaw = (webhookData.direction || webhookData.msg_direction || '').toString().toLowerCase();
        const direction = isSms ? (directionRaw.includes('in') ? 'inbound' : 'outbound') : 'inbound';

        const communicationLog = {
            // raw Thoughtly type for debugging
            thoughtly_event_type: raw?.type || webhookData?.type || undefined,
            company_id: companyId,
            contact_name: contactName,
            contact_phone: contactPhone,
            communication_type: isSms ? 'sms' : 'call',
            direction,
            subject: isSms ? 'Sarah AI SMS' : `Sarah AI Call: ${webhookData.intent || webhookData.summary?.intent || 'General Inquiry'}`,
            message: webhookData.transcript || webhookData.conversation || webhookData.response || webhookData.message || (webhookData.messages ? JSON.stringify(webhookData.messages) : 'No transcript'),
            transcription: hasRecording ? (webhookData.transcript || webhookData.conversation || webhookData.response || webhookData.message) : undefined,
            recording_url: hasRecording ? (webhookData.recording_url || webhookData.recordingUrl || webhookData.recording?.url) : undefined,
            duration_minutes: hasRecording && webhookData.duration ? Math.ceil(webhookData.duration / 60) : (isSms ? undefined : 0),
            status: 'completed',
            outcome: webhookData.intent || webhookData.summary?.intent || (isSms ? 'sent' : 'completed'),
            intent: webhookData.intent || webhookData.summary?.intent
        };
        await base44.asServiceRole.entities.Communication.create(communicationLog);
        console.log('✅ Communication logged successfully.');

        // --- AUTOMATION BASED ON INTENT ---
        const intent = webhookData.summary?.intent;
        if (intent === 'schedule_appointment' || intent === 'send_calendar_link') {
            console.log(`🎯 Intent detected: ${intent}. Attempting to send calendar link.`);
            
            let staffMember = null;
            if (lead.assigned_to) {
                const staff = await base44.asServiceRole.entities.User.filter({ company_id: companyId, email: lead.assigned_to });
                if (staff.length > 0) staffMember = staff[0];
            }
            
            if (!staffMember) {
                const admins = await base44.asServiceRole.entities.User.filter({ company_id: companyId }); // Just get all users and pick first for now
                if (admins.length > 0) staffMember = admins[0];
            }

            if (staffMember && staffMember.calendar_link) {
                const message = `Hi ${lead.name}, here is the link to schedule an appointment as you requested: ${staffMember.calendar_link}`;
                
                await base44.asServiceRole.functions.invoke('sendSMS', {
                    to: lead.phone,
                    from: mainTwilioNumber, // This might be Thoughtly number, ensure sendSMS handles it or use TwilioSettings.main_phone_number
                    body: message,
                    contactName: lead.name,
                    companyId: companyId
                });

                console.log(`✅ Successfully sent calendar link SMS to ${lead.phone}`);

            } else {
                console.warn(`⚠️ Could not send calendar link. Staff member ${staffMember?.email || 'not found'} has no calendar link set.`);
            }
        }

        return new Response(JSON.stringify({ success: true, message: "Webhook processed" }), { status: 200 });

    } catch (error) {
        console.error('❌ Thoughtly Webhook Error:', error);
        // Always return 200 to Thoughtly so it doesn't think the call failed
        return new Response(JSON.stringify({ success: false, error: error.message }), { status: 200 });
    }
});