import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const users = await base44.asServiceRole.entities.User.filter({ 
            google_calendar_connected: true 
        });
        
        console.log(`🔄 Checking ${users.length} users for calendar watch renewal...`);
        
        const now = Date.now();
        const renewalResults = [];
        
        for (const user of users) {
            try {
                if (!user.google_watch_expiration) {
                    console.log(`⚠️ User ${user.email} has no watch expiration date, setting up new watch...`);
                    await base44.asServiceRole.functions.invoke('setupGoogleCalendarWatch', {
                        targetUserEmail: user.email
                    });
                    renewalResults.push({ email: user.email, status: 'new_watch_created' });
                    continue;
                }
                
                const expirationTime = new Date(user.google_watch_expiration).getTime();
                const timeUntilExpiration = expirationTime - now;
                const hoursUntilExpiration = timeUntilExpiration / (1000 * 60 * 60);
                
                if (hoursUntilExpiration < 24) {
                    console.log(`🔄 Renewing watch for ${user.email} (expires in ${hoursUntilExpiration.toFixed(1)} hours)`);
                    
                    const result = await base44.asServiceRole.functions.invoke('setupGoogleCalendarWatch', {
                        targetUserEmail: user.email
                    });
                    
                    if (result.success) {
                        renewalResults.push({ 
                            email: user.email, 
                            status: 'renewed',
                            newExpiration: result.expires 
                        });
                        console.log(`✅ Watch renewed for ${user.email}`);
                    } else {
                        renewalResults.push({ 
                            email: user.email, 
                            status: 'failed',
                            error: result.error 
                        });
                        console.error(`❌ Failed to renew watch for ${user.email}:`, result.error);
                    }
                } else {
                    console.log(`✓ Watch for ${user.email} is still valid (expires in ${hoursUntilExpiration.toFixed(1)} hours)`);
                    renewalResults.push({ 
                        email: user.email, 
                        status: 'still_valid',
                        hoursUntilExpiration: hoursUntilExpiration.toFixed(1)
                    });
                }
            } catch (userError) {
                console.error(`❌ Error processing user ${user.email}:`, userError);
                renewalResults.push({ 
                    email: user.email, 
                    status: 'error',
                    error: userError.message 
                });
            }
        }
        
        const summary = {
            total: users.length,
            renewed: renewalResults.filter(r => r.status === 'renewed').length,
            new_watches: renewalResults.filter(r => r.status === 'new_watch_created').length,
            still_valid: renewalResults.filter(r => r.status === 'still_valid').length,
            failed: renewalResults.filter(r => r.status === 'failed' || r.status === 'error').length
        };
        
        console.log('📊 Renewal Summary:', summary);
        
        return Response.json({
            success: true,
            summary,
            results: renewalResults,
            message: `Processed ${users.length} users. Renewed ${summary.renewed} watches, created ${summary.new_watches} new watches.`
        });
        
    } catch (error) {
        console.error('❌ Cron renewal error:', error);
        return Response.json({ 
            error: error.message,
            success: false 
        }, { status: 500 });
    }
});

