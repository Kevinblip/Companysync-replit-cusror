import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Return public settings that are safe to expose to frontend
        return Response.json({
            resend_domain: 'crewcam.com',
            weather_api_enabled: !!Deno.env.get('Base44_APIKEY_WEATHER')
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});