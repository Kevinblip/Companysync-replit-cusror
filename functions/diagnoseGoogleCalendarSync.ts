import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔍 Diagnosing Google Calendar sync for:', user.email);

        const diagnosis = {
            user_email: user.email,
            connected: !!user.google_calendar_connected,
            has_access_token: !!user.google_access_token,
            has_refresh_token: !!user.google_refresh_token,
            token_expires_at: user.google_token_expires_at,
            token_expired: user.google_token_expires_at ? new Date(user.google_token_expires_at) < new Date() : null,
            last_sync: user.last_google_sync,
            webhook_channel_id: user.google_watch_channel_id,
            webhook_resource_id: user.google_watch_resource_id,
            webhook_expiration: user.google_watch_expiration,
            webhook_expired: user.google_watch_expiration ? new Date(user.google_watch_expiration) < new Date() : null,
            issues: [],
            recommendations: []
        };

        // Check for issues
        if (!diagnosis.connected) {
            diagnosis.issues.push('Google Calendar not connected');
            diagnosis.recommendations.push('Click "Connect Google Calendar" to authorize access');
        }

        if (!diagnosis.has_access_token) {
            diagnosis.issues.push('No access token found');
            diagnosis.recommendations.push('Reconnect your Google Calendar');
        }

        if (diagnosis.token_expired) {
            diagnosis.issues.push('Access token has expired');
            diagnosis.recommendations.push('Token will be auto-refreshed on next sync, or reconnect manually');
        }

        if (!diagnosis.webhook_channel_id) {
            diagnosis.issues.push('Webhook not set up - calendar will NOT sync automatically');
            diagnosis.recommendations.push('Click "Setup Instant Sync" to enable automatic syncing');
        }

        if (diagnosis.webhook_expired) {
            diagnosis.issues.push('Webhook has expired - calendar will NOT sync automatically');
            diagnosis.recommendations.push('Click "Setup Instant Sync" to renew automatic syncing');
        }

        if (!diagnosis.last_sync) {
            diagnosis.issues.push('Calendar has never been synced');
            diagnosis.recommendations.push('Click "Sync Now" to perform initial sync');
        }

        const hoursSinceLastSync = diagnosis.last_sync 
            ? (Date.now() - new Date(diagnosis.last_sync).getTime()) / (1000 * 60 * 60)
            : null;

        if (hoursSinceLastSync && hoursSinceLastSync > 24) {
            diagnosis.issues.push(`Last sync was ${Math.round(hoursSinceLastSync)} hours ago`);
            diagnosis.recommendations.push('Click "Sync Now" to update your calendar');
        }

        diagnosis.status = diagnosis.issues.length === 0 ? 'healthy' : 'needs_attention';

        console.log('✅ Diagnosis complete:', diagnosis.status);
        console.log('Issues found:', diagnosis.issues.length);

        return Response.json(diagnosis);

    } catch (error) {
        console.error('❌ Diagnosis error:', error);
        return Response.json({ 
            error: error.message,
            status: 'error'
        }, { status: 500 });
    }
});