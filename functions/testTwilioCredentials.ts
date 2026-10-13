import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        // Require auth
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { accountSid, authToken } = await req.json();

        if (!accountSid || !authToken) {
            return Response.json({ success: false, message: "Missing SID or Token" });
        }

        // Aggressive cleaning of credentials
        const sid = accountSid.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');
        const token = authToken.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');

        if (!sid.startsWith('AC')) {
             return Response.json({ success: false, message: "❌ Account SID must start with 'AC'" });
        }

        // Basic Auth header
        const authHeader = `Basic ${btoa(`${sid}:${token}`)}`;

        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
            headers: { 'Authorization': authHeader }
        });

        if (response.ok) {
            const data = await response.json();
            // Verify the SID matches
            if (data.sid !== sid) {
                 return Response.json({ success: false, message: "❌ Connected, but SID mismatch. Please check your credentials." });
            }
            // Also check if account is active
            if (data.status === 'suspended' || data.status === 'closed') {
                 return Response.json({ success: false, message: `❌ Connection successful, but Account is ${data.status}.` });
            }
            return Response.json({ success: true, message: `✅ Twilio connection successful! (${data.type} account)` });
        } else {
            console.error("Twilio Auth Failed:", response.status, response.statusText);
            
            let msg = `❌ Twilio API Error: ${response.status} ${response.statusText}`;
            if (response.status === 401) {
                msg = "❌ Authentication Failed. Please check your Auth Token.";
            } else if (response.status === 404) {
                msg = "❌ Account SID not found. Please check your SID.";
            }
            
            return Response.json({ 
                success: false, 
                message: msg
            });
        }
    } catch (error) {
        console.error("Test function error:", error);
        return Response.json({ success: false, message: "❌ Server error: " + error.message });
    }
});