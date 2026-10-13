import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // 1. Authenticate Request
        // Webhooks don't have user auth headers, so we validate differently or look up context
        // GHL doesn't sign webhooks consistently, so we often rely on the URL path or finding the matching company
        
        const payload = await req.json();
        console.log('📥 GHL Webhook received:', JSON.stringify(payload, null, 2));

        // Get location_id from payload to identify company
        const locationId = payload.locationId || payload.location_id;
        
        if (!locationId) {
            return Response.json({ error: 'No location_id in payload' }, { status: 400 });
        }

        // Find company associated with this GHL Location ID
        // We look for IntegrationSetting with this location_id in its config
        // Since we can't easily query inside JSON columns with standard filter in some DBs, 
        // we might need to rely on the company having the GHL_LOCATION_ID secret set if we can't find via IntegrationSetting.
        // BETTER APPROACH: The webhook URL could include ?companyId=... but GHL webhooks are often set globally.
        // Let's try to find the company by querying IntegrationSettings.
        
        // Strategy: List all enabled GHL integrations and match location_id
        // NOTE: This might be slow if there are many companies. 
        // Alternative: The user sets the webhook URL in GHL to include the company ID: /api/functions/ghlWebhook?company_id=XYZ
        
        const url = new URL(req.url);
        let companyId = url.searchParams.get('company_id');
        let companyOwner = null;

        if (!companyId) {
            // Try to find by location_id matching stored secrets/settings
            // This is complex without a direct index. 
            // Fallback: If no company_id param, we might process for the 'first' match or fail.
            // For now, let's assume the GHL setup instructions tell them to append ?company_id=... 
            // OR we fetch all companies and check their IntegrationSetting (expensive but accurate)
            
            const settings = await base44.asServiceRole.entities.IntegrationSetting.filter({ 
                integration_name: 'GoHighLevel',
                is_enabled: true
            });
            
            const match = settings.find(s => s.config?.location_id === locationId);
            if (match) {
                companyId = match.company_id;
            }
        }

        if (!companyId) {
            console.warn(`⚠️ Could not identify company for GHL Location ${locationId}`);
            return Response.json({ error: 'Company not found for this GHL Location' }, { status: 404 });
        }

        // Get Company Owner for assignment fallback
        const company = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        if (company && company.length > 0) {
            companyOwner = company[0].created_by;
        }

        // Detect event type
        let eventType = payload.type || payload.event;
        if (!eventType && (payload.call_from || payload.call_to || payload.call_duration)) {
            eventType = 'CallStatus';
        }
        if (!eventType) eventType = 'unknown';
        
        console.log(`Processing ${eventType} for company ${companyId}`);

        // Handle event types
        switch (eventType) {
            case 'ContactCreate':
            case 'contact.created':
                await handleContactCreated(base44, companyId, payload, companyOwner);
                break;
            
            case 'ContactUpdate':
            case 'contact.updated':
                await handleContactUpdated(base44, companyId, payload, companyOwner);
                break;
            
            case 'OpportunityCreate':
            case 'opportunity.created':
                await handleOpportunityCreated(base44, companyId, payload, companyOwner);
                break;
            
            case 'NoteCreate':
            case 'note.created':
                await handleNoteCreated(base44, companyId, payload, companyOwner);
                break;
            
            case 'InboundMessage':
            case 'message.inbound':
                await handleInboundMessage(base44, companyId, payload, companyOwner);
                break;
            
            case 'OutboundMessage':
            case 'message.outbound':
                await handleOutboundMessage(base44, companyId, payload, companyOwner);
                break;

            case 'CallStatus':
            case 'call.status':
            case 'call.completed':
                await handleCallStatus(base44, companyId, payload, companyOwner);
                break;

            default:
                console.log('⚠️ Unhandled GHL event type:', eventType);
        }

        return Response.json({ success: true });

    } catch (error) {
        console.error('❌ GHL Webhook Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

// --- HELPER FUNCTIONS ---

// 1. Handle Contact Creation
async function handleContactCreated(base44, companyId, payload, ownerEmail) {
    const contact = payload.contact || payload.data || payload; // GHL payload structure varies
    const leadData = mapGHLToLead(contact, companyId, ownerEmail);
    
    // Check duplicates
    const existing = await findExistingLead(base44, companyId, contact.id, contact.email, contact.phone);
    
    if (existing) {
        console.log(`Lead already exists (ID: ${existing.id}), updating...`);
        await base44.asServiceRole.entities.Lead.update(existing.id, leadData);
    } else {
        console.log('Creating new lead from GHL...');
        await base44.asServiceRole.entities.Lead.create(leadData);
        
        // Notify admins
        await notifyAdmins(base44, companyId, `New GHL Lead: ${leadData.name}`);
    }
}

// 2. Handle Contact Update
async function handleContactUpdated(base44, companyId, payload, ownerEmail) {
    // Logic is same as create - upsert
    await handleContactCreated(base44, companyId, payload, ownerEmail);
}

// 3. Handle Opportunity
async function handleOpportunityCreated(base44, companyId, payload, ownerEmail) {
    const opp = payload.opportunity || payload;
    const contactId = opp.contact_id || opp.contactId;
    
    if (!contactId) return;

    // Find the lead
    const existing = await findExistingLead(base44, companyId, contactId);
    if (!existing) return;

    // Update lead status/value
    const updates = {};
    if (opp.status === 'won') updates.status = 'won';
    if (opp.status === 'lost') updates.status = 'lost';
    if (opp.monetary_value) updates.value = parseFloat(opp.monetary_value);
    
    // Append to notes
    const newNote = `\n[GHL Opportunity]: ${opp.name} - Status: ${opp.status} - Pipeline: ${opp.pipeline_id}`;
    updates.notes = (existing.notes || '') + newNote;

    await base44.asServiceRole.entities.Lead.update(existing.id, updates);
}

// 4. Handle Note
async function handleNoteCreated(base44, companyId, payload, ownerEmail) {
    const contactId = payload.contact_id || payload.contactId;
    const noteBody = payload.body || payload.description;

    if (!contactId || !noteBody) return;

    const existing = await findExistingLead(base44, companyId, contactId);
    if (!existing) return;

    const updates = {
        notes: (existing.notes || '') + `\n[GHL Note]: ${noteBody}`
    };
    await base44.asServiceRole.entities.Lead.update(existing.id, updates);
}

// 5. Handle Inbound Message
async function handleInboundMessage(base44, companyId, payload, ownerEmail) {
    const contactId = payload.contact_id || payload.contactId;
    const body = payload.body || payload.message;
    const type = payload.messageType || 'sms';

    // Create Communication record
    await base44.asServiceRole.entities.Communication.create({
        company_id: companyId,
        communication_type: type === 'email' ? 'email' : 'sms',
        direction: 'inbound',
        message: body,
        contact_phone: payload.phone,
        contact_email: payload.email,
        status: 'received',
        subject: `GHL Inbound ${type}`,
        notes: `GHL Contact ID: ${contactId}`
    });
}

// 6. Handle Outbound Message
async function handleOutboundMessage(base44, companyId, payload, ownerEmail) {
    const contactId = payload.contact_id || payload.contactId;
    const body = payload.body || payload.message;
    const type = payload.messageType || 'sms';

    // Create Communication record
    await base44.asServiceRole.entities.Communication.create({
        company_id: companyId,
        communication_type: type === 'email' ? 'email' : 'sms',
        direction: 'outbound',
        message: body,
        contact_phone: payload.phone,
        contact_email: payload.email,
        status: 'sent',
        subject: `GHL Outbound ${type}`,
        notes: `GHL Contact ID: ${contactId}`
    });
}

// 7. Handle Call Status
async function handleCallStatus(base44, companyId, payload, ownerEmail) {
    const direction = payload.direction || 'inbound';
    const status = payload.status || 'completed';
    const duration = parseInt(payload.duration || '0', 10);
    
    await base44.asServiceRole.entities.Communication.create({
        company_id: companyId,
        communication_type: 'call',
        direction: direction,
        message: `Call ${status} - Duration: ${duration}s`,
        contact_phone: direction === 'inbound' ? payload.from : payload.to,
        status: status === 'completed' ? 'completed' : 'failed',
        subject: `GHL Call ${status}`,
        duration_minutes: Math.ceil(duration / 60),
        recording_url: payload.recordingUrl || payload.recording_url
    });
}

// --- UTILITIES ---

function mapGHLToLead(contact, companyId, ownerEmail) {
    // Map basic fields
    const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown GHL Contact';
    
    // Parse Custom Fields to Notes/Tags
    let notes = `GHL ID: ${contact.id}\n`;
    const tags = contact.tags || [];
    
    if (contact.customFields) {
        contact.customFields.forEach(field => {
            notes += `${field.name || field.key}: ${field.value}\n`;
        });
    }

    return {
        company_id: companyId,
        ghl_contact_id: contact.id,
        name: name,
        email: contact.email,
        phone: contact.phone || contact.phoneNumber,
        status: 'new',
        source: 'gohighlevel',
        lead_source: contact.source || 'GHL Integration',
        notes: notes,
        tags: tags,
        assigned_to: ownerEmail, // Default to owner
        address: contact.address1,
        city: contact.city,
        state: contact.state,
        zip: contact.postalCode,
        country: contact.country
    };
}

async function findExistingLead(base44, companyId, ghlId, email, phone) {
    const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 1000);
    
    // 1. Match GHL ID
    if (ghlId) {
        const match = leads.find(l => l.ghl_contact_id === ghlId);
        if (match) return match;
    }
    
    // 2. Match Email
    if (email) {
        const match = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());
        if (match) return match;
    }

    // 3. Match Phone
    if (phone) {
        const cleanPhone = p => p.replace(/\D/g, '').slice(-10);
        const target = cleanPhone(phone);
        if (target.length >= 10) {
            const match = leads.find(l => l.phone && cleanPhone(l.phone) === target);
            if (match) return match;
        }
    }
    
    return null;
}

async function notifyAdmins(base44, companyId, message) {
    // Implementation to notify admins (email or in-app notification)
    // For now, just a placeholder or basic Communication log
    // Real implementation would look up admins and send emails/push
}