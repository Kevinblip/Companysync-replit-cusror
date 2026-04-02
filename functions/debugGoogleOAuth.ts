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

        const url = new URL(req.url);
        const appUrl = url.origin;
        const redirectUri = `${appUrl}/api/functions/userGoogleCalendarCallback`;

        return Response.json({ 
            success: true,
            debug_info: {
                user_email: user.email,
                client_id: GOOGLE_CLIENT_ID,
                client_secret_set: !!GOOGLE_CLIENT_SECRET,
                app_url: appUrl,
                redirect_uri: redirectUri,
                expected_redirect_uri: `https://getcompanysync.com/api/functions/userGoogleCalendarCallback`,
                match: redirectUri === `https://getcompanysync.com/api/functions/userGoogleCalendarCallback`,
                instructions: [
                    "1. Go to: https://console.cloud.google.com/apis/credentials",
                    `2. Find OAuth Client: ${GOOGLE_CLIENT_ID?.substring(0, 20)}...`,
                    "3. Click Edit, add this EXACT redirect URI:",
                    redirectUri,
                    "4. Go to OAuth Consent Screen → Edit App",
                    "5. Add scopes: calendar, calendar.events",
                    `6. Add ${user.email} as Test User`,
                    "7. Save everything and wait 2 minutes"
                ]
            }
        });

    } catch (error) {
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});