import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ connected: false, error: 'Unauthorized' }, { status: 401 });
        }

        const isConnected = !!user.google_refresh_token;

        return Response.json({ connected: isConnected });

    } catch (error) {
        console.error('Check Google Connection Error:', error);
        return Response.json({ connected: false, error: error.message }, { status: 500 });
    }
});