import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// 🔄 GHL AUTO-SYNC HTTP ENDPOINT
// Call this endpoint via external cron service (cron-job.org, etc.) every 5 minutes
// URL: https://your-project.deno.dev/ghlAutoSyncEndpoint

Deno.serve(async (req) => {
  try {
    // 🔐 Validate CRON_SECRET_TOKEN
    const authToken = Deno.env.get('CRON_SECRET_TOKEN');
    let processedReq = req;
    
    if (authToken) {
      const requestToken = req.headers.get('Authorization')?.replace('Bearer ', '');
      if (requestToken !== authToken) {
        return Response.json({ error: 'Unauthorized - Invalid token' }, { status: 401 });
      }
      // Remove Authorization header so createClientFromRequest doesn't try to parse it as a user token
      const headers = new Headers(req.headers);
      headers.delete('Authorization');
      processedReq = new Request(req.url, { headers, body: req.body, method: req.method });
    }
    
    const base44 = createClientFromRequest(processedReq);
    
    const allIntegrations = await base44.asServiceRole.entities.IntegrationSetting.filter({
      integration_name: 'gohighlevel',
      is_enabled: true
    });
    
    console.log(`✅ Found ${allIntegrations.length} companies with GHL enabled`);
    
    if (allIntegrations.length === 0) {
      return Response.json({
        success: true,
        message: 'No active GHL integrations found',
        timestamp: new Date().toISOString()
      });
    }
    
    const ghlApiKey = Deno.env.get('GHL_API_KEY');
    if (!ghlApiKey) {
      console.error('❌ GHL_API_KEY not configured');
      return Response.json({
        success: false,
        error: 'GHL_API_KEY not configured'
      }, { status: 500 });
    }
    
    const results = [];
    
    for (const integration of allIntegrations) {
      try {
        const companyId = integration.company_id;
        const locationId = integration.config?.location_id;
        
        console.log(`🔄 Syncing company: ${companyId}`);
        
        // Fetch the 10 newest contacts from GHL (sorted by creation date)
        let ghlUrl = 'https://rest.gohighlevel.com/v1/contacts/?limit=10&sort=-createdAt';
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
          console.error(`❌ GHL API error for company ${companyId}: ${ghlResponse.status}`);
          results.push({
            company_id: companyId,
            success: false,
            error: `GHL API returned ${ghlResponse.status}`
          });
          continue;
        }
        
        const ghlData = await ghlResponse.json();
        const contacts = ghlData.contacts || [];
        
        console.log(`✅ Found ${contacts.length} contacts for company ${companyId}`);
        
        if (contacts.length === 0) {
          results.push({
            company_id: companyId,
            success: true,
            created: 0,
            skipped: 0,
            message: 'No contacts to sync'
          });
          continue;
        }
        
        // Get existing leads (large limit to avoid missing older records)
        const existingLeads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 5000);
        
        let created = 0;
        let skipped = 0;
        
        for (const contact of contacts) {
          try {
            const email = contact.email?.toLowerCase();
            const phone = contact.phone?.replace(/\D/g, '');
            const ghlContactId = contact.id;

            // Check if already exists by GHL ID (preferred), email, or last 10 of phone
            const cleanPhone = phone ? phone.slice(-10) : null;
            const isDuplicate = existingLeads.some(lead => {
              const leadPhoneClean = (lead.phone || '').replace(/\D/g, '');
              const leadPhoneLast10 = leadPhoneClean ? leadPhoneClean.slice(-10) : null;
              return (ghlContactId && (lead.ghl_contact_id === ghlContactId || (lead.notes || '').includes(`GHL ID: ${ghlContactId}`))) ||
                     (email && lead.email && lead.email.toLowerCase() === email) ||
                     (cleanPhone && leadPhoneLast10 === cleanPhone);
            });

            if (isDuplicate) {
              skipped++;
              console.log(`⏭️ Skipped duplicate: ${contact.email || contact.phone || contact.firstName} (GHL ID: ${ghlContactId})`);
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
            
            // Build notes with GHL ID for duplicate detection
            let notesText = `Auto-imported from GHL (HTTP Endpoint Sync).\nGHL ID: ${ghlContactId}\n\n`;

            if (contact.notes) {
              notesText += `GHL Notes:\n${contact.notes}\n\n`;
            }
            
            // Get company owner
            const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
            const ownerEmail = companies[0]?.created_by;
            
            // Create new lead
            const newLead = await base44.asServiceRole.entities.Lead.create({
              company_id: companyId,
              ghl_contact_id: ghlContactId,
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
            existingLeads.push(newLead);
            console.log(`✅ Created lead: ${contact.email || contact.phone}`);
            
            // 🔔 Send notification to ALL admins (not just owner)
            const allStaffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId });
            const adminEmails = allStaffProfiles.filter(s => s.is_administrator).map(s => s.user_email);

            for (const adminEmail of adminEmails) {
              await base44.asServiceRole.entities.Notification.create({
                company_id: companyId,
                user_email: adminEmail,
                title: '🎯 New Lead from GoHighLevel',
                message: `${contact.firstName || ''} ${contact.lastName || ''} has been automatically imported from GHL`,
                type: 'lead_created',
                icon: 'user-plus',
                link_url: `/lead-profile?id=${newLead.id}`
              });
            }
          } catch (contactError) {
            console.error(`❌ Failed to process contact ${contact.email || contact.phone}:`, contactError.message);
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
        console.error(`❌ Error syncing company ${integration.company_id}:`, companyError);
        results.push({
          company_id: integration.company_id,
          success: false,
          error: companyError.message
        });
      }
    }
    
    console.log('✅ GHL auto-sync completed');
    
    return Response.json({
      success: true,
      message: 'GHL auto-sync completed via HTTP endpoint',
      timestamp: new Date().toISOString(),
      results,
      summary: {
        total_companies: allIntegrations.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        total_created: results.reduce((sum, r) => sum + (r.created || 0), 0),
        total_skipped: results.reduce((sum, r) => sum + (r.skipped || 0), 0)
      }
    });
    
  } catch (error) {
    console.error('❌ GHL auto-sync error:', error);
    return Response.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
});