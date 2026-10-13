import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Google OAuth setup
        const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || Deno.env.get('Google_Client_Id');
        const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || Deno.env.get('Google_Secret_Key');
        
        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
            return Response.json({ 
                error: 'Google OAuth credentials (GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET) are not set in the environment variables. Please check your app settings.',
                needsSetup: true
            }, { status: 500 });
        }
        
        const reqUrl = new URL(req.url);
        const baseUrl = Deno.env.get('APP_BASE_URL') || `${reqUrl.protocol}//${reqUrl.host}`;
        const REDIRECT_URI = `${baseUrl}/api/functions/googleCalendarCallback`;

        console.log('🔗 Using redirect URI:', REDIRECT_URI);
        console.log('👤 User connecting:', user.email);

        // Generate OAuth URL
        const scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events'
        ];

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${GOOGLE_CLIENT_ID}&` +
            `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes.join(' '))}&` +
            `access_type=offline&` +
            `prompt=consent&` +
            `state=${user.email}`;

        return Response.json({ authUrl });

    } catch (error) {
        console.error('❌ Connect Google Calendar Error:', error);
        return Response.json({ error: `An unexpected error occurred: ${error.message}` }, { status: 500 });
    }
});