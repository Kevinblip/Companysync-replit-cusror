import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

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

function mask(raw?: string) {
    if (!raw) return '';
    return raw.length > 4 ? `••••${raw.slice(-4)}` : '••••';
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const companyId = await resolveCompanyId(base44, user, body.company_id);
        if (!companyId) return Response.json({ success: false, error: 'Company not found for this user' }, { status: 400 });

        const settings = await base44.entities.IntegrationSetting.filter({
            company_id: companyId,
            integration_name: 'gohighlevel',
        });
        const current = settings[0];
        const config = current?.config || {};
        const hasKey = Boolean(config.api_key || Deno.env.get('GHL_API_KEY'));
        const locationId = config.location_id || '';
        const connected = Boolean(hasKey && locationId && current?.is_enabled !== false);

        return Response.json({
            success: true,
            company_id: companyId,
            connected,
            is_enabled: current?.is_enabled !== false,
            has_api_key: hasKey,
            uses_env_fallback: !config.api_key && Boolean(Deno.env.get('GHL_API_KEY')),
            api_key_masked: config.api_key ? mask(config.api_key) : (Deno.env.get('GHL_API_KEY') ? '••••env' : ''),
            location_id: locationId,
            location_name: config.location_name || null,
            last_sync_at: config.last_sync_at || null,
            last_sync_error: config.last_sync_error || null,
            last_sync_result: config.last_sync_result || null,
            push_new_leads: config.push_new_leads !== false,
            import_contacts: config.import_contacts !== false,
        });
    } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});
