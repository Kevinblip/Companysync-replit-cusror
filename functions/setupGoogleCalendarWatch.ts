import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// This function sets up a Google Calendar "watch" so Google sends us instant notifications
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        // Support both authenticated user and service role calls
        let user;
        let targetUserEmail;

        try {
            user = await base44.auth.me();
            targetUserEmail = user?.email;
        } catch (authError) {
            // If not authenticated, check for targetUserEmail in body (service role call)
            const body = await req.json().catch(() => ({}));
            targetUserEmail = body.targetUserEmail;
        }

        if (!targetUserEmail) {
            return Response.json({ error: 'No user specified' }, { status: 400 });
        }

        // Get user by email using service role
        const users = await base44.asServiceRole.entities.User.filter({ email: targetUserEmail });
        user = users[0];

        if (!user) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }
        
        if (!user.google_calendar_connected || !user.google_access_token) {
            return Response.json({ 
                error: 'Google Calendar not connected. Please connect first.' 
            }, { status: 400 });
        }
        
        console.log('🔔 Setting up instant webhook for:', user.email);
        
        // Get the webhook URL - must be the full API function URL
        const appId = Deno.env.get('BASE44_APP_ID');
        const webhookUrl = `https://getcompanysync.com/api/apps/${appId}/functions/googleCalendarWebhook`;
        
        console.log('📡 Webhook URL:', webhookUrl);
        
        // Try to get access token from connector first
        let accessToken = user.google_access_token;
        try {
            const connectorToken = await base44.asServiceRole.connectors.getAccessToken('googlecalendar');
            if (connectorToken) {
                accessToken = connectorToken;
                console.log('✅ Using connector access token');
            }
        } catch (connectorError) {
            console.log('ℹ️ No connector token, using user token:', connectorError.message);
        }

        // Set up Google Calendar push notification
        console.log('📡 Calling Google Calendar API to set up watch...');
        const watchResponse = await fetch(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events/watch',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id: `calendar_${user.email}_${Date.now()}`,
                    type: 'web_hook',
                    address: webhookUrl,
                    expiration: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
                })
            }
        );
        
        if (!watchResponse.ok) {
            const errorText = await watchResponse.text();
            console.error('❌ Failed to set up watch:', watchResponse.status, errorText);
            
            // Parse error for better messaging
            let errorMessage = 'Failed to set up instant sync';
            try {
                const errorData = JSON.parse(errorText);
                if (errorData.error?.message) {
                    errorMessage = errorData.error.message;
                }
            } catch (e) {
                errorMessage = errorText;
            }
            
            return Response.json({ 
                error: 'Google Calendar webhook setup failed',
                details: errorMessage,
                suggestion: 'This requires domain verification in Google Cloud Console. For now, use "Sync Now" button manually or we can set up automatic periodic syncing.'
            }, { status: 500 });
        }
        
        const watchData = await watchResponse.json();
        console.log('✅ Watch set up successfully:', watchData);
        
        // Save watch info to user
        await base44.asServiceRole.entities.User.update(user.id, {
            google_watch_channel_id: watchData.id,
            google_watch_resource_id: watchData.resourceId,
            google_watch_expiration: new Date(parseInt(watchData.expiration)).toISOString()
        });
        
        return Response.json({ 
            success: true,
            message: '✅ Instant sync enabled! Your calendar will now sync automatically whenever you make changes in Google Calendar.',
            expires: new Date(parseInt(watchData.expiration)).toISOString()
        });
        
    } catch (error) {
        console.error('❌ Setup error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});