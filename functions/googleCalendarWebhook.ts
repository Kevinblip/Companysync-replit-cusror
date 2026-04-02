import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('🔔 Google Calendar Webhook triggered');
        console.log('Request method:', req.method);
        console.log('Request headers:', Object.fromEntries(req.headers.entries()));
        
        // Google sends a sync token in the header
        const channelId = req.headers.get('x-goog-channel-id');
        const resourceState = req.headers.get('x-goog-resource-state');
        
        console.log('Channel ID:', channelId);
        console.log('Resource State:', resourceState);
        
        // Ignore "sync" state (initial verification)
        if (resourceState === 'sync') {
            console.log('✅ Webhook verification successful');
            return new Response('OK', { status: 200 });
        }
        
        // Handle OPTIONS for CORS
        if (req.method === 'OPTIONS') {
            return new Response('OK', {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': '*'
                }
            });
        }
        
        // Get user email from channel ID (we'll encode it when setting up the watch)
        const userEmail = channelId?.split('_')[1];
        
        if (!userEmail) {
            console.error('❌ No user email in channel ID');
            return new Response('Invalid channel', { status: 400 });
        }
        
        console.log('🔄 Triggering instant sync for:', userEmail);
        
        const base44 = createClientFromRequest(req);
        
        // Get user's auth tokens
        const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
        const user = users[0];
        
        if (!user || !user.google_calendar_connected) {
            console.error('❌ User not found or not connected:', userEmail);
            return new Response('User not connected', { status: 404 });
        }
        
        // Trigger sync in background (don't wait for it)
        base44.asServiceRole.functions.invoke('syncUserGoogleCalendar', {
            targetUserEmail: userEmail
        }).then(() => {
            console.log('✅ Background sync completed for', userEmail);
        }).catch(err => {
            console.error('⚠️ Background sync error:', err.message);
        });
        
        return new Response('OK', { status: 200 });
        
    } catch (error) {
        console.error('❌ Webhook error:', error);
        return new Response('Error: ' + error.message, { status: 500 });
    }
});