import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        console.log('🔄 Starting automatic calendar sync for all users...');
        
        // Get all users with Google Calendar connected
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 1000);
        const connectedUsers = allUsers.filter(u => u.google_calendar_connected && u.google_access_token);
        
        console.log(`📊 Found ${connectedUsers.length} users with Google Calendar connected`);
        
        const results = [];
        
        // Sync each user's calendar
        for (const user of connectedUsers) {
            try {
                console.log(`🔄 Syncing calendar for: ${user.email}`);
                
                const syncResult = await base44.asServiceRole.functions.invoke('syncUserGoogleCalendar', {
                    targetUserEmail: user.email
                });
                
                results.push({
                    email: user.email,
                    status: 'success',
                    data: syncResult.data
                });
                
                console.log(`✅ Synced ${user.email}`);
            } catch (error) {
                console.error(`⚠️ Failed to sync ${user.email}:`, error.message);
                results.push({
                    email: user.email,
                    status: 'error',
                    error: error.message
                });
            }
        }
        
        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount = results.filter(r => r.status === 'error').length;
        
        console.log(`✅ Sync complete: ${successCount} successful, ${errorCount} failed`);
        
        return Response.json({
            success: true,
            totalUsers: connectedUsers.length,
            successCount,
            errorCount,
            results
        });
        
    } catch (error) {
        console.error('❌ Auto-sync error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});