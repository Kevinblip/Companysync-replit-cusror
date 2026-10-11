import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const { company_id, locationId } = await req.json().catch(() => ({}));
        const staff = await base44.entities.StaffProfile.filter({ user_email: user.email });
        const owned = await base44.entities.Company.filter({ created_by: user.email });
        const allowed = new Set([...staff.map((s: any) => s.company_id), ...owned.map((c: any) => c.id)].filter(Boolean));
        const companyId = company_id && allowed.has(company_id) ? company_id : [...allowed][0];
        if (!companyId) return Response.json({ success: false, error: 'Company not found' }, { status: 400 });

        let settings = await base44.entities.IntegrationSetting.filter({ company_id: companyId, integration_name: 'gohighlevel' });
        if (!settings.length) settings = await base44.entities.IntegrationSetting.filter({ company_id: companyId, integration_name: 'GoHighLevel' });
        const config = settings[0]?.config || {};
        const token = config.api_key || Deno.env.get('GHL_API_KEY');
        const loc = locationId || config.location_id;
        if (!token) return Response.json({ success: false, error: 'No API Key' }, { status: 400 });
        if (!loc) return Response.json({ success: false, error: 'Location ID not configured' }, { status: 400 });

        const response = await fetch(`${GHL_API_BASE}/contacts/?locationId=${encodeURIComponent(loc)}&limit=1`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Version: GHL_VERSION,
                Accept: 'application/json',
            },
        });
        if (!response.ok) {
            return Response.json({ success: false, error: `API Error: ${response.status}`, details: await response.text() });
        }
        const data = await response.json();
        const contact = data.contacts?.[0];
        if (!contact) return Response.json({ success: true, message: 'Connection successful, but no contacts found.' });
        return Response.json({
            success: true,
            message: 'Connection successful!',
            sample: { name: contact.contactName || contact.name || contact.firstName, email: contact.email },
        });
    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});
