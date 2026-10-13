import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { format } from 'npm:date-fns@3.0.0';

// Format a Date in a specific IANA timezone (e.g. "America/New_York")
// Falls back to UTC display if timezone is unknown
function formatInTz(date: Date, timezone: string | undefined, template: string): string {
  if (!timezone) return format(date, template);
  try {
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    };
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(date);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    if (template.includes('EEEE')) {
      const month = parts.find(p => p.type === 'month')?.value ?? '';
      const day = get('day');
      const year = get('year');
      const weekday = get('weekday');
      const hour = get('hour');
      const minute = get('minute');
      const dayPeriod = get('dayPeriod');
      return `${weekday}, ${month} ${day}, ${year} at ${hour}:${minute} ${dayPeriod}`;
    } else {
      const month = parts.find(p => p.type === 'month')?.value ?? '';
      const day = get('day');
      const hour = get('hour');
      const minute = get('minute');
      const dayPeriod = get('dayPeriod');
      return `${month} ${day} at ${hour}:${minute} ${dayPeriod}`;
    }
  } catch (_) {
    return format(date, template);
  }
}

// Fixed reminder intervals: 24h, 6h, 1h before every appointment
const REMINDER_INTERVALS_MINUTES = [1440, 360, 60];
// Cost policy: early planning reminders are email-only. SMS is reserved for
// the urgent one-hour reminder, even when older saved preferences still have
// SMS enabled for every interval.
const SMS_REMINDER_INTERVALS_MINUTES = new Set([60]);
// Cron runs every 5 minutes — use a 5-min window so each interval fires exactly once
const WINDOW_MINUTES = 5;

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const now = new Date();
        
        console.log('🔔 Checking appointment reminders at', now.toISOString());
        
        // Fetch events in the next 25 hours (covers all 3 intervals)
        const windowEnd = new Date(now.getTime() + (25 * 60 * 60 * 1000));
        
        // NOTE: do NOT add a status filter to this query. The local entity layer
        // translates { status: { $ne: 'cancelled' } } to SQL `status != 'cancelled'`,
        // which in Postgres evaluates to NULL (and therefore EXCLUDES) every row
        // whose status IS NULL — i.e. all the legacy/manual events created with no
        // status (Calendar/Dashboard/BookAppointment). Those events MUST still get
        // reminders. We fetch everything in the time window and apply the status
        // DENYLIST below (which already skips cancelled/completed/pending/etc.).
        //
        // We paginate in batches of 200 so that a company with a very busy calendar
        // (or a platform with many tenants) never silently loses appointments to the
        // per-query row cap.  We keep fetching until a page comes back with fewer
        // rows than the page size, which means we've reached the end.
        const PAGE_SIZE = 200;
        const allEvents: any[] = [];
        let page = 0;
        while (true) {
            const batch = await base44.asServiceRole.entities.CalendarEvent.filter(
                { start_time: { $gte: now.toISOString(), $lte: windowEnd.toISOString() } },
                "start_time",
                PAGE_SIZE,
                page * PAGE_SIZE
            );
            allEvents.push(...batch);
            if (batch.length < PAGE_SIZE) break;   // last (or only) page
            page++;
            console.log(`📄 Fetched page ${page} of events (${allEvents.length} so far) — calendar is unusually busy`);
        }
        
        if (page > 0) {
            console.warn(`⚠️  checkReminders required ${page + 1} pages to load all events in the next 25 hours (${allEvents.length} total). Consider investigating calendar volume.`);
        }
        
        console.log(`📋 Found ${allEvents.length} events in the next 25 hours`);

        // Cache ReminderSettings per company so we only fetch once per cron run.
        // A missing/null result means "no settings saved" → all intervals enabled (safe default).
        const settingsCache = new Map<string, any>();
        const getCompanySettings = async (companyId: string) => {
            if (settingsCache.has(companyId)) return settingsCache.get(companyId);
            try {
                const arr = await base44.asServiceRole.entities.ReminderSettings.filter({
                    company_id: companyId
                });
                const settings = arr[0] ?? null;
                settingsCache.set(companyId, settings);
                return settings;
            } catch (_) {
                settingsCache.set(companyId, null);
                return null;
            }
        };
        const getStaffReminderPrefs = async (email: string, companyId: string) => {
            try {
                const profiles = await base44.asServiceRole.entities.StaffProfile.filter({
                    user_email: email,
                    company_id: companyId,
                });
                const data = profiles[0]?.data;
                return data?.reminder_preferences || null;
            } catch (_) {
                return null;
            }
        };
        const isQuietHours = (quiet: any, timezone: string | undefined) => {
            if (!quiet?.enabled) return false;
            const [sh, sm] = String(quiet.start || '22:00').split(':').map(Number);
            const [eh, em] = String(quiet.end || '07:00').split(':').map(Number);
            const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
                timeZone: timezone || 'America/New_York',
                hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
            }).formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
            const current = Number(parts.hour) * 60 + Number(parts.minute);
            const start = sh * 60 + sm;
            const end = eh * 60 + em;
            return start === end || (start < end ? current >= start && current < end : current >= start || current < end);
        };
        
        const results = await Promise.all(allEvents.map(async (event) => {
            const eventResults = [];
            if (event.status === 'completed') return null;

            // Only fire reminders for actionable calendar events. Skip statuses that
            // represent not-yet-confirmed or non-actionable items — in particular,
            // AI-proposed appointments now live as PENDING ActionItems and only become
            // a real CalendarEvent (status 'scheduled') once a human approves them, so a
            // half-booked appointment can never trigger reminders. We use a DENYLIST
            // (not a scheduled/confirmed allowlist) on purpose: many existing/manual
            // events are created with no status at all, and an allowlist would silently
            // stop reminders for every one of those legacy calendars.
            const REMINDER_SKIP_STATUSES = [
                'pending', 'tentative', 'draft', 'proposed',
                'awaiting_approval', 'needs_approval', 'cancelled', 'completed',
            ];
            if (event.status && REMINDER_SKIP_STATUSES.includes(String(event.status).toLowerCase())) {
                return null;
            }
            
            const eventStart = new Date(event.start_time);
            const minutesUntil = Math.floor((eventStart.getTime() - now.getTime()) / 60000);
            
            // Track which intervals have already been sent — staff
            const emailSent: number[] = Array.isArray(event.reminders_sent_email)
                ? event.reminders_sent_email : [];
            const smsSent: number[] = Array.isArray(event.reminders_sent_sms)
                ? event.reminders_sent_sms : [];
            // Track which intervals have already been sent — customer/lead
            const customerEmailSent: number[] = Array.isArray(event.reminders_sent_email_customer)
                ? event.reminders_sent_email_customer : [];
            const customerSmsSent: number[] = Array.isArray(event.reminders_sent_sms_customer)
                ? event.reminders_sent_sms_customer : [];
            
            const userEmail = event.assigned_to || event.created_by;
            if (!userEmail) return null;

            // Load per-company reminder settings (null = no settings = all defaults = all enabled)
            const companySettings = await getCompanySettings(event.company_id);
            const staffPrefs = await getStaffReminderPrefs(userEmail, event.company_id);
            const companyDefaults = companySettings?.default_staff_preferences;
            
            // Get company for display name / timezone
            let company: any = null;
            try {
                const companies = await base44.asServiceRole.entities.Company.filter({ id: event.company_id });
                company = companies[0];
            } catch (_) {}
            
            const tz = company?.timezone || 'America/New_York';
            const companyName = company?.company_name || 'CompanySync';
            const remindersEnabled = staffPrefs?.enabled ?? companyDefaults?.enabled ?? true;
            const quietHours = staffPrefs?.quiet_hours || companyDefaults?.quiet_hours;
            if (!remindersEnabled || isQuietHours(quietHours, tz)) return null;
            
            // Look up linked customer or lead contact info
            let contactName = '';
            let contactEmail = '';
            let contactPhone = '';
            
            if (event.related_customer) {
                try {
                    const customers = await base44.asServiceRole.entities.Customer.filter({
                        name: event.related_customer,
                        company_id: event.company_id
                    });
                    const customer = customers[0];
                    if (customer) {
                        contactName = customer.name || '';
                        contactEmail = customer.email || '';
                        contactPhone = customer.phone || '';
                    }
                } catch (_) {}
            } else if (event.related_lead) {
                try {
                    const leads = await base44.asServiceRole.entities.Lead.filter({
                        name: event.related_lead,
                        company_id: event.company_id
                    });
                    const lead = leads[0];
                    if (lead) {
                        contactName = lead.name || '';
                        contactEmail = lead.email || '';
                        contactPhone = lead.phone || '';
                    }
                } catch (_) {}
            }
            
            for (const intervalMin of REMINDER_INTERVALS_MINUTES) {
                // Are we inside the 5-minute fire window for this interval?
                const inWindow = minutesUntil <= intervalMin && minutesUntil >= (intervalMin - WINDOW_MINUTES);
                if (!inWindow) continue;

                // Honor per-company settings — undefined/null means use default (all enabled)
                const ivCfg = companySettings?.intervals?.[String(intervalMin)];
                const personalIntervals = staffPrefs?.intervals || staffPrefs || {};
                const defaultIntervals = companyDefaults?.intervals || companyDefaults || {};
                const personalCfg = personalIntervals[String(intervalMin)];
                const defaultCfg = defaultIntervals[String(intervalMin)];
                if (ivCfg?.enabled === false) {
                    console.log(`⏭ Interval ${intervalMin}m disabled by company settings for event "${event.title ?? ''}"`);
                    continue;
                }
                
                const intervalLabel = intervalMin === 1440 ? '24 hours' : intervalMin === 360 ? '6 hours' : '1 hour';
                const eventTime = formatInTz(eventStart, tz, "EEEE, MMMM d, yyyy 'at' h:mm a");
                const shortTime = formatInTz(eventStart, tz, "MMM d 'at' h:mm a");
                const title = event.title || 'Upcoming Appointment';
                
                // ── STAFF EMAIL ────────────────────────────────────────────
                if (!emailSent.includes(intervalMin) && ivCfg?.email !== false && personalCfg?.email !== false && (!staffPrefs && defaultCfg?.email !== false)) {
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
                                    ${contactName ? `<p style="color:#374151;margin:6px 0;"><strong>👤 Contact:</strong> ${contactName}</p>` : ''}
                                    ${event.description ? `<p style="color:#374151;margin:6px 0;"><strong>📝 Details:</strong> ${event.description}</p>` : ''}
                                    <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:12px;border-radius:4px;margin-top:16px;">
                                      <p style="color:#1e40af;margin:0;font-size:13px;">⏰ This reminder is being sent <strong>${intervalLabel} before</strong> your appointment.</p>
                                    </div>
                                    <p style="color:#9ca3af;font-size:12px;margin-top:16px;">— ${companyName} Team</p>
                                  </div>
                                </div>
                            `,
                            from_name: `${companyName} Reminders`
                        });
                        
                        const newEmailSent = [...emailSent, intervalMin];
                        await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                            reminders_sent_email: newEmailSent
                        });
                        emailSent.push(intervalMin);
                        
                        eventResults.push({ event_id: event.id, type: 'email', audience: 'staff', interval: intervalLabel, status: 'sent', to: userEmail });
                        console.log(`✅ Email (${intervalLabel}) → staff ${userEmail}: "${title}"`);
                    } catch (err: any) {
                        console.error(`❌ Email (${intervalLabel}) staff failed for "${title}":`, err.message);
                        eventResults.push({ event_id: event.id, type: 'email', audience: 'staff', interval: intervalLabel, status: 'failed', error: err.message });
                    }
                }
                
                // ── STAFF SMS ──────────────────────────────────────────────
                if (
                    SMS_REMINDER_INTERVALS_MINUTES.has(intervalMin)
                    && !smsSent.includes(intervalMin)
                    && ivCfg?.sms !== false
                    && personalCfg?.sms !== false
                    && (!staffPrefs && defaultCfg?.sms !== false)
                ) {
                    try {
                        const profiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: userEmail });
                        const profile = profiles[0];
                        
                        if (profile?.phone) {
                            const smsText = `⏰ Reminder: "${title}" is in ${intervalLabel} (${shortTime})${event.location ? ` at ${event.location}` : ''}${contactName ? ` — with ${contactName}` : ''}`;
                            
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
                            
                            eventResults.push({ event_id: event.id, type: 'sms', audience: 'staff', interval: intervalLabel, status: 'sent', to: profile.phone });
                            console.log(`✅ SMS (${intervalLabel}) → staff ${profile.phone}: "${title}"`);
                        } else {
                            console.warn(`⚠️ No phone for staff ${userEmail} — SMS skipped for "${title}"`);
                            eventResults.push({ event_id: event.id, type: 'sms', audience: 'staff', interval: intervalLabel, status: 'skipped', reason: 'No phone number' });
                        }
                    } catch (err: any) {
                        console.error(`❌ SMS (${intervalLabel}) staff failed for "${title}":`, err.message);
                        eventResults.push({ event_id: event.id, type: 'sms', audience: 'staff', interval: intervalLabel, status: 'failed', error: err.message });
                    }
                }
                
                // ── CUSTOMER / LEAD EMAIL ──────────────────────────────────
                if (contactEmail && !customerEmailSent.includes(intervalMin) && ivCfg?.email !== false) {
                    try {
                        await base44.asServiceRole.integrations.Core.SendEmail({
                            to: contactEmail,
                            subject: `⏰ Appointment Reminder: ${title} in ${intervalLabel}`,
                            body: `
                                <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                                  <div style="background:linear-gradient(135deg,#10b981,#3b82f6);padding:24px;border-radius:12px 12px 0 0;">
                                    <h2 style="color:white;margin:0;font-size:22px;">📅 Appointment Reminder</h2>
                                    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">Your upcoming appointment with ${companyName}</p>
                                  </div>
                                  <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
                                    <p style="color:#374151;margin:0 0 12px;">Hi ${contactName || 'there'},</p>
                                    <p style="color:#374151;margin:0 0 16px;">This is a friendly reminder about your upcoming appointment:</p>
                                    <h3 style="color:#111827;margin:0 0 12px;font-size:18px;">${title}</h3>
                                    <p style="color:#374151;margin:6px 0;"><strong>📅 When:</strong> ${eventTime}</p>
                                    ${event.location ? `<p style="color:#374151;margin:6px 0;"><strong>📍 Location:</strong> ${event.location}</p>` : ''}
                                    ${event.description ? `<p style="color:#374151;margin:6px 0;"><strong>📝 Notes:</strong> ${event.description}</p>` : ''}
                                    <div style="background:#d1fae5;border-left:4px solid #10b981;padding:12px;border-radius:4px;margin-top:16px;">
                                      <p style="color:#065f46;margin:0;font-size:13px;">⏰ Your appointment is in <strong>${intervalLabel}</strong>. We look forward to seeing you!</p>
                                    </div>
                                    <p style="color:#9ca3af;font-size:12px;margin-top:16px;">— ${companyName} Team</p>
                                  </div>
                                </div>
                            `,
                            from_name: `${companyName}`
                        });
                        
                        const newCustomerEmailSent = [...customerEmailSent, intervalMin];
                        await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                            reminders_sent_email_customer: newCustomerEmailSent
                        });
                        customerEmailSent.push(intervalMin);
                        
                        eventResults.push({ event_id: event.id, type: 'email', audience: 'customer', interval: intervalLabel, status: 'sent', to: contactEmail });
                        console.log(`✅ Email (${intervalLabel}) → customer ${contactEmail}: "${title}"`);
                    } catch (err: any) {
                        console.error(`❌ Email (${intervalLabel}) customer failed for "${title}":`, err.message);
                        eventResults.push({ event_id: event.id, type: 'email', audience: 'customer', interval: intervalLabel, status: 'failed', error: err.message });
                    }
                }
                
                // ── CUSTOMER / LEAD SMS ────────────────────────────────────
                if (
                    SMS_REMINDER_INTERVALS_MINUTES.has(intervalMin)
                    && contactPhone
                    && !customerSmsSent.includes(intervalMin)
                    && ivCfg?.sms !== false
                ) {
                    try {
                        const smsText = `Hi ${contactName || 'there'}! Reminder from ${companyName}: "${title}" is in ${intervalLabel} (${shortTime})${event.location ? ` at ${event.location}` : ''}. See you soon!`;
                        
                        await base44.asServiceRole.functions.invoke('sendSMS', {
                            to: contactPhone,
                            message: smsText,
                            companyId: event.company_id
                        });
                        
                        const newCustomerSmsSent = [...customerSmsSent, intervalMin];
                        await base44.asServiceRole.entities.CalendarEvent.update(event.id, {
                            reminders_sent_sms_customer: newCustomerSmsSent
                        });
                        customerSmsSent.push(intervalMin);
                        
                        eventResults.push({ event_id: event.id, type: 'sms', audience: 'customer', interval: intervalLabel, status: 'sent', to: contactPhone });
                        console.log(`✅ SMS (${intervalLabel}) → customer ${contactPhone}: "${title}"`);
                    } catch (err: any) {
                        console.error(`❌ SMS (${intervalLabel}) customer failed for "${title}":`, err.message);
                        eventResults.push({ event_id: event.id, type: 'sms', audience: 'customer', interval: intervalLabel, status: 'failed', error: err.message });
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
