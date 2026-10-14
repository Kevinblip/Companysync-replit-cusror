/**
 * Shared inbound-SMS / WhatsApp AI assistant.
 *
 * Replaces the old "static knowledge-base chatbot" that lived inline in
 * prod-server.cjs / vite-functions-plugin.js. Brings SMS up to feature
 * parity with the voice (Sarah) handler:
 *
 *   - Gemini 2.5 Flash (was 2.0)
 *   - Multi-turn function-calling loop
 *   - 8 CRM tools the assistant can call (read + write)
 *   - Caller lookup by phone via lookupCallerByCrmPhone
 *   - Conversation memory persisted to generic_entities (entity_type='SmsConversation'),
 *     so memory survives server restarts
 *   - Used by both prod-server.cjs (real Twilio inbound) and the test panel
 *     simulator in vite-functions-plugin.js, so what you test is what you ship.
 *
 * The single entry point is processInboundSms({ ... }).
 */

const { lookupCallerByCrmPhone } = require('./lookupCallerByCrmPhone.cjs');
const { resolveAssistantName } = require('./assistantName.cjs');
const { fetchWithRetry } = require('./fetchWithRetry.cjs');
const { notifyInspector } = require('./appointmentNotify.cjs');
const { getVerifiedLexiChannels } = require('./insuranceClaimWelcome.cjs');
const { canonicalPhone } = require('./insuranceClaimWelcome.cjs');
const {
  getCustomerPublicProgress,
  renderCustomerProgressReply,
} = require('./customerProjectProgress.cjs');

// ─── Tool definitions ────────────────────────────────────────────────────────

const SMS_CRM_TOOLS = [
  {
    name: 'lookup_my_account',
    description: "Look up the texter's record in the CRM using their phone number. Returns their name, recent project, recent estimate, and any open invoice. Call this PROACTIVELY whenever a returning contact asks anything personal (status of their job, claim, estimate, invoice, payment, callback, etc.) — do not wait to be asked.",
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_project_status',
    description: 'Get details for a specific project the texter owns: status, current milestone, start date, end date, assigned rep. Use after lookup_my_account to drill in.',
    parameters: { type: 'object', properties: { project_id: { type: 'string', description: 'Project ID returned from lookup_my_account.' } }, required: ['project_id'] }
  },
  {
    name: 'get_open_estimates',
    description: "List the texter's pending or sent estimates with amount and date. Use when they ask about a quote, estimate, proposal, or pricing they were sent.",
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_open_invoices',
    description: "List the texter's unpaid or partially paid invoices with amount due and due date. Use when they ask about a bill, payment, balance, or invoice.",
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'save_lead_details',
    description: 'Capture a NEW lead from an unknown texter who is interested in a service. Do not call this for existing customers/leads — use lookup_my_account first.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Texter name as they stated it.' },
        email: { type: 'string' },
        address: { type: 'string', description: 'Property address if mentioned.' },
        service_needed: { type: 'string', description: 'What service they want (roof repair, replacement, inspection, claim, etc.)' }
      },
      required: ['name']
    }
  },
  {
    name: 'schedule_callback_request',
    description: 'The texter wants a human to call them back. Creates a high-priority task for the assigned rep (or the company default) and notifies them. Use whenever they say "have someone call me", "can a person reach out", "I want to talk to a real person", etc.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Brief summary of what the texter wants to discuss.' },
        preferred_time: { type: 'string', description: 'When they want to be called, if they specified.' }
      },
      required: ['reason']
    }
  },
  {
    name: 'notify_rep',
    description: 'Send a notification to the assigned rep (or admins) about something the texter mentioned that needs human attention — complaint, urgent issue, schedule change, sensitive request. Different from schedule_callback_request: use this when the rep should be aware but does not necessarily need to call back.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What to tell the rep.' },
        urgency: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }
      },
      required: ['message']
    }
  },
  {
    name: 'request_appointment',
    description: "The texter wants to schedule an inspection, estimate visit, or other appointment. Collect their name (if unknown), the PROPERTY ADDRESS, and their preferred day/time FIRST — then call this. It sends the request to the team for confirmation; it does NOT book the calendar directly, so never tell the customer the time is booked — say the team will confirm shortly.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "Texter's name. Required for new contacts; omit if already known from CRM." },
        address: { type: 'string', description: 'Property address for the visit.' },
        preferred_time: { type: 'string', description: 'Their preferred day/time in their own words (e.g. "Tuesday afternoon", "tomorrow at 10am").' },
        service_needed: { type: 'string', description: 'What the visit is for (inspection, estimate, repair quote, etc.)' }
      },
      required: ['address']
    }
  },
  {
    name: 'get_build_schedule',
    description: "Look up the texter's build/installation schedule. Returns the scheduled build date, current stage, crew assignment, and property address. Use when they ask 'when does my roof start', 'when is my install', 'what's the schedule', 'when is the crew coming', 'what stage is my job in', etc. Call lookup_my_account first if customerId is not yet known.",
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_customer_tasks',
    description: "List open tasks linked to the texter's customer record. Returns task name, status, due date, and assigned rep. Use when they ask 'are there any open items on my project', 'what's left to do', 'any outstanding tasks', 'what needs to happen next', etc. Call lookup_my_account first if customerId is not yet known.",
    parameters: { type: 'object', properties: {}, required: [] }
  }
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtMoney(n) {
  const v = Number(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return 'unknown date';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (_) { return String(d); }
}

// ─── Tool execution ─────────────────────────────────────────────────────────

/**
 * Execute one tool call. `ctx` carries the live conversation context
 * so tools can resolve "the texter" without taking arguments.
 *
 * ctx = { pool, companyId, fromPhone, fromName, customerId, leadId, assignedRepEmail }
 *
 * Returns a JSON-serializable result the model will see.
 */
const CUSTOMER_LEXI_TOOLS = [
  {
    name: 'get_customer_public_progress',
    description: "Check only the caller's own project milestone and updates explicitly published for homeowners. Do not request IDs. If the customer has multiple projects, ask which property address before calling again.",
    parameters: {
      type: 'object',
      properties: {
        property_address: { type: 'string', description: 'Only when the caller has already provided the exact property address to select among their own projects.' },
      },
      required: [],
    },
  },
  SMS_CRM_TOOLS.find(tool => tool.name === 'schedule_callback_request'),
];
const CUSTOMER_LEXI_TOOL_NAMES = new Set(CUSTOMER_LEXI_TOOLS.map(tool => tool.name));

async function handleSmsToolCall(name, args, ctx) {
  const a = args || {};
  const { pool, companyId, fromPhone } = ctx;

  if (ctx.customerLexiMode && !CUSTOMER_LEXI_TOOL_NAMES.has(name)) {
    return { ok: false, reason: 'tool_not_allowed', instruction: 'This customer-facing assistant cannot access that information or perform that action.' };
  }

  try {
    switch (name) {
      case 'get_customer_public_progress': {
        const result = await getCustomerPublicProgress(pool, companyId, fromPhone, a.property_address || '');
        ctx.customerProgressResult = result;
        return result;
      }

      case 'lookup_my_account': {
        const lookup = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
        if (!lookup || !lookup.name) {
          return { found: false, message: 'No CRM record found for this phone number. Treat them as a new contact.' };
        }
        ctx.fromName = lookup.name;

        // Resolve customer_id / lead_id depending on which collection we matched
        let customerRow = null;
        let leadRow = null;
        if (lookup.source === 'customer') {
          ctx.customerId = lookup.record?.id || null;
          customerRow = lookup.record || null;
        } else if (lookup.source === 'lead' || lookup.source === 'crm_lead') {
          ctx.leadId = lookup.record?.id || null;
          leadRow = lookup.record || null;
        }

        // Try also to find a matching customer for a lead, or vice versa, by phone
        if (!customerRow) {
          const { rows } = await pool.query(
            `SELECT id, name, assigned_to, email FROM customers
             WHERE company_id = $1 AND (phone = $2 OR phone_2 = $2) LIMIT 1`,
            [companyId, fromPhone]
          );
          if (rows[0]) { customerRow = rows[0]; ctx.customerId = rows[0].id; }
        }
        if (!leadRow && !customerRow) {
          const { rows } = await pool.query(
            `SELECT id, name, assigned_to, email, status FROM leads
             WHERE company_id = $1 AND (phone = $2 OR phone_2 = $2) LIMIT 1`,
            [companyId, fromPhone]
          );
          if (rows[0]) { leadRow = rows[0]; ctx.leadId = rows[0].id; }
        }

        const assigned = customerRow?.assigned_to || leadRow?.assigned_to || null;
        if (assigned) ctx.assignedRepEmail = assigned;

        // Pull a tiny digest: most-recent project, estimate, open invoice
        const summary = { found: true, name: lookup.name, source: lookup.source };
        if (ctx.customerId) {
          summary.customer_id = ctx.customerId;

          const { rows: pr } = await pool.query(
            `SELECT id, title, status, current_milestone, start_date, end_date
             FROM projects WHERE company_id = $1 AND customer_id = $2
             ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1`,
            [companyId, ctx.customerId]
          );
          if (pr[0]) summary.most_recent_project = {
            id: pr[0].id, title: pr[0].title, status: pr[0].status,
            milestone: pr[0].current_milestone || null,
            starts: pr[0].start_date ? fmtDate(pr[0].start_date) : null
          };

          const { rows: es } = await pool.query(
            `SELECT id, estimate_number, status, total_amount, created_at
             FROM estimates WHERE company_id = $1 AND customer_id = $2
             ORDER BY created_at DESC NULLS LAST LIMIT 1`,
            [companyId, ctx.customerId]
          );
          if (es[0]) summary.most_recent_estimate = {
            id: es[0].id, number: es[0].estimate_number, status: es[0].status,
            total: fmtMoney(es[0].total_amount), sent: fmtDate(es[0].created_at)
          };

          const { rows: inv } = await pool.query(
            `SELECT id, invoice_number, status, total_amount, amount_paid, due_date
             FROM invoices WHERE company_id = $1 AND customer_id = $2
               AND COALESCE(status,'') NOT IN ('paid','void','cancelled')
             ORDER BY due_date ASC NULLS LAST LIMIT 1`,
            [companyId, ctx.customerId]
          );
          if (inv[0]) {
            const due = Number(inv[0].total_amount || 0) - Number(inv[0].amount_paid || 0);
            summary.next_open_invoice = {
              id: inv[0].id, number: inv[0].invoice_number, status: inv[0].status,
              amount_due: fmtMoney(due), due_date: fmtDate(inv[0].due_date)
            };
          }
        } else if (ctx.leadId) {
          summary.lead_id = ctx.leadId;
          summary.lead_status = leadRow?.status || null;
        }
        if (assigned) summary.assigned_rep_email = assigned;
        return summary;
      }

      case 'get_project_status': {
        if (!a.project_id) return { error: 'project_id is required.' };
        const { rows } = await pool.query(
          `SELECT id, title, status, current_milestone, start_date, end_date,
                  assigned_to, address, notes, total_value
             FROM projects WHERE company_id = $1 AND id = $2 LIMIT 1`,
          [companyId, a.project_id]
        );
        if (!rows[0]) return { error: 'Project not found.' };
        const p = rows[0];
        const result = {
          id: p.id, title: p.title, status: p.status,
          milestone: p.current_milestone || null,
          starts: p.start_date ? fmtDate(p.start_date) : null,
          ends: p.end_date ? fmtDate(p.end_date) : null,
          assigned_to: p.assigned_to || null,
          address: p.address || null,
          value: p.total_value ? fmtMoney(p.total_value) : null
        };
        // Also pull the linked BuildSchedule so one call answers "when does my build start"
        try {
          const custName = ctx.fromName || null;
          const custId = ctx.customerId || null;
          const { rows: bsRows } = await pool.query(
            `SELECT id, data FROM generic_entities
             WHERE entity_type = 'BuildSchedule' AND company_id = $1
               AND (data->>'project_id' = $2
                    OR (data->>'customer_id' = $3 AND $3 IS NOT NULL)
                    OR (data->>'customer_name' ILIKE $4 AND $4 IS NOT NULL))
             ORDER BY (data->>'build_date') DESC NULLS LAST LIMIT 1`,
            [companyId, a.project_id, custId, custName ? '%' + custName + '%' : null]
          );
          if (bsRows[0]) {
            const bd = bsRows[0].data || {};
            result.build_schedule = {
              build_date: bd.build_date ? fmtDate(bd.build_date) : null,
              stage: bd.status || bd.stage || null,
              crew: bd.assigned_crew || bd.crew_name || bd.assigned_to || null,
              address: bd.address || bd.customer_address || null,
              notes: bd.notes || null
            };
          }
        } catch (_) { /* build schedule is optional */ }
        return result;
      }

      case 'get_open_estimates': {
        if (!ctx.customerId) {
          // Try to resolve via phone in case the model called this without lookup first
          const lookup = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
          if (lookup?.source === 'customer') ctx.customerId = lookup.record?.id || null;
        }
        if (!ctx.customerId) return { count: 0, message: 'No customer record found for this phone number.' };
        const { rows } = await pool.query(
          `SELECT id, estimate_number, title, status, total_amount, created_at
             FROM estimates WHERE company_id = $1 AND customer_id = $2
               AND COALESCE(status,'') IN ('draft','sent','viewed','pending')
             ORDER BY created_at DESC NULLS LAST LIMIT 5`,
          [companyId, ctx.customerId]
        );
        if (rows.length === 0) return { count: 0, message: 'No open estimates.' };
        return {
          count: rows.length,
          estimates: rows.map(r => ({
            id: r.id, number: r.estimate_number, title: r.title || null,
            status: r.status, total: fmtMoney(r.total_amount), sent: fmtDate(r.created_at)
          }))
        };
      }

      case 'get_open_invoices': {
        if (!ctx.customerId) {
          const lookup = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
          if (lookup?.source === 'customer') ctx.customerId = lookup.record?.id || null;
        }
        if (!ctx.customerId) return { count: 0, message: 'No customer record found for this phone number.' };
        const { rows } = await pool.query(
          `SELECT id, invoice_number, status, total_amount, amount_paid, due_date
             FROM invoices WHERE company_id = $1 AND customer_id = $2
               AND COALESCE(status,'') NOT IN ('paid','void','cancelled')
             ORDER BY due_date ASC NULLS LAST LIMIT 5`,
          [companyId, ctx.customerId]
        );
        if (rows.length === 0) return { count: 0, message: 'No open invoices.' };
        return {
          count: rows.length,
          invoices: rows.map(r => {
            const due = Number(r.total_amount || 0) - Number(r.amount_paid || 0);
            return {
              id: r.id, number: r.invoice_number, status: r.status,
              total: fmtMoney(r.total_amount), amount_due: fmtMoney(due),
              due_date: fmtDate(r.due_date)
            };
          })
        };
      }

      case 'save_lead_details': {
        if (!a.name) return { error: 'name is required.' };
        // Don't double-create if this phone already maps to a lead/customer
        const existing = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
        if (existing?.name) {
          return { success: true, deduped: true, message: `Already in CRM as ${existing.name} — not creating duplicate.`, existing_source: existing.source };
        }
        const id = genId('lead_sms');
        const now = new Date().toISOString();
        await pool.query(
          `INSERT INTO leads (id, company_id, name, email, phone, address, status, source, service_needed, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,'New','sms_inbound',$7,$8,$9,$9)
           ON CONFLICT (id) DO NOTHING`,
          [id, companyId, a.name, a.email || null, fromPhone, a.address || null,
           a.service_needed || null,
           `Created from inbound text. ${a.service_needed ? 'Service: ' + a.service_needed : ''}`.trim(),
           now]
        );
        ctx.leadId = id;
        ctx.fromName = a.name;
        // Notify admins
        try {
          const notifId = genId('notif_lead');
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
             VALUES ($1,'Notification',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
            [notifId, companyId, JSON.stringify({
              id: notifId, type: 'new_lead_sms', is_read: false, priority: 'medium',
              title: `New lead from text: ${a.name}`,
              message: `${a.name} texted in${a.service_needed ? ' about ' + a.service_needed : ''}. Phone: ${fromPhone}.`,
              lead_id: id, contact_phone: fromPhone, created_at: now
            })]
          );
        } catch (_) {}
        return { success: true, lead_id: id, message: `Lead saved for ${a.name}.` };
      }

      case 'schedule_callback_request': {
        if (!a.reason) return { error: 'reason is required.' };
        const taskId = genId('task_sms');
        const now = new Date().toISOString();
        const title = `Callback requested: ${ctx.fromName || fromPhone}`;
        const description = `Texter ${ctx.fromName || fromPhone} (${fromPhone}) requested a callback.\nReason: ${a.reason}` +
          (a.preferred_time ? `\nPreferred time: ${a.preferred_time}` : '');
        // Try the proper tasks table first; fall back to generic_entities
        let saved = false;
        try {
          await pool.query(
            `INSERT INTO tasks (id, company_id, title, name, description, status, priority, assigned_to, customer_id, related_to, created_at, updated_at)
             VALUES ($1,$2,$3,$3,$4,'pending','high',$5,$6,$7,$8,$8)
             ON CONFLICT (id) DO NOTHING`,
            [taskId, companyId, title, description, ctx.assignedRepEmail || null,
             ctx.customerId || null,
             ctx.leadId ? `lead:${ctx.leadId}` : null, now]
          );
          saved = true;
        } catch (_) {
          try {
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
               VALUES ($1,'Task',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
              [taskId, companyId, JSON.stringify({
                id: taskId, title, description, status: 'pending', priority: 'high',
                assigned_to: ctx.assignedRepEmail || null,
                customer_id: ctx.customerId || null, lead_id: ctx.leadId || null,
                source: 'sms_callback_request', created_at: now
              })]
            );
            saved = true;
          } catch (_) {}
        }
        // Notification to the rep / admins
        try {
          const notifId = genId('notif_cb');
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
             VALUES ($1,'Notification',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
            [notifId, companyId, JSON.stringify({
              id: notifId, type: 'callback_request', is_read: false, priority: 'high',
              title,
              message: description,
              user_email: ctx.assignedRepEmail || null,
              caller_phone: fromPhone, task_id: taskId, created_at: now
            })]
          );
        } catch (_) {}
        return { success: saved, task_id: taskId, message: 'Callback request logged.' };
      }

      case 'request_appointment': {
        if (!a.address) return { error: 'address is required — ask the customer for the property address first.' };
        const now = new Date();
        const nowIso = now.toISOString();
        const custName = a.name || ctx.fromName || 'Customer';
        const cleanPhone = String(fromPhone || '').replace(/[^\d+]/g, '');

        // Parse the preferred time best-effort; default ~1 day out. The raw
        // wording is always preserved for the human approver.
        let startTime = new Date(now.getTime() + 86400000);
        if (a.preferred_time) {
          const parsed = new Date(a.preferred_time);
          if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) startTime = parsed;
        }
        const startIso = startTime.toISOString();
        const endIso = new Date(startTime.getTime() + 3600000).toISOString();
        const friendlyTime = a.preferred_time
          ? a.preferred_time
          : startTime.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

        // Find or create the Lead (dedicated leads table), keyed by phone —
        // mirrors the voice flow in prod-server.cjs so both paths look identical.
        let leadId = ctx.leadId || '';
        if (!leadId && !ctx.customerId && cleanPhone) {
          const phoneVariants = [cleanPhone, cleanPhone.replace(/^\+1/, ''), '+1' + cleanPhone.replace(/^\+1/, '')];
          const { rows: exRows } = await pool.query(
            `SELECT id, name FROM leads WHERE company_id = $1 AND phone = ANY($2) ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
            [companyId, phoneVariants]
          );
          if (exRows[0]) { leadId = exRows[0].id; if (!ctx.fromName) ctx.fromName = exRows[0].name; }
        }
        if (!leadId && !ctx.customerId) {
          leadId = genId('lead_sms');
          await pool.query(
            `INSERT INTO leads (id, company_id, name, phone, address, status, source, service_needed, notes, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,'New','sms_inbound',$6,$7,$8,$8) ON CONFLICT (id) DO NOTHING`,
            [leadId, companyId, custName, cleanPhone, a.address,
             a.service_needed || 'inspection',
             `Created from inbound text — requested an appointment (${friendlyTime}).`, nowIso]
          );
          ctx.leadId = leadId;
          if (a.name) ctx.fromName = a.name;
        }

        // Idempotency: one open approval per phone at a time. If the team
        // already has a pending request from this texter, don't stack another.
        const dup = await pool.query(
          `SELECT id FROM generic_entities
           WHERE entity_type = 'ActionItem' AND company_id = $1
             AND data->>'type' = 'pending_appointment_approval'
             AND data->>'status' IN ('pending','snoozed')
             AND data#>>'{proposed_appointment,contact_phone}' = $2
           LIMIT 1`,
          [companyId, cleanPhone]
        );
        if (dup.rows.length > 0) {
          return { success: true, deduped: true, message: 'A pending appointment request already exists for this customer — the team will confirm shortly. Do not create another; reassure the customer it is in progress.' };
        }

        // Create the pending-approval ActionItem (NO calendar event yet) —
        // same proposed_appointment shape as the voice flow so the Action
        // Items approval card works identically for both.
        const aiId = genId('action_sms');
        const title = `${a.service_needed ? a.service_needed.charAt(0).toUpperCase() + a.service_needed.slice(1) : 'Appointment'} - ${custName}`;
        const proposed = {
          start_time: startIso, end_time: endIso, address: a.address, title,
          description: a.preferred_time ? `Customer asked for: ${a.preferred_time}` : '',
          contact_phone: cleanPhone, contact_name: custName,
        };
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
           VALUES ($1,'ActionItem',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
          [aiId, companyId, JSON.stringify({
            id: aiId, company_id: companyId, type: 'pending_appointment_approval',
            title: `Confirm appointment: ${custName}`,
            description: `${title} requested via text for ${friendlyTime} at ${a.address}. Phone: ${cleanPhone || 'N/A'}. Approve to add it to the calendar.`,
            status: 'pending', priority: 'high',
            due_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
            related_lead_id: leadId || undefined,
            related_customer_id: ctx.customerId || undefined,
            proposed_appointment: proposed,
            source: 'sms_inbound', created_by: 'system', escalation_level: 0,
            created_at: nowIso,
          })]
        );

        // Bell notification so the team sees it right away.
        try {
          const notifId = genId('notif_appt');
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
             VALUES ($1,'Notification',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
            [notifId, companyId, JSON.stringify({
              id: notifId, type: 'appointment_request', is_read: false, priority: 'high',
              title: `📅 Appointment to confirm — ${custName}`,
              message: `${title} requested via text for ${friendlyTime} at ${a.address}. Open Action Items to approve.`,
              link_url: '/ActionItems', contact_phone: cleanPhone, created_at: nowIso,
            })]
          );
        } catch (_) {}

        return {
          success: true, action_item_id: aiId,
          message: `Appointment request logged for ${friendlyTime}. Tell the customer the team will text them shortly to confirm the exact time — do NOT say it is booked yet.`
        };
      }

      case 'get_build_schedule': {
        // Auto-resolve customer if not yet looked up.
        // lookupCallerByCrmPhone may return source='crm_lead' even for callers who also have a
        // customer record — fall back to a direct phone-based customer lookup in that case.
        if (!ctx.customerId) {
          const lookup = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
          if (lookup) { ctx.fromName = ctx.fromName || lookup.name; }
          if (lookup?.source === 'customer') {
            ctx.customerId = lookup.record?.id || null;
          } else {
            const digits = String(fromPhone || '').replace(/\D/g, '');
            const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
            if (last10) {
              const { rows: cr } = await pool.query(
                `SELECT id FROM customers WHERE company_id=$1 AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') LIKE '%'||$2 LIMIT 1`,
                [companyId, last10]
              );
              if (cr[0]) ctx.customerId = cr[0].id;
            }
          }
        }
        if (!ctx.customerId && !ctx.fromName) {
          return { found: false, message: 'No customer record found for this phone number. Try lookup_my_account first.' };
        }
        // Match on customer_id stored in build schedule data, or customer name
        const { rows: bsRows } = await pool.query(
          `SELECT id, data FROM generic_entities
           WHERE entity_type = 'BuildSchedule' AND company_id = $1
             AND (data->>'customer_id' = $2
                  OR data->>'customer_name' ILIKE $3)
           ORDER BY (data->>'build_date') DESC NULLS LAST LIMIT 3`,
          [companyId, ctx.customerId || '', ctx.fromName ? '%' + ctx.fromName + '%' : '']
        );
        if (bsRows.length === 0) {
          return { found: false, message: 'No build schedule found for this customer yet. The team may not have scheduled the build date.' };
        }
        return {
          found: true,
          count: bsRows.length,
          schedules: bsRows.map(r => {
            const bd = r.data || {};
            return {
              build_date: bd.build_date ? fmtDate(bd.build_date) : null,
              stage: bd.status || bd.stage || null,
              crew: bd.assigned_crew || bd.crew_name || bd.assigned_to || null,
              address: bd.address || bd.customer_address || null,
              notes: bd.notes || null,
              project_title: bd.project_title || bd.title || null
            };
          })
        };
      }

      case 'get_customer_tasks': {
        // Auto-resolve customer if not yet looked up.
        // Same phone-based customer fallback as get_build_schedule.
        if (!ctx.customerId) {
          const lookup = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
          if (lookup) { ctx.fromName = ctx.fromName || lookup.name; }
          if (lookup?.source === 'customer') {
            ctx.customerId = lookup.record?.id || null;
          } else {
            const digits = String(fromPhone || '').replace(/\D/g, '');
            const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
            if (last10) {
              const { rows: cr } = await pool.query(
                `SELECT id FROM customers WHERE company_id=$1 AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') LIKE '%'||$2 LIMIT 1`,
                [companyId, last10]
              );
              if (cr[0]) ctx.customerId = cr[0].id;
            }
          }
        }
        if (!ctx.customerId && !ctx.fromName) {
          return { count: 0, message: 'No customer record found for this phone number. Try lookup_my_account first.' };
        }
        // Query by customer_id; fall back to name match when customerId is absent
        let taskRows = [];
        if (ctx.customerId) {
          const { rows } = await pool.query(
            `SELECT id, title, name, status, priority, due_date, assigned_to
               FROM tasks
              WHERE company_id = $1 AND customer_id = $2
                AND COALESCE(status,'pending') NOT IN ('done','completed','cancelled')
              ORDER BY due_date ASC NULLS LAST, created_at DESC
              LIMIT 8`,
            [companyId, ctx.customerId]
          );
          taskRows = rows;
        }
        if (taskRows.length === 0 && ctx.fromName) {
          // Fallback: match by customer name in the data JSONB
          const { rows } = await pool.query(
            `SELECT id, title, name, status, priority, due_date, assigned_to
               FROM tasks
              WHERE company_id = $1
                AND (data->>'customer_name' ILIKE $2 OR related_to ILIKE $3)
                AND COALESCE(status,'pending') NOT IN ('done','completed','cancelled')
              ORDER BY due_date ASC NULLS LAST, created_at DESC
              LIMIT 8`,
            [companyId, '%' + ctx.fromName + '%', '%' + ctx.fromName + '%']
          );
          taskRows = rows;
        }
        if (taskRows.length === 0) {
          return { count: 0, message: 'No open tasks found for this customer.' };
        }
        return {
          count: taskRows.length,
          tasks: taskRows.map(t => ({
            title: t.title || t.name,
            status: t.status || 'pending',
            priority: t.priority || null,
            due_date: t.due_date ? fmtDate(t.due_date) : null,
            assigned_to: t.assigned_to || null
          }))
        };
      }

      case 'notify_rep': {
        if (!a.message) return { error: 'message is required.' };
        const urgency = a.urgency || 'normal';
        const notifId = genId('notif_rep');
        const now = new Date().toISOString();
        try {
          await pool.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
             VALUES ($1,'Notification',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING`,
            [notifId, companyId, JSON.stringify({
              id: notifId, type: 'sms_rep_notification', is_read: false,
              priority: (urgency === 'urgent' || urgency === 'high') ? 'high' : 'medium',
              title: `Note from ${ctx.fromName || 'a texter'} (${fromPhone})`,
              message: a.message,
              user_email: ctx.assignedRepEmail || null,
              caller_phone: fromPhone, urgency, created_at: now
            })]
          );
        } catch (_) {}
        return { success: true, message: 'Rep notified.' };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    console.warn(`[SMS Tool] ${name} error:`, e.message);
    return { error: 'Tool execution failed.', details: e.message };
  }
}

// ─── Conversation history persistence (generic_entities, type=SmsConversation) ──

const HISTORY_MAX_TURNS = 30;

function _convId(companyId, fromPhone, toPhone) {
  const from = String(fromPhone || '').replace(/\D/g, '').slice(-10);
  const to = String(toPhone || '').replace(/\D/g, '').slice(-10);
  // Segment by company line so the same customer texting two different reps
  // doesn't smush both threads together. Falls back to from-only when toPhone
  // is unknown (e.g. the test simulator).
  return to ? `smsconv_${companyId}_${from}_${to}` : `smsconv_${companyId}_${from}`;
}

async function loadHistory(pool, companyId, fromPhone, toPhone) {
  if (!pool) return [];
  try {
    const id = _convId(companyId, fromPhone, toPhone);
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = 'SmsConversation' LIMIT 1`,
      [id]
    );
    if (!rows[0]) return [];
    const turns = rows[0].data?.turns || [];
    return Array.isArray(turns) ? turns : [];
  } catch (e) {
    console.warn('[SMS Assistant] loadHistory failed:', e.message);
    return [];
  }
}

async function saveHistory(pool, companyId, fromPhone, toPhone, turns) {
  if (!pool) return;
  try {
    const id = _convId(companyId, fromPhone, toPhone);
    const trimmed = (turns || []).slice(-HISTORY_MAX_TURNS);
    const data = { id, company_id: companyId, phone: fromPhone, to_phone: toPhone || null, turns: trimmed, updated_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1,'SmsConversation',$2,$3,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_date = NOW()`,
      [id, companyId, JSON.stringify(data)]
    );
  } catch (e) {
    console.warn('[SMS Assistant] saveHistory failed:', e.message);
  }
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSmsSystemPrompt({ companyName, assistantName, customPrompt, knowledgeBase, companyDescription, callerContext, channel, customerLexiMode = false }) {
  const channelLabel = channel === 'whatsapp' ? 'WhatsApp message' : 'text message';
  if (customerLexiMode) {
    return `You are Lexi, ${companyName}'s AI project update assistant. You are not the company's COO or a human employee. Disclose that you are an AI assistant when introducing yourself.

You may answer only from a successful get_customer_public_progress result from this same turn. For each request about the caller's project, status, claim progress, or updates, use that tool first. Never use old conversation history, caller-provided details, or assumptions as proof.

The tool is restricted to a single uniquely phone-matched customer and returns only that customer's current milestone and project updates explicitly published for homeowners. Do not reveal or infer invoices, prices, insurance/adjuster details, private notes, staff tasks, schedules, crew information, unpublished photos, addresses, or another customer's records. Do not identify the customer from a name or an ID supplied in chat.

If the tool says a property must be selected, ask for the exact property address and use only that address to select among this caller's own projects. If the number or project cannot be matched safely, lookup fails, or no published update exists, say you cannot verify it and offer a human callback. Use schedule_callback_request only when they ask for a person or accept the offer.

Keep texts concise, warm, and in the customer's language. Never claim a callback, booking, or other action happened unless the corresponding tool confirms it.`;
  }

  let prompt = `You are ${assistantName}, the AI assistant for ${companyName}. You are responding to a ${channelLabel}.

YOUR JOB:
- Be warm but professional, concise, and human — like a polished front-desk receptionist at an established company. Courteous and composed, never slangy, goofy, or over-eager. Skip filler like "lol", "haha", "totally", and excessive exclamation points (one is plenty).
- Texts must be SHORT — usually 1–3 sentences. Avoid long paragraphs. No bullet lists unless the customer explicitly asked for one.
- Never invent information about the customer's account, projects, estimates, or invoices. If you don't know, call lookup_my_account first.
- If you can answer directly from the knowledge base below, do so.
- If the customer is asking about THEIR account, project, claim, estimate, invoice, or balance — call lookup_my_account FIRST, then answer using the result. Never guess.
- If you genuinely cannot help, call schedule_callback_request and tell them a real person will reach out.
- Never apologize repeatedly. Never go silent. Never say "I'm just an AI" or "I'm an AI assistant" or "I can't connect you" — act like a receptionist, not a chatbot.
- Keep your name as ${assistantName}. Do not introduce yourself as anything else.
- LANGUAGE: Always reply in the SAME language the customer is writing in. If they text in Spanish, respond entirely in Spanish; if they switch languages mid-conversation, switch with them. Match their language naturally — never announce that you're translating or switching.

WHEN SOMEONE ASKS TO SPEAK TO OR REACH A SPECIFIC PERSON (e.g. "can I speak to Kevin", "is Kevin available", "I need to talk to Sarah"):
- NEVER say "I can't connect you" or explain that you're an AI. A receptionist doesn't say that — they just take a message.
- Use their EXACT name from the request (never say "someone"). Example: "I'll have Kevin call you right back! What's this regarding?"
- Ask what the call is about (one short question), then call schedule_callback_request with their name and reason so that person gets notified immediately.
- If the customer pushes back or asks why they can't be connected directly, just say something like: "Kevin isn't available to text right now, but I'll make sure he gets your message and calls you back. What's the best number for him?" — don't over-explain.

TOOL USAGE RULES:
- Call lookup_my_account at the start of any conversation that touches the customer's account or history.
- Use get_open_estimates / get_open_invoices when they ask about quotes or bills specifically.
- Use get_build_schedule when they ask about their install date, build schedule, crew schedule, "when does my roof start", "when is the crew coming", or what stage their job is in.
- Use get_customer_tasks when they ask about open items, "what's left to do", "any outstanding tasks", or what still needs to happen on their project.
- Use save_lead_details ONLY for genuinely new contacts who introduce themselves.
- Use notify_rep for non-urgent things the rep should know.
- Use schedule_callback_request when they want to talk to a human or you can't resolve their need.
- Use request_appointment when they want to schedule an inspection, estimate visit, or appointment. Collect the property address and their preferred day/time FIRST (ask one short question at a time), then call it. After calling it, tell them the team will text shortly to confirm the exact time — NEVER say the appointment is booked or confirmed, because a human still has to approve it.

`;

  if (customPrompt) {
    // Replace template placeholders the user may have left from the default prompt
    let resolvedPrompt = customPrompt
      .replace(/\{brand\}/g, companyName)
      .replace(/\{name\}/g, assistantName)
      // Replace any hardcoded "Sarah" that refers to the AI persona (not a customer/staff name)
      // Safe heuristic: "You are Sarah", "I'm Sarah", "I am Sarah", "this is Sarah" → use assistantName
      .replace(/\bYou are Sarah\b/gi, `You are ${assistantName}`)
      .replace(/\bI'm Sarah\b/gi, `I'm ${assistantName}`)
      .replace(/\bI am Sarah\b/gi, `I am ${assistantName}`)
      .replace(/\bthis is Sarah\b/gi, `this is ${assistantName}`)
      .replace(/\bmy name is Sarah\b/gi, `my name is ${assistantName}`);
    prompt += `\nCOMPANY-SPECIFIC INSTRUCTIONS:\n${resolvedPrompt}\n`;
  }
  // Final override — ensures the AI never introduces itself by a stale name
  prompt += `\nREMINDER: Your name is ${assistantName}. Always refer to yourself as ${assistantName}.\n`;
  if (companyDescription) prompt += `\nABOUT ${companyName}:\n${companyDescription}\n`;
  if (knowledgeBase) prompt += `\nKNOWLEDGE BASE:\n${knowledgeBase}\n`;
  if (callerContext) prompt += `\n${callerContext}\n`;

  return prompt.trim();
}

// ─── Caller context block (run once before the conversation) ────────────────

async function buildCallerContext(pool, companyId, fromPhone) {
  if (!pool || !companyId || !fromPhone) return { context: '', name: null, customerId: null, leadId: null, assignedRepEmail: null };
  try {
    const lookup = await lookupCallerByCrmPhone(pool, companyId, fromPhone);
    if (!lookup || !lookup.name) {
      return { context: `CALLER CONTEXT: Phone ${fromPhone} is not in the CRM. Treat them as a new contact.`, name: null, customerId: null, leadId: null, assignedRepEmail: null };
    }
    let customerId = null, leadId = null, assignedRepEmail = null;
    if (lookup.source === 'customer') {
      customerId = lookup.record?.id || null;
      assignedRepEmail = lookup.record?.assigned_to || null;
    } else if (lookup.source === 'lead' || lookup.source === 'crm_lead') {
      leadId = lookup.record?.id || null;
      assignedRepEmail = lookup.record?.assigned_to || null;
    }
    const ctx = `CALLER CONTEXT: This texter is ${lookup.name} (${lookup.source === 'customer' ? 'existing customer' : 'existing lead'}) at ${fromPhone}. Address them by first name. Use lookup_my_account if they ask anything personal.`;
    return { context: ctx, name: lookup.name, customerId, leadId, assignedRepEmail };
  } catch (e) {
    return { context: '', name: null, customerId: null, leadId: null, assignedRepEmail: null };
  }
}

// ─── Gemini multi-turn function-calling loop ────────────────────────────────

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const MAX_TOOL_LOOP_ITERATIONS = 6;

async function runGeminiTurn({ apiKey, model, systemPrompt, history, userMessage, ctx }) {
  // Build the contents array: prior history + new user turn
  const contents = [];
  for (const turn of history) {
    if (turn.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: turn.text }] });
    } else if (turn.role === 'assistant' && turn.text) {
      contents.push({ role: 'model', parts: [{ text: turn.text }] });
    }
  }
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const baseBody = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    tools: [{ function_declarations: ctx.customerLexiMode ? CUSTOMER_LEXI_TOOLS : SMS_CRM_TOOLS }],
    generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
  };

  const toolCallsExecuted = [];

  for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
    const body = { ...baseBody, contents };
    const resp = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, { timeoutMs: 30000 });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Gemini ${resp.status}: ${errText.substring(0, 300)}`);
    }
    const data = await resp.json();
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts || [];

    // Collect any function calls in this turn
    const fnCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
    const textParts = parts.filter(p => typeof p.text === 'string' && p.text.trim()).map(p => p.text);

    if (fnCalls.length === 0) {
      const text = textParts.join(' ').trim();
      return { reply: text, toolCallsExecuted };
    }

    // Append model turn (with the function calls) to contents
    contents.push({ role: 'model', parts: parts.filter(p => p.functionCall || p.text) });

    // Execute each tool call and append a `function` role turn with results
    const responseParts = [];
    for (const fc of fnCalls) {
      const result = await handleSmsToolCall(fc.name, fc.args || {}, ctx);
      toolCallsExecuted.push({ name: fc.name, args: fc.args || {}, result });
      responseParts.push({ functionResponse: { name: fc.name, response: { name: fc.name, content: result } } });
    }
    contents.push({ role: 'function', parts: responseParts });
  }

  // Loop bailout — model kept calling tools without finalizing
  console.warn('[SMS Assistant] Tool loop hit MAX_TOOL_LOOP_ITERATIONS — model never produced a text reply. Tools called:', toolCallsExecuted.map(t => t.name).join(','));
  return { reply: "Got it — let me have someone follow up with you on that shortly.", toolCallsExecuted };
}

// ─── Appointment confirmation detection (deterministic, pre-AI) ─────────────

// Short, purely-affirmative replies only — anything longer or mixed goes to
// the AI as usual. Scoped further by requiring a calendar event that is
// actually awaiting this exact phone number's confirmation.
const CONFIRM_REPLY_RE = /^\s*(y|ya|yes+|yep|yeah|yea|yess?ir|confirm(ed)?|correct|sounds good|that works|works for me|see you (then|there)|ok(ay)?|sure|si|sí|👍|👌)[.!\s]*$/i;

/**
 * If this inbound text is a confirmation reply for an appointment that was
 * approved with "awaiting_customer_confirmation", handle it WITHOUT the AI:
 * mark the event confirmed, notify the assigned inspector, and return the
 * reply to send. Returns null when this message is not a confirmation.
 */
async function handleAppointmentConfirmationReply(pool, companyId, fromPhone, body) {
  try {
    const text = String(body || '').trim();
    if (!text || text.length > 40 || !CONFIRM_REPLY_RE.test(text)) return null;

    const digits = String(fromPhone || '').replace(/[^0-9]/g, '');
    const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
    if (!last10 || last10.length < 10) return null;

    const { rows } = await pool.query(
      `SELECT id, title, start_time, location, assigned_to, data
         FROM calendar_events
        WHERE company_id = $1
          AND COALESCE(status,'scheduled') NOT IN ('cancelled','completed')
          AND data->>'awaiting_customer_confirmation' = 'true'
          AND regexp_replace(COALESCE(data->>'contact_phone',''), '[^0-9]', '', 'g') LIKE '%' || $2
          AND start_time > NOW()
        ORDER BY start_time ASC
        LIMIT 1`,
      [companyId, last10]
    );
    if (!rows[0]) return null;
    const ev = rows[0];
    const evData = (typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data) || {};

    // Flip the flag first (idempotency: a second "yes" won't re-notify).
    await pool.query(
      `UPDATE calendar_events
          SET data = COALESCE(data,'{}'::jsonb) || $2::jsonb, updated_at = NOW()
        WHERE id = $1`,
      [ev.id, JSON.stringify({
        awaiting_customer_confirmation: false,
        customer_confirmed: true,
        customer_confirmed_at: new Date().toISOString(),
      })]
    );

    let startLabel = '';
    try {
      startLabel = new Date(ev.start_time).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZone: evData.timezone || 'America/New_York',
      });
    } catch (_) { startLabel = String(ev.start_time); }

    // Tell the inspector the customer confirmed (bell + cell SMS, best-effort).
    if (ev.assigned_to) {
      await notifyInspector({
        pool, companyId,
        inspectorEmail: ev.assigned_to,
        kind: 'customer_confirmed',
        customerName: evData.contact_name || null,
        customerPhone: evData.contact_phone || fromPhone,
        address: ev.location || '',
        startTimeLabel: startLabel,
      });
    }

    const firstName = (evData.contact_name || '').split(' ')[0];
    const reply = `You're all set${firstName ? ', ' + firstName : ''}! We'll see you ${startLabel}. Reply here if anything changes.`;
    return { reply, eventId: ev.id };
  } catch (e) {
    console.warn('[SMS Assistant] confirmation-reply check failed:', e.message);
    return null;
  }
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Process one inbound SMS / WhatsApp message and return what the assistant
 * should reply (or null/empty string if no reply should be sent).
 *
 * Required: { pool, companyId, fromPhone, body, apiKey }
 * Optional: { toPhone, channel, settings, model, persistHistory, historyOverride }
 *
 *   settings = {
 *     assistant_name, brand_short_name,
 *     custom_system_prompt, knowledge_base, company_description,
 *     sms_auto_reply  // if false, returns { reply: null, skipped: true }
 *   }
 *
 *   persistHistory (default true): when false, history is taken from
 *     historyOverride and never written back. Used by the test simulator.
 *
 *   historyOverride: array of { role: 'user'|'assistant', text } turns to use
 *     instead of loading from the DB. Used by the test simulator.
 */
async function processInboundSms(opts) {
  const {
    pool, companyId, fromPhone, body,
    toPhone = null, channel = 'sms',
    settings = {}, apiKey,
    model = DEFAULT_GEMINI_MODEL,
    persistHistory = true,
    historyOverride = null
  } = opts;

  if (!apiKey) throw new Error('Gemini apiKey is required');
  if (!body || !body.trim()) return { reply: null, skipped: true, reason: 'empty_body' };
  if (settings.sms_auto_reply === false) return { reply: null, skipped: true, reason: 'auto_reply_disabled' };

  const verifiedLexiChannels = channel === 'sms'
    ? await getVerifiedLexiChannels(pool, companyId)
    : { phone: '', sms: false };
  const customerLexiMode = verifiedLexiChannels.sms
    && canonicalPhone(toPhone) === verifiedLexiChannels.phone;

  // Deterministic pre-AI check: a short "yes"/"confirmed" reply for an
  // appointment awaiting this phone's confirmation is handled without Gemini —
  // it marks the event confirmed and notifies the assigned inspector.
  if (pool && companyId && !customerLexiMode) {
    const confirmed = await handleAppointmentConfirmationReply(pool, companyId, fromPhone, body);
    if (confirmed) {
      if (persistHistory) {
        const priorHistory = Array.isArray(historyOverride)
          ? historyOverride.slice()
          : await loadHistory(pool, companyId, fromPhone, toPhone);
        await saveHistory(pool, companyId, fromPhone, toPhone, [...priorHistory,
          { role: 'user', text: body, at: new Date().toISOString() },
          { role: 'assistant', text: confirmed.reply, at: new Date().toISOString(), tools: ['appointment_confirmation'] }
        ]);
      }
      return { reply: confirmed.reply, skipped: false, toolCalls: [{ name: 'appointment_confirmation', args: {}, result: { eventId: confirmed.eventId } }], callerName: null, customerId: null, leadId: null, model: 'deterministic' };
    }
  }

  const assistantName = customerLexiMode
    ? 'Lexi'
    : resolveAssistantName(settings.intent_templates?._assistant_display_name, settings.assistant_name);
  const companyName = (settings.brand_short_name || settings.company_name || 'our team').trim() || 'our team';
  const historyToPhone = customerLexiMode ? `customer-lexi:${toPhone || ''}` : toPhone;

  // Load or stub history
  const history = Array.isArray(historyOverride)
    ? historyOverride.slice()
    : (persistHistory ? await loadHistory(pool, companyId, fromPhone, historyToPhone) : []);

  // Build caller context once per turn (inexpensive — uses LRU cache internally)
  const callerCtx = customerLexiMode
    ? { name: '', customerId: null, leadId: null, assignedRepEmail: null, context: '' }
    : await buildCallerContext(pool, companyId, fromPhone);

  const systemPrompt = buildSmsSystemPrompt({
    companyName, assistantName,
    customPrompt: settings.custom_system_prompt || settings.customSystemPrompt || '',
    knowledgeBase: settings.knowledge_base || settings.knowledgeBase || '',
    companyDescription: settings.company_description || settings.companyDescription || '',
    callerContext: callerCtx.context,
    channel,
    customerLexiMode,
  });

  const ctx = {
    pool, companyId, fromPhone, toPhone,
    fromName: callerCtx.name,
    customerId: callerCtx.customerId,
    leadId: callerCtx.leadId,
    assignedRepEmail: callerCtx.assignedRepEmail,
    customerLexiMode,
    customerProgressResult: null
  };

  const { reply: modelReply, toolCallsExecuted } = await runGeminiTurn({
    apiKey, model, systemPrompt, history, userMessage: body, ctx
  });
  let reply = modelReply;
  if (customerLexiMode && ctx.customerProgressResult) {
    reply = renderCustomerProgressReply(ctx.customerProgressResult);
  } else if (customerLexiMode && /\b(progress|status|milestone|updates?|project|job|claim|roof|install|work|going on)\b/i.test(body)) {
    reply = 'I could not safely verify the project information for this number. Please contact the office team so they can help.';
  }

  // Persist history (append user + assistant turns)
  if (persistHistory && reply) {
    const newHistory = [...history,
      { role: 'user', text: body, at: new Date().toISOString() },
      { role: 'assistant', text: reply, at: new Date().toISOString(), tools: toolCallsExecuted.map(t => t.name) }
    ];
    await saveHistory(pool, companyId, fromPhone, historyToPhone, newHistory);
  }

  return {
    reply: reply || null,
    skipped: false,
    toolCalls: toolCallsExecuted,
    callerName: ctx.fromName || null,
    customerId: ctx.customerId || null,
    leadId: ctx.leadId || null,
    model
  };
}

module.exports = {
  processInboundSms,
  handleSmsToolCall,
  buildSmsSystemPrompt,
  buildCallerContext,
  handleAppointmentConfirmationReply,
  loadHistory,
  saveHistory,
  SMS_CRM_TOOLS,
  CUSTOMER_LEXI_TOOLS,
  DEFAULT_GEMINI_MODEL,
};
