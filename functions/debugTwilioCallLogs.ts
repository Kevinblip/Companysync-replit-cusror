import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Get Twilio credentials
        const settings = await base44.asServiceRole.entities.TwilioSettings.list('-created_date', 1);
        if (!settings.length) return Response.json({ error: 'No Twilio settings' });
        
        const accountSid = settings[0].account_sid;
        const authToken = settings[0].auth_token;
        
        // Fetch recent calls
        const callsUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json?PageSize=5&To=%2B12167777154`;
        const callsResp = await fetch(callsUrl, {
            headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) }
        });
        const callsData = await callsResp.json();
        
        const calls = (callsData.calls || []).map(c => ({
            sid: c.sid,
            from: c.from,
            to: c.to,
            status: c.status,
            duration: c.duration,
            start_time: c.start_time,
            end_time: c.end_time,
            direction: c.direction,
            price: c.price
        }));

        // For the most recent call, get notifications/warnings
        let notifications = [];
        if (calls.length > 0) {
            const notifUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${calls[0].sid}/Notifications.json`;
            const notifResp = await fetch(notifUrl, {
                headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) }
            });
            const notifData = await notifResp.json();
            notifications = (notifData.notifications || []).map(n => ({
                message_text: n.message_text,
                error_code: n.error_code,
                log: n.log,
                request_url: n.request_url,
                response_body: n.response_body,
                date_created: n.date_created
            }));
        }

        // Also check account-level notifications
        const acctNotifUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Notifications.json?PageSize=10`;
        const acctNotifResp = await fetch(acctNotifUrl, {
            headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) }
        });
        const acctNotifData = await acctNotifResp.json();
        const recentNotifications = (acctNotifData.notifications || []).map(n => ({
            message_text: n.message_text,
            error_code: n.error_code,
            log: n.log,
            request_url: n.request_url,
            date_created: n.date_created
        }));
        
        return Response.json({ 
            recent_calls: calls,
            most_recent_call_notifications: notifications,
            recent_account_notifications: recentNotifications
        });

    } catch (e) {
        return Response.json({ error: e.message });
    }
});