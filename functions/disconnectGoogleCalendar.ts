import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const refreshToken = user.google_refresh_token;

        // Clear tokens from the user record
        await base44.entities.User.update(user.id, {
            google_access_token: null,
            google_refresh_token: null,
            google_token_expiry: null,
        });
        
        // Revoke the token with Google
        if (refreshToken) {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${refreshToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
        }
        
        return Response.json({ success: true, message: 'Google Calendar disconnected successfully.' });

    } catch (error) {
        console.error('Disconnect Google Calendar Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});