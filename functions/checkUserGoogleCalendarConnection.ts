import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const connected = user.google_calendar_connected === true && 
                         user.google_access_token && 
                         user.google_refresh_token;

        return Response.json({ 
            connected: connected,
            last_sync: user.last_google_sync || null,
            sync_enabled: user.google_sync_enabled !== false
        });

    } catch (error) {
        console.error('❌ Error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});