import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Authenticate user first
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { family_member_id } = body;

        if (!family_member_id) {
            return Response.json({ error: 'family_member_id required' }, { status: 400 });
        }

        // Get family member
        const members = await base44.asServiceRole.entities.FamilyMember.filter({ id: family_member_id });
        if (members.length === 0) {
            return Response.json({ error: 'Family member not found' }, { status: 404 });
        }

        const member = members[0];

        // Generate secure token (valid for 30 days)
        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        // Save token to family member
        await base44.asServiceRole.entities.FamilyMember.update(family_member_id, {
            setup_token: token,
            setup_token_expires: expiresAt
        });

        // Generate link (use your app's URL)
        const appUrl = new URL(req.url).origin;
        const setupLink = `${appUrl}/setup-bank-account?token=${token}`;

        console.log(`✅ Generated setup link for ${member.full_name}`);

        return Response.json({
            success: true,
            setup_link: setupLink,
            expires_at: expiresAt,
            family_member: member.full_name
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
});