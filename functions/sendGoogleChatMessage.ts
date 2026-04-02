import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { message, webhookUrl, companyId, cardTitle, cardSubtitle } = await req.json();

        if (!message || !webhookUrl) {
            return Response.json({ 
                error: 'Missing required fields: message and webhookUrl' 
            }, { status: 400 });
        }

        // Build Google Chat card message format
        const chatMessage = {
            text: message,
            cards: cardTitle ? [{
                header: {
                    title: cardTitle,
                    subtitle: cardSubtitle || new Date().toLocaleString(),
                    imageUrl: "https://developers.google.com/chat/images/quickstart-app-avatar.png"
                },
                sections: [{
                    widgets: [{
                        textParagraph: {
                            text: message
                        }
                    }]
                }]
            }] : undefined
        };

        // Send to Google Chat webhook
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(chatMessage)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google Chat API error: ${response.status} - ${errorText}`);
        }

        console.log('✅ Message sent to Google Chat');

        return Response.json({
            success: true,
            message: 'Message sent to Google Chat'
        });

    } catch (error) {
        console.error('❌ Google Chat error:', error);
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});