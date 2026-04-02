import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, webhookUrl, companyId, title, color } = await req.json();

    if (!message || !webhookUrl) {
      return Response.json({ error: 'Missing message or webhookUrl' }, { status: 400 });
    }

    // Send to Slack
    const slackPayload = {
      text: title || 'CRM Notification',
      attachments: [{
        color: color || '#36a64f',
        text: message,
        footer: 'Your CRM',
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Slack error:', errorText);
      return Response.json({ 
        error: `Slack API error: ${response.statusText}`,
        details: errorText
      }, { status: response.status });
    }

    // Log communication
    if (companyId) {
      try {
        await base44.entities.Communication.create({
          company_id: companyId,
          communication_type: 'note',
          direction: 'outbound',
          subject: title || 'Slack Notification',
          message: message,
          status: 'completed'
        });
      } catch (error) {
        console.error('Failed to log communication:', error);
      }
    }

    return Response.json({ success: true });

  } catch (error) {
    console.error('Error sending Slack message:', error);
    return Response.json({ 
      error: error.message || 'Failed to send message' 
    }, { status: 500 });
  }
});