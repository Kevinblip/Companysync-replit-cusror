import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🔄 Connecting Google Calendar for user:', user.email);

        const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || Deno.env.get('Google_Client_Id');

        if (!GOOGLE_CLIENT_ID) {
            console.error('❌ Missing GOOGLE_CLIENT_ID');
            return Response.json({
                error: 'Google OAuth not configured. GOOGLE_CLIENT_ID is missing from environment variables.',
                needsSetup: true
            }, { status: 500 });
        }

        const origin = req.headers.get('origin') || req.headers.get('referer') || 'https://getcompanysync.com';
        const appUrl = new URL(origin).origin;
        const REDIRECT_URI = `${appUrl}/api/google-calendar-callback`;

        console.log('🔗 Redirect URI:', REDIRECT_URI);
        console.log('👤 User connecting:', user.email);

        const scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ];

        const stateData = btoa(JSON.stringify({
            user_email: user.email,
            redirect_to: '/calendar'
        }));

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${GOOGLE_CLIENT_ID}&` +
            `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes.join(' '))}&` +
            `access_type=offline&` +
            `prompt=consent&` +
            `state=${stateData}`;

        console.log('✅ Generated auth URL with correct callback route');

        return Response.json({ authUrl, redirectUri: REDIRECT_URI });

    } catch (error) {
        console.error('❌ Error connecting Google Calendar:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
