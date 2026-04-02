import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Clear Google Calendar tokens and connection
        await base44.auth.updateMe({
            google_calendar_connected: false,
            google_access_token: null,
            google_refresh_token: null,
            google_token_expires_at: null,
            google_calendar_id: null,
            google_sync_enabled: false,
            last_google_sync: null
        });

        console.log('✅ Disconnected Google Calendar for user:', user.email);

        return Response.json({ 
            success: true,
            message: 'Google Calendar disconnected'
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});