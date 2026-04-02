import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_GEMINI_API_KEY is not configured' }, { status: 500 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (err) {
      body = {};
    }

    let model = (body && body.model) || 'gemini-2.0-flash-exp';

    // Fix: Map 'gemini-2.0-flash' to 'gemini-2.0-flash-exp'
    if (model === 'gemini-2.0-flash') {
        model = 'gemini-2.0-flash-exp';
    }

    // Use REST API directly to create ephemeral session
    // Use v1alpha for consistency with Live API
    const response = await fetch('https://generativelanguage.googleapis.com/v1alpha/models/' + model + ':createCachedContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        display_name: 'Live session for ' + user.email,
        model: 'models/' + model,
        systemInstruction: {
          text: 'You are a helpful AI assistant. Keep responses concise and clear.',
        },
        ttlSeconds: '1800',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      let errorMessage = errorText;
      try {
          const json = JSON.parse(errorText);
          errorMessage = json.error?.message || errorText;
      } catch (e) {
          // ignore json parse error
      }
      return Response.json({ error: 'Failed to create session: ' + errorMessage }, { status: response.status });
    }

    const data = await response.json();

    return Response.json({
      success: true,
      sessionId: data.name,
      model,
    });
  } catch (error) {
    console.error('Token creation error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});