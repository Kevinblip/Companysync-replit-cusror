import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// This function runs periodically to auto-sync new leads from GHL
Deno.serve(async (req) => {
    try {
        console.log('🔄 Starting automatic GHL sync...');
        
        const base44 = createClientFromRequest(req);
        
        // Get all companies with GHL integration enabled
        const allIntegrations = await base44.asServiceRole.entities.IntegrationSetting.filter({
            integration_name: 'gohighlevel',
            is_enabled: true
        });
        
        console.log(`Found ${allIntegrations.length} companies with GHL enabled`);
        
        const results = [];
        
        for (const integration of allIntegrations) {
            try {
                const companyId = integration.company_id;
                const locationId = integration.config?.location_id;
                
                console.log(`Syncing for company: ${companyId}`);
                
                const ghlApiKey = Deno.env.get('GHL_API_KEY');
                if (!ghlApiKey) {
                    console.error('GHL_API_KEY not configured');
                    continue;
                }
                
                // Fetch the 10 newest contacts from GHL
                let ghlUrl = 'https://rest.gohighlevel.com/v1/contacts/?limit=10';
                if (locationId) {
                    ghlUrl += `&locationId=${locationId}`;
                }
                
                const ghlResponse = await fetch(ghlUrl, {
                    headers: {
                        'Authorization': `Bearer ${ghlApiKey}`,
                        'Content-Type': 'application/json',
                        'Version': '2021-07-28'
                    }
                });
                
                if (!ghlResponse.ok) {
                    console.error(`Failed to fetch GHL contacts for company ${companyId}`);
                    continue;
                }
                
                const ghlData = await ghlResponse.json();
                const contacts = ghlData.contacts || [];
                
                console.log(`Found ${contacts.length} contacts for company ${companyId}`);
                
                // Get existing leads
                const existingLeads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId });
                
                let created = 0;
                let skipped = 0;
                
                for (const contact of contacts) {
                    const email = contact.email?.toLowerCase();
                    const phone = contact.phone?.replace(/\D/g, '');
                    
                    // Check if already exists
                    const isDuplicate = existingLeads.some(lead => 
                        (email && lead.email?.toLowerCase() === email) || 
                        (phone && lead.phone?.replace(/\D/g, '') === phone)
                    );
                    
                    if (isDuplicate) {
                        skipped++;
                        continue;
                    }
                    
                    // Auto-detect tags
                    const autoTags = [];
                    const formData = contact.customFields || [];
                    const ghlTags = contact.tags || [];
                    
                    autoTags.push(...ghlTags);
                    
                    for (const field of formData) {
                        const fieldName = (field.name || field.key || '').toLowerCase();
                        const fieldValue = (field.value || '').toLowerCase();
                        
                        if (fieldName.includes('inspection') || fieldName.includes('roof inspector')) {
                            autoTags.push('lead inspections');
                        }
                        if (fieldName.includes('ladder') || fieldValue.includes('ladder')) {
                            autoTags.push('ladder assistants');
                        }
                        if (fieldName.includes('sales') || fieldName.includes('representative') || 
                            fieldValue.includes('sales') || fieldValue.includes('rep')) {
                            autoTags.push('sales reps');
                        }
                    }
                    
                    // Build notes
                    let notesText = `Auto-imported from GHL. GHL ID: ${contact.id || 'unknown'}\n\n`;
                    
                    if (contact.notes) {
                        notesText += `GHL Notes:\n${contact.notes}\n\n`;
                    }
                    
                    // Get company owner
                    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                    const ownerEmail = companies[0]?.created_by;
                    
                    // 🔥 Check if GHL ID exists in any lead's notes to prevent re-importing
                    const ghlIdExists = existingLeads.some(lead => 
                        lead.notes?.includes(`GHL ID: ${contact.id}`)
                    );
                    
                    if (ghlIdExists) {
                        console.log(`⏭️ Lead with GHL ID ${contact.id} already exists, skipping`);
                        skipped++;
                        continue;
                    }
                    
                    // Create new lead
                    const newLead = await base44.asServiceRole.entities.Lead.create({
                        company_id: companyId,
                        name: contact.firstName && contact.lastName 
                            ? `${contact.firstName} ${contact.lastName}` 
                            : contact.firstName || contact.lastName || 'Unknown',
                        email: contact.email,
                        phone: contact.phone,
                        company: contact.companyName,
                        street: contact.address1,
                        city: contact.city,
                        state: contact.state,
                        zip: contact.postalCode,
                        status: 'new',
                        source: 'gohighlevel',
                        lead_source: contact.source || 'GHL Auto-Sync',
                        tags: [...new Set(autoTags)],
                        notes: notesText,
                        is_active: true,
                        created_by: ownerEmail || 'system'
                    });
                    
                    created++;
                    console.log(`✅ Created lead: ${contact.email || contact.phone}`);
                    
                    // 🔥 ONLY send notification if lead was actually created
                    // Check if a notification for this exact contact was sent in the last 5 minutes
                    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
                    const recentNotifications = await base44.asServiceRole.entities.Notification.filter({
                        company_id: companyId,
                        type: 'lead_created',
                        created_date: { $gte: fiveMinutesAgo }
                    });
                    
                    const isDuplicateNotification = recentNotifications.some(n => 
                        n.message?.includes(contact.firstName || '') && 
                        n.message?.includes(contact.lastName || '')
                    );
                    
                    if (!isDuplicateNotification && ownerEmail) {
                        await base44.asServiceRole.entities.Notification.create({
                            company_id: companyId,
                            user_email: ownerEmail,
                            title: '🎯 New Lead from GoHighLevel',
                            message: `${contact.firstName || ''} ${contact.lastName || ''} has been automatically imported from GHL`,
                            type: 'lead_created',
                            icon: 'user-plus'
                        });
                    } else {
                        console.log(`⏭️ Duplicate notification prevented for ${contact.firstName} ${contact.lastName}`);
                    }
                }
                
                results.push({
                    company_id: companyId,
                    success: true,
                    created,
                    skipped
                });
                
                console.log(`✅ Company ${companyId}: Created ${created}, Skipped ${skipped}`);
                
            } catch (companyError) {
                console.error(`Error syncing company ${integration.company_id}:`, companyError);
                results.push({
                    company_id: integration.company_id,
                    success: false,
                    error: companyError.message
                });
            }
        }
        
        console.log('✅ Auto-sync completed');
        
        return Response.json({
            success: true,
            message: 'Auto-sync completed',
            results
        });
        
    } catch (error) {
        console.error('❌ Auto-sync error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});