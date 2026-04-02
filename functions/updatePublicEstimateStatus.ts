import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req, { skipAuth: true });
    const { id, status } = await req.json();

    if (!id || !status) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['accepted', 'declined'].includes(status)) {
        return Response.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Update estimate
    const result = await base44.asServiceRole.entities.Estimate.update(id, { status });

    // Trigger workflow or notification here if needed
    // e.g. notify sales rep

    return Response.json({ success: true, data: result });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});