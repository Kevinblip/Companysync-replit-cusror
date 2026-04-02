import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('🔄 ========== GOOGLE CALENDAR CALLBACK STARTED ==========');
    console.log('🔗 Full URL:', req.url);
    
    try {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        console.log('📥 Query params:', {
            hasCode: !!code,
            hasState: !!state,
            hasError: !!error,
            error: error
        });

        // If Google returned an error, handle it
        if (error) {
            console.error('❌ Google OAuth error:', error);
            const errorMsg = error === 'access_denied' ? 'You denied access to Google Calendar' : error;
            return new Response(
                getHtmlPage(false, errorMsg, 'https://getcompanysync.com/calendar'),
                { headers: { 'Content-Type': 'text/html' } }
            );
        }

        if (!code) {
            console.error('❌ Missing authorization code');
            return new Response(
                getHtmlPage(false, 'Missing authorization code from Google', 'https://getcompanysync.com/calendar'),
                { headers: { 'Content-Type': 'text/html' } }
            );
        }

        // Decode state to get user email
        console.log('🔓 Decoding state...');
        let stateData, userEmail, redirectTo;
        try {
            stateData = JSON.parse(atob(state));
            userEmail = stateData.user_email;
            redirectTo = stateData.redirect_to || '/calendar';
            console.log('✅ State decoded successfully:', { userEmail, redirectTo });
        } catch (e) {
            console.error('❌ Failed to decode state:', e.message);
            throw new Error('Invalid state parameter: ' + e.message);
        }

        console.log('👤 User email:', userEmail);
        console.log('🔀 Will redirect to:', redirectTo);

        const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
        const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

        console.log('🔑 Checking Google credentials...');
        console.log('   GOOGLE_CLIENT_ID:', GOOGLE_CLIENT_ID ? '✓ (set)' : '✗ (missing)');
        console.log('   GOOGLE_CLIENT_SECRET:', GOOGLE_CLIENT_SECRET ? '✓ (set)' : '✗ (missing)');

        if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
            console.error('❌ Missing Google credentials');
            throw new Error('Google API credentials not configured - check environment variables');
        }

        // 🔥 FIXED: Hardcode Base44 app URL
        const redirectUri = 'https://getcompanysync.com/api/functions/userGoogleCalendarCallback';

        console.log('🔗 Using redirect URI:', redirectUri);

        // Exchange code for tokens
        console.log('🔄 Exchanging authorization code for tokens...');
        const tokenRequestBody = {
            code: code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        };

        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(tokenRequestBody)
        });

        console.log('📦 Token response status:', tokenResponse.status);
        const tokens = await tokenResponse.json();
        console.log('📦 Token response keys:', Object.keys(tokens));

        if (tokens.error) {
            console.error('❌ Token error from Google:', tokens);
            throw new Error(`Google token error: ${tokens.error_description || tokens.error}`);
        }

        if (!tokens.access_token) {
            console.error('❌ No access token in response:', tokens);
            throw new Error('Failed to get access token from Google');
        }

        console.log('✅ Got access token! Length:', tokens.access_token.length);
        console.log('✅ Got refresh token:', !!tokens.refresh_token);
        console.log('✅ Token expires in:', tokens.expires_in, 'seconds');

        // Use service role to update user
        console.log('🔧 Creating Base44 client...');
        const base44 = createClientFromRequest(req);
        
        // Get the user by email
        console.log('🔍 Looking up user by email:', userEmail);
        const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
        console.log('👥 Users found:', users.length);

        const user = users[0];

        if (!user) {
            console.error('❌ User not found with email:', userEmail);
            throw new Error('User not found - please try logging out and back in');
        }

        console.log('👤 Found user ID:', user.id);

        // Update user with Google Calendar tokens
        const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();

        console.log('💾 Updating user with Google Calendar connection...');
        console.log('   - Setting google_calendar_connected: true');
        console.log('   - Setting access token');
        console.log('   - Setting refresh token:', !!tokens.refresh_token);
        console.log('   - Token expires at:', expiresAt);

        await base44.asServiceRole.entities.User.update(user.id, {
            google_calendar_connected: true,
            google_access_token: tokens.access_token,
            google_refresh_token: tokens.refresh_token || user.google_refresh_token,
            google_token_expires_at: expiresAt,
            google_sync_enabled: true,
            last_google_sync: new Date().toISOString()
        });

        console.log('✅ User successfully updated!');
        console.log('✅ Google Calendar connected for user:', userEmail);

        // 🔔 Automatically set up instant webhook sync
        console.log('🔔 Setting up instant webhook notifications...');
        let webhookSuccess = false;
        try {
            const webhookResult = await base44.asServiceRole.functions.invoke('setupGoogleCalendarWatch', {
                targetUserEmail: userEmail
            });
            console.log('✅ Instant sync webhooks enabled!', webhookResult.data);
            webhookSuccess = true;
        } catch (webhookError) {
            console.error('❌ WEBHOOK SETUP FAILED:', webhookError.message);
            console.error('Full error:', JSON.stringify(webhookError, Object.getOwnPropertyNames(webhookError)));
            console.error('⚠️ WARNING: Google Calendar will NOT sync automatically. User must manually sync.');
        }
        
        // 🔄 Trigger initial sync to pull existing Google Calendar events
        console.log('🔄 Performing initial sync...');
        try {
            await base44.asServiceRole.functions.invoke('syncUserGoogleCalendar', {
                targetUserEmail: userEmail
            });
            console.log('✅ Initial sync completed!');
        } catch (syncError) {
            console.error('⚠️ Initial sync failed (non-critical):', syncError.message);
        }

        // Return success page with auto-redirect
        const webhookWarning = webhookSuccess ? '' : ' Note: Automatic sync is not available - you will need to click "Sync Now" to update your calendar.';
        const finalRedirect = `https://getcompanysync.com${redirectTo}?google_connected=true`;
        console.log('🔀 Redirecting to:', finalRedirect);
        console.log('🔄 ========== CALLBACK COMPLETED SUCCESSFULLY ==========');
        
        return new Response(
            getHtmlPage(true, `Successfully connected to Google Calendar!${webhookWarning}`, finalRedirect),
            { headers: { 'Content-Type': 'text/html' } }
        );

    } catch (error) {
        console.error('❌ ========== CALLBACK ERROR ==========');
        console.error('❌ Error message:', error.message);
        console.error('❌ Error stack:', error.stack);
        
        // More user-friendly error messages
        let userMessage = error.message;
        if (error.message.includes('invalid_grant')) {
            userMessage = 'Authorization code expired - please try connecting again';
        } else if (error.message.includes('redirect_uri_mismatch')) {
            userMessage = 'Configuration error - redirect URI mismatch';
        }
        
        return new Response(
            getHtmlPage(false, userMessage, 'https://getcompanysync.com/calendar'),
            { headers: { 'Content-Type': 'text/html' } }
        );
    }
});

function getHtmlPage(success, message, redirectUrl) {
    const statusIcon = success ? '✅' : '❌';
    const statusColor = success ? '#10b981' : '#ef4444';
    const statusText = success ? 'Success' : 'Error';
    
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Google Calendar ${statusText}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            border-radius: 16px;
            padding: 40px;
            max-width: 500px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center;
        }
        .icon {
            font-size: 64px;
            margin-bottom: 20px;
        }
        h1 {
            color: ${statusColor};
            margin: 0 0 20px 0;
            font-size: 24px;
        }
        p {
            color: #666;
            line-height: 1.6;
            margin-bottom: 30px;
        }
        .btn {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 12px 32px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            transition: all 0.2s;
        }
        .btn:hover {
            background: #5568d3;
            transform: translateY(-2px);
        }
        .countdown {
            color: #999;
            font-size: 14px;
            margin-top: 20px;
        }
    </style>
    ${success ? `<meta http-equiv="refresh" content="2;url=${redirectUrl}">` : ''}
</head>
<body>
    <div class="container">
        <div class="icon">${statusIcon}</div>
        <h1>${statusText}</h1>
        <p>${message}</p>
        <a href="${redirectUrl}" class="btn">Return to Calendar</a>
        ${success ? '<p class="countdown">Redirecting automatically in <span id="countdown">2</span> seconds...</p>' : ''}
    </div>
    ${success ? `
    <script>
        let count = 2;
        const countdownEl = document.getElementById('countdown');
        setInterval(() => {
            count--;
            if (count >= 0) countdownEl.textContent = count;
        }, 1000);
    </script>
    ` : ''}
</body>
</html>`;
}