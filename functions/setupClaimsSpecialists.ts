import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get user's company
        const companies = await base44.asServiceRole.entities.Company.filter({ 
            created_by: user.email 
        });

        if (!companies || companies.length === 0) {
            return Response.json({ error: 'No company found' }, { status: 400 });
        }

        const company = companies[0];

        // Define Claims Specialist permissions
        const claimsSpecialistPermissions = {
            dashboard: { view: true },
            leads: { view_own: true, create: true, edit_own: true, delete_own: true },
            customers: { view_own: true, create: true, edit_own: true, delete_own: true },
            estimates: { view_own: true, create: true, edit_own: true, delete_own: true, view_all_templates: true },
            proposals: { view_own: true, create: true, edit_own: true, delete_own: true, view_all_templates: true },
            invoices: { view_own: true, create: true, edit_own: true, delete_own: true },
            payments: { view_own: true, create: true, edit_own: true, delete_own: true },
            items: { view: true, create: true, edit: true },
            tasks: { view_own: true, create: true, edit_own: true, delete_own: true },
            reminders: { view_own: true, create: true, edit: true, delete: true },
            contracts: { view_own: true, create: true, edit_own: true, delete_own: true },
            
            // AI Tools - Full Access
            ai_estimator: { view: true, create: true, generate_images: true, generate_audio: true },
            lexi_ai: { view: true, chat: true },
            permit_assistant: { view: true, generate: true },
            daily_reports: { view: true },
            
            // Inspections - Own Only
            inspections: { view_own: true, create: true, capture_photos: true, edit_own: true, delete_own: true },
            lead_inspections: { view_own: true, create: true, edit: true },
            drone_analysis: { view: true, upload: true, analyze: true },
            
            // Communication - Own Only
            communication_hub: { view_own: true, audio_call: true, video_call: true, send_sms: true, send_email: true },
            mailbox: { view_own: true, send: true, delete_own: true },
            messages: { view_own: true, send: true },
            email_templates: { view: true },
            sms_templates: { view: true },
            zoom_meeting: { view: true, create: true },
            
            // Documents - Own Only
            documents: { view_own: true, upload: true, delete_own: true },
            contract_templates: { view: true },
            contract_signing: { view_own: true, create: true, send: true },
            knowledge_base: { view: true },
            
            // Reports - Own Only
            reports: { view_own: true },
            analytics_dashboard: { view_own: true },
            report_builder: { view_own: true, create: true, edit_own: true, delete_own: true },
            sales_reports: { view_own: true },
            sales_dashboard: { view_own: true },
            
            // Other
            calendar: { view_own: true, create: true, edit_own: true, delete_own: true },
            activity: { view_own: true },
            review_requests: { view_own: true, create: true, send: true },
            map: { view: true },
            subscription: { view: true }
        };

        // Find or create Insurance Claims Specialist role
        let roles = await base44.asServiceRole.entities.StaffRole.filter({
            company_id: company.id,
            name: "Insurance Claims Specialist"
        });

        let role;
        if (roles && roles.length > 0) {
            // Update existing role
            role = await base44.asServiceRole.entities.StaffRole.update(roles[0].id, {
                name: "Insurance Claims Specialist",
                description: "Field specialist handling insurance claims, estimates, and inspections. Can use AI tools and view/edit own data only.",
                permissions: claimsSpecialistPermissions
            });
            console.log('✅ Updated Insurance Claims Specialist role');
        } else {
            // Create new role
            role = await base44.asServiceRole.entities.StaffRole.create({
                company_id: company.id,
                name: "Insurance Claims Specialist",
                description: "Field specialist handling insurance claims, estimates, and inspections. Can use AI tools and view/edit own data only.",
                permissions: claimsSpecialistPermissions
            });
            console.log('✅ Created Insurance Claims Specialist role');
        }

        // Staff members to add/update
        const staffMembers = [
            {
                email: "scott.bickel@yicnroofing.com",
                full_name: "Scott Bickel",
                position: "Claims Specialist"
            },
            {
                email: "chris.t@yicnroofing.com",
                full_name: "Chris T",
                position: "Claims Specialist"
            }
        ];

        const results = [];

        for (const member of staffMembers) {
            // Check if staff profile exists
            const existingProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
                company_id: company.id,
                user_email: member.email
            });

            if (existingProfiles && existingProfiles.length > 0) {
                // Update existing profile
                await base44.asServiceRole.entities.StaffProfile.update(existingProfiles[0].id, {
                    role_id: role.id,
                    role_name: role.name,
                    full_name: member.full_name,
                    position: member.position,
                    is_active: true
                });
                results.push({ name: member.full_name, status: 'updated' });
            } else {
                // Create new profile
                await base44.asServiceRole.entities.StaffProfile.create({
                    company_id: company.id,
                    user_email: member.email,
                    full_name: member.full_name,
                    position: member.position,
                    role_id: role.id,
                    role_name: role.name,
                    is_active: true
                });
                results.push({ name: member.full_name, status: 'created' });
            }

            // Try to invite user if they don't exist in User entity
            try {
                const existingUsers = await base44.asServiceRole.entities.User.filter({
                    email: member.email
                });
                
                if (!existingUsers || existingUsers.length === 0) {
                    // Invite the user
                    await base44.users.inviteUser(member.email, "user");
                    results[results.length - 1].invited = true;
                }
            } catch (inviteError) {
                console.log(`Note: Could not invite ${member.email}:`, inviteError.message);
            }
        }

        return Response.json({
            success: true,
            message: '✅ Insurance Claims Specialist role configured and staff added',
            role: {
                id: role.id,
                name: role.name,
                description: role.description
            },
            staff: results
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message,
            details: error.stack
        }, { status: 500 });
    }
});