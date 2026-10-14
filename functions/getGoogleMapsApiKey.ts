import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const apiKey = Deno.env.get("GOOGLE_MAPS_BROWSER_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY");

        if (!apiKey) {
            return Response.json({ error: "Google Maps browser key is not configured. Set GOOGLE_MAPS_BROWSER_KEY in Secrets. GOOGLE_MAPS_API_KEY is also accepted until a separate browser key is added." }, { status: 500 });
        }

        return Response.json({ apiKey });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});