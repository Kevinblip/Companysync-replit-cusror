import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import twilio from 'npm:twilio';

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
        let from, to, callSid;
        
        // Parse Twilio request
        if (contentType.includes('application/x-www-form-urlencoded')) {
            const formData = await req.formData();
            from = formData.get('From');
            to = formData.get('To');
            callSid = formData.get('CallSid');
        } else if (contentType.includes('application/json')) {
            const json = await req.json();
            from = json.From || json.from;
            to = json.To || json.to;
            callSid = json.CallSid || json.callSid;
        } else {
            // Fallback for query params
            const url = new URL(req.url);
            to = url.searchParams.get('To');
            from = url.searchParams.get('From');
            callSid = url.searchParams.get('CallSid');
        }
        
        console.log('📞 Incoming call from:', from, 'to:', to);

        // 1. Find Settings for this number
        const normalizedTo = normalizePhone(to);
        const normalizedFrom = normalizePhone(from);
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

            // 2. Look up the caller's contact info from CRM
            let contactName = 'Unknown Caller';
            let contactId = null;
            let contactType = null;

            if (normalizedFrom) {
                try {
                    const [customers, leads] = await Promise.all([
                        base44.asServiceRole.entities.Customer.filter({ company_id: settings.company_id }),
                        base44.asServiceRole.entities.Lead.filter({ company_id: settings.company_id })
                    ]);

                    const matchedCustomer = customers.find(c =>
                        normalizePhone(c.phone) === normalizedFrom ||
                        normalizePhone(c.phone_2) === normalizedFrom
                    );
                    const matchedLead = leads.find(l =>
                        normalizePhone(l.phone) === normalizedFrom ||
                        normalizePhone(l.phone_2) === normalizedFrom
                    );

                    if (matchedCustomer) {
                        contactName = matchedCustomer.name || matchedCustomer.first_name || 'Unknown Caller';
                        contactId = matchedCustomer.id;
                        contactType = 'customer';
                        console.log(`👤 Caller identified as customer: ${contactName} (${contactId})`);
                    } else if (matchedLead) {
                        contactName = matchedLead.name || matchedLead.first_name || 'Unknown Caller';
                        contactId = matchedLead.id;
                        contactType = 'lead';
                        console.log(`👤 Caller identified as lead: ${contactName} (${contactId})`);
                    } else {
                        console.log(`👤 Caller not found in CRM: ${from}`);
                    }
                } catch (lookupErr) {
                    console.error('⚠️ Contact lookup error (non-critical):', lookupErr.message);
                }
            }

            // 3a. Fetch assistant settings to get the real name (used in the Communication record below)
            let resolvedAssistantName = 'AI Assistant';
            try {
                const allAssistantSettings = await base44.asServiceRole.entities.AssistantSettings.filter({
                    company_id: settings.company_id
                });
                if (allAssistantSettings[0]?.assistant_name) {
                    const raw = allAssistantSettings[0].assistant_name.trim();
                    resolvedAssistantName = raw.charAt(0).toUpperCase() + raw.slice(1);
                }
                console.log('🤖 Resolved assistant name:', resolvedAssistantName);
            } catch (nameErr) {
                console.warn('⚠️ Could not fetch assistant settings for name (non-critical):', nameErr.message);
            }

            // 3. Pre-create Communication record with real contact info
            try {
                const existing = await base44.asServiceRole.entities.Communication.filter({ twilio_sid: callSid });
                if (!existing || existing.length === 0) {
                    const commPayload: Record<string, unknown> = {
                        company_id: settings.company_id,
                        contact_name: contactName,
                        contact_phone: from || 'Unknown',
                        communication_type: 'call',
                        direction: 'inbound',
                        subject: `Inbound Call from ${contactName !== 'Unknown Caller' ? contactName : (from || 'Unknown')}`,
                        message: `${resolvedAssistantName} is handling this call. Recording will appear when complete.`,
                        twilio_sid: callSid,
                        status: 'in_progress'
                    };
                    if (contactId && contactType === 'customer') commPayload.customer_id = contactId;
                    if (contactId && contactType === 'lead') commPayload.lead_id = contactId;

                    await base44.asServiceRole.entities.Communication.create(commPayload);
                    console.log('✅ Pre-created inbound Communication for SID:', callSid, '| Contact:', contactName);
                } else if (contactId) {
                    // Record already exists (retry/duplicate path) — backfill contact info if we resolved a real match
                    const existingComm = existing[0];
                    const needsUpdate = existingComm.contact_name === 'Inbound Caller' ||
                        existingComm.contact_name === 'Unknown Caller' ||
                        existingComm.contact_name === 'Unknown';
                    if (needsUpdate) {
                        const updatePayload: Record<string, unknown> = { contact_name: contactName };
                        if (contactType === 'customer') updatePayload.customer_id = contactId;
                        if (contactType === 'lead') updatePayload.lead_id = contactId;
                        await base44.asServiceRole.entities.Communication.update(existingComm.id, updatePayload);
                        console.log('✅ Backfilled contact info on existing Communication:', existingComm.id, '| Contact:', contactName);
                    }
                }
            } catch (commErr) {
                console.error('⚠️ Could not pre-create/update Communication (non-critical):', commErr.message);
            }

            // 4. Start dual-channel recording via Twilio REST API
            const recordingEnabled = settings.enable_recording !== false; // default ON
            if (recordingEnabled && callSid && settings.account_sid && settings.auth_token) {
                try {
                    const cleanSid = String(settings.account_sid).trim().replace(/["']/g, '');
                    const cleanToken = String(settings.auth_token).trim().replace(/["']/g, '');
                    if (cleanSid.startsWith('AC')) {
                        const client = twilio(cleanSid, cleanToken);
                        // Use the public host for the callback — Twilio must be able to reach it.
                        // Prefer the explicit env var; fall back to the public origin this request arrived on.
                        const publicHost = Deno.env.get('PUBLIC_HOST') ||
                            Deno.env.get('REPLIT_WS_URL')?.replace('wss://', 'https://').replace('ws://', 'http://') ||
                            new URL(req.url).origin;
                        const recCallback = `${publicHost}/api/functions/recordingWebhook`;
                        // fire-and-forget so we don't delay TwiML response
                        client.calls(callSid).recordings.create({
                            recordingChannels: 'dual',
                            recordingStatusCallback: recCallback,
                            recordingStatusCallbackEvent: ['completed'],
                            recordingStatusCallbackMethod: 'POST'
                        }).then(rec => {
                            console.log('✅ Inbound recording started:', rec.sid, '| callback:', recCallback);
                        }).catch(err => {
                            console.error('⚠️ Failed to start inbound recording:', err.message);
                        });
                    }
                } catch (recErr) {
                    console.error('⚠️ Recording start error (non-critical):', recErr.message);
                }
            }
            
            // 5. Route to Gemini Live API for speech-to-speech
            // Route to Replit production server WebSocket for Gemini Live speech-to-speech
            const replitHost = Deno.env.get('REPLIT_WS_URL') || 'wss://getcompanysync.com';
            const coleDigits = (Deno.env.get('SALES_AGENT_PHONE_NUMBER') || '+18886703112').replace(/\D/g, '').slice(-10);
            const callerDigits = String(from || '').replace(/\D/g, '').slice(-10);
            const allowlist = (Deno.env.get('SALES_AGENT_PHONE_ALLOWLIST') || '')
                .split(',')
                .map((item) => item.replace(/\D/g, '').slice(-10))
                .filter(Boolean);
            if (coleDigits && normalizePhone(to) === coleDigits) {
                const allowed = allowlist.length === 0 || allowlist.includes(callerDigits);
                if (!allowed) {
                    const polite = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Matthew">Thanks for calling CompanySync. This test line can only take calls from the numbers we are checking right now. Please try getcompanysync.com.</Say>
    <Hangup/>
</Response>`;
                    return new Response(polite, { headers: { 'Content-Type': 'text/xml' } });
                }
                const salesStream = `${replitHost.replace(/\/$/, '')}/ws/sales-phone`;
                const coleTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Matthew">This call is recorded and transcribed so we can follow up accurately.</Say>
    <Connect>
        <Stream url="${escapeXml(salesStream)}">
            <Parameter name="from" value="${escapeXml(from || '')}" />
            <Parameter name="to" value="${escapeXml(to || '')}" />
            <Parameter name="callSid" value="${escapeXml(callSid || '')}" />
        </Stream>
    </Connect>
</Response>`;
                return new Response(coleTwiml, { headers: { 'Content-Type': 'text/xml' } });
            }
            const wsUrl = `${replitHost}/ws/twilio?companyId=${encodeURIComponent(settings.company_id)}`;
            console.log('📍 Replit WebSocket URL:', wsUrl);
            
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${escapeXml(wsUrl)}">
            <Parameter name="companyId" value="${escapeXml(settings.company_id)}" />
            <Parameter name="callerPhone" value="${escapeXml(from || '')}" />
            <Parameter name="contactName" value="${escapeXml(contactName)}" />
        </Stream>
    </Connect>
</Response>`;
            return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
        } else {
            console.log('❌ No Twilio settings found for this number');
        }

        // 6. Fallback: Default Greeting if no AI configured or Settings not found
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
