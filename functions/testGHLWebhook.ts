import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Just a mock test to verify the endpoint is reachable
        // In a real scenario, this might trigger a test event in GHL if their API supports it
        
        return Response.json({ 
            success: true, 
            message: 'Webhook endpoint is ready to receive events.',
            endpoint_url: 'https://getcompanysync.com/api/functions/ghlWebhook'
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});