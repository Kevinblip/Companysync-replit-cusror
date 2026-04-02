import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Allow both CRON auth and user auth for testing
        const authHeader = req.headers.get('Authorization');
        const expectedToken = Deno.env.get('CRON_SECRET_TOKEN');
        const isCronAuth = authHeader === `Bearer ${expectedToken}`;
        
        if (!isCronAuth) {
            // Require user to be authenticated
            const user = await base44.auth.me();
            if (!user) {
                return Response.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const { reportDate, companyId } = await req.json();

        if (!companyId) {
            return Response.json({ error: 'Company ID required' }, { status: 400 });
        }

        console.log('📊 Generating daily report for:', reportDate, 'company:', companyId);

        const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        const company = companies[0];

        if (!company) {
            return Response.json({ error: 'Company not found' }, { status: 404 });
        }

        // Use company timezone (default: America/New_York = EST)
        const companyTimezone = company.settings?.time_zone || 'America/New_York';
        
        // Helper to format any date to YYYY-MM-DD in company timezone
        const formatToCompanyDate = (dateObj) => {
            const options = { timeZone: companyTimezone, year: 'numeric', month: '2-digit', day: '2-digit' };
            const formatter = new Intl.DateTimeFormat('en-US', options);
            const parts = formatter.formatToParts(dateObj);
            const year = parts.find(p => p.type === 'year').value;
            const month = parts.find(p => p.type === 'month').value;
            const day = parts.find(p => p.type === 'day').value;
            return `${year}-${month}-${day}`;
        };

        // If no reportDate provided, use current date in company's timezone
        let targetDate = reportDate;
        if (!targetDate) {
            targetDate = formatToCompanyDate(new Date());
        }
        
        console.log('📅 Using timezone:', companyTimezone, 'Target date:', targetDate);

        // Deduplication: skip if EOD report already exists for this company + date
        const existingReports = await base44.asServiceRole.entities.DailyReport.filter({
            company_id: companyId,
            report_date: targetDate,
            report_type: 'end_of_day',
        });
        if (existingReports && existingReports.length > 0) {
            console.log(`⏭️ EOD report already exists for company ${companyId} on ${targetDate}, skipping`);
            return Response.json({ success: true, skipped: true, reason: 'Already generated for today', report_id: existingReports[0].id });
        }

        console.log('📅 Filtering records for date:', targetDate);

        // Use a 48-hour lookback window so we always capture the full target day
        // regardless of timezone offset, without loading all historical records.
        const lookbackDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

        const [
            allCommunications,
            allTasks,
            allLeads,
            allCustomers,
            allEstimates,
            allInvoices,
            allPayments,
            allCalendarEvents,
            allStaffProfiles,
            allStormSettings,
            allLeadsForFollowUp,
            allInvoicesForAR
        ] = await Promise.all([
            base44.asServiceRole.entities.Communication.filter({ company_id: companyId, created_date: { $gte: lookbackDate } }, '-created_date', 1000),
            base44.asServiceRole.entities.Task.filter({ company_id: companyId, updated_date: { $gte: lookbackDate } }, '-updated_date', 500),
            base44.asServiceRole.entities.Lead.filter({ company_id: companyId, created_date: { $gte: lookbackDate } }, '-created_date', 500),
            base44.asServiceRole.entities.Customer.filter({ company_id: companyId, created_date: { $gte: lookbackDate } }, '-created_date', 500),
            base44.asServiceRole.entities.Estimate.filter({ company_id: companyId, created_date: { $gte: lookbackDate } }, '-created_date', 500),
            base44.asServiceRole.entities.Invoice.filter({ company_id: companyId, created_date: { $gte: lookbackDate } }, '-created_date', 500),
            // Payments use payment_date (YYYY-MM-DD), not created_date — fetch recent by created_date as proxy
            base44.asServiceRole.entities.Payment.filter({ company_id: companyId }, '-created_date', 500),
            // Calendar events: look at both created and updated within window
            base44.asServiceRole.entities.CalendarEvent.filter({ company_id: companyId, updated_date: { $gte: lookbackDate } }, '-updated_date', 500),
            base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId }),
            base44.asServiceRole.entities.StormAlertSettings.filter({ company_id: companyId }),
            // Follow-ups need all-time leads (not just recent)
            base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 500),
            // AR needs all unpaid invoices (not just recent)
            base44.asServiceRole.entities.Invoice.filter({ company_id: companyId }, '-created_date', 1000),
        ]);

        // Fetch recent storm events globally (last 48 hours to be safe)
        const stormSearchDate = new Date(new Date(targetDate).getTime() - 48 * 60 * 60 * 1000).toISOString();
        const recentStorms = await base44.asServiceRole.entities.StormEvent.filter({ start_time: { $gte: stormSearchDate } });

        const isTargetDate = (isoString) => {
            if (!isoString) return false;
            // Convert UTC ISO string to Company Timezone Date String
            const localDateStr = formatToCompanyDate(new Date(isoString));
            return localDateStr === targetDate;
        };

        const todayCommunications = allCommunications.filter(c => isTargetDate(c.created_date));
        const todayTasks = allTasks.filter(t => isTargetDate(t.updated_date) && t.status === 'job_completed');
        const todayLeads = allLeads.filter(l => isTargetDate(l.created_date));
        const todayCustomers = allCustomers.filter(c => isTargetDate(c.created_date));
        const todayEstimates = allEstimates.filter(e => isTargetDate(e.created_date));
        const todayInvoices = allInvoices.filter(i => isTargetDate(i.created_date));
        
        // 🎙️ NEW: Calculate call recording statistics
        const todayCalls = todayCommunications.filter(c => c.communication_type === 'call');
        const callsWithRecordings = todayCalls.filter(c => c.recording_url);
        const totalCallMinutes = todayCalls.reduce((sum, c) => sum + (c.duration_minutes || 0), 0);
        const averageCallDuration = todayCalls.length > 0 ? (totalCallMinutes / todayCalls.length).toFixed(1) : 0;
        
        // 🔥 FIX: Filter payments by payment_date field (which is YYYY-MM-DD format, not ISO)
        const todayPayments = allPayments.filter(p => p.payment_date === targetDate);
        
        // Track BOTH created AND updated calendar events - ONLY count real customer appointments
        // Exclude synced Google Calendar events like internal meetings, personal events, etc.
        const todayAppointmentsCreated = allCalendarEvents.filter(e => {
            const isCreatedToday = isTargetDate(e.created_date);
            // Only count customer-facing appointment types (not "meeting", "reminder", "other", "call", "follow_up")
            const isCustomerAppointment = ['appointment', 'inspection', 'estimate', 'roofing_contractor', 'check_pickup'].includes(e.event_type);
            return isCreatedToday && isCustomerAppointment;
        });
        const todayAppointmentsUpdated = allCalendarEvents.filter(e => {
            const isUpdatedToday = isTargetDate(e.updated_date) && !isTargetDate(e.created_date);
            const isCustomerAppointment = ['appointment', 'inspection', 'estimate', 'roofing_contractor', 'check_pickup'].includes(e.event_type);
            return isUpdatedToday && isCustomerAppointment;
        });

        console.log('📈 Filtered data counts:', {
            communications: todayCommunications.length,
            calls: todayCalls.length,
            recordedCalls: callsWithRecordings.length,
            totalCallMinutes: totalCallMinutes,
            tasks: todayTasks.length,
            leads: todayLeads.length,
            customers: todayCustomers.length,
            estimates: todayEstimates.length,
            invoices: todayInvoices.length,
            payments: todayPayments.length,
            paymentsData: todayPayments.map(p => ({ customer: p.customer_name, amount: p.amount, date: p.payment_date })),
            appointmentsCreated: todayAppointmentsCreated.length,
            appointmentsUpdated: todayAppointmentsUpdated.length,
            appointmentsCreatedData: todayAppointmentsCreated.map(e => ({ title: e.title, created: e.created_date, start: e.start_time })),
            appointmentsUpdatedData: todayAppointmentsUpdated.map(e => ({ title: e.title, updated: e.updated_date, start: e.start_time }))
        });

        const metrics = {
            new_leads: todayLeads.length,
            new_customers: todayCustomers.length,
            appointments_scheduled: todayAppointmentsCreated.length,
            appointments_updated: todayAppointmentsUpdated.length,
            estimates_sent: todayEstimates.filter(e => e.status === 'sent' || e.status === 'viewed').length,
            invoices_sent: todayInvoices.filter(i => i.status === 'sent' || i.status === 'viewed').length,
            payments_received: todayPayments.filter(p => p.status === 'received').length,
            payments_amount: todayPayments.filter(p => p.status === 'received').reduce((sum, p) => sum + (p.amount || 0), 0),
            calls_made: todayCommunications.filter(c => c.communication_type === 'call' && c.direction === 'outbound').length,
            calls_received: todayCommunications.filter(c => c.communication_type === 'call' && c.direction === 'inbound').length,
            // 🎙️ NEW: Call recording metrics
            total_call_minutes: totalCallMinutes,
            calls_recorded: callsWithRecordings.length,
            recording_rate: todayCalls.length > 0 ? ((callsWithRecordings.length / todayCalls.length) * 100).toFixed(0) : 0,
            average_call_duration: averageCallDuration,
            sms_sent: todayCommunications.filter(c => c.communication_type === 'sms' && c.direction === 'outbound').length,
            sms_received: todayCommunications.filter(c => c.communication_type === 'sms' && c.direction === 'inbound').length,
            emails_sent: todayCommunications.filter(c => c.communication_type === 'email' && c.direction === 'outbound').length,
            tasks_completed: todayTasks.length
        };

        const staffBreakdown = allStaffProfiles.map(staff => {
            const staffEmail = staff.user_email;
            const staffName = staff.full_name || staffEmail;

            const staffCalls = todayCommunications.filter(c => 
                c.created_by === staffEmail && c.communication_type === 'call'
            );
            
            // 🎙️ NEW: Staff-specific call recording metrics
            const staffCallsRecorded = staffCalls.filter(c => c.recording_url);
            const staffCallMinutes = staffCalls.reduce((sum, c) => sum + (c.duration_minutes || 0), 0);
            
            const staffEmails = todayCommunications.filter(c => 
                c.created_by === staffEmail && c.communication_type === 'email'
            );
            const staffSMS = todayCommunications.filter(c => 
                c.created_by === staffEmail && c.communication_type === 'sms'
            );
            const staffLeads = todayLeads.filter(l => 
                l.created_by === staffEmail || l.assigned_to === staffEmail
            );
            const staffEstimates = todayEstimates.filter(e => e.created_by === staffEmail);
            const staffInvoices = todayInvoices.filter(i => i.created_by === staffEmail || i.sale_agent === staffEmail);
            const staffTasks = todayTasks.filter(t => t.created_by === staffEmail);
            
            const staffPaymentsToday = todayPayments.filter(p => {
                // Match payment to invoice using full AR set (invoice may predate the 48hr window)
                const invoice = allInvoicesForAR.find(inv => inv.invoice_number === p.invoice_number);
                return invoice && (invoice.sale_agent === staffEmail || invoice.created_by === staffEmail);
            });
            
            const todayRevenue = staffPaymentsToday.reduce((sum, p) => sum + (p.amount || 0), 0);
            const estimatedCommission = todayRevenue * ((staff.commission_rate || 5) / 100);

            const totalActivities = staffCalls.length + staffEmails.length + staffSMS.length + 
                                   staffLeads.length + staffEstimates.length + staffInvoices.length + 
                                   staffTasks.length;

            if (totalActivities === 0) return null;

            return {
                staff_email: staffEmail,
                staff_name: staffName,
                calls_made: staffCalls.filter(c => c.direction === 'outbound').length,
                calls_received: staffCalls.filter(c => c.direction === 'inbound').length,
                // 🎙️ NEW: Add call recording stats per staff
                calls_recorded: staffCallsRecorded.length,
                total_call_minutes: staffCallMinutes,
                average_call_duration: staffCalls.length > 0 ? (staffCallMinutes / staffCalls.length).toFixed(1) : 0,
                emails_sent: staffEmails.filter(e => e.direction === 'outbound').length,
                sms_sent: staffSMS.filter(s => s.direction === 'outbound').length,
                leads_created: staffLeads.length,
                estimates_sent: staffEstimates.length,
                invoices_created: staffInvoices.length,
                tasks_completed: staffTasks.length,
                revenue_generated: todayRevenue,
                estimated_commission: estimatedCommission,
                total_activities: totalActivities,
                top_achievements: []
            };
        }).filter(Boolean);

        // BUILD TOP ACTIVITIES FROM ACTUAL DATA
        const topActivities = [];
        
        // Add NEW calendar events created today
        todayAppointmentsCreated.forEach(event => {
            const staffName = allStaffProfiles.find(s => s.user_email === event.created_by)?.full_name || event.created_by || 'System';
            const eventTime = event.start_time ? new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD';
            topActivities.push({
                type: 'Appointment Scheduled',
                description: `"${event.title}" scheduled for ${eventTime}${event.location ? ` at ${event.location}` : ''}`,
                time: event.created_date ? new Date(event.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Unknown',
                staff_email: event.created_by
            });
        });

        // Add UPDATED calendar events (modified today but created earlier)
        todayAppointmentsUpdated.forEach(event => {
            const staffName = allStaffProfiles.find(s => s.user_email === event.updated_by || event.created_by)?.full_name || 'System';
            const eventTime = event.start_time ? new Date(event.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD';
            topActivities.push({
                type: 'Appointment Updated',
                description: `"${event.title}" rescheduled to ${eventTime}`,
                time: event.updated_date ? new Date(event.updated_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Unknown',
                staff_email: event.created_by
            });
        });

        // Add estimates
        todayEstimates.forEach(est => {
            topActivities.push({
                type: 'Estimate Created',
                description: `${est.estimate_number} for ${est.customer_name} - $${est.amount?.toFixed(2)}`,
                time: new Date(est.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                staff_email: est.created_by
            });
        });

        // Add invoices
        todayInvoices.forEach(inv => {
            topActivities.push({
                type: 'Invoice Created',
                description: `${inv.invoice_number} for ${inv.customer_name} - $${inv.amount?.toFixed(2)}`,
                time: new Date(inv.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                staff_email: inv.created_by
            });
        });

        // Add payments
        todayPayments.forEach(payment => {
            topActivities.push({
                type: 'Payment Received',
                description: `$${payment.amount?.toFixed(2)} from ${payment.customer_name}${payment.notes ? ' - ' + payment.notes : ''}`,
                time: payment.created_date ? new Date(payment.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Unknown',
                staff_email: payment.created_by
            });
        });

        // Add new leads
        todayLeads.forEach(lead => {
            topActivities.push({
                type: 'New Lead',
                description: `${lead.name} - Source: ${lead.source}`,
                time: new Date(lead.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                staff_email: lead.created_by
            });
        });

        // Add new customers
        todayCustomers.forEach(customer => {
            topActivities.push({
                type: 'New Customer',
                description: `${customer.name} added to system`,
                time: new Date(customer.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                staff_email: customer.created_by
            });
        });

        // Add completed tasks
        todayTasks.forEach(task => {
            topActivities.push({
                type: 'Task Completed',
                description: `"${task.name}" marked complete`,
                time: new Date(task.updated_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                staff_email: task.created_by
            });
        });

        // Sort by time (most recent first)
        topActivities.sort((a, b) => {
            const timeA = a.time || '12:00 AM';
            const timeB = b.time || '12:00 AM';
            return timeB.localeCompare(timeA);
        });

        // 🌪️ Process Storm Alerts
        let stormAlerts = [];
        const stormSettings = allStormSettings?.[0];

        if (recentStorms && recentStorms.length > 0 && stormSettings) {
           // Filter storms for this company
           stormAlerts = recentStorms.filter(storm => {
               // Check date match
               if (!isTargetDate(storm.start_time)) return false;

               // Check severity
               const severityLevels = { all: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };
               const threshold = severityLevels[stormSettings.alert_severity_threshold] || 2;
               const stormSeverity = severityLevels[storm.severity] || 0;
               if (stormSeverity < threshold) return false;

               // Check storm type
               const monitoredTypes = stormSettings.storm_types_to_monitor || ['hail', 'tornado', 'high_wind'];
               if (monitoredTypes.length > 0 && !monitoredTypes.includes(storm.event_type)) return false;

               // Check location match
               const center = stormSettings.service_center_location || '';
               const areas = stormSettings.service_areas || [];
               
               // Check if storm affects center or any service area
               const affectsCenter = center && (
                   (storm.affected_areas?.some(a => a.toLowerCase().includes(center.toLowerCase()))) ||
                   (storm.title?.toLowerCase().includes(center.toLowerCase()))
               );
               
               const affectsAreas = areas.some(area => 
                   storm.affected_areas?.some(a => a.toLowerCase().includes(area.toLowerCase()))
               );

               return affectsCenter || affectsAreas;
           });
        }

        const followUpsNeeded = [];
        
        // Use all-time leads/invoices for follow-up tracking (not just recent 48hr window)
        const leadsNeedingFollowUp = allLeadsForFollowUp.filter(l => 
            l.status === 'contacted' && 
            (!l.last_contact_date || new Date(l.last_contact_date) < new Date(Date.now() - 3 * 24 * 60 * 60 * 1000))
        ).slice(0, 5);

        leadsNeedingFollowUp.forEach(lead => {
            followUpsNeeded.push({
                customer_name: lead.name,
                reason: `No contact in 3+ days (Status: ${lead.status})`,
                priority: 'medium',
                assigned_to: lead.assigned_to
            });
        });

        const overdueInvoices = allInvoicesForAR.filter(i => i.status === 'overdue').slice(0, 5);
        overdueInvoices.forEach(invoice => {
            followUpsNeeded.push({
                customer_name: invoice.customer_name,
                reason: `Overdue invoice ${invoice.invoice_number} - $${invoice.amount?.toFixed(2)}`,
                priority: 'high',
                assigned_to: invoice.sale_agent || invoice.created_by
            });
        });

        // =============================================
        // 📋 TRIAL STATUS for CompanySync reports
        // =============================================
        let trialStatusBlock = '';
        const isPlatformCompany = company.company_name?.startsWith('CompanySync');
        
        if (isPlatformCompany) {
          try {
            const allTrialCos = await base44.asServiceRole.entities.Company.filter({ 
              subscription_status: 'trial', 
              is_deleted: { $ne: true } 
            });
            const todayCheck = new Date();
            todayCheck.setHours(0, 0, 0, 0);

            const expired = allTrialCos.filter(c => 
              c.trial_ends_at && new Date(c.trial_ends_at) < todayCheck && 
              c.company_name !== 'CompanySync'
            );
            const expiringSoon = allTrialCos.filter(c => {
              if (!c.trial_ends_at || c.company_name?.startsWith('CompanySync')) return false;
              const d = Math.ceil((new Date(c.trial_ends_at) - todayCheck) / (1000 * 60 * 60 * 24));
              return d >= 0 && d <= 3;
            });
            const expiringWeek = allTrialCos.filter(c => {
              if (!c.trial_ends_at || c.company_name?.startsWith('CompanySync')) return false;
              const d = Math.ceil((new Date(c.trial_ends_at) - todayCheck) / (1000 * 60 * 60 * 24));
              return d > 3 && d <= 7;
            });

            trialStatusBlock = `
**📋 SUBSCRIBER TRIAL STATUS:**
${expired.length > 0 ? `🚫 EXPIRED (${expired.length}): ${expired.map(c => `${c.company_name} (ended ${Math.ceil((todayCheck - new Date(c.trial_ends_at)) / (1000 * 60 * 60 * 24))}d ago)`).join(', ')}` : '✅ No expired trials'}
${expiringSoon.length > 0 ? `⚠️ EXPIRING IN 0-3 DAYS (${expiringSoon.length}): ${expiringSoon.map(c => `${c.company_name} (${Math.ceil((new Date(c.trial_ends_at) - todayCheck) / (1000 * 60 * 60 * 24))}d left)`).join(', ')}` : ''}
${expiringWeek.length > 0 ? `📅 EXPIRING IN 4-7 DAYS (${expiringWeek.length}): ${expiringWeek.map(c => `${c.company_name} (${Math.ceil((new Date(c.trial_ends_at) - todayCheck) / (1000 * 60 * 60 * 24))}d left)`).join(', ')}` : ''}
`;
          } catch (trialErr) {
            console.error('Failed to fetch trial status for report:', trialErr);
          }
        }

        // Also run expireTrials to update statuses
        if (isPlatformCompany) {
          try {
            await base44.asServiceRole.functions.invoke('expireTrials', {});
            console.log('✅ Trial expiration check ran from daily report');
          } catch (e) {
            console.error('Trial expiration check failed (non-blocking):', e);
          }
        }

        // 🎙️ NEW: Enhanced AI prompt with call recording data + STORM ALERTS
        const aiPrompt = `You are Lexi, the friendly AI assistant for ${company.company_name}.

Generate an end-of-day report for ${new Date(targetDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: companyTimezone })}.
${trialStatusBlock}

**COMPANY-WIDE METRICS:**
- 📞 Calls: ${metrics.calls_made} outbound, ${metrics.calls_received} inbound
- 🎙️ **Call Recordings: ${metrics.calls_recorded} recorded (${metrics.recording_rate}% capture rate)**
- ⏱️ **Total Talk Time: ${metrics.total_call_minutes} minutes (avg ${metrics.average_call_duration} min/call)**
- 📧 Emails: ${metrics.emails_sent} sent
- 💬 SMS: ${metrics.sms_sent} sent, ${metrics.sms_received} received
- 🎯 New Leads: ${metrics.new_leads}
- 👥 New Customers: ${metrics.new_customers}
- 📄 Estimates Sent: ${metrics.estimates_sent}
- 🧾 Invoices Created: ${metrics.invoices_sent}
- 💰 Payments Received: ${metrics.payments_received} totaling $${metrics.payments_amount.toFixed(2)}
- ✅ Tasks Completed: ${metrics.tasks_completed}
- 📅 Appointments Scheduled: ${metrics.appointments_scheduled}
- 🔄 Appointments Updated: ${metrics.appointments_updated}
- ⛈️ **Storm Alerts: ${stormAlerts.length} significant events detected**

**STAFF PERFORMANCE BREAKDOWN:**
${staffBreakdown.length > 0 ? staffBreakdown.map(staff => `
📊 ${staff.staff_name}:
   - Calls: ${staff.calls_made} out / ${staff.calls_received} in
   - 🎙️ **Recordings: ${staff.calls_recorded} captured, ${staff.total_call_minutes} min talk time (avg ${staff.average_call_duration} min/call)**
   - Emails: ${staff.emails_sent} sent
   - SMS: ${staff.sms_sent} sent
   - Leads: ${staff.leads_created} new
   - Estimates: ${staff.estimates_sent} sent
   - Invoices: ${staff.invoices_created} created
   - Tasks: ${staff.tasks_completed} completed
   - Revenue Generated: $${staff.revenue_generated.toFixed(2)}
   - Est. Commission: $${staff.estimated_commission.toFixed(2)}
   - Total Activities: ${staff.total_activities}
`).join('\n') : 'No staff activity recorded today.'}

**REAL ACTIVITIES THAT ACTUALLY HAPPENED TODAY:**
${topActivities.length > 0 ? topActivities.slice(0, 20).map(a => `- ${a.time}: ${a.type} - ${a.description}`).join('\n') : 'No user activities recorded today.'}
${stormAlerts.length > 0 ? stormAlerts.map(s => `- ⛈️ STORM ALERT: ${s.title} (${s.severity}) - ${s.description}`).join('\n') : ''}

**FOLLOW-UPS NEEDED (FROM DATABASE):**
${followUpsNeeded.length > 0 ? followUpsNeeded.map(f => `- ${f.customer_name}: ${f.reason} (${f.priority} priority)${f.assigned_to ? ` - Assigned to ${f.assigned_to}` : ''}`).join('\n') : 'No follow-ups needed.'}

**CRITICAL INSTRUCTIONS:**
Write a warm, executive-style daily summary in Lexi's voice. 

⚠️ ONLY REPORT WHAT ACTUALLY HAPPENED - NO MADE-UP ACTIVITIES OR PLACEHOLDERS!

Highlight call recording compliance and talk time when relevant.

Include:
1. **Opening** - Friendly greeting with date
2. **Honest Assessment** - Report actual performance (if slow, acknowledge it positively)
3. **Real Wins** - Only celebrate achievements that actually happened (use staff names from above)
4. **Actual Numbers** - Key metrics from above, INCLUDING call recording statistics
5. **Real Follow-ups** - Only the follow-ups listed above from the database
6. **Motivational Close** - Positive note (every day is progress)

DO NOT invent activities, meetings, or follow-ups. Use ONLY the data provided above. Max 300 words.`;

        console.log('🤖 Calling LLM for summary...');
        const aiSummary = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: aiPrompt
        });
        console.log('✅ LLM summary received:', aiSummary ? 'YES' : 'NULL');

        const summaryText = typeof aiSummary === 'string' ? aiSummary : (aiSummary ? String(aiSummary) : 'No summary generated - please check OpenAI API configuration');

        const insightsPrompt = `Based on this daily activity data, extract REAL insights:

**ACTUAL DATA FROM TODAY:**
- Appointments created: ${metrics.appointments_scheduled}
- Appointments updated: ${metrics.appointments_updated}
- Calls: ${metrics.calls_made + metrics.calls_received} total, ${metrics.calls_recorded} recorded (${metrics.recording_rate}% rate)
- Talk time: ${metrics.total_call_minutes} minutes
- Leads created: ${metrics.new_leads}
- Estimates sent: ${metrics.estimates_sent}
- Invoices created: ${metrics.invoices_sent}
- Payments: ${metrics.payments_received} totaling $${metrics.payments_amount.toFixed(2)}
- Tasks completed: ${metrics.tasks_completed}

**REAL ACTIVITIES:**
${topActivities.length > 0 ? topActivities.slice(0, 10).map(a => `- ${a.type}: ${a.description}`).join('\n') : 'No activities today.'}

**DATABASE FOLLOW-UPS:**
${followUpsNeeded.length > 0 ? followUpsNeeded.map(f => `- ${f.customer_name}: ${f.reason}`).join('\n') : 'None.'}

Return JSON with:
1. highlights: Array of REAL positive things that ACTUALLY happened (2-4 items). If nothing happened, say things like "Good opportunity to plan ahead" or "Team recharged for tomorrow"
2. concerns: Array of REAL issues from the database follow-ups list above (1-3 items). If no real issues, return empty array []

⚠️ CRITICAL: NO MADE-UP ACTIVITIES. If there were no highlights, acknowledge the quiet day positively. Only report things that actually exist in the data above.`;

        console.log('🤖 Calling LLM for insights...');
        const insights = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: insightsPrompt,
            response_json_schema: {
                type: "object",
                properties: {
                    highlights: {
                        type: "array",
                        items: { type: "string" }
                    },
                    concerns: {
                        type: "array",
                        items: { type: "string" }
                    }
                }
            }
        });
        console.log('✅ LLM insights received:', insights);

        const report = await base44.asServiceRole.entities.DailyReport.create({
            company_id: companyId,
            report_date: reportDate,
            generated_by: 'Lexi AI',
            summary: summaryText,
            highlights: insights.highlights || [],
            concerns: insights.concerns || [],
            metrics: metrics,
            top_activities: topActivities.slice(0, 20),
            follow_ups_needed: followUpsNeeded,
            staff_activity: staffBreakdown,
            storm_alerts: stormAlerts, // NEW: Include storm alerts in report
            revenue_summary: {
                invoices_created: todayInvoices.length,
                payments_received: metrics.payments_amount,
                // Use full AR query for outstanding balance (not just recent 48hr window)
                outstanding: allInvoicesForAR
                    .filter(i => i.status !== 'paid' && i.status !== 'cancelled')
                    .reduce((sum, i) => sum + (i.amount || 0), 0)
            }
            });

            console.log('✅ Daily report created:', report.id);

            // 📧 Send email notification via Unified System
            try {
                // Determine recipient logic
                // 1. Explicit setting
                let recipientEmail = company.settings?.daily_report_email;
                const platformAdmin = 'yicnteam@gmail.com';
                const isPlatformCompany = company.company_name?.startsWith('CompanySync');

                // 2. If no setting, try to find a real Admin user (who is not the platform admin)
                if (!recipientEmail || (recipientEmail === platformAdmin && !isPlatformCompany)) {
                    // We already have allStaffProfiles
                    const realAdmins = allStaffProfiles.filter(s => 
                        (s.is_administrator || s.role === 'admin') && 
                        s.user_email && 
                        s.user_email !== platformAdmin
                    );
                    
                    if (realAdmins.length > 0) {
                        recipientEmail = realAdmins[0].user_email;
                    }
                }

                // 3. Fallback to billing email or company email
                if (!recipientEmail || (recipientEmail === platformAdmin && !isPlatformCompany)) {
                    recipientEmail = company.billing_email || company.email;
                }

                // 4. Final safety check - if it's still the platform admin and NOT his company, skip it
                if (recipientEmail === platformAdmin && !isPlatformCompany) {
                    console.log(`⚠️ Skipping email report for ${company.company_name} - Recipient is platform admin`);
                    recipientEmail = null;
                }
                
                if (recipientEmail) {
                    await base44.functions.invoke('sendUnifiedEmail', {
                        to: recipientEmail,
                        subject: `📊 End of Day Report - ${new Date(reportDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
                        html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #1f2937;">End of Day Report 📊</h2>
                            <p style="color: #4b5563;">Here's your daily summary for ${company.company_name}:</p>

                            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
                                ${summaryText.split('\n').map(line => `<p style="margin: 8px 0; color: #374151;">${line}</p>`).join('')}
                            </div>

                            <div style="background: #eff6ff; padding: 12px; border-left: 4px solid #3b82f6; margin: 16px 0;">
                                <strong style="color: #1e40af;">Key Metrics:</strong>
                                <ul style="margin: 8px 0; padding-left: 20px; color: #1e40af;">
                                    <li>${metrics.new_leads} new leads</li>
                                    <li>${metrics.appointments_scheduled} appointments scheduled</li>
                                    <li>${metrics.payments_received} payments ($${metrics.payments_amount.toFixed(2)})</li>
                                    <li>${metrics.tasks_completed} tasks completed</li>
                                </ul>
                            </div>

                            <p style="margin-top: 20px;">
                                <a href="${Deno.env.get('APP_URL') || 'https://getcompanysync.com'}/daily-reports" 
                                   style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                                    View Full Report →
                                </a>
                            </p>
                        </div>
                        `,
                        companyId: companyId,
                        contactName: company.company_name,
                        messageType: 'daily_report',
                        skipLogging: false,
                        skipNotification: true
                    });
                    console.log(`📧 Daily report email sent to ${recipientEmail}`);
                } else {
                    console.log('⚠️ No email address found for company, skipping email report');
                }
            } catch (emailError) {
                console.error('❌ Failed to send daily report email:', emailError);
            }

        return Response.json({
            success: true,
            report_id: report.id,
            message: 'Daily report generated successfully'
        });

    } catch (error) {
        console.error('❌ Error generating report:', error);
        return Response.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
});