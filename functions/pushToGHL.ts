import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function headers(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const { entityType, entityId, action = 'create' } = await req.json();
        if (entityType && entityType !== 'Lead') {
            return Response.json({ success: false, message: 'Unsupported entity type or action' });
        }

        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
        let companyId = staffProfiles[0]?.company_id;
        if (!companyId) {
            const companies = await base44.entities.Company.filter({ created_by: user.email });
            companyId = companies[0]?.id;
        }
        if (!companyId) return Response.json({ success: false, error: 'Company not found' }, { status: 400 });

        const leads = await base44.entities.Lead.filter({ id: entityId });
        const lead = leads[0];
        if (!lead) return Response.json({ success: false, error: 'Lead not found' }, { status: 404 });
        if (lead.company_id && lead.company_id !== companyId && user.role !== 'admin') {
            return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        let settings = await base44.entities.IntegrationSetting.filter({ company_id: lead.company_id || companyId, integration_name: 'gohighlevel' });
        if (!settings.length) {
            settings = await base44.entities.IntegrationSetting.filter({ company_id: lead.company_id || companyId, integration_name: 'GoHighLevel' });
        }
        const config = settings[0]?.config || {};
        const token = config.api_key || Deno.env.get('GHL_API_KEY');
        const locationId = config.location_id;
        if (!token) return Response.json({ success: false, error: 'GHL token not configured' }, { status: 400 });
        if (!locationId) return Response.json({ success: false, error: 'Location ID not configured. Please set it in GoHighLevel Settings.' });
        if (config.push_new_leads === false) {
            return Response.json({ success: false, skipped: true, message: 'Push new leads is disabled' });
        }

        const nameParts = String(lead.name || '').trim().split(/\s+/);
        const ghlContact = {
            firstName: nameParts[0] || '',
            lastName: nameParts.slice(1).join(' ') || '',
            email: lead.email || undefined,
            phone: lead.phone || undefined,
            address1: lead.street || lead.address || undefined,
            city: lead.city || undefined,
            state: lead.state || undefined,
            postalCode: lead.zip || undefined,
            companyName: lead.company || undefined,
            source: lead.source || 'CompanySync',
            locationId,
        };

        if (action === 'update' && lead.ghl_contact_id) {
            const response = await fetch(`${GHL_API_BASE}/contacts/${lead.ghl_contact_id}`, {
                method: 'PUT',
                headers: headers(token),
                body: JSON.stringify(ghlContact),
            });
            if (!response.ok) {
                return Response.json({ success: false, error: `Failed to update contact in GHL: ${await response.text()}` }, { status: 400 });
            }
            return Response.json({ success: true, ghlContactId: lead.ghl_contact_id, message: 'Contact updated in GoHighLevel' });
        }

        const response = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify(ghlContact),
        });
        if (!response.ok) {
            return Response.json({ success: false, error: `Failed to create contact in GHL: ${await response.text()}` }, { status: 400 });
        }
        const ghlData = await response.json();
        const ghlId = ghlData.contact?.id || ghlData.id;
        if (ghlId) {
            await base44.entities.Lead.update(entityId, { ghl_contact_id: ghlId });
        }
        return Response.json({ success: true, ghlContactId: ghlId, message: 'Contact created in GoHighLevel' });
    } catch (error) {
        console.error('❌ Push to GHL Error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});
