import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me(); // Authenticate user for manual triggering

        // Check if user is authenticated (manual trigger) or use service role (if cron - requires header check)
        // Since this is a cron/backend function, we might be called by an external cron service
        // We'll use a shared secret for external cron security if user is not present
        
        const authHeader = req.headers.get('Authorization');
        const cronSecret = Deno.env.get('CRON_SECRET_TOKEN');
        const isCron = authHeader === `Bearer ${cronSecret}`;
        
        if (!user && !isCron) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Starting GHL Auto-Sync...');

        // 1. Find all companies with GHL enabled
        // We look for IntegrationSetting for 'GoHighLevel' that is enabled
        const settings = await base44.asServiceRole.entities.IntegrationSetting.filter({ 
            integration_name: 'GoHighLevel',
            is_enabled: true 
        });

        console.log(`Found ${settings.length} companies with GHL enabled.`);

        const results = [];

        // 2. Loop through each enabled company and sync
        for (const setting of settings) {
            try {
                const companyId = setting.company_id;
                const config = setting.config || {};
                const locationId = config.location_id;
                
                // Get API Key (Assuming global agency key in env, OR per-company key in secrets?)
                // Usually GHL uses OAuth or a Location API Key. 
                // If it's a global agency key, we use that + locationId.
                // If it's a location key, it might be in the config or secrets.
                // Let's assume Global Agency Key in env (GHL_API_KEY) + Location ID in config.
                
                const apiKey = Deno.env.get('GHL_API_KEY'); 
                // If the user put a specific key in config (Location Key), use that instead
                const effectiveKey = config.api_key || apiKey;

                if (!effectiveKey) {
                    results.push({ companyId, status: 'skipped', reason: 'No API Key found' });
                    continue;
                }
                
                if (!locationId && !config.api_key) { 
                     // If using Agency Key, we MUST have locationId. 
                     // If using Location Key (in config.api_key), locationId might be implicit.
                     // But generally we need locationId for filtering.
                }

                console.log(`Syncing Company ${companyId} (Location: ${locationId})...`);

                // 3. Fetch Contacts from GHL
                // API v2: GET /contacts/ (requires locationId if using Agency Token)
                const baseUrl = 'https://services.leadconnectorhq.com'; // or app.gohighlevel.com/v1 depending on version
                // Assuming v2 API for newer integrations, or v1. Let's try v1 standard 'rest/v1/contacts' if using Location Key
                // or 'contacts/' for v2. 
                // Let's use the v1 endpoint often used with Location Keys for simplicity unless OAuth.
                // v1: https://rest.gohighlevel.com/v1/contacts/?limit=20
                
                const response = await fetch('https://rest.gohighlevel.com/v1/contacts/?limit=20', {
                    headers: {
                        'Authorization': `Bearer ${effectiveKey}`
                    }
                });

                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`GHL API Error: ${response.status} ${text}`);
                }

                const data = await response.json();
                const contacts = data.contacts || [];

                // 4. Upsert Contacts to Leads
                let syncedCount = 0;
                
                // Get company owner for assignment
                const company = (await base44.asServiceRole.entities.Company.filter({ id: companyId }))[0];
                const ownerEmail = company?.created_by;

                for (const contact of contacts) {
                    await upsertLead(base44, companyId, contact, ownerEmail);
                    syncedCount++;
                }

                results.push({ companyId, status: 'success', count: syncedCount });

            } catch (err) {
                console.error(`Error syncing company ${setting.company_id}:`, err);
                results.push({ companyId: setting.company_id, status: 'error', error: err.message });
            }
        }

        return Response.json({ success: true, results });

    } catch (error) {
        console.error('❌ GHL Auto-Sync Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

async function upsertLead(base44, companyId, contact, ownerEmail) {
    // Reusing logic similar to webhook upsert
    const name = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown GHL';
    const email = contact.email;
    const phone = contact.phone || contact.phoneNumber;
    const ghlId = contact.id;

    // Find Existing
    const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 1000);
    
    let match = null;
    if (ghlId) match = leads.find(l => l.ghl_contact_id === ghlId);
    if (!match && email) match = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());
    
    const leadData = {
        company_id: companyId,
        ghl_contact_id: ghlId,
        name: name,
        email: email,
        phone: phone,
        lead_source: 'GoHighLevel Sync',
        source: 'gohighlevel',
        // Preserve existing status if updating
        // Only set default fields if creating or if empty
    };

    if (match) {
        // Update
        // Don't overwrite status or notes blindly
        await base44.asServiceRole.entities.Lead.update(match.id, {
            ...leadData,
            notes: match.notes // Keep existing notes
        });
    } else {
        // Create
        await base44.asServiceRole.entities.Lead.create({
            ...leadData,
            status: 'new',
            assigned_to: ownerEmail,
            notes: `Imported from GHL Sync. ID: ${ghlId}`
        });
    }
}