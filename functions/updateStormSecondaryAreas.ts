import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { stormId, secondary_areas } = body;
    if (!stormId) return Response.json({ error: 'stormId required' }, { status: 400 });
    if (!Array.isArray(secondary_areas)) return Response.json({ error: 'secondary_areas must be an array' }, { status: 400 });

    // Storm events are stored service-role — the regular entity API cannot update them
    await base44.asServiceRole.entities.StormEvent.update(stormId, { secondary_areas });

    return Response.json({ success: true });
  } catch (err) {
    console.error('[updateStormSecondaryAreas]', err);
    return Response.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
});
