import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { targetUserEmail } = body;

        if (!targetUserEmail) {
            return Response.json({ error: 'Target user email required' }, { status: 400 });
        }

        const requesterProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
        const requesterProfile = requesterProfiles?.[0];

        const targetProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: targetUserEmail });
        const targetProfile = targetProfiles?.[0];
        if (!targetProfile?.company_id) {
            return Response.json({ error: 'Target user has no company association' }, { status: 400 });
        }

        const targetCompanies = await base44.asServiceRole.entities.Company.filter({ id: targetProfile.company_id });
        const isOwnerOfTargetCompany = targetCompanies?.[0]?.created_by === user.email;
        if (!isOwnerOfTargetCompany && !requesterProfile?.is_super_admin) {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        const allUsers = await base44.asServiceRole.entities.User.list();
        const targetUser = allUsers.find(u => u.email === targetUserEmail);

        if (!targetUser) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }

        // Clear Google Calendar tokens for target user
        await base44.asServiceRole.entities.User.update(targetUser.id, {
            google_calendar_connected: false,
            google_access_token: null,
            google_refresh_token: null,
            google_token_expires_at: null,
            google_calendar_id: null,
            google_sync_enabled: false,
            last_google_sync: null
        });

        console.log(`✅ Admin ${user.email} disconnected Google Calendar for: ${targetUserEmail}`);

        return Response.json({ 
            success: true,
            message: `Google Calendar disconnected for ${targetUserEmail}`
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});