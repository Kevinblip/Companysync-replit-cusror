import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, spaceId, cardTitle, cardSubtitle } = await req.json();

    if (!message || !spaceId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get OAuth access token for Google Chat
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('google');

    if (!accessToken) {
      return Response.json({ 
        error: 'Google Chat not connected. Please authorize in Settings → Google Chat.' 
      }, { status: 400 });
    }

    // Send message via Google Chat API
    const response = await fetch(
      `https://chat.googleapis.com/v1/spaces/${spaceId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: message,
          cards: cardTitle ? [{
            header: {
              title: cardTitle,
              subtitle: cardSubtitle || '',
            },
            sections: [{
              widgets: [{
                textParagraph: {
                  text: message
                }
              }]
            }]
          }] : undefined
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error('Google Chat API error:', errorData);
      return Response.json({ 
        error: `Failed to send message: ${response.statusText}`,
        details: errorData
      }, { status: response.status });
    }

    const result = await response.json();
    return Response.json({ success: true, messageId: result.name });

  } catch (error) {
    console.error('Error sending Google Chat message:', error);
    return Response.json({ 
      error: error.message || 'Failed to send message' 
    }, { status: 500 });
  }
});