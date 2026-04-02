import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const GOOGLE_CLIENT_ID_ENV = () => Deno.env.get('GOOGLE_CLIENT_ID') || Deno.env.get('Google_Client_Id');
const GOOGLE_CLIENT_SECRET_ENV = () => Deno.env.get('GOOGLE_CLIENT_SECRET') || Deno.env.get('Google_Secret_Key');

async function refreshGoogleToken(base44, user) {
    const clientId = GOOGLE_CLIENT_ID_ENV();
    const clientSecret = GOOGLE_CLIENT_SECRET_ENV();

    if (!clientId || !clientSecret || !user.google_refresh_token) {
        throw new Error('Missing credentials for token refresh');
    }

    console.log('🔄 Refreshing Google token for:', user.email);

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

    console.log('✅ Token refreshed successfully');
    return tokens.access_token;
}

async function getAccessToken(user, base44) {
    console.log('🔑 Getting access token for:', user.email);

    // 1. Try user's own OAuth tokens (Primary - per-user calendar)
    if (user.google_access_token) {
        const expiry = user.google_token_expiry || user.google_token_expires_at;
        if (expiry && new Date(expiry) < new Date()) {
            console.log('⏰ User token expired, refreshing...');
            try {
                return await refreshGoogleToken(base44, user);
            } catch (e) {
                console.warn('⚠️ Token refresh failed:', e.message);
            }
        } else {
            console.log('✅ Using user OAuth token');
            return user.google_access_token;
        }
    }

    // 2. Fallback to App Connector (shared token)
    try {
        const appToken = await base44.asServiceRole.connectors.getAccessToken("googlecalendar");
        if (appToken) {
            console.log('✅ Using App Connector token (fallback)');
            return appToken;
        }
    } catch (e) {
        console.log('⚠️ App Connector not available:', e.message);
    }

    throw new Error('No Google Calendar token available. Please reconnect Google Calendar in Settings.');
}

function convertGoogleDateToISO(googleDateTime) {
    if (!googleDateTime) return null;
    try {
        const date = new Date(googleDateTime);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
    } catch (error) {
        return null;
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.serve(async (req) => {
    let targetUser = null;

    try {
        console.log('🚀 === TWO-WAY GOOGLE CALENDAR SYNC STARTED ===');

        const base44 = createClientFromRequest(req);

        // Support both user-authenticated and service-role calls
        let requestingUser = null;
        try {
            requestingUser = await base44.auth.me();
        } catch (e) {
            console.log('ℹ️ No user auth context (likely cron/service call)');
        }

        let bodyData = {};
        try {
            const contentType = req.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const text = await req.text();
                if (text && text.trim() && text !== '{}') {
                    bodyData = JSON.parse(text);
                }
            }
        } catch (parseError) {
            console.log('ℹ️ No JSON body');
        }

        const { targetUserEmail } = bodyData;

        if (targetUserEmail) {
            console.log(`🔄 Sync requested for: ${targetUserEmail}`);
            const users = await base44.asServiceRole.entities.User.filter({ email: targetUserEmail });
            targetUser = users[0];
            if (!targetUser) {
                return Response.json({ error: 'Target user not found' }, { status: 404 });
            }
        } else if (requestingUser) {
            // Look up full user record with tokens
            const users = await base44.asServiceRole.entities.User.filter({ email: requestingUser.email });
            targetUser = users[0] || requestingUser;
        } else {
            return Response.json({ error: 'No user specified' }, { status: 400 });
        }

        console.log('✅ Syncing calendar for:', targetUser.email);

        // Get company ID
        const staffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({
            user_email: targetUser.email
        });

        let companyId = staffProfiles[0]?.company_id || null;

        if (!companyId) {
            const companies = await base44.asServiceRole.entities.Company.filter({
                created_by: targetUser.email
            });
            companyId = companies[0]?.id || null;
        }

        console.log(`🏢 Company ID: ${companyId || 'None'}`);

        // Get company timezone
        let companyTimezone = 'America/New_York';
        if (companyId) {
            try {
                const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
                if (companies[0]?.timezone) {
                    companyTimezone = companies[0].timezone;
                }
            } catch (err) {}
        }

        // Get Access Token (tries user OAuth first, then App Connector)
        let accessToken;
        try {
            accessToken = await getAccessToken(targetUser, base44);
        } catch (e) {
            console.error('❌ Auth error:', e.message);
            return Response.json({
                error: 'Authentication failed. Please reconnect Google Calendar.',
                details: e.message,
                needsReconnect: true
            }, { status: 401 });
        }

        // ========== STEP 1: Google → CRM ==========
        console.log('📥 STEP 1: Syncing FROM Google Calendar TO CRM...');

        const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

        let fromGoogleCreated = 0;
        let fromGoogleUpdated = 0;
        let fromGoogleDeleted = 0;
        let fromGoogleErrors = 0;

        try {
            let googleEvents = [];

            const fetchGoogleEvents = async (token) => {
                const resp = await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=250&showDeleted=true`,
                    { headers: { 'Authorization': `Bearer ${token}` } }
                );
                return resp;
            };

            let googleResponse = await fetchGoogleEvents(accessToken);

            if (!googleResponse.ok) {
                const errorText = await googleResponse.text();
                console.error(`❌ Google API error (${googleResponse.status}): ${errorText}`);

                if (googleResponse.status === 401 && targetUser.google_refresh_token) {
                    console.log('🔄 Token expired, attempting refresh...');
                    try {
                        accessToken = await refreshGoogleToken(base44, targetUser);
                        googleResponse = await fetchGoogleEvents(accessToken);
                        if (!googleResponse.ok) {
                            throw new Error(`Google API error after refresh: ${googleResponse.status}`);
                        }
                    } catch (refreshError) {
                        throw new Error(`Auth failed after refresh: ${refreshError.message}`);
                    }
                } else {
                    throw new Error(`Google API error (${googleResponse.status}): ${errorText}`);
                }
            }

            const googleData = await googleResponse.json();
            googleEvents = googleData.items || [];
            console.log(`📋 Found ${googleEvents.length} events in Google Calendar`);

            const batchSize = 5;
            for (let i = 0; i < googleEvents.length; i += batchSize) {
                const batch = googleEvents.slice(i, i + batchSize);

                for (const gEvent of batch) {
                    try {
                        if (gEvent.status === 'cancelled') {
                            const existingEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ google_event_id: gEvent.id });
                            if (existingEvents.length > 0) {
                                await base44.asServiceRole.entities.CalendarEvent.delete(existingEvents[0].id);
                                fromGoogleDeleted++;
                            }
                            continue;
                        }

                        if (!gEvent.start?.dateTime && !gEvent.start?.date) continue;

                        const startTimeISO = convertGoogleDateToISO(gEvent.start.dateTime || gEvent.start.date);
                        const endTimeISO = convertGoogleDateToISO(gEvent.end?.dateTime || gEvent.end?.date) || startTimeISO;

                        if (!startTimeISO) continue;

                        const existingEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ google_event_id: gEvent.id });

                        const eventData = {
                            title: gEvent.summary || 'Untitled Event',
                            description: gEvent.description || '',
                            start_time: startTimeISO,
                            end_time: endTimeISO,
                            location: gEvent.location || '',
                            google_event_id: gEvent.id,
                            google_calendar_id: 'primary',
                            assigned_to: targetUser.email,
                            event_type: 'meeting',
                            color: '#3b82f6',
                            company_id: companyId
                        };

                        if (existingEvents.length > 0) {
                            const existingEvent = existingEvents[0];
                            const lastUpdatedCrm = new Date(existingEvent.updated_date).getTime();
                            const lastUpdatedGoogle = new Date(gEvent.updated).getTime();

                            if (lastUpdatedGoogle > lastUpdatedCrm) {
                                await base44.asServiceRole.entities.CalendarEvent.update(existingEvent.id, eventData);
                                fromGoogleUpdated++;
                            }
                        } else {
                            await base44.asServiceRole.entities.CalendarEvent.create(eventData);
                            fromGoogleCreated++;
                        }
                    } catch (eventError) {
                        fromGoogleErrors++;
                        console.error(`⚠️ Error processing Google event ${gEvent.summary}:`, eventError.message);
                    }
                }

                if (i + batchSize < googleEvents.length) {
                    await delay(500);
                }
            }
        } catch (googleSyncError) {
            console.error('❌ Error syncing from Google Calendar:', googleSyncError.message);
            fromGoogleErrors++;
        }

        // ========== STEP 2: CRM → Google ==========
        console.log('📤 STEP 2: Syncing FROM CRM TO Google Calendar...');

        let toGoogleCreated = 0;
        let toGoogleUpdated = 0;
        let toGoogleErrors = 0;

        try {
            const allCRMEvents = await base44.asServiceRole.entities.CalendarEvent.filter({
                assigned_to: targetUser.email
            }, '-start_time', 1000);

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const oneYearFromNow = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

            const userCRMEvents = allCRMEvents.filter(event => {
                try {
                    const eventTime = new Date(event.start_time);
                    return eventTime >= thirtyDaysAgo && eventTime <= oneYearFromNow;
                } catch { return false; }
            });

            console.log(`📋 Found ${userCRMEvents.length} CRM events for ${targetUser.email}`);

            const crmBatchSize = 10;
            for (let i = 0; i < userCRMEvents.length; i += crmBatchSize) {
                const batch = userCRMEvents.slice(i, i + crmBatchSize);

                for (const crmEvent of batch) {
                    try {
                        if (!crmEvent.start_time) continue;

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
                            },
                            reminders: { useDefault: false, overrides: [] }
                        };

                        if (crmEvent.send_email_notification && crmEvent.email_reminder_minutes) {
                            const mins = Array.isArray(crmEvent.email_reminder_minutes) ? crmEvent.email_reminder_minutes : [crmEvent.email_reminder_minutes];
                            mins.forEach(m => { if (!isNaN(m)) googleEventData.reminders.overrides.push({ method: 'email', minutes: m }); });
                        }
                        if (crmEvent.send_browser_notification && crmEvent.browser_reminder_minutes) {
                            const mins = Array.isArray(crmEvent.browser_reminder_minutes) ? crmEvent.browser_reminder_minutes : [crmEvent.browser_reminder_minutes];
                            mins.forEach(m => { if (!isNaN(m)) googleEventData.reminders.overrides.push({ method: 'popup', minutes: m }); });
                        }

                        if (crmEvent.google_event_id) {
                            // Update existing event in Google
                            const updateResponse = await fetch(
                                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${crmEvent.google_event_id}`,
                                {
                                    method: 'PUT',
                                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(googleEventData)
                                }
                            );

                            if (updateResponse.ok) {
                                toGoogleUpdated++;
                            } else if (updateResponse.status === 404 || updateResponse.status === 410) {
                                console.log(`⚠️ Event not found in Google, recreating: ${crmEvent.title}`);
                                const createResponse = await fetch(
                                    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                                    {
                                        method: 'POST',
                                        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                                        body: JSON.stringify(googleEventData)
                                    }
                                );
                                if (createResponse.ok) {
                                    const newGoogleEvent = await createResponse.json();
                                    await base44.asServiceRole.entities.CalendarEvent.update(crmEvent.id, { google_event_id: newGoogleEvent.id });
                                    toGoogleCreated++;
                                }
                            } else {
                                const errText = await updateResponse.text();
                                console.error(`❌ Failed to update Google event: ${errText}`);
                                toGoogleErrors++;
                            }
                        } else {
                            // Create new event in Google
                            console.log(`➕ Creating new event in Google: "${crmEvent.title}"`);
                            const createResponse = await fetch(
                                'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                                {
                                    method: 'POST',
                                    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                                    body: JSON.stringify(googleEventData)
                                }
                            );

                            if (createResponse.ok) {
                                const newGoogleEvent = await createResponse.json();
                                await base44.asServiceRole.entities.CalendarEvent.update(crmEvent.id, { google_event_id: newGoogleEvent.id });
                                toGoogleCreated++;
                            } else {
                                const err = await createResponse.text();
                                console.error(`❌ Failed to create in Google: ${err}`);
                                toGoogleErrors++;
                            }
                        }
                    } catch (error) {
                        toGoogleErrors++;
                        console.error(`⚠️ Error syncing CRM event ${crmEvent.title}:`, error.message);
                    }
                }

                if (i + crmBatchSize < userCRMEvents.length) {
                    await delay(500);
                }
            }

            console.log(`✅ To Google: ${toGoogleCreated} created, ${toGoogleUpdated} updated, ${toGoogleErrors} errors`);
        } catch (crmSyncError) {
            console.error('❌ Error syncing to Google Calendar:', crmSyncError.message);
            toGoogleErrors++;
        }

        try {
            await base44.asServiceRole.entities.User.update(targetUser.id, { last_google_sync: new Date().toISOString() });
        } catch (e) {}

        console.log('✅ === TWO-WAY SYNC COMPLETED ===');

        return Response.json({
            success: true,
            fromGoogle: { created: fromGoogleCreated, updated: fromGoogleUpdated, deleted: fromGoogleDeleted, errors: fromGoogleErrors },
            toGoogle: { created: toGoogleCreated, updated: toGoogleUpdated, errors: toGoogleErrors },
            total: fromGoogleCreated + fromGoogleUpdated + toGoogleCreated + toGoogleUpdated,
            timezone: companyTimezone
        });

    } catch (error) {
        console.error('❌ === SYNC ERROR ===');
        return Response.json({ error: error.message, details: error.stack }, { status: 500 });
    }
});
