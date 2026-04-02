import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const GOOGLE_CLIENT_ID_ENV = () => Deno.env.get('GOOGLE_CLIENT_ID') || Deno.env.get('Google_Client_Id');
const GOOGLE_CLIENT_SECRET_ENV = () => Deno.env.get('GOOGLE_CLIENT_SECRET') || Deno.env.get('Google_Secret_Key');

async function refreshGoogleToken(base44, user) {
    const clientId = GOOGLE_CLIENT_ID_ENV();
    const clientSecret = GOOGLE_CLIENT_SECRET_ENV();

    if (!clientId || !clientSecret || !user.google_refresh_token) {
        throw new Error('Missing credentials for token refresh');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: user.google_refresh_token,
            grant_type: 'refresh_token'
        })
    });

    const tokens = await tokenResponse.json();
    if (!tokens.access_token) {
        throw new Error('Failed to refresh token: ' + JSON.stringify(tokens));
    }

    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000)).toISOString();
    await base44.asServiceRole.entities.User.update(user.id, {
        google_access_token: tokens.access_token,
        google_token_expiry: expiresAt
    });

    return tokens.access_token;
}

async function getUserAccessToken(base44, user) {
    // 1. Try user's own OAuth tokens
    if (user.google_access_token) {
        const expiry = user.google_token_expiry || user.google_token_expires_at;
        if (expiry && new Date(expiry) < new Date()) {
            try {
                return await refreshGoogleToken(base44, user);
            } catch (e) {
                console.warn(`⚠️ Token refresh failed for ${user.email}:`, e.message);
            }
        } else {
            return user.google_access_token;
        }
    }

    // 2. Fallback to App Connector
    try {
        const appToken = await base44.asServiceRole.connectors.getAccessToken("googlecalendar");
        if (appToken) return appToken;
    } catch (e) {}

    return null;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    try {
        console.log('🔄 === AUTO-SYNC ALL CALENDARS STARTED ===');

        const base44 = createClientFromRequest(req);

        const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

        // Get all users who have Google Calendar connected
        const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 1000);
        const connectedUsers = allUsers.filter(u =>
            u.google_access_token || u.google_refresh_token || u.google_calendar_connected
        );

        console.log(`📋 Found ${connectedUsers.length} users with Google Calendar connected`);

        let totalCreated = 0;
        let totalUpdated = 0;
        let totalDeleted = 0;
        let usersProcessed = 0;
        let usersFailed = 0;

        for (const user of connectedUsers) {
            try {
                console.log(`\n👤 Processing: ${user.email}`);

                // Get access token for THIS user
                const accessToken = await getUserAccessToken(base44, user);
                if (!accessToken) {
                    console.log(`⚠️ No valid token for ${user.email}, skipping`);
                    usersFailed++;
                    continue;
                }

                // Get company ID
                const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
                let companyId = staffProfiles[0]?.company_id;
                if (!companyId) {
                    const companies = await base44.asServiceRole.entities.Company.filter({ created_by: user.email });
                    companyId = companies[0]?.id;
                }

                if (!companyId) {
                    console.log(`⚠️ No company found for ${user.email}, skipping`);
                    continue;
                }

                // Get company timezone
                let companyTimezone = 'America/New_York';
                try {
                    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                    if (companies[0]?.timezone) companyTimezone = companies[0].timezone;
                } catch (err) {}

                // ===== Google → CRM =====
                let googleEvents = [];
                try {
                    const googleResponse = await fetch(
                        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=250&showDeleted=true`,
                        { headers: { 'Authorization': `Bearer ${accessToken}` } }
                    );

                    if (!googleResponse.ok) {
                        const errorText = await googleResponse.text();
                        console.error(`❌ Google API error for ${user.email}: ${googleResponse.status}`);

                        // Try refresh if 401
                        if (googleResponse.status === 401 && user.google_refresh_token) {
                            try {
                                accessToken = await refreshGoogleToken(base44, user);
                                const newToken = accessToken;
                                const retryResponse = await fetch(
                                    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=250&showDeleted=true`,
                                    { headers: { 'Authorization': `Bearer ${newToken}` } }
                                );
                                if (retryResponse.ok) {
                                    const retryData = await retryResponse.json();
                                    googleEvents = retryData.items || [];
                                }
                            } catch (refreshErr) {
                                console.error(`❌ Refresh failed for ${user.email}:`, refreshErr.message);
                                usersFailed++;
                                continue;
                            }
                        } else {
                            usersFailed++;
                            continue;
                        }
                    } else {
                        const googleData = await googleResponse.json();
                        googleEvents = googleData.items || [];
                    }
                } catch (e) {
                    console.error(`❌ Failed to fetch Google Calendar for ${user.email}:`, e.message);
                    usersFailed++;
                    continue;
                }

                console.log(`📥 ${googleEvents.length} Google events for ${user.email}`);

                for (const gEvent of googleEvents) {
                    try {
                        if (gEvent.status === 'cancelled') {
                            const existing = await base44.asServiceRole.entities.CalendarEvent.filter({
                                google_event_id: gEvent.id,
                                company_id: companyId
                            });
                            if (existing.length > 0) {
                                await base44.asServiceRole.entities.CalendarEvent.delete(existing[0].id);
                                totalDeleted++;
                            }
                            continue;
                        }

                        if (!gEvent.start?.dateTime && !gEvent.start?.date) continue;

                        const startTime = new Date(gEvent.start.dateTime || gEvent.start.date).toISOString();
                        const endTime = new Date(gEvent.end?.dateTime || gEvent.end?.date || gEvent.start.dateTime || gEvent.start.date).toISOString();

                        const existing = await base44.asServiceRole.entities.CalendarEvent.filter({
                            google_event_id: gEvent.id,
                            company_id: companyId
                        });

                        const eventData = {
                            title: gEvent.summary || 'Untitled Event',
                            description: gEvent.description || '',
                            start_time: startTime,
                            end_time: endTime,
                            location: gEvent.location || '',
                            google_event_id: gEvent.id,
                            google_calendar_id: 'primary',
                            assigned_to: user.email,
                            event_type: 'meeting',
                            color: '#3b82f6',
                            company_id: companyId
                        };

                        if (existing.length > 0) {
                            const crmUpdated = new Date(existing[0].updated_date).getTime();
                            const googleUpdated = new Date(gEvent.updated).getTime();
                            if (googleUpdated > crmUpdated) {
                                await base44.asServiceRole.entities.CalendarEvent.update(existing[0].id, eventData);
                                totalUpdated++;
                            }
                        } else {
                            await base44.asServiceRole.entities.CalendarEvent.create(eventData);
                            totalCreated++;
                        }
                    } catch (eventError) {
                        console.error(`⚠️ Error processing event:`, eventError.message);
                    }
                }

                // ===== CRM → Google =====
                const crmEvents = await base44.asServiceRole.entities.CalendarEvent.filter({
                    company_id: companyId,
                    assigned_to: user.email
                }, '-start_time', 500);

                const now = new Date();
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

                // Use the (possibly refreshed) access token for CRM→Google pushes
                const currentToken = accessToken;

                for (const crmEvent of crmEvents) {
                    try {
                        if (!crmEvent.start_time) continue;
                        const eventTime = new Date(crmEvent.start_time);
                        if (eventTime < thirtyDaysAgo || eventTime > oneYearFromNow) continue;

                        const googleEventData = {
                            summary: crmEvent.title || 'Untitled',
                            description: crmEvent.description || '',
                            location: crmEvent.location || '',
                            start: {
                                dateTime: new Date(crmEvent.start_time).toISOString(),
                                timeZone: companyTimezone
                            },
                            end: {
                                dateTime: new Date(crmEvent.end_time || crmEvent.start_time).toISOString(),
                                timeZone: companyTimezone
                            }
                        };

                        if (crmEvent.google_event_id) {
                            // UPDATE existing event in Google (was previously skipped!)
                            const updateResponse = await fetch(
                                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${crmEvent.google_event_id}`,
                                {
                                    method: 'PUT',
                                    headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(googleEventData)
                                }
                            );

                            if (updateResponse.ok) {
                                totalUpdated++;
                            } else if (updateResponse.status === 404 || updateResponse.status === 410) {
                                // Event deleted from Google, recreate
                                const createResponse = await fetch(
                                    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                                    {
                                        method: 'POST',
                                        headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
                                        body: JSON.stringify(googleEventData)
                                    }
                                );
                                if (createResponse.ok) {
                                    const newGoogleEvent = await createResponse.json();
                                    await base44.asServiceRole.entities.CalendarEvent.update(crmEvent.id, { google_event_id: newGoogleEvent.id });
                                    totalCreated++;
                                }
                            }
                        } else {
                            // CREATE new event in Google
                            const createResponse = await fetch(
                                'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                                {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(googleEventData)
                                }
                            );
                            if (createResponse.ok) {
                                const newGoogleEvent = await createResponse.json();
                                await base44.asServiceRole.entities.CalendarEvent.update(crmEvent.id, { google_event_id: newGoogleEvent.id });
                                totalCreated++;
                            }
                        }
                    } catch (pushError) {
                        console.error(`⚠️ Error pushing CRM event to Google:`, pushError.message);
                    }
                }

                // Update last sync time
                try {
                    await base44.asServiceRole.entities.User.update(user.id, { last_google_sync: new Date().toISOString() });
                } catch (e) {}

                usersProcessed++;
                await delay(1000); // Rate limit between users
            } catch (userError) {
                console.error(`❌ Failed to process ${user.email}:`, userError.message);
                usersFailed++;
            }
        }

        console.log('\n✅ === AUTO-SYNC ALL CALENDARS COMPLETED ===');
        console.log(`📊 Users: ${usersProcessed} processed, ${usersFailed} failed`);
        console.log(`📊 Events: ${totalCreated} created, ${totalUpdated} updated, ${totalDeleted} deleted`);

        return Response.json({
            success: true,
            usersProcessed,
            usersFailed,
            events: {
                created: totalCreated,
                updated: totalUpdated,
                deleted: totalDeleted
            }
        });

    } catch (error) {
        console.error('❌ Auto-sync error:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
