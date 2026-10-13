import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { log, LogLevel, ErrorTypes, jsonErrorResponse } from './utils/errorHandler.js';

const FUNCTION_NAME = 'syncCRMToGoogleCalendar';

async function refreshGoogleToken(base44, user) {
    const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID');
    const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET');

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !user.google_refresh_token) {
        throw new Error('Missing credentials for token refresh');
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
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
        google_token_expires_at: expiresAt
    });

    return tokens.access_token;
}

Deno.serve(async (req) => {
    try {
        log(LogLevel.INFO, FUNCTION_NAME, 'Sync started');
        
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return jsonErrorResponse(ErrorTypes.UNAUTHORIZED(), FUNCTION_NAME);
        }

        log(LogLevel.INFO, FUNCTION_NAME, 'User authenticated', { email: user.email });

        // --- AUTHENTICATION STRATEGY ---
        let accessToken = null;

        // 1. Try App Connector (Primary)
        try {
            accessToken = await base44.asServiceRole.connectors.getAccessToken("googlecalendar");
            if (accessToken) {
                log(LogLevel.INFO, FUNCTION_NAME, '✅ Using App Connector Access Token');
            }
        } catch (e) {
            log(LogLevel.DEBUG, FUNCTION_NAME, 'App Connector token not available', { error: e.message });
        }

        // 2. Fallback to User Token (Legacy)
        if (!accessToken) {
            if (user.google_access_token) {
                accessToken = user.google_access_token;
                
                // Check expiry
                if (user.google_token_expires_at && new Date(user.google_token_expires_at) < new Date()) {
                    log(LogLevel.INFO, FUNCTION_NAME, 'User token expired, refreshing...');
                    try {
                        accessToken = await refreshGoogleToken(base44, user);
                        log(LogLevel.INFO, FUNCTION_NAME, 'Token refreshed successfully');
                    } catch (error) {
                        log(LogLevel.WARN, FUNCTION_NAME, 'Token refresh failed', { error: error.message });
                        // Don't return error yet, maybe existing token still works briefly or we handle it downstream
                        accessToken = null; 
                    }
                }
            }
        }

        if (!accessToken) {
            log(LogLevel.WARN, FUNCTION_NAME, 'No valid Google Calendar token found');
            return jsonErrorResponse(
                ErrorTypes.VALIDATION_ERROR('Google Calendar not connected. Please connect via App Settings.'),
                FUNCTION_NAME
            );
        }

        // --- SYNC LOGIC ---

        // Parse request body
        const body = await req.json().catch(() => ({}));
        const singleEventId = body.eventId;
        
        log(LogLevel.DEBUG, FUNCTION_NAME, 'Sync parameters', { singleEventId });

        // Get CRM events to sync
        let userCRMEvents;
        
        if (singleEventId) {
            // INSTANT SYNC MODE: Sync just one event immediately
            log(LogLevel.INFO, FUNCTION_NAME, 'Instant sync mode', { eventId: singleEventId });
            const events = await base44.asServiceRole.entities.CalendarEvent.filter({ id: singleEventId });
            userCRMEvents = events;
        } else {
            // BULK SYNC MODE: Sync all events (last 30 days to future)
            log(LogLevel.INFO, FUNCTION_NAME, 'Bulk sync mode');
            const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

            const allCRMEvents = await base44.asServiceRole.entities.CalendarEvent.list('-start_time', 5000);
            userCRMEvents = allCRMEvents.filter(event => {
                const eventTime = new Date(event.start_time);
                // Sync events assigned to this user, OR created by this user
                // Note: If using App Connector, we might want to sync ALL company events? 
                // For now, stick to user's assigned events to avoid cluttering the primary calendar if shared.
                return (event.assigned_to === user.email || event.created_by === user.email) && 
                       eventTime >= timeMin && 
                       eventTime <= timeMax;
            });
        }

        log(LogLevel.INFO, FUNCTION_NAME, 'Events to sync', { count: userCRMEvents.length });

        let createdCount = 0;
        let updatedCount = 0;
        let deletedCount = 0;

        // Sync each CRM event to Google Calendar
        for (const crmEvent of userCRMEvents) {
            try {
                const googleEventData = {
                    summary: crmEvent.title,
                    description: crmEvent.description || '',
                    location: crmEvent.location || '',
                    start: {
                        dateTime: new Date(crmEvent.start_time).toISOString(),
                        timeZone: 'America/New_York'
                    },
                    end: {
                        dateTime: new Date(crmEvent.end_time || crmEvent.start_time).toISOString(),
                        timeZone: 'America/New_York'
                    },
                    reminders: {
                        useDefault: false,
                        overrides: []
                    }
                };

                // Add email reminders
                if (crmEvent.send_email_notification && crmEvent.email_reminder_minutes) {
                    const reminderMinutes = Array.isArray(crmEvent.email_reminder_minutes) 
                        ? crmEvent.email_reminder_minutes 
                        : [crmEvent.email_reminder_minutes];
                    
                    reminderMinutes.forEach(minutes => {
                        googleEventData.reminders.overrides.push({
                            method: 'email',
                            minutes: minutes
                        });
                    });
                }

                // Add popup reminders (browser notifications)
                if (crmEvent.send_browser_notification && crmEvent.browser_reminder_minutes) {
                    const reminderMinutes = Array.isArray(crmEvent.browser_reminder_minutes) 
                        ? crmEvent.browser_reminder_minutes 
                        : [crmEvent.browser_reminder_minutes];
                    
                    reminderMinutes.forEach(minutes => {
                        googleEventData.reminders.overrides.push({
                            method: 'popup',
                            minutes: minutes
                        });
                    });
                }

                if (crmEvent.google_event_id) {
                    // Update existing Google Calendar event
                    const updateResponse = await fetch(
                        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${crmEvent.google_event_id}`,
                        {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(googleEventData)
                        }
                    );

                    if (updateResponse.ok) {
                        updatedCount++;
                        log(LogLevel.INFO, FUNCTION_NAME, 'Google event updated', { title: crmEvent.title });
                    } else {
                        const errorData = await updateResponse.json();
                        log(LogLevel.WARN, FUNCTION_NAME, 'Failed to update Google event', { title: crmEvent.title, error: errorData });
                        
                        // If event not found in Google (404/410), recreate it
                        if (updateResponse.status === 404 || updateResponse.status === 410) {
                            log(LogLevel.INFO, FUNCTION_NAME, 'Event not found in Google, recreating...');
                            const createResponse = await fetch(
                                'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                                {
                                    method: 'POST',
                                    headers: {
                                        'Authorization': `Bearer ${accessToken}`,
                                        'Content-Type': 'application/json'
                                    },
                                    body: JSON.stringify(googleEventData)
                                }
                            );

                            if (createResponse.ok) {
                                const newGoogleEvent = await createResponse.json();
                                await base44.asServiceRole.entities.CalendarEvent.update(crmEvent.id, {
                                    google_event_id: newGoogleEvent.id
                                });
                                createdCount++;
                                log(LogLevel.INFO, FUNCTION_NAME, 'Google event recreated', { title: crmEvent.title });
                            }
                        }
                    }
                } else {
                    // Create new Google Calendar event
                    const createResponse = await fetch(
                        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                        {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${accessToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(googleEventData)
                        }
                    );

                    if (createResponse.ok) {
                        const newGoogleEvent = await createResponse.json();
                        await base44.asServiceRole.entities.CalendarEvent.update(crmEvent.id, {
                            google_event_id: newGoogleEvent.id,
                            google_calendar_id: 'primary'
                        });
                        createdCount++;
                        log(LogLevel.INFO, FUNCTION_NAME, 'Google event created', { title: crmEvent.title });
                    } else {
                        const errorData = await createResponse.json();
                        log(LogLevel.ERROR, FUNCTION_NAME, 'Failed to create Google event', { title: crmEvent.title, error: errorData });
                    }
                }
            } catch (error) {
                log(LogLevel.ERROR, FUNCTION_NAME, 'Event sync error', { 
                    title: crmEvent.title, 
                    error: error.message 
                });
            }
        }

        log(LogLevel.INFO, FUNCTION_NAME, 'Sync completed', { 
            created: createdCount, 
            updated: updatedCount 
        });

        return Response.json({ 
            success: true,
            created: createdCount,
            updated: updatedCount,
            deleted: deletedCount
        });

    } catch (error) {
        log(LogLevel.ERROR, FUNCTION_NAME, 'Unhandled error', { 
            error: error.message,
            stack: error.stack
        });
        
        return jsonErrorResponse(
            ErrorTypes.INTERNAL_ERROR('Failed to sync calendar: ' + error.message),
            FUNCTION_NAME
        );
    }
});