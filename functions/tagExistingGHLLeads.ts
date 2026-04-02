import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Function to retroactively tag and assign existing GHL leads
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authenticate user
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ 
                success: false,
                error: 'Unauthorized' 
            }, { status: 401 });
        }

        // Get user's company
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        const company = companies[0];

        if (!company) {
            return Response.json({ 
                success: false,
                error: 'No company found for this user'
            }, { status: 400 });
        }

        // Get all GHL leads (source = gohighlevel)
        const ghlLeads = await base44.asServiceRole.entities.Lead.filter({
            company_id: company.id,
            source: 'gohighlevel'
        });

        console.log(`Found ${ghlLeads.length} GHL leads to process`);

        // Get all staff profiles
        const allStaffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
            company_id: company.id 
        });

        // Find Kevin and Victoria (more flexible search)
        const kevin = allStaffProfiles.find(s => 
            s.full_name?.toLowerCase().includes('kevin')
        );
        const victoria = allStaffProfiles.find(s => 
            s.full_name?.toLowerCase().includes('victoria') || 
            s.full_name?.toLowerCase().includes('vicktoria') ||
            s.user_email?.toLowerCase().includes('victoria') ||
            s.user_email?.toLowerCase().includes('vicktoria')
        );

        if (!kevin && !victoria) {
            return Response.json({
                success: false,
                error: 'Could not find Kevin or Victoria in staff profiles. Please add them in Staff Management first.',
                availableStaff: allStaffProfiles.map(s => s.full_name || s.user_email)
            }, { status: 400 });
        }

        let updated = 0;
        const errors = [];

        // Process each GHL lead
        for (const lead of ghlLeads) {
            try {
                // Analyze existing tags and notes to determine lead type
                const existingTags = lead.tags || [];
                const notes = (lead.notes || '').toLowerCase();
                const leadSource = (lead.lead_source || '').toLowerCase();
                
                let newTags = [...existingTags];
                let assignedUsers = [];

                // Auto-detect lead type based on existing data
                if (notes.includes('sales rep') || leadSource.includes('sales rep') || existingTags.some(t => t.toLowerCase().includes('sales rep'))) {
                    if (!newTags.includes('sales reps')) {
                        newTags.push('sales reps');
                    }
                    if (kevin) assignedUsers.push(kevin.user_email);
                } else if (notes.includes('ladder') || leadSource.includes('ladder') || existingTags.some(t => t.toLowerCase().includes('ladder'))) {
                    if (!newTags.includes('ladder assistants')) {
                        newTags.push('ladder assistants');
                    }
                    if (victoria) assignedUsers.push(victoria.user_email);
                } else if (notes.includes('inspection') || leadSource.includes('inspection') || existingTags.some(t => t.toLowerCase().includes('inspection'))) {
                    if (!newTags.includes('lead inspections')) {
                        newTags.push('lead inspections');
                    }
                    if (victoria) assignedUsers.push(victoria.user_email);
                } else {
                    // If we can't determine type, assign to both (if they exist)
                    if (kevin) assignedUsers.push(kevin.user_email);
                    if (victoria) assignedUsers.push(victoria.user_email);
                }

                // If no one could be assigned, skip this lead
                if (assignedUsers.length === 0) {
                    console.log(`Skipping lead ${lead.id} - no Kevin or Victoria found`);
                    continue;
                }

                // Update the lead
                await base44.asServiceRole.entities.Lead.update(lead.id, {
                    tags: newTags,
                    assigned_to: assignedUsers[0],
                    assigned_to_users: assignedUsers
                });

                updated++;
            } catch (error) {
                errors.push({
                    leadId: lead.id,
                    leadName: lead.name,
                    error: error.message
                });
                console.error(`Failed to update lead ${lead.id}:`, error);
            }
        }

        return Response.json({
            success: true,
            message: `Updated ${updated} GHL leads`,
            total: ghlLeads.length,
            updated,
            errors: errors.length > 0 ? errors : undefined,
            assignments: {
                kevin: kevin.full_name,
                victoria: victoria.full_name
            }
        });

    } catch (error) {
        console.error('❌ Tag Existing GHL Leads Error:', error);
        return Response.json({ 
            success: false,
            error: error.message,
            stack: error.stack
        }, { status: 500 });
    }
});