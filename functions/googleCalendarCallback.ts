import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    console.log('📞 ========== GOOGLE CALENDAR CALLBACK ==========');
    
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // User email is passed in state
    const error = url.searchParams.get('error');

    const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || Deno.env.get('Google_Client_Id');
    const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || Deno.env.get('Google_Secret_Key');
    
    const reqUrl = new URL(req.url);
    const baseUrl = Deno.env.get('APP_BASE_URL') || `${reqUrl.protocol}//${reqUrl.host}`;
    const REDIRECT_URI = `${baseUrl}/api/functions/googleCalendarCallback`;
    
    const calendarUrl = `${baseUrl}/calendar`;

    console.log('📋 Callback details:');
    console.log('   Redirect URI:', REDIRECT_URI);
    console.log('   User email (state):', state);
    console.log('   Has code:', !!code);
    console.log('   Has error:', !!error);
    console.log('   Client ID exists:', !!GOOGLE_CLIENT_ID);
    console.log('   Client Secret exists:', !!GOOGLE_CLIENT_SECRET);

    // If user denied access
    if (error) {
        console.error('❌ User denied access:', error);
        return new Response(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Connection Failed</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; }
                    .container { max-width: 500px; margin: 0 auto; }
                    h1 { color: #dc2626; }
                    button { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
                    button:hover { background: #2563eb; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Connection Cancelled</h1>
                    <p>You cancelled the Google Calendar connection.</p>
                    <button onclick="window.location.href='${calendarUrl}'">Go Back to Calendar</button>
                </div>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    if (!code || !state) {
        console.error('❌ Missing code or state');
        return new Response(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Error</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; }
                    .container { max-width: 500px; margin: 0 auto; }
                    h1 { color: #dc2626; }
                    button { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
                    button:hover { background: #2563eb; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Invalid Request</h1>
                    <p>Authorization code or state is missing.</p>
                    <button onclick="window.location.href='${calendarUrl}'">Go Back to Calendar</button>
                </div>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    try {
        console.log('🔄 Exchanging code for tokens...');
        
        // Exchange authorization code for tokens
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
            }),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.json();
            console.error('❌ Google Token Error:', JSON.stringify(errorData, null, 2));
            
            return new Response(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Connection Failed</title>
                    <style>
                        body { font-family: Arial; text-align: center; padding: 50px; }
                        .container { max-width: 600px; margin: 0 auto; }
                        h1 { color: #dc2626; }
                        .error { background: #fee; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: left; }
                        button { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 20px; }
                        button:hover { background: #2563eb; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>❌ Failed to Connect</h1>
                        <p>Could not exchange authorization code for tokens.</p>
                        <div class="error">
                            <strong>Error:</strong> ${errorData.error_description || errorData.error || 'Unknown error'}
                        </div>
                        <p><small>This usually means the redirect URI doesn't match what's configured in Google Cloud Console.</small></p>
                        <button onclick="window.location.href='${calendarUrl}'">Go Back to Calendar</button>
                    </div>
                </body>
                </html>
            `, {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        const tokens = await tokenResponse.json();
        const { access_token, refresh_token, expires_in } = tokens;

        console.log('✅ Tokens received successfully');
        console.log('   Has access token:', !!access_token);
        console.log('   Has refresh token:', !!refresh_token);
        console.log('   Expires in:', expires_in, 'seconds');

        // Calculate expiry date
        const expiryDate = new Date(new Date().getTime() + expires_in * 1000).toISOString();

        // Use service role to update user record
        const base44 = createClientFromRequest(req);
        
        console.log('🔍 Finding user:', state);
        const users = await base44.asServiceRole.entities.User.filter({ email: state });
        
        if (!users || users.length === 0) {
            console.error('❌ User not found:', state);
            
            return new Response(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>User Not Found</title>
                    <style>
                        body { font-family: Arial; text-align: center; padding: 50px; }
                        .container { max-width: 500px; margin: 0 auto; }
                        h1 { color: #dc2626; }
                        button { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
                        button:hover { background: #2563eb; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>❌ User Not Found</h1>
                        <p>Could not find user with email: <strong>${state}</strong></p>
                        <button onclick="window.location.href='${calendarUrl}'">Go Back to Calendar</button>
                    </div>
                </body>
                </html>
            `, {
                headers: { 'Content-Type': 'text/html' }
            });
        }

        const user = users[0];

        console.log('💾 Storing tokens for user:', user.email);
        
        // Store tokens on user record
        await base44.asServiceRole.entities.User.update(user.id, {
            google_access_token: access_token,
            google_refresh_token: refresh_token,
            google_token_expiry: expiryDate,
        });

        console.log('✅ Google Calendar connected successfully!');
        console.log('🔙 Redirecting to:', calendarUrl);

        // Show success page with auto-redirect
        return new Response(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Success!</title>
                <meta http-equiv="refresh" content="2;url=${calendarUrl}">
                <style>
                    body { 
                        font-family: Arial; 
                        text-align: center; 
                        padding: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                    }
                    .container { 
                        max-width: 500px; 
                        margin: 0 auto;
                        background: white;
                        padding: 40px;
                        border-radius: 12px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    }
                    h1 { color: #10b981; font-size: 2.5em; margin: 0; }
                    p { color: #333; font-size: 1.2em; }
                    .spinner {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #3b82f6;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>✅ Success!</h1>
                    <p>Google Calendar connected successfully!</p>
                    <div class="spinner"></div>
                    <p style="font-size: 0.9em; color: #666;">Redirecting you back to Calendar...</p>
                </div>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html' }
        });

    } catch (error) {
        console.error('❌ Google Callback Error:', error);
        console.error('   Error message:', error.message);
        console.error('   Error stack:', error.stack);
        
        return new Response(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Connection Error</title>
                <style>
                    body { font-family: Arial; text-align: center; padding: 50px; }
                    .container { max-width: 600px; margin: 0 auto; }
                    h1 { color: #dc2626; }
                    .error { background: #fee; padding: 15px; border-radius: 6px; margin: 20px 0; text-align: left; font-family: monospace; }
                    button { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 20px; }
                    button:hover { background: #2563eb; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>❌ Connection Error</h1>
                    <p>An error occurred while connecting to Google Calendar.</p>
                    <div class="error">
                        ${error.message}
                    </div>
                    <button onclick="window.location.href='${calendarUrl}'">Go Back to Calendar</button>
                </div>
            </body>
            </html>
        `, {
            headers: { 'Content-Type': 'text/html' }
        });
    }
});