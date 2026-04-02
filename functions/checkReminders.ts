import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format } from 'npm:date-fns@3.0.0';

// Fixed reminder intervals: 24h, 6h, 1h before every appointment
const REMINDER_INTERVALS_MINUTES = [1440, 360, 60];
// Cron runs every 5 minutes — use a 5-min window so each interval fires exactly once
const WINDOW_MINUTES = 5;

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const now = new Date();
        
        console.log('🔔 Checking appointment reminders at', now.toISOString());
        
        // Fetch events in the next 25 hours (covers all 3 intervals)
        const windowEnd = new Date(now.getTime() + (25 * 60 * 60 * 1000));
        
        const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({
            status: { $ne: 'cancelled' },
            start_time: { $gte: now.toISOString(), $lte: windowEnd.toISOString() }
        }, "start_time", 300);
        
        console.log(`📋 Found ${allEvents.length} events in the next 25 hours`);
        
        const results = await Promise.all(allEvents.map(async (event) => {
            const eventResults = [];
            if (event.status === 'completed') return null;
            
            const eventStart = new Date(event.start_time);
            const minutesUntil = Math.floor((eventStart.getTime() - now.getTime()) / 60000);
            
            // Track which intervals have already been sent
            const emailSent: number[] = Array.isArray(event.reminders_sent_email)
                ? event.reminders_sent_email
                : [];
            const smsSent: number[] = Array.isArray(event.reminders_sent_sms)
                ? event.reminders_sent_sms
                : [];
            
            const userEmail = event.assigned_to || event.created_by;
            if (!userEmail) return null;
            
            // Get company for display name
            let company: any = null;
            try {
                const companies = await base44.asServiceRole.entities.Company.filter({ id: event.company_id });
                company = companies[0];
            } catch (_) {}
            
            for (const intervalMin of REMINDER_INTERVALS_MINUTES) {
                // Are we inside the 5-minute fire window for this interval?
                const inWindow = minutesUntil <= intervalMin && minutesUntil >= (intervalMin - WINDOW_MINUTES);
                if (!inWindow) continue;
                
                const intervalLabel = intervalMin === 1440 ? '24 hours' : intervalMin === 360 ? '6 hours' : '1 hour';
                const eventTime = format(eventStart, "EEEE, MMMM d, yyyy 'at' h:mm a");
                const title = event.title || 'Upcoming Appointment';
                
                // ── EMAIL ──────────────────────────────────────────────────
                if (!emailSent.includes(intervalMin)) {
                    try {
                        await base44.asServiceRole.integrations.Core.SendEmail({
                            to: userEmail,
                            subject: `⏰ Reminder: ${title} in ${intervalLabel}`,
                            body: `
                                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                                  <div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;">
                                    <h2 style="color:white;margin:0;font-size:22px;">📅 Appointment Reminder</h2>
                                    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">You have an appointment coming up soon</p>
                                  </div>
                                  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                                    <h3 style="color:#111827;margin:0 0 12px;font-size:18px;">${title}</h3>
                                    <p style="color:#374151;margin:6px 0;"><strong>📅 When:</strong> ${eventTime}</p>
                                    ${event.location ? `<p style="color:#374151;margin:6px 0;"><strong>📍 Location:</strong> ${event.location}</p>` : ''}
                                    ${event.description ? `<p style="color:#374151;margin:6px 0;"><strong>📝 Details:</strong> ${event.description}</p>` : ''}
                                    <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:12px;border-radius:4px;margin-top:16px;">
                                      <p style="color:#1e40af;margin:0;font-size:13px;">⏰ This reminder is being sent <strong>${intervalLabel} before</strong> your appointment.</p>
                                    </div>
                                    <p style="color:#9ca3af;font-size:12px;margin-top:16px;">— ${company?.company_name || 'CompanySync'} Team</p>
                                  </div>
                                </div>
                            `,
                            from_name: `${company?.company_name || 'CompanySync'} Reminders`
                        });
                        
                        const newEmailSent = [...emailSent, intervalMin];
                        await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                            reminders_sent_email: newEmailSent
                        });
                        emailSent.push(intervalMin);
                        
                        eventResults.push({ event_id: event.id, type: 'email', interval: intervalLabel, status: 'sent', to: userEmail });
                        console.log(`✅ Email (${intervalLabel}) → ${userEmail}: "${title}"`);
                    } catch (err: any) {
                        console.error(`❌ Email (${intervalLabel}) failed for "${title}":`, err.message);
                        eventResults.push({ event_id: event.id, type: 'email', interval: intervalLabel, status: 'failed', error: err.message });
                    }
                }
                
                // ── SMS ────────────────────────────────────────────────────
                if (!smsSent.includes(intervalMin)) {
                    try {
                        const profiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: userEmail });
                        const profile = profiles[0];
                        
                        if (profile?.phone) {
                            const shortTime = format(eventStart, "MMM d 'at' h:mm a");
                            const smsText = `⏰ Reminder: "${title}" is in ${intervalLabel} (${shortTime})${event.location ? ` at ${event.location}` : ''}`;
                            
                            await base44.asServiceRole.functions.invoke('sendSMS', {
                                to: profile.phone,
                                message: smsText,
                                companyId: event.company_id
                            });
                            
                            const newSmsSent = [...smsSent, intervalMin];
                            await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                                reminders_sent_sms: newSmsSent
                            });
                            smsSent.push(intervalMin);
                            
                            eventResults.push({ event_id: event.id, type: 'sms', interval: intervalLabel, status: 'sent', to: profile.phone });
                            console.log(`✅ SMS (${intervalLabel}) → ${profile.phone}: "${title}"`);
                        } else {
                            console.warn(`⚠️ No phone for ${userEmail} — SMS skipped for "${title}"`);
                            eventResults.push({ event_id: event.id, type: 'sms', interval: intervalLabel, status: 'skipped', reason: 'No phone number' });
                        }
                    } catch (err: any) {
                        console.error(`❌ SMS (${intervalLabel}) failed for "${title}":`, err.message);
                        eventResults.push({ event_id: event.id, type: 'sms', interval: intervalLabel, status: 'failed', error: err.message });
                    }
                }
            }
            
            return eventResults;
        }));
        
        const finalResults = results.flat().filter(Boolean);
        const sent = finalResults.filter((r: any) => r.status === 'sent').length;
        
        console.log(`✅ Reminder check complete. ${sent} notifications sent across ${allEvents.length} events.`);
        
        return Response.json({
            success: true,
            checked_at: now.toISOString(),
            events_checked: allEvents.length,
            notifications_sent: sent,
            results: finalResults
        });
        
    } catch (error: any) {
        console.error('❌ checkReminders error:', error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
});
