import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const MAX_PAGES = 10;

function headers(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
}

function displayName(contact: any) {
    return (contact?.name || contact?.contactName || `${contact?.firstName || ''} ${contact?.lastName || ''}`).trim() || 'Unknown';
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

async function loadSettings(base44: any, companyId: string) {
    let settings = await base44.entities.IntegrationSetting.filter({ company_id: companyId, integration_name: 'gohighlevel' });
    if (!settings.length) {
        settings = await base44.entities.IntegrationSetting.filter({ company_id: companyId, integration_name: 'GoHighLevel' });
    }
    return settings[0] || null;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

        const body = await req.json().catch(() => ({}));
        const companyId = await resolveCompanyId(base44, user, body.company_id);
        if (!companyId) return Response.json({ success: false, error: 'Company ID required' }, { status: 400 });

        const setting = await loadSettings(base44, companyId);
        const config = setting?.config || {};
        const token = config.api_key || Deno.env.get('GHL_API_KEY');
        const locationId = body.locationId || config.location_id;
        if (!token) return Response.json({ success: false, error: 'GHL token not configured' }, { status: 400 });
        if (!locationId) return Response.json({ success: false, error: 'Location ID not configured in GHL settings' }, { status: 400 });
        if (setting && setting.is_enabled === false) {
            return Response.json({ success: false, error: 'GHL integration is disabled for this company' }, { status: 400 });
        }

        let created = 0;
        let updated = 0;
        let startAfterId = '';
        let pages = 0;
        const maxContacts = body.limit || null;

        while (pages < MAX_PAGES) {
            const url = new URL(`${GHL_API_BASE}/contacts/`);
            url.searchParams.set('locationId', locationId);
            url.searchParams.set('limit', '100');
            if (startAfterId) url.searchParams.set('startAfterId', startAfterId);
            const resp = await fetch(url.toString(), { headers: headers(token) });
            if (!resp.ok) throw new Error(`GHL API Failed: ${resp.status} ${await resp.text()}`);
            const data = await resp.json();
            const contacts = data.contacts || [];
            if (!contacts.length) break;

            for (const contact of contacts) {
                if (maxContacts != null && created + updated >= maxContacts) break;
                const email = contact.email || null;
                const ghlId = contact.id;
                const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 2000);
                let match = leads.find((l: any) => l.ghl_contact_id === ghlId);
                if (!match && email) match = leads.find((l: any) => l.email && l.email.toLowerCase() === email.toLowerCase());
                const payload = {
                    company_id: companyId,
                    ghl_contact_id: ghlId,
                    name: displayName(contact),
                    email,
                    phone: contact.phone || contact.phoneNumber || null,
                    street: contact.address1 || null,
                    city: contact.city || null,
                    state: contact.state || null,
                    zip: contact.postalCode || null,
                    lead_source: 'GoHighLevel',
                    source: 'gohighlevel',
                };
                if (match) {
                    await base44.asServiceRole.entities.Lead.update(match.id, payload);
                    updated++;
                } else {
                    await base44.asServiceRole.entities.Lead.create({
                        ...payload,
                        status: 'new',
                        assigned_to: user.email,
                        notes: `Imported from GoHighLevel. GHL ID: ${ghlId}`,
                    });
                    created++;
                }
            }

            pages++;
            startAfterId = data.meta?.startAfterId || '';
            if (!startAfterId || (maxContacts != null && created + updated >= maxContacts)) break;
        }

        let pushed = 0;
        if (config.push_new_leads !== false) {
            const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 200);
            const unsynced = leads.filter((l: any) => !l.ghl_contact_id && (l.email || l.phone)).slice(0, 100);
            for (const lead of unsynced) {
                const nameParts = String(lead.name || '').trim().split(/\s+/);
                const upsert = await fetch(`${GHL_API_BASE}/contacts/upsert`, {
                    method: 'POST',
                    headers: headers(token),
                    body: JSON.stringify({
                        firstName: nameParts[0] || '',
                        lastName: nameParts.slice(1).join(' ') || '',
                        email: lead.email || undefined,
                        phone: lead.phone || undefined,
                        address1: lead.street || lead.address || undefined,
                        city: lead.city || undefined,
                        state: lead.state || undefined,
                        postalCode: lead.zip || undefined,
                        locationId,
                        source: lead.source || 'CompanySync',
                    }),
                });
                if (!upsert.ok) continue;
                const saved = await upsert.json();
                const ghlId = saved.contact?.id || saved.id;
                if (ghlId) {
                    await base44.asServiceRole.entities.Lead.update(lead.id, { ghl_contact_id: ghlId });
                    pushed++;
                }
            }
        }

        if (setting?.id) {
            await base44.entities.IntegrationSetting.update(setting.id, {
                config: {
                    ...config,
                    last_sync_at: new Date().toISOString(),
                    last_sync_error: null,
                    last_sync_result: { created, updated, pushed, total: created + updated },
                },
            });
        }

        return Response.json({
            success: true,
            created,
            updated,
            pushed,
            total: created + updated,
            message: `Imported ${created + updated} GHL contacts (${created} new, ${updated} updated). Pushed ${pushed} new CompanySync leads to GoHighLevel.`,
        });
    } catch (error) {
        console.error('❌ Manual Sync Error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});
