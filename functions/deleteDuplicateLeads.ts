import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get company ID
        const companies = await base44.entities.Company.list('-created_date', 1);
        if (!companies || companies.length === 0) {
            return Response.json({ error: 'No company found' }, { status: 404 });
        }
        const companyId = companies[0].id;

        // Get all leads for this company
        const allLeads = await base44.asServiceRole.entities.Lead.filter({ 
            company_id: companyId 
        });

        console.log(`🔍 Scanning ${allLeads.length} leads for duplicates...`);

        // Group leads by GHL contact ID
        const leadsByGhlId = {};
        const leadsByEmail = {};
        const leadsByPhone = {};

        for (const lead of allLeads) {
            // Group by GHL ID
            if (lead.ghl_contact_id) {
                if (!leadsByGhlId[lead.ghl_contact_id]) {
                    leadsByGhlId[lead.ghl_contact_id] = [];
                }
                leadsByGhlId[lead.ghl_contact_id].push(lead);
            }

            // Group by email
            if (lead.email) {
                const cleanEmail = lead.email.toLowerCase();
                if (!leadsByEmail[cleanEmail]) {
                    leadsByEmail[cleanEmail] = [];
                }
                leadsByEmail[cleanEmail].push(lead);
            }

            // Group by phone
            if (lead.phone) {
                const cleanPhone = lead.phone.replace(/\D/g, '');
                if (cleanPhone.length >= 10) {
                    const last10 = cleanPhone.slice(-10);
                    if (!leadsByPhone[last10]) {
                        leadsByPhone[last10] = [];
                    }
                    leadsByPhone[last10].push(lead);
                }
            }
        }

        // Find duplicates
        const duplicateGroups = [];

        // Check GHL ID duplicates
        for (const [ghlId, leads] of Object.entries(leadsByGhlId)) {
            if (leads.length > 1) {
                duplicateGroups.push({
                    type: 'ghl_id',
                    key: ghlId,
                    leads: leads
                });
            }
        }

        // Check email duplicates
        for (const [email, leads] of Object.entries(leadsByEmail)) {
            if (leads.length > 1) {
                // Only add if not already in duplicates by GHL ID
                const alreadyGrouped = duplicateGroups.some(g => 
                    g.leads.some(l => leads.some(lead => lead.id === l.id))
                );
                if (!alreadyGrouped) {
                    duplicateGroups.push({
                        type: 'email',
                        key: email,
                        leads: leads
                    });
                }
            }
        }

        // Check phone duplicates
        for (const [phone, leads] of Object.entries(leadsByPhone)) {
            if (leads.length > 1) {
                // Only add if not already in duplicates
                const alreadyGrouped = duplicateGroups.some(g => 
                    g.leads.some(l => leads.some(lead => lead.id === l.id))
                );
                if (!alreadyGrouped) {
                    duplicateGroups.push({
                        type: 'phone',
                        key: phone,
                        leads: leads
                    });
                }
            }
        }

        console.log(`🔍 Found ${duplicateGroups.length} duplicate groups`);

        // Delete duplicates (keep the oldest/most complete one in each group)
        let deletedCount = 0;
        const deletionDetails = [];

        for (const group of duplicateGroups) {
            // Sort by created_date (oldest first) and completeness
            const sortedLeads = group.leads.sort((a, b) => {
                // Prefer leads with more data
                const scoreA = (a.email ? 1 : 0) + (a.phone ? 1 : 0) + (a.notes?.length || 0) / 100;
                const scoreB = (b.email ? 1 : 0) + (b.phone ? 1 : 0) + (b.notes?.length || 0) / 100;
                
                if (scoreA !== scoreB) {
                    return scoreB - scoreA; // Higher score first
                }
                
                // Then by creation date (older first)
                return new Date(a.created_date) - new Date(b.created_date);
            });

            // Keep the first (best) lead, delete the rest
            const keepLead = sortedLeads[0];
            const deleteLeads = sortedLeads.slice(1);

            console.log(`📌 Keeping lead ${keepLead.id} (${keepLead.name})`);
            
            for (const lead of deleteLeads) {
                try {
                    await base44.asServiceRole.entities.Lead.delete(lead.id);
                    deletedCount++;
                    deletionDetails.push({
                        id: lead.id,
                        name: lead.name,
                        reason: `Duplicate ${group.type}: ${group.key}`,
                        kept_instead: keepLead.id
                    });
                    console.log(`  ❌ Deleted duplicate lead ${lead.id} (${lead.name})`);
                } catch (error) {
                    console.error(`Failed to delete lead ${lead.id}:`, error.message);
                }
            }
        }

        console.log(`✅ Deleted ${deletedCount} duplicate leads`);

        return Response.json({
            success: true,
            total_leads: allLeads.length,
            duplicate_groups: duplicateGroups.length,
            deleted_count: deletedCount,
            details: deletionDetails
        });

    } catch (error) {
        console.error('❌ Error deleting duplicate leads:', error);
        return Response.json({ 
            error: error.message,
            stack: error.stack 
        }, { status: 500 });
    }
});