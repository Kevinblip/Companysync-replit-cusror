import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Accept company_id from request body (preferred), fall back to owner lookup
        let body = {};
        try { body = await req.json(); } catch (_) {}
        const passedCompanyId = body?.company_id;

        let company;
        if (passedCompanyId) {
            const rows = await base44.asServiceRole.entities.Company.filter({ id: passedCompanyId });
            company = rows?.[0];
        } else {
            const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
            company = companies?.[0];
        }

        if (!company) {
            return Response.json({ error: 'No company found (tried id=' + passedCompanyId + ', email=' + user.email + ')' }, { status: 400 });
        }

        // Authorization: caller must be company owner
        if (company.created_by !== user.email) {
            return Response.json({ error: 'Forbidden — only the company owner can run this repair' }, { status: 403 });
        }

        // Claims Specialist permissions — view/edit OWN data only, no view_global anywhere
        const permissions = {
            dashboard: { view_own: true },
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
            ai_estimator: { view: true, create: true, generate_images: true, generate_audio: true },
            lexi_ai: { view: true, chat: true },
            permit_assistant: { view: true, generate: true },
            daily_reports: { view: true },
            inspections: { view_own: true, create: true, capture_photos: true, edit_own: true, delete_own: true },
            lead_inspections: { view_own: true, create: true, edit: true },
            drone_analysis: { view: true, upload: true, analyze: true },
            communication_hub: { view_own: true, audio_call: true, video_call: true, send_sms: true, send_email: true },
            mailbox: { view_own: true, send: true, delete_own: true },
            messages: { view_own: true, send: true },
            email_templates: { view: true },
            sms_templates: { view: true },
            zoom_meeting: { view: true, create: true },
            documents: { view_own: true, upload: true, delete_own: true },
            contract_templates: { view: true },
            contract_signing: { view_own: true, create: true, send: true },
            knowledge_base: { view: true },
            reports: { view_own: true },
            analytics_dashboard: { view_own: true },
            sales_reports: { view_own: true },
            sales_dashboard: { view_own: true },
            calendar: { view_own: true, create: true, edit_own: true, delete_own: true },
            activity: { view_own: true },
            review_requests: { view_own: true, create: true, send: true },
            map: { view: true },
            subscription: { view: true }
        };

        // STEP 1: Find and fix all Insurance Claims Specialist roles
        const allRoles = await base44.asServiceRole.entities.StaffRole.filter({ company_id: company.id });
        const matchingRoles = (allRoles || []).filter(r =>
            r.name && r.name.toLowerCase().includes('insurance claims specialist')
        );

        const updatedRoleNames = [];
        const matchingRoleIds = [];

        if (matchingRoles.length === 0) {
            const created = await base44.asServiceRole.entities.StaffRole.create({
                company_id: company.id,
                name: "Insurance Claims Specialist/Rep",
                description: "Field specialist - view/edit own data only, full AI tools access",
                permissions: permissions
            });
            updatedRoleNames.push(created.name);
            matchingRoleIds.push(created.id);
        } else {
            for (const r of matchingRoles) {
                await base44.asServiceRole.entities.StaffRole.update(r.id, { permissions });
                updatedRoleNames.push(r.name);
                matchingRoleIds.push(r.id);
            }
        }

        // STEP 2: Clear is_administrator on ALL non-owner staff profiles
        // This catches profiles regardless of role_id (even if role was deleted/reassigned)
        const ownerEmail = company.created_by;
        const allProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: company.id });

        const adminFlagsCleared = [];
        const skippedOwner = [];
        for (const profile of (allProfiles || [])) {
            const profileEmail = profile.user_email || profile.email || '';
            const profileName = profile.full_name || profileEmail || profile.id;

            if (profile.is_administrator === true) {
                if (profileEmail === ownerEmail) {
                    skippedOwner.push(profileName);
                } else {
                    await base44.asServiceRole.entities.StaffProfile.update(profile.id, {
                        is_administrator: false
                    });
                    adminFlagsCleared.push(profileName);
                }
            }
        }

        const msg = `✅ Fixed ${updatedRoleNames.length} role(s): ${updatedRoleNames.join(', ')}. ` +
            `Scanned ${(allProfiles || []).length} staff profile(s). ` +
            (adminFlagsCleared.length > 0
                ? `Cleared admin flag from: ${adminFlagsCleared.join(', ')}. `
                : `No non-owner admin flags found. `) +
            (skippedOwner.length > 0
                ? `Owner kept as admin: ${skippedOwner.join(', ')}.`
                : '');

        return Response.json({
            success: true,
            message: msg,
            rolesUpdated: updatedRoleNames,
            profilesScanned: (allProfiles || []).length,
            adminFlagsCleared,
            ownerKept: skippedOwner
        });

    } catch (error) {
        console.error('updateClaimsSpecialistRole error:', error);
        return Response.json({ error: String(error) }, { status: 500 });
    }
});
