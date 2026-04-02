import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
        const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

        // Test if we can access Google Calendar API
        let apiAccessTest = 'NOT TESTED';
        let apiError = null;
        
        if (user.google_access_token) {
            try {
                const testResponse = await fetch(
                    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
                    {
                        headers: {
                            'Authorization': `Bearer ${user.google_access_token}`
                        }
                    }
                );
                
                if (testResponse.ok) {
                    apiAccessTest = '✅ SUCCESS';
                } else {
                    const errorData = await testResponse.json();
                    apiAccessTest = `❌ FAILED (${testResponse.status})`;
                    apiError = errorData;
                }
            } catch (error) {
                apiAccessTest = `❌ ERROR: ${error.message}`;
            }
        }

        const diagnosis = {
            user_email: user.email,
            connection_status: user.google_calendar_connected ? '✅ Connected' : '❌ Not Connected',
            has_access_token: user.google_access_token ? '✅ Yes' : '❌ No',
            has_refresh_token: user.google_refresh_token ? '✅ Yes' : '❌ No',
            token_expires_at: user.google_token_expires_at || 'Not set',
            token_expired: user.google_token_expires_at ? (new Date(user.google_token_expires_at) < new Date() ? '⚠️ YES - Token Expired!' : '✅ No') : 'Unknown',
            last_sync: user.last_google_sync || 'Never',
            api_access_test: apiAccessTest,
            api_error: apiError,
            
            google_cloud_setup: {
                client_id: GOOGLE_CLIENT_ID ? `✅ Set (${GOOGLE_CLIENT_ID.substring(0, 20)}...)` : '❌ NOT SET',
                client_secret: GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ NOT SET',
                redirect_uri: 'https://getcompanysync.com/api/functions/userGoogleCalendarCallback',
            },

            required_steps: [
                '═══════════════════════════════════════════════',
                '🔧 GOOGLE CLOUD CONSOLE SETUP CHECKLIST',
                '═══════════════════════════════════════════════',
                '',
                '1️⃣ ENABLE GOOGLE CALENDAR API',
                '   → https://console.cloud.google.com/apis/library/calendar-json.googleapis.com',
                '   → Click "ENABLE"',
                '',
                '2️⃣ CONFIGURE OAUTH CONSENT SCREEN',
                '   → https://console.cloud.google.com/apis/credentials/consent',
                '   → Click "EDIT APP"',
                '   → On "Scopes" step, click "ADD OR REMOVE SCOPES"',
                '   → Search for "calendar"',
                '   → Check these 2 scopes:',
                '     ✅ https://www.googleapis.com/auth/calendar',
                '     ✅ https://www.googleapis.com/auth/calendar.events',
                '   → Click "UPDATE"',
                '   → Click "SAVE AND CONTINUE"',
                '',
                '3️⃣ ADD TEST USER',
                '   → On "Test users" step',
                '   → Click "+ ADD USERS"',
                `   → Add your email: ${user.email}`,
                '   → Click "ADD"',
                '   → Click "SAVE AND CONTINUE"',
                '',
                '4️⃣ FIX REDIRECT URI',
                '   → https://console.cloud.google.com/apis/credentials',
                `   → Find OAuth Client ID: ${GOOGLE_CLIENT_ID?.substring(0, 30)}...`,
                '   → Click "EDIT" (pencil icon)',
                '   → Under "Authorized redirect URIs":',
                '   → REMOVE all existing URIs',
                '   → ADD this exact URI:',
                '     https://getcompanysync.com/api/functions/userGoogleCalendarCallback',
                '   → Click "SAVE"',
                '',
                '5️⃣ WAIT & TEST',
                '   → Wait 2-3 minutes for changes to propagate',
                '   → Go back to your CRM Calendar page',
                '   → Click "Disconnect" (if connected)',
                '   → Click "Connect Google Calendar"',
                '   → Grant ALL permissions when Google asks',
                '',
                '═══════════════════════════════════════════════',
            ]
        };

        return new Response(JSON.stringify(diagnosis, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return Response.json({ 
            error: error.message 
        }, { status: 500 });
    }
});