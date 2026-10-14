import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { canonicalizeGenericEntityType, normalizeGenericEntityData } from './utils/expenseNormalize.ts';
import { calendarBuildRouteGuard, manageEntityBuildRouteGuard } from './utils/buildIntent.ts';
import { buildScheduleConfirmationGuard, isBuildSchedulingMutation } from './utils/buildConfirmation.ts';
// Native clients send these names through executeTool; retain explicit contracts
// here as well as the native model schema.
const BUILD_SCHEDULE_TOOL_CONTRACTS = ['get_build_schedule', 'create_build_schedule'];
const ORCHESTRATION_TOOL_CONTRACTS = ['route_lead_to_sequence', 'trigger_document_packet', 'dispatch_team_notification'];
function assertBuildDate(buildDate: any) {
  if (typeof buildDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) throw new Error('build_date must be a valid YYYY-MM-DD date');
  const [year, month, day] = buildDate.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) throw new Error('build_date must be a valid YYYY-MM-DD date');
}
function buildDayRange(buildDate: string, timezone: string) {
  assertBuildDate(buildDate);
  const targetInstant = (hour: number) => {
    const target = Date.UTC(...buildDate.split('-').map(Number).map((n, i) => i === 1 ? n - 1 : n), hour, 0, 0);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let instant = target;
    for (let i = 0; i < 2; i++) { const p = Object.fromEntries(fmt.formatToParts(new Date(instant)).filter(x => x.type !== 'literal').map(x => [x.type, x.value])); instant += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); }
    return new Date(instant).toISOString();
  };
  return { start_time: targetInstant(7), end_time: targetInstant(17) };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkAndTrackAI(base44: any, companyId: string, featureType = 'ai_interaction'): Promise<{ allowed: boolean; remaining?: number; error?: string }> {
  try {
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    if (!company) return { allowed: true };
    
    const isCompanySync = company.company_name === 'CompanySync';
    if (isCompanySync) return { allowed: true };

    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id: companyId });
    if (usageRecords.length === 0) return { allowed: true };
    
    const usage = usageRecords[0];
    const limit = (usage.ai_limit || 0) + (usage.ai_credits_purchased || 0);
    const used = usage.ai_used || 0;
    
    if (limit > 0 && used >= limit) {
      return { allowed: false, remaining: 0, error: 'AI interaction limit reached. Please upgrade your plan or purchase additional credits.' };
    }
    
    return { allowed: true, remaining: limit > 0 ? limit - used : -1 };
  } catch (err: any) {
    console.warn('[lexiBridgeAPI] AI usage check failed, allowing:', err.message);
    return { allowed: true };
  }
}

async function incrementAIUsage(base44: any, companyId: string): Promise<void> {
  try {
    const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const company = companies[0];
    if (company?.company_name === 'CompanySync') return;

    const usageRecords = await base44.asServiceRole.entities.SubscriptionUsage.filter({ company_id: companyId });
    if (usageRecords.length === 0) return;
    
    const usage = usageRecords[0];
    await base44.asServiceRole.entities.SubscriptionUsage.update(usage.id, {
      ai_used: (usage.ai_used || 0) + 1
    });
  } catch (err: any) {
    console.warn('[lexiBridgeAPI] AI usage increment failed:', err.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405);
  }

  try {
    const base44 = createClientFromRequest(req);
    // The bridge secret authenticates the integration, not an arbitrary
    // end-user named in its JSON payload. Build tools require a real session.
    const authenticatedUser = await base44.auth.me().catch(() => null);

    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('LEXI_NATIVE_BRIDGE_SECRET');

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const { action, companyId, userEmail, data } = body;

    if (!action) {
      return jsonResponse({ error: 'Missing required field: action' }, 400);
    }

    // The bearer secret authenticates the integration. It does not authorize
    // an arbitrary companyId. The named user must belong to that company.
    const sessionEmail = authenticatedUser?.email ? String(authenticatedUser.email).toLowerCase() : '';
    const claimedEmail = userEmail ? String(userEmail).toLowerCase() : '';
    if (sessionEmail && claimedEmail && sessionEmail !== claimedEmail) {
      return jsonResponse({ error: 'User email does not match the signed-in session' }, 403);
    }
    const actorEmail = sessionEmail || claimedEmail;
    if (!companyId || !actorEmail) {
      return jsonResponse({ error: 'This bridge requires the company this request belongs to' }, 403);
    }
    const bridgeCompanies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const bridgeCompany = bridgeCompanies?.[0];
    const bridgeOwner = String(bridgeCompany?.created_by || '').toLowerCase() === actorEmail;
    let bridgeMember = false;
    try {
      const bridgeProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId });
      bridgeMember = (bridgeProfiles || []).some((staff: any) =>
        [staff.user_email, staff.email].some((value) => String(value || '').toLowerCase() === actorEmail)
      );
    } catch (membershipErr: any) {
      console.warn('[lexiBridgeAPI] company membership lookup failed:', membershipErr.message);
    }
    if (!bridgeOwner && !bridgeMember) {
      return jsonResponse({ error: 'This bridge can only read data for your company' }, 403);
    }

    switch (action) {
      case 'getSettings': {
        if (!companyId) {
          return jsonResponse({ error: 'Missing companyId' }, 400);
        }

        const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({
          company_id: companyId,
        });
        const settings = settingsRows[0] || {};

        const companies = await base44.asServiceRole.entities.Company.filter({ id: companyId });
        const company = companies[0];
        const companyName = settings.brand_short_name || company?.company_name || 'our company';
        const rawName = settings.assistant_name || 'lexi';
        const assistantDisplayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        const companyTimezone = company?.timezone || 'America/New_York';

        let knowledgeBase = '';
        try {
          const memories = await base44.asServiceRole.entities.AIMemory.filter({
            company_id: companyId,
            is_active: true
          }, '-importance', 100);

          if (memories && memories.length > 0) {
            knowledgeBase = memories.map((m: any) => `- ${m.title}: ${m.content}`).join('\n');
          }
        } catch (err: any) {
          console.warn('[lexiBridgeAPI] Knowledge base load failed:', err.message);
        }

        let customerList = '';
        try {
          const customers = await base44.asServiceRole.entities.Customer.filter(
            { company_id: companyId }, '-created_date', 50
          );
          if (customers.length > 0) {
            customerList = customers.map((c: any) => `${c.name} (${c.email || c.phone || 'no contact'})`).join(', ');
          }
        } catch (err: any) {
          console.warn('[lexiBridgeAPI] Customer list load failed:', err.message);
        }

        let staffList: any[] = [];
        try {
          const staff = await base44.asServiceRole.entities.StaffProfile.filter(
            { company_id: companyId }, '-created_date', 50
          );
          staffList = staff.map((s: any) => ({ name: s.full_name, email: s.user_email, role: s.role_name }));
        } catch (err: any) {
          console.warn('[lexiBridgeAPI] Staff list load failed:', err.message);
        }

        return jsonResponse({
          settings,
          companyName,
          assistantName: assistantDisplayName,
          timezone: companyTimezone,
          knowledgeBase,
          customerList,
          staffList,
        });
      }

      case 'executeTool': {
        if (!companyId || !data?.toolName) {
          return jsonResponse({ error: 'Missing companyId or data.toolName' }, 400);
        }

        const aiCheck = await checkAndTrackAI(base44, companyId);
        if (!aiCheck.allowed) {
          return jsonResponse({ 
            success: false, 
            result: { error: aiCheck.error || 'AI limit reached' },
            limit_reached: true 
          }, 429);
        }

        const effectiveUserEmail = authenticatedUser?.email || null;
        const toolName = data.toolName;
        const args = data.args || {};

        console.log(`[lexiBridgeAPI] Executing tool: ${toolName}`, JSON.stringify(args).substring(0, 200));

        const isAdmin = true;

        // Existing bridge tools preserve their historical service integration
        // behavior. Build Schedule is a CRM visibility/write surface, so fail
        // closed unless this call carries an authenticated end-user session
        // whose identity matches the claimed native user and belongs here.
        let buildPolicy: { isAdmin: boolean; email: string; timezone: string } | null = null;
        if (BUILD_SCHEDULE_TOOL_CONTRACTS.includes(toolName) || ORCHESTRATION_TOOL_CONTRACTS.includes(toolName)) {
          if (!authenticatedUser?.email || !userEmail || authenticatedUser.email.toLowerCase() !== String(userEmail).toLowerCase()) {
            return jsonResponse({ success: false, result: { error: 'This voice tool requires an authenticated user session.' } }, 403);
          }
          const [companies, profiles] = await Promise.all([
            base44.asServiceRole.entities.Company.filter({ id: companyId }),
            base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId, user_email: authenticatedUser.email }),
          ]);
          const company = companies[0];
          const profile = profiles[0];
          const owner = company?.created_by?.toLowerCase() === authenticatedUser.email.toLowerCase();
          const admin = owner || profile?.is_administrator === true || profile?.is_super_admin === true;
          if (!company || (!owner && !profile)) {
            return jsonResponse({ success: false, result: { error: 'You are not authorized for this company.' } }, 403);
          }
          buildPolicy = { isAdmin: admin, email: authenticatedUser.email, timezone: company.timezone || 'America/New_York' };
          if (ORCHESTRATION_TOOL_CONTRACTS.includes(toolName) && !admin) {
            return jsonResponse({ success: false, result: { error: 'Only an administrator can route leads, send document packets, or delegate work to a teammate.' } }, 403);
          }
        }

        try {
          let result: any = null;

          if (toolName === 'route_lead_to_sequence') {
            const [leads, workflows] = await Promise.all([
              base44.asServiceRole.entities.Lead.filter({ id: args.lead_id, company_id: companyId }),
              base44.asServiceRole.entities.Workflow.filter({ company_id: companyId }),
            ]);
            const workflow = workflows.find((item: any) => item.is_active !== false && String(item.workflow_name || item.name || '').toLowerCase() === String(args.sequence_name || '').toLowerCase());
            if (!leads[0]) return jsonResponse({ success: false, result: { error: 'That lead is not in this company.' } });
            if (!workflow) return jsonResponse({ success: false, result: { error: 'I could not find an active company follow-up sequence with that name.' } });
            return jsonResponse({ success: true, result: { requires_confirmation: true, proposed_action: { type: 'lexi_sequence', lead_id: args.lead_id, workflow_id: workflow.id, sequence_name: args.sequence_name }, message: `Ready to enroll ${leads[0].name} in ${args.sequence_name}. Ask for explicit approval before enrolling.` } });
          }

          if (toolName === 'trigger_document_packet') {
            const Entity = args.recipient_type === 'lead' ? base44.asServiceRole.entities.Lead : args.recipient_type === 'customer' ? base44.asServiceRole.entities.Customer : null;
            const recipient = Entity ? (await Entity.filter({ id: args.recipient_id, company_id: companyId }))[0] : null;
            if (!recipient) return jsonResponse({ success: false, result: { error: 'That recipient is not in this company.' } });
            if (args.channel === 'email' && !recipient.email) return jsonResponse({ success: false, result: { error: 'That recipient has no email address.' } });
            if (args.channel === 'sms' && !recipient.phone) return jsonResponse({ success: false, result: { error: 'That recipient has no phone number.' } });
            return jsonResponse({ success: true, result: { requires_confirmation: true, proposed_action: { type: 'lexi_packet', ...args }, message: `Ready to send a restoration packet to ${recipient.name} by ${String(args.channel).toUpperCase()}. Ask for explicit approval before sending.` } });
          }

          if (toolName === 'dispatch_team_notification') {
            const needle = String(args.assignee || '').trim().toLowerCase();
            const matches = (await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId })).filter((staff: any) => staff.is_active !== false && [staff.user_email, staff.email, staff.full_name].some(value => String(value || '').toLowerCase() === needle));
            if (matches.length !== 1) return jsonResponse({ success: false, result: { error: matches.length ? 'More than one teammate matches that name; please use their email.' : 'That teammate is not an active member of this company.' } });
            const assignee = matches[0];
            const task = await base44.asServiceRole.entities.Task.create({ name: args.title, description: args.context_note, due_date: args.due_date || null, priority: args.priority || 'medium', status: 'not_started', company_id: companyId, assigned_to: assignee.user_email || assignee.email });
            await base44.asServiceRole.entities.Notification.create({ company_id: companyId, user_email: assignee.user_email || assignee.email, title: 'New operational ticket', message: `${args.title}: ${args.context_note}`, type: 'task_assigned', related_entity_type: 'Task', related_entity_id: task.id, link_url: '/Tasks', is_read: false });
            return jsonResponse({ success: true, result: { task_id: task.id, assignee: assignee.full_name, message: `Operational ticket assigned to ${assignee.full_name}.` } });
          }

          if (toolName === 'get_crm_data') {
            const dataType = args.data_type;
            if (dataType === 'customers') {
              const items = await base44.asServiceRole.entities.Customer.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length, sample: items.slice(0, 20).map((c: any) => ({ name: c.name, email: c.email, phone: c.phone })) };
            } else if (dataType === 'leads') {
              const items = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length, sample: items.slice(0, 20).map((l: any) => ({ name: l.name, status: l.status, phone: l.phone })) };
            } else if (dataType === 'estimates') {
              const items = await base44.asServiceRole.entities.Estimate.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length };
            } else if (dataType === 'invoices') {
              const items = await base44.asServiceRole.entities.Invoice.filter({ company_id: companyId }, '-created_date', 200);
              const total = items.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
              const paid = items.reduce((sum: number, inv: any) => sum + (inv.amount_paid || 0), 0);
              result = { count: items.length, total_revenue: total, total_paid: paid };
            } else if (dataType === 'tasks') {
              const items = await base44.asServiceRole.entities.Task.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length, sample: items.slice(0, 10).map((t: any) => ({ name: t.name, status: t.status })) };
            } else if (dataType === 'projects') {
              const items = await base44.asServiceRole.entities.Project.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length };
            } else if (dataType === 'payments') {
              const items = await base44.asServiceRole.entities.Payment.filter({ company_id: companyId }, '-created_date', 200);
              const total = items.reduce((sum: number, pmt: any) => sum + (pmt.amount || 0), 0);
              result = { count: items.length, total_amount: total };
            } else if (dataType === 'staff') {
              const items = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length, staff: items.map((s: any) => ({ name: s.full_name, email: s.user_email, role: s.role_name })) };
            } else if (dataType === 'calendar_events') {
              const items = await base44.asServiceRole.entities.CalendarEvent.filter({ company_id: companyId }, '-created_date', 200);
              result = { count: items.length, events: items.slice(0, 20).map((e: any) => ({ title: e.title, start: e.start_time })) };
            }
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result });
          }

          if (toolName === 'get_calendar_events') {
            const startDate = args.start_date;
            const endDate = args.end_date || startDate;
            const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ company_id: companyId }, '-start_time', 1000);
            const events = allEvents.filter((e: any) => {
              if (!e.start_time) return false;
              try {
                const eventDate = new Date(e.start_time).toISOString().split('T')[0];
                return eventDate >= startDate && eventDate <= endDate;
              } catch { return false; }
            }).map((e: any) => ({ title: e.title, start: e.start_time, end: e.end_time, status: e.status }));
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result: { count: events.length, events } });
          }

          if (toolName === 'get_build_schedule') {
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
            const baseFilter = { company_id: companyId };
            const all = buildPolicy!.isAdmin
              ? await base44.asServiceRole.entities.BuildSchedule.filter(baseFilter, 'build_date', 1000)
              : (await Promise.all([
                base44.asServiceRole.entities.BuildSchedule.filter({ ...baseFilter, created_by: buildPolicy!.email }, 'build_date', 1000),
                base44.asServiceRole.entities.BuildSchedule.filter({ ...baseFilter, rep_email: buildPolicy!.email }, 'build_date', 1000),
                base44.asServiceRole.entities.BuildSchedule.filter({ ...baseFilter, assigned_to_users: { $contains: buildPolicy!.email } }, 'build_date', 1000),
              ])).flat().filter((b: any, i: number, a: any[]) => a.findIndex(x => x.id === b.id) === i);
            const builds = all.filter((b: any) => (!args.customer_id || b.customer_id === args.customer_id) && (!args.customer_name || (b.customer_name || '').toLowerCase().includes(args.customer_name.toLowerCase())) && (!args.status || (b.status || '').toLowerCase() === args.status.toLowerCase()) && (!args.job_type || JSON.stringify(b.job_type || []).toLowerCase().includes(args.job_type.toLowerCase())) && (!args.date_from || b.build_date >= args.date_from) && (!args.date_to || b.build_date <= args.date_to)).slice(0, limit);
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result: { count: builds.length, builds: builds.map((b: any) => ({ id: b.id, customer_name: b.customer_name, build_date: b.build_date, status: b.status, job_type: b.job_type || [], address: b.address, rep: b.rep, crew: b.crew || b.assigned_to || [], notes: b.notes || null })) } });
          }

          if (toolName === 'create_build_schedule') {
            const jobTypes = Array.isArray(args.job_types) ? args.job_types.filter(Boolean) : (args.job_type ? [args.job_type] : []);
            if (!(args.customer_id || args.customer_name) || !args.build_date || !jobTypes.length) return jsonResponse({ success: false, result: { error: 'Build requires customer_name or customer_id, build_date, and one or more job_types.' } });
            try { assertBuildDate(args.build_date); } catch (e: any) { return jsonResponse({ success: false, result: { error: e.message } }, 400); }
            let customers;
            if (args.customer_id) {
              customers = await base44.asServiceRole.entities.Customer.filter({ company_id: companyId, id: args.customer_id }, 'name', 1);
              const selected = customers[0];
              const assigned = Array.isArray(selected?.assigned_to_users) ? selected.assigned_to_users : [];
              if (!buildPolicy!.isAdmin && selected?.assigned_to !== buildPolicy!.email && !assigned.includes(buildPolicy!.email)) customers = [];
            } else {
              const needle = String(args.customer_name || '').toLowerCase().trim().replace(/\s+/g, ' ');
              const tokens = needle.split(' ').filter(Boolean);
              const allCustomers = await base44.asServiceRole.entities.Customer.filter({ company_id: companyId }, '-created_date', 1000);
              customers = allCustomers.filter((item: any) => {
                const name = String(item.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
                const assigned = Array.isArray(item.assigned_to_users) ? item.assigned_to_users : [];
                const canAccess = buildPolicy!.isAdmin || item.assigned_to === buildPolicy!.email || assigned.includes(buildPolicy!.email);
                return canAccess && (name.includes(needle) || tokens.every(token => name.includes(token)));
              }).slice(0, 3);
            }
            const customer = customers.length === 1 ? customers[0] : null;
            if (!customer && customers.length > 1) return jsonResponse({ success: false, result: { error: 'More than one customer matches that name. Please ask which customer they mean.', code: 'CUSTOMER_AMBIGUOUS', candidates: customers.map((c: any) => ({ id: c.id, name: c.name })) } });
            if (!customer) return jsonResponse({ success: false, result: { error: 'Customer was not found in this company.' } });
            const confirmation = buildScheduleConfirmationGuard({
              companyId, userEmail: buildPolicy!.email, action: 'create',
              customerId: customer.id, customerName: customer.name,
              buildDate: args.build_date, jobTypes,
            }, args.confirmation_token);
            if (confirmation) return jsonResponse({ success: false, result: confirmation });
            const assigned = buildPolicy!.isAdmin ? (Array.isArray(args.assigned_to) ? args.assigned_to : [args.assigned_to || buildPolicy!.email]) : [buildPolicy!.email];
            const build = await base44.asServiceRole.entities.BuildSchedule.create({ company_id: companyId, customer_id: customer.id, customer_name: customer.name, build_date: args.build_date, job_type: jobTypes, address: args.address || customer.address || '', customer_phone: args.customer_phone || customer.phone || '', customer_email: args.customer_email || customer.email || '', rep: buildPolicy!.isAdmin ? (args.rep || buildPolicy!.email) : buildPolicy!.email, rep_email: buildPolicy!.email, crew: args.crew || [], assigned_to: assigned, assigned_to_users: assigned, notes: args.notes || '', status: args.status || 'scheduled', created_by: buildPolicy!.email, created_by_name: buildPolicy!.email });
            let calendarEventId: string | null = null;
            try {
              const day = buildDayRange(args.build_date, buildPolicy!.timezone);
              const event = await base44.asServiceRole.entities.CalendarEvent.create({ company_id: companyId, title: `${jobTypes.join(' & ')}: ${customer.name}`, start_time: day.start_time, end_time: day.end_time, event_type: 'build', location: args.address || customer.address || '', description: args.notes || '', assigned_to: assigned[0], attendees: assigned, related_customer: customer.name, status: 'scheduled', created_by: buildPolicy!.email });
              calendarEventId = event.id;
              await base44.asServiceRole.entities.BuildSchedule.update(build.id, { calendar_event_id: event.id });
              const [verifiedBuilds, verifiedEvents] = await Promise.all([
                base44.asServiceRole.entities.BuildSchedule.filter({ id: build.id, company_id: companyId }, '-created_date', 1),
                base44.asServiceRole.entities.CalendarEvent.filter({ id: event.id, company_id: companyId }, '-created_date', 1),
              ]);
              if (verifiedBuilds[0]?.calendar_event_id !== event.id || !verifiedEvents[0]) {
                throw new Error('Saved build records could not be verified');
              }
              await incrementAIUsage(base44, companyId);
              return jsonResponse({ success: true, result: { build_id: build.id, calendar_event_id: event.id, customer_name: customer.name, build_date: args.build_date, job_type: jobTypes } });
            } catch (calendarError: any) {
              const cleanup = await Promise.allSettled([
                calendarEventId ? base44.asServiceRole.entities.CalendarEvent.delete(calendarEventId) : Promise.resolve(),
                base44.asServiceRole.entities.BuildSchedule.delete(build.id),
              ]);
              const cleanedUp = cleanup.every(r => r.status === 'fulfilled');
              await incrementAIUsage(base44, companyId);
              return jsonResponse({ success: false, result: { error: `No build was created: calendar setup failed (${calendarError.message}). Cleanup ${cleanedUp ? 'completed' : 'may require manual review'}.` } }, 500);
            }
          }

          if (toolName === 'create_calendar_event') {
            const buildRouteBlock = calendarBuildRouteGuard(args);
            if (buildRouteBlock) return jsonResponse({ success: false, result: buildRouteBlock });
            let startTime = args.start_time;
            let endTime = args.end_time;

            // Safety net: if the voice AI emitted a bare local time (no Z, no ±HH:MM),
            // compute the company timezone offset and append it so storage is correct.
            const getUtcOffsetLBA = (tz: string, date: Date = new Date()): string => {
              try {
                const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
                const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
                const diffMin = Math.round((new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000);
                const sign = diffMin >= 0 ? '+' : '-';
                const abs = Math.abs(diffMin);
                return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
              } catch { return '-04:00'; }
            };
            const companyTzOffset = getUtcOffsetLBA(companyTimezone || 'America/New_York');
            if (startTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startTime)) {
              console.log(`[lexiBridgeAPI] Bare datetime — appending tz offset: ${startTime}${companyTzOffset}`);
              startTime = startTime + companyTzOffset;
            }
            if (endTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
              endTime = endTime + companyTzOffset;
            }

            if (!endTime) {
              const d = new Date(startTime);
              d.setHours(d.getHours() + 1);
              endTime = d.toISOString();
            }
            const eventData = {
              title: args.title,
              start_time: startTime,
              end_time: endTime,
              location: args.location || '',
              description: args.description || '',
              event_type: args.event_type || 'meeting',
              status: 'scheduled',
              company_id: companyId,
              assigned_to: effectiveUserEmail,
              created_by: effectiveUserEmail,
              send_email_notification: true,
            };
            const event = await base44.asServiceRole.entities.CalendarEvent.create(eventData);

            try {
              await base44.asServiceRole.functions.invoke('syncCRMToGoogleCalendar', { eventId: event.id });
            } catch (syncErr: any) {
              console.warn('[lexiBridgeAPI] Google Calendar sync failed:', syncErr.message);
            }

            await incrementAIUsage(base44, companyId);
            return jsonResponse({
              success: true,
              result: {
                event_id: event.id,
                title: args.title,
                start_time: startTime,
                end_time: endTime,
                message: `Event "${args.title}" created successfully`
              }
            });
          }

          if (toolName === 'create_task') {
            const task = await base44.asServiceRole.entities.Task.create({
              ...args,
              company_id: companyId,
              assigned_to: effectiveUserEmail,
              assigned_to_users: [effectiveUserEmail]
            });
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result: { task_id: task.id, name: args.name } });
          }

          if (toolName === 'create_lead') {
            const lead = await base44.asServiceRole.entities.Lead.create({
              ...args,
              company_id: companyId,
              status: 'new',
              lead_source: 'Lexi AI (Native Voice)',
              source: 'ai',
              assigned_to: effectiveUserEmail,
              assigned_to_users: [effectiveUserEmail]
            });
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result: { lead_id: lead.id, name: args.name, message: `Lead "${args.name}" created.` } });
          }

          if (toolName === 'create_customer') {
            const customer = await base44.asServiceRole.entities.Customer.create({
              ...args,
              company_id: companyId,
              assigned_to: effectiveUserEmail,
              assigned_to_users: [effectiveUserEmail]
            });
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result: { customer_id: customer.id, name: args.name } });
          }

          if (toolName === 'send_sms') {
            await incrementAIUsage(base44, companyId);
            return jsonResponse({
              success: true,
              result: { pending_confirmation: true, message: `SMS to ${args.to}: "${args.message}" - Confirm to send.` }
            });
          }

          if (toolName === 'send_email') {
            await incrementAIUsage(base44, companyId);
            return jsonResponse({
              success: true,
              result: { pending_confirmation: true, message: `Email to ${args.to}, subject "${args.subject}" - Confirm to send.` }
            });
          }

          if (toolName === 'manage_entity') {
            const { entity_action, entity_name, entity_data, entity_id } = args;
            const normalizedEntity = canonicalizeGenericEntityType(entity_name.charAt(0).toUpperCase() + entity_name.slice(1));

            // A build must not reach the calendar through the generic CRUD tool either.
            const entityBuildRouteBlock = manageEntityBuildRouteGuard(normalizedEntity, entity_action, entity_data);
            if (entityBuildRouteBlock) return jsonResponse({ success: false, result: entityBuildRouteBlock });

            if (!base44.asServiceRole.entities[normalizedEntity]) {
              return jsonResponse({ success: false, result: { error: `Entity type '${normalizedEntity}' not found.` } });
            }

            let entityResult: any;
            if (entity_action === 'create') {
              // Expense: map LLM alias fields (vendor/date) → canonical schema + default
              // category, or the Expenses page crashes on undefined category
              const payload = normalizeGenericEntityData(normalizedEntity, { ...entity_data, company_id: companyId }, { applyDefaults: true });
              if (normalizedEntity === 'BuildSchedule' && isBuildSchedulingMutation(entity_data)) {
                const confirmation = buildScheduleConfirmationGuard({
                  companyId, userEmail: buildPolicy!.email, action: 'create',
                  customerId: payload.customer_id, customerName: payload.customer_name,
                  buildDate: payload.build_date, jobTypes: payload.job_type || payload.job_types,
                }, args.confirmation_token);
                if (confirmation) return jsonResponse({ success: false, result: confirmation });
                payload.created_by = payload.created_by || buildPolicy!.email;
                payload.created_by_name = payload.created_by_name || buildPolicy!.name || buildPolicy!.email;
              }
              entityResult = await base44.asServiceRole.entities[normalizedEntity].create(payload);
            } else if (entity_action === 'update') {
              const owned = await base44.asServiceRole.entities[normalizedEntity].filter(
                { id: entity_id, company_id: companyId }, '-created_date', 1
              );
              if (!owned || owned.length === 0) {
                return jsonResponse({ success: false, result: { error: `Entity ${entity_id} not found in this company.` } });
              }
              if (normalizedEntity === 'BuildSchedule' && isBuildSchedulingMutation(entity_data)) {
                const proposed = { ...owned[0], ...entity_data };
                const confirmation = buildScheduleConfirmationGuard({
                  companyId, userEmail: buildPolicy!.email, action: 'update', recordId: entity_id,
                  customerId: proposed.customer_id, customerName: proposed.customer_name,
                  buildDate: proposed.build_date, jobTypes: proposed.job_type || proposed.job_types,
                }, args.confirmation_token);
                if (confirmation) return jsonResponse({ success: false, result: confirmation });
              }
              const safeData = normalizeGenericEntityData(normalizedEntity, { ...owned[0], ...entity_data });
              delete safeData.id;
              delete safeData.company_id;
              entityResult = await base44.asServiceRole.entities[normalizedEntity].update(entity_id, safeData);
               if (normalizedEntity === 'BuildSchedule') {
                 const previousBuild = { ...owned[0] };
                 const verifiedRows = await base44.asServiceRole.entities.BuildSchedule.filter({ id: entity_id, company_id: companyId }, '-created_date', 1);
                 const verified = verifiedRows[0];
                 const requestedEntries = Object.entries(entity_data || {}).filter(([key]) => !['id', 'company_id', 'calendar_event_id'].includes(key));
                 const confirmed = verified && requestedEntries.every(([key, value]) => JSON.stringify(verified[key]) === JSON.stringify(value));
                  if (!confirmed) {
                    delete previousBuild.id;
                    delete previousBuild.company_id;
                    await base44.asServiceRole.entities.BuildSchedule.update(entity_id, previousBuild);
                    return jsonResponse({ success: false, result: { error: 'The build update could not be verified. Please review the Build Schedule before trying again.' } });
                  }
                 if (verified.calendar_event_id) {
                   const calendarPatch: any = {};
                   if (entity_data.build_date) {
                     const day = buildDayRange(entity_data.build_date, buildPolicy!.timezone);
                     calendarPatch.start_time = day.start_time;
                     calendarPatch.end_time = day.end_time;
                   }
                   if (entity_data.address !== undefined) calendarPatch.location = entity_data.address;
                   if (entity_data.notes !== undefined) calendarPatch.description = entity_data.notes;
                   if (entity_data.status !== undefined) calendarPatch.status = entity_data.status;
                   if (entity_data.assigned_to !== undefined) {
                     const assigned = Array.isArray(entity_data.assigned_to) ? entity_data.assigned_to : [entity_data.assigned_to];
                     calendarPatch.assigned_to = assigned[0];
                     calendarPatch.attendees = assigned;
                   }
                    const priorEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ id: verified.calendar_event_id, company_id: companyId }, '-created_date', 1);
                    const previousCalendar = { ...priorEvents[0] };
                    try {
                     if (Object.keys(calendarPatch).length) await base44.asServiceRole.entities.CalendarEvent.update(verified.calendar_event_id, calendarPatch);
                     const linkedEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ id: verified.calendar_event_id, company_id: companyId }, '-created_date', 1);
                     const calendarConfirmed = linkedEvents[0] && Object.entries(calendarPatch).every(([key, value]) => JSON.stringify(linkedEvents[0][key]) === JSON.stringify(value));
                     if (!calendarConfirmed) throw new Error('The linked calendar event could not be verified.');
                   } catch (calendarError) {
                     delete previousBuild.id;
                     delete previousBuild.company_id;
                     await base44.asServiceRole.entities.BuildSchedule.update(entity_id, previousBuild);
                      delete previousCalendar.id;
                      delete previousCalendar.company_id;
                      if (Object.keys(previousCalendar).length) await base44.asServiceRole.entities.CalendarEvent.update(verified.calendar_event_id, previousCalendar);
                     return jsonResponse({ success: false, result: { error: 'The linked calendar update could not be verified. Please review the Build Schedule before trying again.' } });
                   }
                  } else {
                    let createdEvent: any = null;
                    try {
                      const day = buildDayRange(verified.build_date, buildPolicy!.timezone);
                      const jobTypes = Array.isArray(verified.job_type) ? verified.job_type : (verified.job_type ? [verified.job_type] : ['Build']);
                      const assigned = Array.isArray(verified.assigned_to) ? verified.assigned_to : [verified.assigned_to || buildPolicy!.email];
                      createdEvent = await base44.asServiceRole.entities.CalendarEvent.create({
                        company_id: companyId,
                        title: `${jobTypes.join(' & ')}: ${verified.customer_name || 'Build'}`,
                        start_time: day.start_time,
                        end_time: day.end_time,
                        event_type: 'build',
                        location: verified.address || '',
                        description: verified.notes || '',
                        assigned_to: assigned[0],
                        attendees: assigned,
                        related_customer: verified.customer_name || '',
                        status: verified.status || 'scheduled',
                        created_by: verified.created_by || buildPolicy!.email,
                      });
                      await base44.asServiceRole.entities.BuildSchedule.update(entity_id, { calendar_event_id: createdEvent.id });
                      const [linkedBuilds, linkedEvents] = await Promise.all([
                        base44.asServiceRole.entities.BuildSchedule.filter({ id: entity_id, company_id: companyId }, '-created_date', 1),
                        base44.asServiceRole.entities.CalendarEvent.filter({ id: createdEvent.id, company_id: companyId }, '-created_date', 1),
                      ]);
                      if (linkedBuilds[0]?.calendar_event_id !== createdEvent.id || !linkedEvents[0]) throw new Error('The calendar link could not be verified');
                    } catch (calendarError) {
                      if (createdEvent?.id) await base44.asServiceRole.entities.CalendarEvent.delete(createdEvent.id).catch(() => {});
                      delete previousBuild.id;
                      delete previousBuild.company_id;
                      await base44.asServiceRole.entities.BuildSchedule.update(entity_id, previousBuild);
                      return jsonResponse({ success: false, result: { error: 'The missing calendar link could not be created. The build update was rolled back.' } });
                    }
                 }
               }
            } else if (entity_action === 'delete') {
              const owned = await base44.asServiceRole.entities[normalizedEntity].filter(
                { id: entity_id, company_id: companyId }, '-created_date', 1
              );
              if (!owned || owned.length === 0) {
                return jsonResponse({ success: false, result: { error: `Entity ${entity_id} not found in this company.` } });
              }
              await base44.asServiceRole.entities[normalizedEntity].delete(entity_id);
              entityResult = { deleted: true };
            } else if (entity_action === 'list') {
              entityResult = await base44.asServiceRole.entities[normalizedEntity].filter({ company_id: companyId }, '-created_date', 20);
            }
            await incrementAIUsage(base44, companyId);
            return jsonResponse({ success: true, result: entityResult });
          }

          if (toolName === 'find_subcontractors') {
            const { area, specialty } = args;
            const allSubs = await base44.asServiceRole.entities.Subcontractor.filter(
              { company_id: companyId }, '-created_date', 100
            );
            let matched = allSubs || [];
            if (area && area.trim()) {
              const kw = area.trim().toLowerCase();
              matched = matched.filter((sub: any) => {
                const searchable = [sub.base_address, sub.city, sub.state, sub.zip, sub.notes, sub.name].filter(Boolean).join(' ').toLowerCase();
                return searchable.includes(kw) || searchable.split(/[\s,]+/).some((w: string) => w === kw);
              });
            }
            if (specialty && specialty.trim()) {
              const spec = specialty.trim().toLowerCase();
              matched = matched.filter((sub: any) => {
                const specs = Array.isArray(sub.specialty) ? sub.specialty : [sub.specialty || ''];
                return specs.some((s: string) => (s || '').toLowerCase().includes(spec));
              });
            }
            matched.sort((a: any, b: any) =>
              Number(b.is_active !== false) - Number(a.is_active !== false)
              || (Number(b.rating) || 0) - (Number(a.rating) || 0)
              || (Number(b.total_jobs_completed) || 0) - (Number(a.total_jobs_completed) || 0)
            );
            const summary = matched.map((sub: any) => ({
              id: sub.id, name: sub.name, contact: sub.contact_person || '', phone: sub.phone || '',
              base_address: sub.base_address || '',
              rating: Number(sub.rating) || 0,
              rating_count: Number(sub.rating_count) || 0,
              service_radius_miles: Number(sub.service_radius_miles ?? sub.service_radius) || 0,
              specialty: sub.specialty || [], availability: sub.availability || '',
              hourly_rate: sub.hourly_rate || null, per_sq_rate: sub.per_sq_rate || null,
              total_jobs_completed: Number(sub.total_jobs_completed) || 0,
              is_active: sub.is_active !== false
            }));
            return jsonResponse({ success: true, result: {
              total_in_company: (allSubs || []).length,
              matched_count: matched.length,
              filter: { area, specialty },
              subcontractors: summary,
              recommended_teams: summary.filter((sub: any) => sub.is_active).slice(0, 3),
              recommendation_basis: 'Active crews are ranked by rating, then completed jobs. Compare work radius with the job location and check the build schedule before confirming availability.'
            } });
          }

          if (toolName === 'assign_inspection') {
            const inspectionData = {
              company_id: companyId,
              client_name: args.client_name,
              client_phone: args.client_phone || '',
              client_email: args.client_email || '',
              property_address: args.property_address,
              assigned_to_email: args.assigned_to_email,
              scheduled_date: args.inspection_date || null,
              inspection_time: args.inspection_time || null,
              damage_type: args.damage_type || '',
              special_instructions: args.special_instructions || '',
              status: 'assigned'
            };
            const inspection = await base44.asServiceRole.entities.InspectionJob.create(inspectionData);

            if (args.create_calendar_event && args.inspection_date && args.inspection_time) {
              const dateTime = new Date(`${args.inspection_date}T${args.inspection_time}:00`);
              const endTime = new Date(dateTime.getTime() + 60 * 60 * 1000);
              await base44.asServiceRole.entities.CalendarEvent.create({
                company_id: companyId,
                title: `Inspection: ${args.client_name}`,
                description: `Property: ${args.property_address}\nDamage: ${args.damage_type || 'N/A'}`,
                start_time: dateTime.toISOString(),
                end_time: endTime.toISOString(),
                event_type: 'inspection',
                assigned_to: args.assigned_to_email,
                location: args.property_address,
              });
            }

            if (args.create_lead) {
              await base44.asServiceRole.entities.Lead.create({
                company_id: companyId,
                name: args.client_name,
                phone: args.client_phone || '',
                email: args.client_email || '',
                street: args.property_address,
                status: 'new',
                source: 'ai',
                assigned_to: args.assigned_to_email,
                assigned_to_users: [args.assigned_to_email],
              });
            }

            await incrementAIUsage(base44, companyId);
            return jsonResponse({
              success: true,
              result: {
                inspection_id: inspection.id,
                message: `Inspection assigned to ${args.assigned_to_email} at ${args.property_address}`
              }
            });
          }

          return jsonResponse({ success: false, result: { error: `Unknown tool: ${toolName}` } });

        } catch (toolError: any) {
          console.error(`[lexiBridgeAPI] Tool error (${toolName}):`, toolError.message);
          return jsonResponse({ success: false, result: { error: toolError.message } });
        }
      }

      case 'saveVoiceSession': {
        if (!companyId) {
          return jsonResponse({ error: 'Missing companyId' }, 400);
        }

        const durationSec = data?.duration_seconds || 0;
        const transcript = data?.transcript || '';
        const toolCallsMade = data?.tool_calls_made || [];
        const sessionUser = data?.user_email || userEmail || 'Unknown';

        await base44.asServiceRole.entities.Communication.create({
          company_id: companyId,
          contact_name: sessionUser,
          contact_phone: '',
          communication_type: 'call',
          direction: 'inbound',
          subject: 'Lexi Native Voice Session',
          message: transcript || `Lexi native voice session. Duration: ${Math.round(durationSec)}s.${toolCallsMade.length > 0 ? ' Tools: ' + toolCallsMade.join(', ') : ''}`,
          status: 'completed',
          duration: Math.round(durationSec),
          ai_analyzed: true,
          ai_data: {
            mode: 'native_sts',
            tools_used: toolCallsMade,
            is_internal: true,
          }
        });

        return jsonResponse({ success: true, message: 'Voice session saved.' });
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error('[lexiBridgeAPI] Error:', error.message);
    return jsonResponse({ error: error.message }, 500);
  }
});
