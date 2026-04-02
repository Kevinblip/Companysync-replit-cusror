import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { entityType, entityId, action } = await req.json();

        // Get company ID
        const staffProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
        let companyId;
        
        if (staffProfiles && staffProfiles.length > 0) {
            companyId = staffProfiles[0].company_id;
        } else {
            const companies = await base44.entities.Company.filter({ created_by: user.email });
            companyId = companies[0]?.id;
        }

        if (!companyId) {
            return Response.json({ error: 'Company not found' }, { status: 400 });
        }

        const ghlApiKey = Deno.env.get('GHL_API_KEY');
        if (!ghlApiKey) {
            return Response.json({ error: 'GHL_API_KEY not configured' }, { status: 400 });
        }

        // Get location ID from settings
        const integrationSettings = await base44.entities.IntegrationSetting.filter({
            company_id: companyId,
            integration_name: 'gohighlevel'
        });
        
        const locationId = integrationSettings[0]?.settings?.location_id;
        
        if (!locationId) {
            return Response.json({ 
                success: false, 
                message: 'Location ID not configured. Please set it in GoHighLevel Settings.' 
            });
        }

        // Handle different entity types
        if (entityType === 'Lead') {
            const leads = await base44.entities.Lead.filter({ id: entityId });
            const lead = leads[0];

            if (!lead) {
                return Response.json({ error: 'Lead not found' }, { status: 404 });
            }

            // Map CRM Lead to GHL Contact
            const ghlContact = {
                firstName: lead.name?.split(' ')[0] || '',
                lastName: lead.name?.split(' ').slice(1).join(' ') || '',
                email: lead.email || '',
                phone: lead.phone || '',
                address1: lead.street || '',
                city: lead.city || '',
                state: lead.state || '',
                postalCode: lead.zip || '',
                companyName: lead.company || '',
                source: lead.source || 'CRM',
                tags: lead.tags || [],
                locationId: locationId
            };

            if (action === 'create') {
                // Create new contact in GHL
                const response = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${ghlApiKey}`,
                        'Content-Type': 'application/json',
                        'Version': '2021-07-28'
                    },
                    body: JSON.stringify(ghlContact)
                });

                if (!response.ok) {
                    const error = await response.text();
                    console.error('GHL API Error:', error);
                    return Response.json({ 
                        success: false, 
                        error: `Failed to create contact in GHL: ${error}` 
                    }, { status: 400 });
                }

                const ghlData = await response.json();
                console.log('✅ Contact created in GHL:', ghlData.contact?.id);

                // Store GHL ID in lead notes for reference
                await base44.entities.Lead.update(entityId, {
                    notes: `${lead.notes || ''}\n\n[GHL ID: ${ghlData.contact?.id}]`
                });

                return Response.json({ 
                    success: true, 
                    ghlContactId: ghlData.contact?.id,
                    message: 'Contact created in GoHighLevel' 
                });

            } else if (action === 'update') {
                // Extract GHL ID from notes if exists
                const ghlIdMatch = lead.notes?.match(/\[GHL ID: ([^\]]+)\]/);
                const ghlContactId = ghlIdMatch?.[1];

                if (!ghlContactId) {
                    return Response.json({ 
                        success: false, 
                        message: 'No GHL contact ID found. Cannot update.' 
                    });
                }

                // Update contact in GHL
                const response = await fetch(`https://rest.gohighlevel.com/v1/contacts/${ghlContactId}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bearer ${ghlApiKey}`,
                        'Content-Type': 'application/json',
                        'Version': '2021-07-28'
                    },
                    body: JSON.stringify(ghlContact)
                });

                if (!response.ok) {
                    const error = await response.text();
                    console.error('GHL API Error:', error);
                    return Response.json({ 
                        success: false, 
                        error: `Failed to update contact in GHL: ${error}` 
                    }, { status: 400 });
                }

                console.log('✅ Contact updated in GHL:', ghlContactId);

                return Response.json({ 
                    success: true, 
                    ghlContactId: ghlContactId,
                    message: 'Contact updated in GoHighLevel' 
                });
            }
        }

        return Response.json({ 
            success: false, 
            message: 'Unsupported entity type or action' 
        });

    } catch (error) {
        console.error('❌ Push to GHL Error:', error);
        return Response.json({ 
            error: error.message,
            details: error.stack 
        }, { status: 500 });
    }
});