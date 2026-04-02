import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { company_id } = await req.json();

        // Check integration
        const settings = await base44.asServiceRole.entities.IntegrationSetting.filter({ 
            company_id: company_id,
            integration_name: 'GoHighLevel'
        });
        
        if (settings.length === 0 || !settings[0].is_enabled) {
            return Response.json({ error: 'GHL not enabled' }, { status: 400 });
        }

        const apiKey = settings[0].config?.api_key || Deno.env.get('GHL_API_KEY');
        if (!apiKey) return Response.json({ error: 'No API Key' }, { status: 400 });

        // Fetch 1 contact
        const response = await fetch('https://rest.gohighlevel.com/v1/contacts/?limit=1', {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!response.ok) {
            const text = await response.text();
            return Response.json({ success: false, error: `API Error: ${response.status}`, details: text });
        }

        const data = await response.json();
        const contact = data.contacts?.[0];

        if (!contact) {
            return Response.json({ success: true, message: 'Connection successful, but no contacts found.' });
        }

        return Response.json({ 
            success: true, 
            message: 'Connection successful!', 
            sample: { name: contact.contactName || contact.firstName, email: contact.email } 
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});