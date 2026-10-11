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

async function resolveCompanyId(base44: any, user: any, requested?: string) {
    const staff = await base44.entities.StaffProfile.filter({ user_email: user.email });
    const owned = await base44.entities.Company.filter({ created_by: user.email });
    const allowed = new Set([
        ...staff.map((row: any) => row.company_id),
        ...owned.map((row: any) => row.id),
    ].filter(Boolean));
    if (requested) return allowed.has(requested) ? requested : null;
    return [...allowed][0] || null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const companyId = await resolveCompanyId(base44, user, body.company_id);
        if (!companyId) return Response.json({ success: false, error: 'Company not found for this user' }, { status: 400 });

        const locationId = String(body.location_id || body.locationId || '').trim();
        const incomingKey = String(body.api_key || body.apiKey || body.token || '').trim();

        const existing = await base44.entities.IntegrationSetting.filter({
            company_id: companyId,
            integration_name: 'gohighlevel',
        });
        const current = existing[0];
        const token = incomingKey || current?.config?.api_key || Deno.env.get('GHL_API_KEY');
        if (!locationId) return Response.json({ success: false, error: 'Location ID is required' }, { status: 400 });
        if (!token) return Response.json({ success: false, error: 'Paste a GoHighLevel Private Integration token (or set GHL_API_KEY).' }, { status: 400 });

        const verify = await fetch(`${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}`, { headers: headers(token) });
        if (!verify.ok) {
            const fallback = await fetch(`${GHL_API_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`, { headers: headers(token) });
            if (!fallback.ok) {
                const detail = await verify.text();
                return Response.json({ success: false, connected: false, error: `GoHighLevel connection failed (${verify.status}): ${detail.slice(0, 300)}` }, { status: 400 });
            }
        }

        const locationJson = verify.ok ? await verify.json().catch(() => ({})) : {};
        const locationName = locationJson?.location?.name || locationJson?.name || current?.config?.location_name || null;
        const payload = {
            company_id: companyId,
            integration_name: 'gohighlevel',
            is_enabled: body.is_enabled !== false,
            config: {
                ...(current?.config || {}),
                location_id: locationId,
                location_name: locationName,
                api_key: incomingKey || current?.config?.api_key,
                push_new_leads: body.push_new_leads !== false,
                import_contacts: body.import_contacts !== false,
                last_connection_at: new Date().toISOString(),
                last_sync_error: null,
            },
        };

        if (current?.id) await base44.entities.IntegrationSetting.update(current.id, payload);
        else await base44.entities.IntegrationSetting.create(payload);

        return Response.json({
            success: true,
            connected: true,
            is_enabled: true,
            has_api_key: true,
            api_key_masked: token.length > 4 ? `••••${token.slice(-4)}` : '••••',
            location_id: locationId,
            location_name: locationName,
            push_new_leads: payload.config.push_new_leads,
            import_contacts: payload.config.import_contacts,
        });
    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});
