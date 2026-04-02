import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('🚀 === BULK SYNC ALL CALENDARS STARTED ===');
        
        const base44 = createClientFromRequest(req);
        const requestingUser = await base44.auth.me();

        if (!requestingUser) {
            console.error('❌ Unauthorized');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Only admins can run bulk sync
        if (requestingUser.role !== 'admin') {
            return Response.json({ error: 'Only admins can run bulk sync' }, { status: 403 });
        }

        // Get all users with Google Calendar connected
        const allUsers = await base44.asServiceRole.entities.User.list();
        const connectedUsers = allUsers.filter(u => u.google_calendar_connected === true);

        console.log(`📋 Found ${connectedUsers.length} connected users`);

        const results = {
            total: connectedUsers.length,
            success: 0,
            failed: 0,
            details: []
        };

        // Sync each connected user's calendar
        for (const user of connectedUsers) {
            try {
                console.log(`🔄 Syncing calendar for ${user.email}...`);
                
                // Call the individual sync function for this user
                const syncResponse = await base44.asServiceRole.functions.invoke('syncUserGoogleCalendar', {
                    targetUserEmail: user.email
                });

                if (syncResponse.success) {
                    results.success++;
                    results.details.push({
                        email: user.email,
                        status: 'success',
                        fromGoogle: syncResponse.fromGoogle,
                        toGoogle: syncResponse.toGoogle
                    });
                    console.log(`✅ Synced ${user.email}: ${syncResponse.total} changes`);
                } else {
                    throw new Error(syncResponse.error || 'Sync failed');
                }
            } catch (error) {
                console.error(`❌ Failed to sync ${user.email}:`, error.message);
                results.failed++;
                results.details.push({
                    email: user.email,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        console.log(`✅ === BULK SYNC COMPLETED: ${results.success} success, ${results.failed} failed ===`);

        return Response.json(results);

    } catch (error) {
        console.error('❌ === BULK SYNC ERROR ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        
        return Response.json({ 
            error: error.message,
            details: 'Check server logs for more details'
        }, { status: 500 });
    }
});