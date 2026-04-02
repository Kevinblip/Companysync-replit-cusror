import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    const appId = Deno.env.get("BASE44_APP_ID");
    return Response.json({ appId });
});