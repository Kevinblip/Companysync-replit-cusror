import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
        const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

        const report = {
            user_email: user.email,
            client_id: GOOGLE_CLIENT_ID || 'NOT SET',
            client_secret_set: !!GOOGLE_CLIENT_SECRET,
            redirect_uri: 'https://getcompanysync.com/api/functions/userGoogleCalendarCallback',
            
            required_scopes: [
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events'
            ],
            
            steps_to_complete: [
                '1. Go to: https://console.cloud.google.com/apis/credentials',
                `2. Find OAuth Client ID: ${GOOGLE_CLIENT_ID?.substring(0, 25)}...`,
                '3. Click EDIT',
                '4. Under "Authorized redirect URIs", ADD:',
                '   https://getcompanysync.com/api/functions/userGoogleCalendarCallback',
                '5. REMOVE all other redirect URIs (especially the Deno one)',
                '6. Click SAVE',
                '',
                '7. Go to: https://console.cloud.google.com/apis/credentials/consent',
                '8. Click "EDIT APP"',
                '9. On SCOPES step, click "ADD OR REMOVE SCOPES"',
                '10. Search: calendar',
                '11. Check BOTH scopes:',
                '    ✅ .../auth/calendar',
                '    ✅ .../auth/calendar.events',
                '12. Click UPDATE',
                '',
                '13. On TEST USERS step, click "+ ADD USERS"',
                `14. Add: ${user.email}`,
                '15. Click ADD',
                '16. Click SAVE AND CONTINUE through all steps',
                '',
                '17. Go to: https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
                '18. Click ENABLE (if not already enabled)',
                '',
                '19. WAIT 2-3 minutes for changes to propagate',
                '20. Test in INCOGNITO window: https://getcompanysync.com/calendar'
            ]
        };

        return Response.json(report, { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});