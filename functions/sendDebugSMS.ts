import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendSMSInternal } from './utils/smsSender.js';

Deno.serve(async (req) => {
    // For security, you should validate the user is authenticated
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    try {
        const { to, body } = await req.json();

        if (!to || !body) {
            return Response.json({ error: 'Missing "to" or "body"' }, { status: 400 });
        }

        // Reuse the shared utility to ensure consistent behavior
        // We'll pass the user email so it can lookup company if needed
        const result = await sendSMSInternal(base44, {
            to,
            body,
            userEmail: user.email
        });
        
        return Response.json(result);
    } catch (error) {
        console.error('Debug SMS Failed:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});