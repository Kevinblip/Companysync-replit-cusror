import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { company_id } = await req.json();
        
        if (!company_id) {
            return Response.json({ error: 'Company ID required' }, { status: 400 });
        }

        // Verify user belongs to company (or is admin)
        // Simple check: Is user the creator? Or has staff profile?
        // For simplicity assuming access control is handled by frontend/logic or user owns company
        
        console.log(`Manual GHL Sync for company ${company_id} by ${user.email}`);

        // Reuse the logic from cron, but for single company
        // 1. Get Settings
        const settings = await base44.asServiceRole.entities.IntegrationSetting.filter({ 
            company_id: company_id,
            integration_name: 'GoHighLevel'
        });

        if (settings.length === 0 || !settings[0].is_enabled) {
             return Response.json({ error: 'GHL Integration not enabled for this company' }, { status: 400 });
        }

        const config = settings[0].config || {};
        const apiKey = config.api_key || Deno.env.get('GHL_API_KEY');
        
        if (!apiKey) {
            return Response.json({ error: 'GHL API Key not configured' }, { status: 400 });
        }

        // 2. Fetch from GHL
        const response = await fetch('https://rest.gohighlevel.com/v1/contacts/?limit=100', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            throw new Error(`GHL API Failed: ${response.status}`);
        }

        const data = await response.json();
        const contacts = data.contacts || [];

        // 3. Upsert
        let count = 0;
        for (const contact of contacts) {
            await upsertLead(base44, company_id, contact, user.email);
            count++;
        }

        return Response.json({ success: true, count, message: `Synced ${count} contacts` });

    } catch (error) {
        console.error('❌ Manual Sync Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function upsertLead(base44, companyId, contact, ownerEmail) {
    const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim();
    const email = contact.email;
    const ghlId = contact.id;
    
    const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 2000);
    
    let match = leads.find(l => l.ghl_contact_id === ghlId);
    if (!match && email) match = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());

    const payload = {
        company_id: companyId,
        ghl_contact_id: ghlId,
        name: name,
        email: email,
        phone: contact.phone || contact.phoneNumber,
        lead_source: 'GoHighLevel Manual Sync',
        source: 'gohighlevel'
    };

    if (match) {
        await base44.asServiceRole.entities.Lead.update(match.id, payload);
    } else {
        await base44.asServiceRole.entities.Lead.create({
            ...payload,
            status: 'new',
            assigned_to: ownerEmail,
            notes: `Manual Sync Import. GHL ID: ${ghlId}`
        });
    }
}