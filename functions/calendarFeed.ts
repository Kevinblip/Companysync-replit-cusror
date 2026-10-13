import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Get user from auth
        const user = await base44.auth.me();
        if (!user) {
            return new Response('Unauthorized - Please log in', { status: 401 });
        }

        // Get all calendar events for this user
        const events = await base44.entities.CalendarEvent.filter({
            created_by: user.email
        }, "-start_time", 500);

        console.log(`📅 Generating calendar feed for ${user.email} with ${events.length} events`);

        // Generate iCal format
        const ical = generateICalFeed(events, user);

        return new Response(ical, {
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': 'attachment; filename="crm-calendar.ics"',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });

    } catch (error) {
        console.error('Calendar Feed Error:', error);
        return new Response('Error generating calendar feed: ' + error.message, { status: 500 });
    }
});

function generateICalFeed(events, user) {
    const now = new Date();
    
    let ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//AI CRM Pro//Calendar Feed//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:AI CRM Pro - ${user.full_name}
X-WR-TIMEZONE:UTC
X-WR-CALDESC:Calendar events from AI CRM Pro
`;

    events.forEach(event => {
        const startDate = new Date(event.start_time);
        const endDate = event.end_time ? new Date(event.end_time) : new Date(startDate.getTime() + 3600000); // +1 hour default
        
        // Format dates as YYYYMMDDTHHMMSSZ
        const formatDate = (date) => {
            return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        };

        const uid = `${event.id}@aicrmpro.com`;
        const summary = event.title || 'Untitled Event';
        const description = (event.description || '').replace(/\n/g, '\\n');
        const location = event.location || '';
        
        ical += `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatDate(now)}
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:${summary}
DESCRIPTION:${description}
LOCATION:${location}
STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}
SEQUENCE:0
`;

        if (event.assigned_to) {
            ical += `ATTENDEE;CN=${event.assigned_to}:mailto:${event.assigned_to}
`;
        }

        ical += `END:VEVENT
`;
    });

    ical += `END:VCALENDAR`;
    
    return ical;
}