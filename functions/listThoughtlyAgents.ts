import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = (Deno.env.get('THOUGHTLY_API_KEY') || '').trim();
    const teamId = (Deno.env.get('THOUGHTLY_TEAM_ID') || '').trim();

    if (!apiKey || !teamId) {
      return Response.json(
        {
          error: 'Missing Thoughtly credentials',
          details: { hasApiKey: !!apiKey, hasTeamId: !!teamId },
          help: 'Please set THOUGHTLY_API_KEY and THOUGHTLY_TEAM_ID in your environment.',
        },
        { status: 400 },
      );
    }

    const url = 'https://api.thoughtly.com/interview?limit=50';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-token': apiKey,
        'team_id': teamId,
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      return Response.json(
        {
          error: `Thoughtly request failed (${response.status})`,
          details: responseText,
        },
        { status: 502 },
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (_e) {
      parsed = { data: [] };
    }

    // Attempt to normalize agents list from various possible shapes
    const root = parsed?.data ?? parsed ?? [];
    let list = Array.isArray(root)
      ? root
      : (root.items || root.list || root.agents || root.interviews || root.results || []);

    if (!Array.isArray(list) && Array.isArray(root.data)) {
      list = root.data;
    }

    if (!Array.isArray(list)) list = [];

    const agents = list
      .map((a) => ({
        id: a?.id || a?._id || a?.agent_id || a?.uuid,
        name: a?.title || a?.name || a?.agent_name || a?.display_name || 'Unnamed Agent',
        status: a?.status,
        phone_number: a?.phone_number || a?.phoneNumber,
        created_at: a?.created_at || a?.createdAt,
      }))
      .filter((a) => !!a.id);

    return Response.json({ success: true, agents, raw: parsed });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});