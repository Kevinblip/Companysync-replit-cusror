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
    console.log('🌅 Starting Morning Report Generation...');

    // Support single-company mode (called from sendScheduledDailyReports)
    let requestBody: { companyId?: string } = {};
    try {
      const cloned = req.clone();
      requestBody = await cloned.json();
    } catch { /* no body is fine */ }

    const singleCompanyId = requestBody?.companyId;

    // Fetch companies - either all or just the requested one
    let companies;
    if (singleCompanyId) {
      companies = await base44.asServiceRole.entities.Company.filter({ id: singleCompanyId });
      console.log(`Single-company mode: ${singleCompanyId}`);
    } else {
      companies = await base44.asServiceRole.entities.Company.list();
      console.log(`Found ${companies.length} companies`);
    }

    // =============================================
    // 📋 TRIAL EXPIRATION CHECK (run once for all)
    // =============================================
    console.log('⏰ Running trial expiration check as part of morning report...');
    try {
      await base44.asServiceRole.functions.invoke('expireTrials', {});
      console.log('✅ Trial expiration check completed');
    } catch (trialErr) {
      console.error('❌ Trial expiration check failed (non-blocking):', trialErr);
    }

    // =============================================
    // 📊 Build trial status summary for CompanySync report
    // =============================================
    const allTrialCompanies = companies.filter(c => 
      c.subscription_status === 'trial' && 
      c.trial_ends_at &&
      c.company_name !== 'CompanySync' &&
      !c.is_deleted
    );
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    
    const trialStatusSummary = {
      expired: allTrialCompanies.filter(c => new Date(c.trial_ends_at) < todayDate).map(c => ({
        name: c.company_name,
        email: c.billing_email || c.email,
        ended: c.trial_ends_at,
        days_ago: Math.ceil((todayDate - new Date(c.trial_ends_at)) / (1000 * 60 * 60 * 24))
      })),
      expiring_3_days: allTrialCompanies.filter(c => {
        const d = Math.ceil((new Date(c.trial_ends_at) - todayDate) / (1000 * 60 * 60 * 24));
        return d >= 0 && d <= 3;
      }).map(c => ({
        name: c.company_name,
        email: c.billing_email || c.email,
        ends: c.trial_ends_at,
        days_left: Math.ceil((new Date(c.trial_ends_at) - todayDate) / (1000 * 60 * 60 * 24))
      })),
      expiring_7_days: allTrialCompanies.filter(c => {
        const d = Math.ceil((new Date(c.trial_ends_at) - todayDate) / (1000 * 60 * 60 * 24));
        return d > 3 && d <= 7;
      }).map(c => ({
        name: c.company_name,
        email: c.billing_email || c.email,
        ends: c.trial_ends_at,
        days_left: Math.ceil((new Date(c.trial_ends_at) - todayDate) / (1000 * 60 * 60 * 24))
      })),
      active_trials: allTrialCompanies.filter(c => {
        const d = Math.ceil((new Date(c.trial_ends_at) - todayDate) / (1000 * 60 * 60 * 24));
        return d > 7;
      }).length
    };

    const reports = [];

    for (const company of companies) {
      try {
        if (company.is_deleted) continue;
        console.log(`\n📊 Generating morning report for: ${company.company_name}`);

        // Determine company timezone and today's date in that timezone
        const companyTimezone = company.settings?.time_zone || company.timezone || 'America/New_York';
        const tzFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: companyTimezone,
          year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const tzParts = tzFormatter.formatToParts(new Date());
        const todayInTz = `${tzParts.find(p => p.type === 'year')?.value}-${tzParts.find(p => p.type === 'month')?.value}-${tzParts.find(p => p.type === 'day')?.value}`;

        // Deduplication: skip if morning report already exists for today
        const existingCheck = await base44.asServiceRole.entities.DailyReport.filter({
          company_id: company.id,
          report_date: todayInTz,
          report_type: 'morning_briefing',
        });
        if (existingCheck && existingCheck.length > 0) {
          console.log(`⏭️ Morning report already exists for ${company.company_name} on ${todayInTz}, skipping`);
          continue;
        }

        // Fetch data for today's briefing — sort newest-first so overdue/pending items are included
        const [tasks, leads, invoices, estimates, calendarEvents, staffProfiles, allStormEvents, stormAlertSettings] = await Promise.all([
          base44.asServiceRole.entities.Task.filter({ company_id: company.id }, '-updated_date', 1000),
          base44.asServiceRole.entities.Lead.filter({ company_id: company.id }, '-created_date', 500),
          base44.asServiceRole.entities.Invoice.filter({ company_id: company.id }, '-created_date', 1000),
          base44.asServiceRole.entities.Estimate.filter({ company_id: company.id }, '-created_date', 500),
          base44.asServiceRole.entities.CalendarEvent.filter({ company_id: company.id }, '-start_time', 500),
          base44.asServiceRole.entities.StaffProfile.filter({ company_id: company.id }),
          base44.asServiceRole.entities.StormEvent.list('-created_date', 100),
          base44.asServiceRole.entities.StormAlertSettings.filter({ company_id: company.id })
        ]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        // 📅 Today's scheduled events
        const todayEvents = calendarEvents.filter(e => {
          const eventDate = new Date(e.start_time);
          return eventDate >= today && eventDate < tomorrow && e.status === 'scheduled';
        }).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

        // 🔥 Critical tasks needing attention
        const criticalTasks = tasks.filter(t => {
          if (t.is_archived || t.column === 'job_completed') return false;
          
          // Overdue tasks
          if (t.due_date) {
            const dueDate = new Date(t.due_date);
            dueDate.setHours(0, 0, 0, 0);
            if (dueDate < today) return true;
          }
          
          // Tasks due today
          if (t.due_date) {
            const dueDate = new Date(t.due_date);
            dueDate.setHours(0, 0, 0, 0);
            if (dueDate.getTime() === today.getTime()) return true;
          }
          
          // Unassigned high-priority tasks
          if (t.priority === 'high' && !t.assignees?.length && !t.assigned_to) return true;
          
          return false;
        });

        // 💰 Financial snapshot - check for TRULY overdue invoices
        const overdueInvoices = invoices.filter(inv => {
          // Skip paid, cancelled, or fully paid invoices
          if (inv.status === 'paid' || inv.status === 'cancelled') return false;
          if (inv.amount_paid >= inv.amount) return false; // Fully paid
          if (!inv.due_date) return false;
          const dueDate = new Date(inv.due_date);
          dueDate.setHours(0, 0, 0, 0);
          return dueDate < today;
        });

        const pendingEstimates = estimates.filter(e => 
          e.status === 'sent' || e.status === 'viewed'
        );

        // 🎯 New leads needing attention
        const newLeads = leads.filter(l => 
          l.status === 'new' && !l.assigned_to && !l.assigned_to_users?.length
        );

        // 🌪️ NEW STORMS detected overnight (created since yesterday)
        const overnightStorms = allStormEvents.filter(storm => {
          const createdDate = new Date(storm.created_date);
          return createdDate >= yesterday && createdDate < today && 
                 (storm.severity === 'severe' || storm.severity === 'extreme');
        });

        // Filter storms by service radius if settings exist
        const alertConfig = stormAlertSettings[0];
        let relevantStorms = overnightStorms;

        if (alertConfig?.service_center_location && alertConfig?.service_radius_miles) {
          // For simplicity, we'll include all storms since detailed filtering is in Storm Tracker
          // In production, you'd geocode service_center_location and calculate distance
          relevantStorms = overnightStorms.filter(storm => {
            if (!storm.latitude || !storm.longitude) {
              // Check if affected areas match service areas
              if (storm.affected_areas && alertConfig.service_areas?.length > 0) {
                return storm.affected_areas.some(stormArea =>
                  alertConfig.service_areas.some(serviceArea =>
                    stormArea.toLowerCase().includes(serviceArea.toLowerCase())
                  )
                );
              }
              return false;
            }
            // If we have coordinates, assume it's in range (proper distance calc would be here)
            return true;
          });
        }

        // Extract highlights and concerns from ACTUAL data
        const highlights = [];
        const concerns = [];

        // HIGHLIGHTS
        if (relevantStorms.length > 0) {
          const stormTypes = [...new Set(relevantStorms.map(s => s.event_type))];
          highlights.push(`🌪️ ${relevantStorms.length} severe storm${relevantStorms.length > 1 ? 's' : ''} detected overnight (${stormTypes.join(', ')}) - potential lead opportunities in affected areas!`);
        }
        if (todayEvents.length > 0) {
          highlights.push(`${todayEvents.length} appointment${todayEvents.length > 1 ? 's' : ''} scheduled today - stay on track with customer meetings`);
        }
        if (newLeads.length > 0) {
          highlights.push(`${newLeads.length} new lead${newLeads.length > 1 ? 's' : ''} ready to assign - fresh sales opportunities`);
        }
        if (pendingEstimates.length > 0) {
          highlights.push(`${pendingEstimates.length} pending estimate${pendingEstimates.length > 1 ? 's' : ''} awaiting customer response - follow up for conversions`);
        }
        if (criticalTasks.filter(t => t.priority === 'high').length > 0) {
          highlights.push(`${criticalTasks.filter(t => t.priority === 'high').length} high-priority task${criticalTasks.filter(t => t.priority === 'high').length > 1 ? 's' : ''} need completion today`);
        }

        // If nothing is happening, add positive highlights
        if (highlights.length === 0) {
          highlights.push('Clear schedule - good opportunity for strategic planning and outreach');
          highlights.push('No urgent fires - focus on proactive sales and follow-ups');
        }

        // CONCERNS
        if (overdueInvoices.length > 0) {
          const totalOwed = overdueInvoices.reduce((sum, inv) => sum + ((inv.amount || 0) - (inv.amount_paid || 0)), 0);
          concerns.push(`${overdueInvoices.length} overdue invoice${overdueInvoices.length > 1 ? 's' : ''} totaling $${totalOwed.toFixed(2)} - immediate follow-up required`);
        }
        if (criticalTasks.filter(t => !t.assignees?.length && !t.assigned_to).length > 0) {
          concerns.push(`${criticalTasks.filter(t => !t.assignees?.length && !t.assigned_to).length} critical task${criticalTasks.filter(t => !t.assignees?.length && !t.assigned_to).length > 1 ? 's' : ''} unassigned - need owners ASAP`);
        }
        if (newLeads.length > 0) {
          concerns.push(`${newLeads.length} new lead${newLeads.length > 1 ? 's' : ''} unassigned - assign and contact today to maximize conversion`);
        }
        if (criticalTasks.filter(t => t.due_date && new Date(t.due_date) < today).length > 0) {
          concerns.push(`${criticalTasks.filter(t => t.due_date && new Date(t.due_date) < today).length} overdue task${criticalTasks.filter(t => t.due_date && new Date(t.due_date) < today).length > 1 ? 's' : ''} - catch up today`);
        }

        // Build trial section for CompanySync platform only
        const isPlatformCompany = company.company_name?.startsWith('CompanySync');
        const trialSection = isPlatformCompany ? `
        **📋 SUBSCRIBER TRIAL STATUS:**
        ${trialStatusSummary.expired.length > 0 ? `🚫 EXPIRED (${trialStatusSummary.expired.length}): ${trialStatusSummary.expired.map(t => `${t.name} (ended ${t.days_ago}d ago)`).join(', ')}` : '✅ No expired trials'}
        ${trialStatusSummary.expiring_3_days.length > 0 ? `⚠️ EXPIRING IN 0-3 DAYS (${trialStatusSummary.expiring_3_days.length}): ${trialStatusSummary.expiring_3_days.map(t => `${t.name} (${t.days_left}d left)`).join(', ')}` : ''}
        ${trialStatusSummary.expiring_7_days.length > 0 ? `📅 EXPIRING IN 4-7 DAYS (${trialStatusSummary.expiring_7_days.length}): ${trialStatusSummary.expiring_7_days.map(t => `${t.name} (${t.days_left}d left)`).join(', ')}` : ''}
        ${trialStatusSummary.active_trials > 0 ? `✅ ${trialStatusSummary.active_trials} active trials with 7+ days remaining` : ''}
        ` : '';

        // Generate concise AI summary
        const prompt = `You are writing a brief morning briefing for ${company.company_name}.
        ${trialSection}
        **OVERNIGHT STORM ACTIVITY:**
        ${relevantStorms.length > 0 ? relevantStorms.map(s => `• 🌪️ ${s.severity.toUpperCase()}: ${s.title} - Affected areas: ${s.affected_areas?.join(', ') || 'Unknown'}${s.hail_size_inches ? ` (${s.hail_size_inches}" hail)` : ''}${s.wind_speed_mph ? ` (${s.wind_speed_mph} mph winds)` : ''}`).join('\n') : 'No severe storms detected overnight'}

        **TODAY'S DATA:**
        - ${todayEvents.length} scheduled events
        - ${criticalTasks.length} critical tasks
        - ${overdueInvoices.length} overdue invoices ($${overdueInvoices.reduce((sum, inv) => sum + ((inv.amount || 0) - (inv.amount_paid || 0)), 0).toFixed(2)} owed)
        - ${newLeads.length} new unassigned leads
        - ${pendingEstimates.length} pending estimates

        **ACTUAL EVENTS TODAY:**
        ${todayEvents.length > 0 ? todayEvents.map(e => `• ${new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${e.title}${e.related_customer ? ` (${e.related_customer})` : ''}`).join('\n') : 'None scheduled'}

        **ACTUAL CRITICAL TASKS:**
        ${criticalTasks.length > 0 ? criticalTasks.slice(0, 3).map(t => `• ${t.name}${t.assignees?.length ? ` (Owner: ${t.assignees[0].name || t.assignees[0].email})` : ' (UNASSIGNED)'}`).join('\n') : 'No critical tasks'}

        **ACTUAL OVERDUE INVOICES:**
        ${overdueInvoices.length > 0 ? overdueInvoices.slice(0, 2).map(inv => `• ${inv.customer_name}: $${((inv.amount || 0) - (inv.amount_paid || 0)).toFixed(2)} owed (${inv.invoice_number} - Total: $${inv.amount.toFixed(2)}, Paid: $${(inv.amount_paid || 0).toFixed(2)})`).join('\n') : 'None'}

        Write a BRIEF executive summary (120 words max) that:
        1. ${relevantStorms.length > 0 ? '**FIRST**: Alert about overnight storms and potential lead generation opportunity in affected areas' : 'Start with today\'s schedule'}
        2. States what's scheduled today (use actual times/names from above)
        3. Highlights key priorities (use actual data)
        4. Notes any urgent items (overdue invoices, unassigned leads)
        5. Ends with a motivating sentence

        DO NOT invent names or scenarios. If data is empty, say "quiet day - focus on planning" or similar.
        Keep it professional and concise.`;


        console.log('🤖 Calling LLM for morning briefing summary...');
        const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt,
          add_context_from_internet: false
        });
        console.log('✅ LLM morning briefing response received:', aiResponse ? 'YES' : 'NULL');

        const reportContent = typeof aiResponse === 'string' ? aiResponse : (aiResponse ? String(aiResponse) : 'No morning briefing generated - please check OpenAI API configuration or prompt');

        // Create DailyReport record with structured data
        const report = await base44.asServiceRole.entities.DailyReport.create({
          company_id: company.id,
          report_date: today.toISOString().split('T')[0],
          report_type: 'morning_briefing',
          summary: reportContent,
          highlights: highlights,
          concerns: concerns,
          metrics: {
            scheduled_events: todayEvents.length,
            critical_tasks: criticalTasks.length,
            overdue_invoices: overdueInvoices.length,
            pending_estimates: pendingEstimates.length,
            new_leads: newLeads.length,
            overnight_storms: relevantStorms.length
          },
          top_activities: [
            // Always show storm status
            ...(relevantStorms.length > 0 
              ? relevantStorms.map(storm => ({
                  type: '🌪️ Storm Alert',
                  description: `${storm.severity.toUpperCase()}: ${storm.title}${storm.hail_size_inches ? ` (${storm.hail_size_inches}" hail)` : ''}${storm.wind_speed_mph ? ` (${storm.wind_speed_mph} mph winds)` : ''}`,
                  time: new Date(storm.start_time || storm.created_date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                  staff_email: null,
                  storm_id: storm.id,
                  affected_areas: storm.affected_areas
                }))
              : [{
                  type: '🌤️ Storm Status',
                  description: `No severe storms detected within service radius overnight`,
                  time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                  staff_email: null
                }]
            ),
            ...todayEvents.map(e => ({
              type: 'Scheduled Event',
              description: e.title,
              time: new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
              staff_email: e.assigned_to || e.created_by
            }))
          ],
          follow_ups_needed: [
            ...overdueInvoices.slice(0, 5).map(inv => ({
              customer_name: inv.customer_name,
              reason: `Overdue invoice ${inv.invoice_number} - $${((inv.amount || 0) - (inv.amount_paid || 0)).toFixed(2)} remaining`,
              priority: 'high',
              assigned_to: inv.sale_agent || inv.created_by
            })),
            ...criticalTasks.filter(t => !t.assignees?.length && !t.assigned_to).slice(0, 3).map(t => ({
              customer_name: t.related_to || 'Internal',
              reason: `Unassigned critical task: ${t.name}`,
              priority: 'high',
              assigned_to: null
            })),
            ...newLeads.slice(0, 3).map(lead => ({
              customer_name: lead.name,
              reason: `New lead from ${lead.source} - needs assignment and contact`,
              priority: 'medium',
              assigned_to: null
            }))
          ],
          generated_at: new Date().toISOString()
        });

        console.log('✅ Morning report created:', report.id);

        // Send notifications to all staff (In-App)
        const adminStaff = staffProfiles.filter(s => s.is_administrator);
        
        for (const staff of adminStaff) {
          await base44.asServiceRole.entities.Notification.create({
            company_id: company.id,
            user_email: staff.user_email,
            title: '🌅 Good Morning - Daily Briefing Ready',
            message: `${criticalTasks.length} critical tasks, ${todayEvents.length} events today`,
            type: 'morning_briefing',
            related_entity_type: 'DailyReport',
            related_entity_id: report.id,
            link_url: '/DailyReports',
            is_read: false
          });
        }

        // Send email to Company
        try {
          let recipientEmail = company.settings?.daily_report_email;
          const platformAdmin = 'yicnteam@gmail.com';
          const isPlatformCompany = company.company_name?.startsWith('CompanySync');

          if (!recipientEmail || (recipientEmail === platformAdmin && !isPlatformCompany)) {
             // We have staffProfiles
             const realAdmins = staffProfiles.filter(s => 
                (s.is_administrator || s.role === 'admin') && 
                s.user_email && 
                s.user_email !== platformAdmin
             );
             if (realAdmins.length > 0) recipientEmail = realAdmins[0].user_email;
          }

          if (!recipientEmail || (recipientEmail === platformAdmin && !isPlatformCompany)) {
             recipientEmail = company.billing_email || company.email;
          }

          if (recipientEmail === platformAdmin && !isPlatformCompany) {
             console.log(`⚠️ Skipping morning report for ${company.company_name} - Recipient is platform admin`);
             recipientEmail = null;
          }
          
          if (recipientEmail) {
            await base44.asServiceRole.functions.invoke('sendEmailWithResend', {
              to: recipientEmail,
              subject: `🌅 Morning Briefing - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
              body: `
                <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #fffbeb; padding: 20px; border-radius: 12px;">
                  <!-- Header -->
                  <div style="text-align: center; border-bottom: 3px solid #fbbf24; padding-bottom: 16px; margin-bottom: 20px;">
                    <h1 style="color: #92400e; margin: 0; font-size: 28px;">**${company.company_name} - Morning Briefing**</h1>
                    <p style="color: #78350f; margin: 8px 0 0 0; font-size: 18px;">**${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}**</p>
                  </div>

                  <div style="background: #fef3c7; padding: 8px 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
                    <p style="margin: 0; color: #78350f; font-weight: 600;">🌅 Good Morning! Here's your action plan for today:</p>
                  </div>

                  <!-- Key Metrics -->
                  <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px;">
                    <div style="background: white; border: 2px solid #fbbf24; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="color: #78350f; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">📅 Events Today</div>
                      <div style="color: #92400e; font-size: 32px; font-weight: bold;">${todayEvents.length}</div>
                    </div>
                    <div style="background: white; border: 2px solid #fbbf24; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="color: #78350f; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">🚨 Critical Tasks</div>
                      <div style="color: #92400e; font-size: 32px; font-weight: bold;">${criticalTasks.length}</div>
                    </div>
                    <div style="background: white; border: 2px solid #fbbf24; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="color: #78350f; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">🎯 New Leads</div>
                      <div style="color: #92400e; font-size: 32px; font-weight: bold;">${newLeads.length}</div>
                    </div>
                    <div style="background: white; border: 2px solid #fbbf24; border-radius: 8px; padding: 16px; text-align: center;">
                      <div style="color: #78350f; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; font-weight: 600;">💰 Overdue Invoices</div>
                      <div style="color: #92400e; font-size: 32px; font-weight: bold;">${overdueInvoices.length}</div>
                    </div>
                  </div>

                  <!-- AI Summary -->
                  <div style="background: white; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                    ${reportContent.split('\n').map(line => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return `<h3 style="color: #92400e; margin: 16px 0 8px 0; font-size: 16px;">${line}</h3>`;
                      }
                      return `<p style="margin: 8px 0; color: #374151; line-height: 1.6;">${line}</p>`;
                    }).join('')}
                  </div>

                  ${todayEvents.length > 0 ? `
                  <!-- Today's Schedule -->
                  <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 2px solid #fbbf24;">
                    <h3 style="color: #92400e; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                      📅 Today's Schedule
                    </h3>
                    ${todayEvents.slice(0, 5).map(e => `
                      <div style="background: white; padding: 12px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid #f59e0b;">
                        <div style="color: #92400e; font-weight: bold; margin-bottom: 4px;">
                          ${new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${e.title}
                        </div>
                        <div style="color: #78350f; font-size: 12px;">
                          ${e.event_type ? `Type: ${e.event_type}` : ''} ${e.location ? `• Location: ${e.location}` : ''}
                        </div>
                      </div>
                    `).join('')}
                  </div>
                  ` : ''}

                  ${criticalTasks.length > 0 ? `
                  <!-- Critical Tasks -->
                  <div style="background: #fee2e2; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 2px solid #fca5a5;">
                    <h3 style="color: #991b1b; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                      🚨 Critical Tasks
                    </h3>
                    ${criticalTasks.slice(0, 5).map(t => `
                      <div style="background: white; padding: 12px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid #ef4444;">
                        <div style="color: #991b1b; font-weight: bold;">${t.name}</div>
                        ${t.due_date ? `<div style="color: #7f1d1d; font-size: 12px; margin-top: 4px;">Due: ${new Date(t.due_date).toLocaleDateString()}</div>` : ''}
                        ${!t.assignees?.length && !t.assigned_to ? `<div style="background: #fef2f2; color: #991b1b; font-size: 11px; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 4px;">⚠️ UNASSIGNED</div>` : ''}
                      </div>
                    `).join('')}
                  </div>
                  ` : ''}

                  ${overdueInvoices.length > 0 ? `
                  <!-- Overdue Invoices -->
                  <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 2px solid #fbbf24;">
                    <h3 style="color: #92400e; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                      💰 Overdue Invoices - Need Follow-up
                    </h3>
                    ${overdueInvoices.slice(0, 3).map(inv => {
                      const remaining = (inv.amount || 0) - (inv.amount_paid || 0);
                      return `
                      <div style="background: white; padding: 12px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid #f59e0b;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <div>
                            <div style="color: #92400e; font-weight: bold;">${inv.customer_name}</div>
                            <div style="color: #78350f; font-size: 12px;">Invoice: ${inv.invoice_number} • Due: ${new Date(inv.due_date).toLocaleDateString()}</div>
                            ${inv.amount_paid > 0 ? `<div style="color: #78350f; font-size: 11px;">Total: $${inv.amount.toFixed(2)} | Paid: $${(inv.amount_paid || 0).toFixed(2)}</div>` : ''}
                          </div>
                          <div style="color: #92400e; font-weight: bold; font-size: 18px;">$${remaining.toFixed(2)}</div>
                        </div>
                      </div>
                    `;
                    }).join('')}
                    ${overdueInvoices.length > 3 ? `<div style="text-align: center; color: #78350f; font-size: 12px; margin-top: 8px;">+ ${overdueInvoices.length - 3} more overdue invoices</div>` : ''}
                  </div>
                  ` : ''}

                  ${newLeads.length > 0 ? `
                  <!-- New Leads -->
                  <div style="background: #dcfce7; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 2px solid #86efac;">
                    <h3 style="color: #166534; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                      🎯 New Leads - Assign & Contact Today
                    </h3>
                    ${newLeads.slice(0, 3).map(lead => `
                      <div style="background: white; padding: 12px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid #22c55e;">
                        <div style="color: #166534; font-weight: bold;">${lead.name}</div>
                        <div style="color: #15803d; font-size: 12px;">Source: ${lead.source}${lead.phone ? ` • ${lead.phone}` : ''}</div>
                      </div>
                    `).join('')}
                    ${newLeads.length > 3 ? `<div style="text-align: center; color: #15803d; font-size: 12px; margin-top: 8px;">+ ${newLeads.length - 3} more new leads</div>` : ''}
                  </div>
                  ` : ''}

                  ${pendingEstimates.length > 0 ? `
                  <!-- Pending Estimates -->
                  <div style="background: #e0e7ff; border-radius: 8px; padding: 16px; margin-bottom: 20px; border: 2px solid #a5b4fc;">
                    <h3 style="color: #3730a3; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
                      📊 Pending Estimates - Follow Up
                    </h3>
                    ${pendingEstimates.slice(0, 3).map(est => `
                      <div style="background: white; padding: 12px; margin-bottom: 8px; border-radius: 6px; border-left: 3px solid #6366f1;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <div>
                            <div style="color: #3730a3; font-weight: bold;">${est.customer_name}</div>
                            <div style="color: #4338ca; font-size: 12px;">Status: ${est.status}</div>
                          </div>
                          <div style="color: #3730a3; font-weight: bold;">$${(est.amount || 0).toFixed(2)}</div>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                  ` : ''}

                  <!-- CTA Button -->
                  <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 2px solid #fbbf24;">
                    <a href="${Deno.env.get('APP_URL') || 'https://getcompanysync.com'}/DailyReports" 
                       style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px rgba(245, 158, 11, 0.3);">
                      📊 View Full Morning Briefing →
                    </a>
                  </div>

                  <!-- Footer -->
                  <div style="text-align: center; margin-top: 20px; padding-top: 16px; border-top: 1px solid #fde68a;">
                    <p style="color: #78350f; font-size: 12px; margin: 0;">
                      Generated by Lexi AI Assistant • ${company.company_name}
                    </p>
                  </div>
                </div>
              `,
              fromName: company.company_name
            });
          }
        } catch (emailError) {
            console.error('Failed to send morning email:', emailError);
        }

        reports.push({
          company: company.company_name,
          report_id: report.id,
          notifications_sent: adminStaff.length
        });

      } catch (companyError) {
        console.error(`Failed for company ${company.company_name}:`, companyError);
        reports.push({
          company: company.company_name,
          error: companyError.message
        });
      }
    }

    console.log('🌅 Morning Report Generation Complete!');
    return Response.json({
      success: true,
      reports_generated: reports.length,
      reports
    });

  } catch (error) {
    console.error('❌ Morning report generation failed:', error);
    return Response.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});