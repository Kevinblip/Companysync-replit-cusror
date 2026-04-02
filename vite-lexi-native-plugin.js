import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import crypto from 'crypto';
const { Pool } = pg;

function generateLexiId(prefix = 'lexi') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

const VALID_GEMINI_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];

const LEXI_PROTECTED_ENTITIES = ['Company', 'SubscriptionUsage', 'SubscriptionPlan', 'CompanySettings', 'LexiVoiceSession'];
const LEXI_PAYMENT_BLOCKED_ACTIONS = ['create', 'update', 'delete'];

const LEXI_CRM_TOOLS = [
  {
    name: "get_crm_data",
    description: "Get counts and details from CRM - customers, leads, estimates, invoices, tasks, projects, payments, staff, calendar events.",
    parameters: {
      type: "object",
      properties: {
        data_type: {
          type: "string",
          enum: ["customers", "leads", "estimates", "invoices", "tasks", "projects", "payments", "staff", "calendar_events"],
          description: "What type of data to retrieve"
        }
      },
      required: ["data_type"]
    }
  },
  {
    name: "get_calendar_events",
    description: "Get calendar events for a specific date range. Use this to check schedule and availability.",
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
        end_date: { type: "string", description: "End date (YYYY-MM-DD)" }
      },
      required: ["start_date"]
    }
  },
  {
    name: "create_calendar_event",
    description: "Create a calendar event with optional reminders. Extract title, date/time, and details. Use ISO format with timezone.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start_time: { type: "string", description: "ISO datetime with timezone" },
        end_time: { type: "string", description: "ISO datetime (optional, defaults to 1 hour after start)" },
        location: { type: "string", description: "Meeting location" },
        description: { type: "string", description: "Additional details" },
        event_type: { type: "string", enum: ["meeting", "appointment", "call", "inspection", "other"] },
        attendees: { type: "string", description: "Names of people attending" },
        email_reminder_minutes: { type: "integer", description: "Send email reminder X minutes before event (e.g. 60 for 1 hour, 120 for 2 hours)" },
        sms_reminder_minutes: { type: "integer", description: "Send SMS reminder X minutes before event" },
        browser_reminder_minutes: { type: "integer", description: "Send browser notification X minutes before event" }
      },
      required: ["title", "start_time"]
    }
  },
  {
    name: "create_task",
    description: "Create a new task in the CRM.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        assigned_to: { type: "string" },
        due_date: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] }
      },
      required: ["name"]
    }
  },
  {
    name: "create_lead",
    description: "Create a new lead in the CRM. Extract name, phone, email, and address.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        street: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
        notes: { type: "string" },
        source: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "create_customer",
    description: "Create a new customer record in the CRM.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        street: { type: "string" },
        city: { type: "string" },
        state: { type: "string" },
        zip: { type: "string" },
        notes: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "send_email",
    description: "Compose an email to send to a customer or lead. Will ask for confirmation before sending.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        message: { type: "string" },
        contact_name: { type: "string" }
      },
      required: ["to", "subject", "message"]
    }
  },
  {
    name: "send_sms",
    description: "Compose a text message to send. Will ask for confirmation before sending.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        message: { type: "string" },
        contact_name: { type: "string" }
      },
      required: ["to", "message"]
    }
  },
  {
    name: "manage_entity",
    description: "General purpose tool to Create, Update, or List ANY entity in the CRM (Leads, Customers, Projects, Notes, Tasks, etc.). Deletion is not allowed.",
    parameters: {
      type: "object",
      properties: {
        entity_action: { type: "string", enum: ["create", "update", "list"], description: "Action to perform" },
        entity_name: { type: "string", description: "Name of the entity (e.g., Lead, Customer, Project, Note, Task)" },
        entity_data: { type: "object", description: "Data fields for create/update" },
        entity_id: { type: "string", description: "ID of the entity (required for update)" }
      },
      required: ["entity_action", "entity_name"]
    }
  },
  {
    name: "assign_inspection",
    description: "Create and assign a CrewCam inspection job to a staff member.",
    parameters: {
      type: "object",
      properties: {
        client_name: { type: "string" },
        client_phone: { type: "string" },
        client_email: { type: "string" },
        property_address: { type: "string" },
        assigned_to_email: { type: "string", description: "Email of staff member to assign to" },
        inspection_date: { type: "string", description: "Scheduled date (YYYY-MM-DD)" },
        inspection_time: { type: "string", description: "Scheduled time (HH:MM in 24hr)" },
        damage_type: { type: "string" },
        special_instructions: { type: "string" },
        create_calendar_event: { type: "boolean" },
        create_lead: { type: "boolean" }
      },
      required: ["client_name", "property_address", "assigned_to_email"]
    }
  },
  {
    name: "get_storm_alerts",
    description: "Get recent storm alerts and weather events in the company's service area. Use to check for hail, wind, tornado, or other storm activity.",
    parameters: {
      type: "object",
      properties: {
        days_back: { type: "integer", description: "How many days to look back (default 30)" },
        event_types: { type: "string", description: "Comma-separated event types to filter (e.g. 'tornado,hail,thunderstorm,high_wind,winter_storm')" },
        active_only: { type: "boolean", description: "Only show active/ongoing alerts" },
        area_filter: { type: "string", description: "Filter by area name, county, or city" }
      }
    }
  },
  {
    name: "add_staff_member",
    description: "Add a new staff member / team member to the company.",
    parameters: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Full name of the staff member" },
        email: { type: "string", description: "Email address (used for login)" },
        phone: { type: "string", description: "Phone number" },
        role: { type: "string", description: "Role/position (e.g. Sales Rep, Inspector, Project Manager)" },
        is_administrator: { type: "boolean", description: "Whether they have admin access (default false)" }
      },
      required: ["full_name", "email"]
    }
  },
  {
    name: "find_subcontractors",
    description: "Search for SUBCONTRACTORS (external vendors/crews, NOT staff) by service area/territory and/or specialty. Use IMMEDIATELY when user asks 'what subs are in [area]', 'find subcontractors near [city/state]', 'who covers [territory]', 'any roofers in [area]', 'list subcontractors', etc. NEVER confuse subcontractors with staff members.",
    parameters: {
      type: "object",
      properties: {
        area: { type: "string", description: "City, state, zip, or territory name to search within (e.g. 'Ohio', 'Cleveland', '44146'). Leave empty to list all." },
        specialty: { type: "string", description: "Optional trade specialty to filter by (e.g. 'Roofing', 'Siding', 'Gutters')" }
      }
    }
  }
];

function buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage, recentSessionContext) {
  const now = new Date();
  const currentDateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone });
  const currentTimeString = now.toLocaleString('en-US', { timeZone: timezone });
  const todayISO = now.toISOString().split('T')[0];
  const isSpanish = preferredLanguage === 'es';

  let staffContext = '';
  if (staffList && staffList.length > 0) {
    staffContext = `\nStaff Members: ${staffList.map(s => `${s.name} (${s.email}${s.role ? ', ' + s.role : ''})`).join(', ')}`;
  }

  const languageInstruction = isSpanish
    ? `\nLANGUAGE: You MUST respond exclusively in Spanish (Español) at all times. Greet in Spanish. All responses must be in Spanish unless the user explicitly switches to English.`
    : '';

  return `You are Lexi, a friendly and professional AI assistant for ${companyName}. You are speaking directly to ${userName} via native voice.${languageInstruction}

CRITICAL: Do NOT output any internal thinking, reasoning, or planning text. Do NOT use markdown formatting. Only speak naturally. Every text output you produce will be spoken aloud.

USER CONTEXT:
- Speaking with: ${userName}
- Company: ${companyName}${staffContext}
${customerList ? `\nCustomers: ${customerList}` : ''}
${knowledgeBase ? `\nKnowledge Base:\n${knowledgeBase}` : ''}

COMMUNICATION STYLE:
- Be warm, conversational, and concise
- Summarize data instead of reading raw numbers
- Use natural phrases like "10 AM" instead of "10:00:00"
- Keep responses short for voice - under 30 words when possible
- Only provide full details when specifically asked
- NEVER say the word "CompanySync" aloud — it is internal-only and must never be spoken

SECURITY:
1. You work EXCLUSIVELY for ${companyName}
2. Never reference other companies or external platforms by name
3. Never make up data - say you don't know if unsure

CAPABILITIES:
- Full CRM access: create, update, and list Leads, Customers, Estimates, Invoices, Tasks, Projects, and Notes
- You CANNOT delete any records — if asked to delete, tell the user deletions must be done directly in the CRM by a human
- Calendar events with reminders: create events and set email/SMS/browser reminders (e.g. 60 minutes = 1 hour before, 120 minutes = 2 hours before)
- Add staff members to the team using add_staff_member tool
- CrewCam inspections: assign inspections to staff via assign_inspection tool
- Storm alerts: query recent weather events (hail, tornado, wind, etc.) in the service area via get_storm_alerts tool
- Email and SMS composition (requires confirmation before sending)
- Subcontractors: search external vendors/crews by territory or specialty using find_subcontractors tool
- Use tools immediately when asked. Never guess or give fake confirmations.

TOOL RULES — CRITICAL:
- Subcontractor questions ("what subs are in Ohio", "who covers Cleveland", "any crews near [area]", "list subcontractors"): ALWAYS call find_subcontractors immediately. Subcontractors are EXTERNAL VENDORS, not staff.
- Staff/team questions: use get_crm_data with data_type='staff' or add_staff_member
- Do NOT say "I cannot access" or "I don't have the ability" — you have full tool access. Use the tools.

RESTRICTIONS:
- You CANNOT delete ANY records under any circumstances — if asked, always say "I can't delete that, you'll need to do it directly in the CRM"
- You CANNOT add, delete, or modify Payments — payment operations must be done by a human
- You CANNOT modify Company settings, subscription plans, or subscription usage data
- For staff profiles and invoices: you can update their status only, never remove them

DATE CONTEXT:
- Today: ${currentDateString}
- Current Time: ${currentTimeString}
- Timezone: ${timezone}
- Today ISO: ${todayISO}

Start by greeting ${userName} warmly.${recentSessionContext ? `\n\nRECENT CONVERSATION CONTEXT (from your last session with ${userName} — use to maintain continuity, don't re-introduce yourself):\n${recentSessionContext}` : ''}`;
}

async function getLocalSettings(companyId, userEmail) {
  const db = getPool();
  let companyName = 'CompanySync';
  let timezone = 'America/New_York';
  let knowledgeBase = '';
  let customerList = '';
  let staffList = [];
  let voiceName = 'Kore';
  let preferredLanguage = 'en';

  try {
    const compRes = await db.query('SELECT name, data, settings, preferred_language FROM companies WHERE id = $1', [companyId]);
    if (compRes.rows.length > 0) {
      companyName = compRes.rows[0].name || companyName;
      if (compRes.rows[0].preferred_language) {
        preferredLanguage = compRes.rows[0].preferred_language;
      }
      const rawData = compRes.rows[0].data;
      const rawSettings = compRes.rows[0].settings;
      const parsed = rawData ? (typeof rawData === 'string' ? JSON.parse(rawData) : rawData) : {};
      const parsedSettings = rawSettings ? (typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings) : {};
      if (parsed.timezone || parsedSettings.timezone) timezone = parsed.timezone || parsedSettings.timezone;
      if (parsed.lexi_voice_id) voiceName = parsed.lexi_voice_id;
      else if (parsedSettings.lexi_voice_id) voiceName = parsedSettings.lexi_voice_id;
      else if (parsed.lexi_voice) voiceName = parsed.lexi_voice;
      else if (parsedSettings.lexi_voice) voiceName = parsedSettings.lexi_voice;
      else if (parsed.voice_id) voiceName = parsed.voice_id;
      else if (parsedSettings.voice_id) voiceName = parsedSettings.voice_id;
    }
  } catch (e) {
    console.warn('[Lexi Native] Could not load company settings:', e.message);
  }

  try {
    const kbRes = await db.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'KnowledgeBase' AND company_id = $1 ORDER BY created_date DESC LIMIT 20`,
      [companyId]
    );
    if (kbRes.rows.length > 0) {
      knowledgeBase = kbRes.rows.map(r => {
        const d = r.data;
        return `${d.title || ''}: ${d.content || d.answer || ''}`;
      }).join('\n');
    }
  } catch (e) {
    console.warn('[Lexi Native] Could not load knowledge base:', e.message);
  }

  try {
    const custRes = await db.query('SELECT name, email, phone FROM customers WHERE company_id = $1 LIMIT 50', [companyId]);
    if (custRes.rows.length > 0) {
      customerList = custRes.rows.map(c => `${c.name}${c.phone ? ' (' + c.phone + ')' : ''}`).join(', ');
    }
  } catch (e) {}

  try {
    const staffRes = await db.query('SELECT full_name, user_email, role_name FROM staff_profiles WHERE company_id = $1', [companyId]);
    staffList = staffRes.rows.map(s => ({ name: s.full_name, email: s.user_email, role: s.role_name }));
  } catch (e) {}

  return { companyName, timezone, knowledgeBase, customerList, staffList, voiceName, preferredLanguage };
}

async function handleLocalToolCall(name, args, companyId, userEmail) {
  const db = getPool();
  console.log(`[Lexi Native] Executing local tool: ${name}`, JSON.stringify(args).substring(0, 200));

  try {
    if (name === 'get_crm_data') {
      const tableMap = {
        customers: 'customers', leads: 'leads', estimates: 'estimates',
        invoices: 'invoices', tasks: 'tasks', projects: 'projects',
        payments: 'payments', staff: 'staff_profiles', calendar_events: 'calendar_events'
      };
      const table = tableMap[args.data_type];
      if (!table) return { error: `Unknown data type: ${args.data_type}` };

      const countRes = await db.query(`SELECT COUNT(*) as count FROM ${table} WHERE company_id = $1`, [companyId]);
      const sampleRes = await db.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 10`, [companyId]);
      const count = parseInt(countRes.rows[0].count);

      if (args.data_type === 'invoices') {
        const totalRevenue = sampleRes.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
        return { count, total_revenue: totalRevenue, sample: sampleRes.rows.slice(0, 5).map(r => ({ number: r.invoice_number, amount: r.amount, status: r.status })) };
      } else if (args.data_type === 'customers') {
        return { count, sample: sampleRes.rows.map(r => ({ name: r.name, email: r.email, phone: r.phone })) };
      } else if (args.data_type === 'leads') {
        return { count, sample: sampleRes.rows.map(r => ({ name: r.name, status: r.status, phone: r.phone })) };
      } else if (args.data_type === 'staff') {
        return { count, staff: sampleRes.rows.map(r => ({ name: r.full_name, email: r.user_email, role: r.role_name })) };
      }
      return { count };

    } else if (name === 'get_calendar_events') {
      const startDate = args.start_date;
      const endDate = args.end_date || startDate;
      const evRes = await db.query(
        `SELECT * FROM calendar_events WHERE company_id = $1 AND start_time >= $2 AND start_time < ($3::date + interval '1 day') ORDER BY start_time`,
        [companyId, startDate, endDate]
      );
      return { events: evRes.rows.map(e => ({ title: e.title, start: e.start_time, end: e.end_time, location: e.location, type: e.event_type })), count: evRes.rows.length };

    } else if (name === 'create_calendar_event') {
      let endTime = args.end_time;
      if (!endTime && args.start_time) {
        const d = new Date(args.start_time);
        d.setHours(d.getHours() + 1);
        endTime = d.toISOString();
      }
      const parseReminder = (val) => { const n = parseInt(val); return (!isNaN(n) && n > 0 && n <= 10080) ? n : null; };
      const emailReminder = parseReminder(args.email_reminder_minutes);
      const smsReminder = parseReminder(args.sms_reminder_minutes);
      const browserReminder = parseReminder(args.browser_reminder_minutes);
      const calId = generateLexiId('cal');
      const evRes = await db.query(
        `INSERT INTO calendar_events (id, title, start_time, end_time, location, description, event_type, company_id, assigned_to, created_by, created_at,
         send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW(),
         $10, $11, $12, $13, $14, $15) RETURNING id`,
        [calId, args.title, args.start_time, endTime, args.location || '', args.description || '', args.event_type || 'meeting', companyId, userEmail,
         emailReminder != null, emailReminder, smsReminder != null, smsReminder, browserReminder != null, browserReminder]
      );
      const reminders = [];
      if (emailReminder) reminders.push(`email ${emailReminder} min before`);
      if (smsReminder) reminders.push(`SMS ${smsReminder} min before`);
      if (browserReminder) reminders.push(`browser ${browserReminder} min before`);
      const reminderMsg = reminders.length > 0 ? ` with reminders: ${reminders.join(', ')}` : '';
      return { success: true, event_id: evRes.rows[0].id, message: `Event "${args.title}" created${reminderMsg}` };

    } else if (name === 'create_task') {
      const taskRes = await db.query(
        `INSERT INTO tasks (name, description, due_date, priority, status, company_id, assigned_to, created_at)
         VALUES ($1, $2, $3, $4, 'not_started', $5, $6, NOW()) RETURNING id`,
        [args.name, args.description || '', args.due_date || null, args.priority || 'medium', companyId, userEmail]
      );
      return { success: true, task_id: taskRes.rows[0].id, message: `Task "${args.name}" created` };

    } else if (name === 'create_lead') {
      const leadRes = await db.query(
        `INSERT INTO leads (name, email, phone, street, city, state, zip, notes, status, lead_source, company_id, assigned_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 'Lexi AI Voice', $9, $10, NOW()) RETURNING id`,
        [args.name, args.email || '', args.phone || '', args.street || '', args.city || '', args.state || '', args.zip || '', args.notes || '', companyId, userEmail]
      );
      return { success: true, lead_id: leadRes.rows[0].id, message: `Lead "${args.name}" created` };

    } else if (name === 'create_customer') {
      const custRes = await db.query(
        `INSERT INTO customers (name, email, phone, street, city, state, zip, company_id, assigned_to, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id`,
        [args.name, args.email || '', args.phone || '', args.street || '', args.city || '', args.state || '', args.zip || '', companyId, userEmail]
      );
      return { success: true, customer_id: custRes.rows[0].id, message: `Customer "${args.name}" created` };

    } else if (name === 'send_email') {
      return { requires_confirmation: true, type: 'email', to: args.to, subject: args.subject, message: args.message, status: 'Awaiting confirmation from user' };

    } else if (name === 'send_sms') {
      return { requires_confirmation: true, type: 'sms', to: args.to, message: args.message, status: 'Awaiting confirmation from user' };

    } else if (name === 'manage_entity') {
      const action = (args.entity_action || '').toLowerCase();
      const entityNameRaw = args.entity_name || '';
      const entityNameMap = {
        'lead': 'Lead', 'leads': 'Lead',
        'customer': 'Customer', 'customers': 'Customer',
        'project': 'Project', 'projects': 'Project',
        'task': 'Task', 'tasks': 'Task',
        'estimate': 'Estimate', 'estimates': 'Estimate',
        'invoice': 'Invoice', 'invoices': 'Invoice',
        'payment': 'Payment', 'payments': 'Payment',
        'calendarevent': 'CalendarEvent', 'calendar_event': 'CalendarEvent', 'calendar': 'CalendarEvent',
        'staffprofile': 'StaffProfile', 'staff': 'StaffProfile', 'staff_profile': 'StaffProfile',
        'note': 'Note', 'notes': 'Note',
      };
      const entityName = entityNameMap[entityNameRaw.toLowerCase()] || entityNameRaw;
      const entityData = args.entity_data || {};
      const entityId = args.entity_id;

      if (LEXI_PROTECTED_ENTITIES.map(e => e.toLowerCase()).includes(entityName.toLowerCase())) {
        return { error: `Cannot ${action} ${entityName} — this is a protected entity type. Only a super admin can manage these.` };
      }
      if (entityName.toLowerCase() === 'payment' && LEXI_PAYMENT_BLOCKED_ACTIONS.includes(action)) {
        return { error: `Cannot ${action} Payments — payment operations must be done by a human for security reasons.` };
      }

      const entityTableMap = {
        'Lead': 'leads', 'Customer': 'customers', 'Project': 'projects',
        'Task': 'tasks', 'Estimate': 'estimates',
        'Invoice': 'invoices', 'Payment': 'payments',
        'CalendarEvent': 'calendar_events',
        'StaffProfile': 'staff_profiles',
      };
      const table = entityTableMap[entityName];

      const NO_DELETE_TABLES = ['invoices', 'staff_profiles'];

      if (action === 'list') {
        if (table) {
          const listRes = await db.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY created_at DESC LIMIT 20`, [companyId]);
          return { count: listRes.rows.length, items: listRes.rows };
        }
        const geRes = await db.query(
          `SELECT id, data FROM generic_entities WHERE entity_type = $1 AND company_id = $2 ORDER BY created_date DESC LIMIT 20`,
          [entityName, companyId]
        );
        return { count: geRes.rows.length, items: geRes.rows.map(r => ({ id: r.id, ...r.data })) };
      }

      if (action === 'create') {
        if (table) {
          const validColumns = await db.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
            [table]
          );
          const validColSet = new Set(validColumns.rows.map(r => r.column_name));
          const insertData = { ...entityData };
          insertData.company_id = companyId;
          insertData.created_at = new Date().toISOString();
          if (validColSet.has('created_by') && !insertData.created_by) insertData.created_by = userEmail;
          if (validColSet.has('assigned_to') && !insertData.assigned_to) insertData.assigned_to = userEmail;
          if (validColSet.has('status') && !insertData.status) {
            if (table === 'leads') insertData.status = 'new';
            else if (table === 'tasks') insertData.status = 'not_started';
            else if (table === 'projects') insertData.status = 'active';
            else if (table === 'estimates') insertData.status = 'draft';
            else if (table === 'invoices') insertData.status = 'draft';
            else if (table === 'calendar_events') insertData.status = 'scheduled';
          }
          if (table === 'leads' && !insertData.lead_source) insertData.lead_source = 'Lexi AI';

          const filteredData = {};
          for (const [k, v] of Object.entries(insertData)) {
            if (validColSet.has(k) && v !== undefined && v !== null && v !== '') filteredData[k] = v;
          }

          const cols = Object.keys(filteredData);
          const vals = Object.values(filteredData);
          const placeholders = cols.map((_, i) => `$${i + 1}`);
          const insertRes = await db.query(
            `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
            vals
          );
          return { success: true, id: insertRes.rows[0].id, message: `${entityName} created successfully` };
        }
        const geId = generateLexiId(entityName.toLowerCase());
        await db.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [geId, entityName, companyId, JSON.stringify({ ...entityData, created_by: userEmail })]
        );
        return { success: true, id: geId, message: `${entityName} created successfully` };
      }

      if (action === 'update') {
        if (!entityId) return { error: 'entity_id is required for update. Please provide the ID of the record to update.' };

        if (table) {
          const validColumns = await db.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
            [table]
          );
          const validColSet = new Set(validColumns.rows.map(r => r.column_name));
          const updateData = { ...entityData };
          if (validColSet.has('updated_at')) updateData.updated_at = new Date().toISOString();

          const filteredData = {};
          for (const [k, v] of Object.entries(updateData)) {
            if (validColSet.has(k) && k !== 'id' && k !== 'company_id' && v !== undefined) filteredData[k] = v;
          }

          if (Object.keys(filteredData).length === 0) return { error: 'No valid fields to update' };

          const setClauses = Object.keys(filteredData).map((k, i) => `${k} = $${i + 1}`);
          const vals = [...Object.values(filteredData), entityId, companyId];
          const updateRes = await db.query(
            `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $${vals.length - 1} AND company_id = $${vals.length} RETURNING id`,
            vals
          );
          if (updateRes.rows.length === 0) return { error: `${entityName} with ID "${entityId}" not found` };
          return { success: true, id: entityId, message: `${entityName} updated successfully`, fields_updated: Object.keys(filteredData) };
        }
        const existing = await db.query(
          `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2 AND company_id = $3`,
          [entityId, entityName, companyId]
        );
        if (existing.rows.length === 0) return { error: `${entityName} with ID "${entityId}" not found` };
        const mergedData = { ...(existing.rows[0].data || {}), ...entityData };
        await db.query(
          `UPDATE generic_entities SET data = $1, updated_date = NOW() WHERE id = $2 AND company_id = $3`,
          [JSON.stringify(mergedData), entityId, companyId]
        );
        return { success: true, id: entityId, message: `${entityName} updated successfully` };
      }

      if (action === 'delete') {
        return { error: "I can't delete records. Deletions must be done by a human in the CRM directly." };
      }

      return { error: `Unknown action "${action}". Use create, update, or list.` };

    } else if (name === 'get_storm_alerts') {
      const daysBack = Math.max(1, Math.min(365, parseInt(args.days_back) || 30));
      const activeOnly = args.active_only || false;
      const areaFilter = args.area_filter ? args.area_filter.toLowerCase() : null;
      const eventTypes = args.event_types ? args.event_types.split(',').map(t => t.trim().toLowerCase()) : null;

      let stateFilter = null;
      try {
        const settingsRes = await db.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'StormAlertSettings' AND company_id = $1 ORDER BY updated_date DESC LIMIT 1`,
          [companyId]
        );
        if (settingsRes.rows.length > 0) {
          const s = settingsRes.rows[0].data;
          if (s.service_states && s.service_states.length > 0) {
            stateFilter = s.service_states;
          } else if (s.service_center_location) {
            const stMatch = s.service_center_location.match(/,\s*([A-Z]{2})(?:\s|$)/);
            if (stMatch) stateFilter = [stMatch[1]];
          }
        }
      } catch (e) {}

      if (!stateFilter) {
        try {
          const compRes = await db.query(`SELECT data FROM companies WHERE id = $1`, [companyId]);
          if (compRes.rows.length > 0 && compRes.rows[0].data) {
            const cd = typeof compRes.rows[0].data === 'string' ? JSON.parse(compRes.rows[0].data) : compRes.rows[0].data;
            if (cd.state) stateFilter = [cd.state];
          }
        } catch (e) {}
      }

      if (!stateFilter) {
        try {
          const custStates = await db.query(
            `SELECT DISTINCT state FROM customers WHERE company_id = $1 AND state IS NOT NULL AND state != '' LIMIT 5`,
            [companyId]
          );
          if (custStates.rows.length > 0) {
            stateFilter = custStates.rows.map(r => r.state.toUpperCase());
          }
        } catch (e) {}
      }

      const params = [daysBack];
      let query = `SELECT id, data FROM generic_entities WHERE entity_type = 'StormEvent' AND (data->>'start_time')::timestamp >= NOW() - ($1::int * INTERVAL '1 day')`;

      if (stateFilter && stateFilter.length > 0) {
        params.push(stateFilter);
        query += ` AND data->>'nws_state' = ANY($${params.length})`;
      }

      if (activeOnly) {
        query += ` AND data->>'status' = 'active'`;
      }

      query += ` ORDER BY (data->>'start_time')::timestamp DESC LIMIT 50`;

      const stormRes = await db.query(query, params);
      let storms = stormRes.rows.map(r => ({
        id: r.id,
        title: r.data.title,
        event_type: r.data.event_type,
        start_time: r.data.start_time,
        severity: r.data.severity,
        status: r.data.status,
        affected_areas: r.data.affected_areas,
        nws_state: r.data.nws_state,
      }));

      if (eventTypes) {
        storms = storms.filter(s => eventTypes.some(et => (s.event_type || '').toLowerCase().includes(et)));
      }

      if (areaFilter) {
        storms = storms.filter(s => {
          const areas = Array.isArray(s.affected_areas) ? s.affected_areas.join(' ').toLowerCase() : '';
          return areas.includes(areaFilter) || (s.title || '').toLowerCase().includes(areaFilter);
        });
      }

      const activeCount = storms.filter(s => s.status === 'active').length;

      const typeCounts = {};
      storms.forEach(s => {
        const t = s.event_type || 'unknown';
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });

      const stateLabel = stateFilter ? stateFilter.join(', ') : 'your area';
      let summaryText = `Found ${storms.length} storm events in ${stateLabel} over the last ${daysBack} days.`;
      if (activeCount > 0) summaryText += ` ${activeCount} are currently active.`;
      if (Object.keys(typeCounts).length > 0) {
        const typeList = Object.entries(typeCounts).map(([t, c]) => `${c} ${t.replace(/_/g, ' ')}`).join(', ');
        summaryText += ` Types: ${typeList}.`;
      }
      if (storms.length === 0) {
        summaryText = `No storm events found in ${stateLabel} in the last ${daysBack} days.`;
      }

      return {
        total_count: storms.length,
        active_count: activeCount,
        type_breakdown: typeCounts,
        storms: storms.slice(0, 15),
        summary_text: summaryText,
        area_searched: stateLabel
      };

    } else if (name === 'add_staff_member') {
      const staffId = generateLexiId('staff');
      const insertRes = await db.query(
        `INSERT INTO staff_profiles (id, company_id, full_name, user_email, email, phone, role_name, role, position, is_administrator, is_super_admin, is_active, created_at, updated_at, created_by)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $6, $6, $7, false, true, NOW(), NOW(), $8) RETURNING id`,
        [staffId, companyId, args.full_name, args.email, args.phone || '', args.role || 'Team Member', args.is_administrator || false, userEmail]
      );
      return { success: true, staff_id: insertRes.rows[0].id, message: `Staff member "${args.full_name}" added as ${args.role || 'Team Member'}` };

    } else if (name === 'assign_inspection') {
      const inspData = {
        client_name: args.client_name,
        property_address: args.property_address,
        assigned_to: args.assigned_to_email,
        status: 'scheduled',
        damage_type: args.damage_type || '',
        special_instructions: args.special_instructions || '',
        inspection_date: args.inspection_date || new Date().toISOString().split('T')[0],
      };
      const inspRes = await db.query(
        `INSERT INTO generic_entities (entity_type, data, company_id, created_date) VALUES ('CrewCamInspection', $1, $2, NOW()) RETURNING id`,
        [JSON.stringify(inspData), companyId]
      );
      return { success: true, inspection_id: inspRes.rows[0].id, message: `Inspection assigned to ${args.assigned_to_email}` };

    } else if (name === 'find_subcontractors') {
      const subsRes = await db.query(
        `SELECT id, data FROM generic_entities WHERE entity_type = 'Subcontractor' AND company_id = $1 ORDER BY created_date DESC LIMIT 100`,
        [companyId]
      );
      let allSubs = subsRes.rows.map(r => ({ id: r.id, ...r.data }));
      let matched = allSubs;

      if (args.area && args.area.trim()) {
        const kw = args.area.trim().toLowerCase();
        matched = matched.filter(sub => {
          const searchable = [sub.base_address, sub.city, sub.state, sub.zip, sub.notes, sub.name].filter(Boolean).join(' ').toLowerCase();
          return searchable.includes(kw);
        });
      }
      if (args.specialty && args.specialty.trim()) {
        const spec = args.specialty.trim().toLowerCase();
        matched = matched.filter(sub => {
          const specs = Array.isArray(sub.specialty) ? sub.specialty : [sub.specialty || ''];
          return specs.some(s => (s || '').toLowerCase().includes(spec));
        });
      }

      const summary = matched.map(sub => ({
        name: sub.name,
        contact: sub.contact_person || '',
        phone: sub.phone || '',
        base_address: sub.base_address || '',
        service_radius: sub.service_radius || '',
        specialty: Array.isArray(sub.specialty) ? sub.specialty.join(', ') : (sub.specialty || ''),
        availability: sub.availability || '',
        is_active: sub.is_active !== false
      }));

      if (summary.length === 0 && allSubs.length === 0) {
        return { matched_count: 0, message: 'No subcontractors found in the system. You can add subcontractors in the Subcontractors section of the CRM.' };
      }

      return {
        total_in_company: allSubs.length,
        matched_count: matched.length,
        filter: { area: args.area || null, specialty: args.specialty || null },
        subcontractors: summary,
        summary_text: matched.length === 0
          ? `No subcontractors found${args.area ? ` in "${args.area}"` : ''}. There are ${allSubs.length} total in the system.`
          : `Found ${matched.length} subcontractor${matched.length !== 1 ? 's' : ''}${args.area ? ` in "${args.area}"` : ''}: ${summary.map(s => s.name).join(', ')}.`
      };

    } else {
      console.warn(`[Lexi Native] Unknown tool: ${name}`);
      return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[Lexi Native] Tool ${name} error:`, err.message);
    return { error: err.message };
  }
}

async function logLexiUsage(companyId, durationSec) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const db = getPool();
    const units = Math.max(1, Math.ceil(durationSec / 60));
    const unitCost = 0.05;
    const totalCost = unitCost * units;
    const usageMonth = new Date().toISOString().slice(0, 7);
    const id = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await db.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
      [id, companyId, JSON.stringify({ company_id: companyId, feature: 'lexi', units, unit_cost: unitCost, total_cost: totalCost, usage_month: usageMonth, duration_sec: durationSec, logged_at: new Date().toISOString() })]
    );
  } catch (e) {
    console.error('[Lexi Native] Failed to log usage:', e.message);
  }
}

async function loadRecentSessionTranscript(companyId, userEmail) {
  if (!companyId) return null;
  try {
    const db = getPool();
    const res = await db.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'LexiVoiceSession' AND company_id = $1 AND (data->>'user_email') = $2 ORDER BY created_date DESC LIMIT 1`,
      [companyId, userEmail]
    );
    if (res.rows.length > 0 && res.rows[0].data?.transcript) {
      const transcript = res.rows[0].data.transcript;
      const lines = transcript.split('\n').filter(Boolean);
      if (lines.length < 2) return null;
      return lines.slice(-20).join('\n');
    }
  } catch (e) {
    console.warn('[Lexi Native] Could not load previous session:', e.message);
  }
  return null;
}

async function saveSessionLocally(companyId, userEmail, durationSec, conversationLog, toolCallsMade) {
  if (!companyId) return;
  const db = getPool();
  const transcript = conversationLog.map(e => `${e.role}: ${e.text}`).join('\n');

  try {
    const sessionId = generateLexiId('lexisession');
    await db.query(
      `INSERT INTO generic_entities (id, entity_type, data, company_id, created_date, updated_date)
       VALUES ($1, 'LexiVoiceSession', $2, $3, NOW(), NOW())`,
      [sessionId, JSON.stringify({
        duration_seconds: durationSec,
        transcript,
        tool_calls_made: toolCallsMade,
        user_email: userEmail,
        session_type: 'native_voice',
      }), companyId]
    );
    if (durationSec > 10) logLexiUsage(companyId, durationSec);
    console.log(`[Lexi Native] Session saved locally: ${durationSec}s, ${toolCallsMade.length} tools`);
  } catch (err) {
    console.error('[Lexi Native] Failed to save session:', err.message);
  }
}

export default function lexiNativePlugin() {
  return {
    name: 'lexi-native-bridge',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer.on('upgrade', (req, socket, head) => {
        if (req.url && req.url.startsWith('/ws/lexi-native')) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        }
      });

      console.log('[Lexi Native] WebSocket bridge plugin loaded (LOCAL mode)');
      console.log('[Lexi Native] WebSocket endpoint: /ws/lexi-native');

      wss.on('connection', (clientWs, req) => {
        console.log('[Lexi Native] Browser client connected');

        const url = new URL(req.url, `http://${req.headers.host}`);
        const companyId = url.searchParams.get('companyId') || '';
        const userEmail = url.searchParams.get('userEmail') || '';
        const userName = url.searchParams.get('userName') || 'User';
        const requestedVoice = url.searchParams.get('voice') || 'Kore';

        let geminiWs = null;
        let setupComplete = false;
        let sessionStartTime = Date.now();
        let conversationLog = [];
        let toolCallsMade = [];
        let geminiIsSpeaking = false;
        let geminiSpeechEndTimer = null;
        const POST_SPEECH_BUFFER_MS = 1200;

        const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!geminiApiKey) {
          console.error('[Lexi Native] GOOGLE_GEMINI_API_KEY not set!');
          clientWs.send(JSON.stringify({ type: 'error', message: 'API key not configured' }));
          clientWs.close();
          return;
        }

        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

        async function connectGemini() {
          let voiceName = requestedVoice;
          let companyName = 'CompanySync';
          let timezone = 'America/New_York';
          let knowledgeBase = '';
          let customerList = '';
          let staffList = [];
          let preferredLanguage = 'en';

          let recentSessionContext = null;
          if (companyId) {
            try {
              const settings = await getLocalSettings(companyId, userEmail);
              companyName = settings.companyName;
              timezone = settings.timezone;
              knowledgeBase = settings.knowledgeBase;
              customerList = settings.customerList;
              staffList = settings.staffList;
              preferredLanguage = settings.preferredLanguage || 'en';
              if (settings.voiceName && !url.searchParams.has('voice')) voiceName = settings.voiceName;
            } catch (e) {
              console.warn('[Lexi Native] Could not load local settings:', e.message);
            }
            try {
              recentSessionContext = await loadRecentSessionTranscript(companyId, userEmail);
              if (recentSessionContext) {
                console.log('[Lexi Native] Loaded previous session context:', recentSessionContext.split('\n').length, 'lines');
              }
            } catch (e) {
              console.warn('[Lexi Native] Could not load recent session context:', e.message);
            }
          }

          if (!VALID_GEMINI_VOICES.includes(voiceName)) {
            console.warn(`[Lexi Native] Voice "${voiceName}" invalid, falling back to Kore`);
            voiceName = 'Kore';
          }

          console.log(`[Lexi Native] Connecting to Gemini: voice=${voiceName}, company=${companyName}`);

          geminiWs = new WebSocket(geminiUrl);

          geminiWs.on('open', () => {
            console.log('[Lexi Native] Connected to Gemini, sending setup...');

            const systemPrompt = buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage, recentSessionContext);

            const setupMsg = {
              setup: {
                model: "models/gemini-2.5-flash-native-audio-latest",
                generation_config: {
                  response_modalities: ["AUDIO"],
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: { voice_name: voiceName }
                    }
                  }
                },
                realtime_input_config: {
                  automatic_activity_detection: {
                    disabled: false,
                    start_of_speech_sensitivity: "START_SENSITIVITY_LOW",
                    end_of_speech_sensitivity: "END_SENSITIVITY_LOW",
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1500
                  }
                },
                system_instruction: {
                  parts: [{ text: systemPrompt }]
                },
                tools: [{
                  function_declarations: LEXI_CRM_TOOLS
                }]
              }
            };

            geminiWs.send(JSON.stringify(setupMsg));
          });

          let audioChunksSent = 0;
          let textChunksSent = 0;

          geminiWs.on('message', async (raw) => {
            try {
              const data = JSON.parse(raw.toString());

              const msgKeys = Object.keys(data);
              if (data.serverContent?.modelTurn?.parts) {
                const partsSummary = data.serverContent.modelTurn.parts.map(p => ({
                  keys: Object.keys(p),
                  hasText: !!p.text,
                  hasInlineData: !!p.inlineData,
                  mime: p.inlineData?.mimeType || null,
                  dataLen: p.inlineData?.data?.length || 0,
                }));
                console.log(`[Lexi Native] Gemini modelTurn: ${JSON.stringify(partsSummary)}`);
              }

              if (data.setupComplete) {
                console.log('[Lexi Native] Setup complete, ready for voice');
                setupComplete = true;
                clientWs.send(JSON.stringify({ type: 'status', status: 'ready' }));

                geminiWs.send(JSON.stringify({
                  client_content: {
                    turns: [{
                      role: "user",
                      parts: [{ text: `Greet ${userName} warmly. Keep it under 15 words.` }]
                    }],
                    turn_complete: true
                  }
                }));
              }

              if (data.toolCall) {
                console.log('[Lexi Native] Gemini requested tool call:', JSON.stringify(data.toolCall).substring(0, 300));
                const functionCalls = data.toolCall.functionCalls || [];
                const toolResponses = [];

                if (geminiWs.readyState === WebSocket.OPEN) {
                  geminiWs.send(JSON.stringify({
                    client_content: {
                      turns: [{ role: "user", parts: [{ text: "[System: Tool call in progress. Say a brief filler like 'One sec, let me check that' or 'Sure, pulling that up now' while waiting. Keep it under 8 words.]" }] }],
                      turn_complete: true
                    }
                  }));
                }

                for (const fc of functionCalls) {
                  let parsedArgs = {};
                  try {
                    parsedArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                  } catch (e) {
                    parsedArgs = {};
                  }

                  const result = await handleLocalToolCall(fc.name, parsedArgs, companyId, userEmail);
                  toolCallsMade.push(fc.name);
                  conversationLog.push({ role: 'Tool', text: `${fc.name}(${JSON.stringify(parsedArgs).substring(0, 100)})` });

                  const responseObj = (typeof result === 'object' && result !== null) ? result : { output: String(result) };
                  toolResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: responseObj
                  });

                  clientWs.send(JSON.stringify({ type: 'tool_call', name: fc.name }));
                }

                if (geminiWs.readyState === WebSocket.OPEN) {
                  geminiWs.send(JSON.stringify({
                    tool_response: {
                      function_responses: toolResponses
                    }
                  }));
                  console.log('[Lexi Native] Tool responses sent to Gemini');

                  const toolNames = toolResponses.map(t => t.name).join(', ');
                  geminiWs.send(JSON.stringify({
                    client_content: {
                      turns: [{ role: "user", parts: [{ text: `[System: Tool results above for ${toolNames}. Now respond VERBALLY to the user with a brief, conversational summary. Keep it natural and under 30 words.]` }] }],
                      turn_complete: true
                    }
                  }));
                }
              }

              if (data.serverContent?.inputTranscript) {
                const userText = data.serverContent.inputTranscript;
                conversationLog.push({ role: 'User', text: userText });
                clientWs.send(JSON.stringify({ type: 'transcript', role: 'user', text: userText }));
              }

              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.text) {
                    const isThinking = /\*\*/.test(part.text) || part.text.includes("I'm starting") || part.text.includes("I've formulated") || part.text.includes("My immediate focus") || part.text.includes("I will leverage");
                    if (!isThinking) {
                      textChunksSent++;
                      conversationLog.push({ role: 'Lexi', text: part.text });
                      clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: part.text }));
                    } else {
                      console.log('[Lexi Native] Filtered thinking text:', part.text.substring(0, 80));
                    }
                  }
                  if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
                    const audioSize = part.inlineData.data?.length || 0;
                    if (audioSize > 0 && clientWs.readyState === WebSocket.OPEN) {
                      geminiIsSpeaking = true;
                      if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
                      audioChunksSent++;
                      clientWs.send(JSON.stringify({
                        type: 'audio',
                        data: part.inlineData.data,
                        mimeType: part.inlineData.mimeType
                      }));
                      if (audioChunksSent <= 3) {
                        console.log(`[Lexi Native] Audio chunk #${audioChunksSent}: ${audioSize} chars base64, mime=${part.inlineData.mimeType}`);
                      }
                    } else if (audioSize === 0) {
                      console.warn('[Lexi Native] Empty audio chunk received from Gemini');
                    }
                  }
                }
              }

              if (audioChunksSent === 0 && textChunksSent > 0 && textChunksSent % 3 === 0) {
                console.warn(`[Lexi Native] WARNING: ${textChunksSent} text chunks sent but 0 audio chunks — Gemini may not be producing audio. Model may need update.`);
              }

              if (data.serverContent?.interrupted) {
                console.log('[Lexi Native] Speech interrupted by user');
                geminiIsSpeaking = false;
                if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
                clientWs.send(JSON.stringify({ type: 'interrupted' }));
              }

              if (data.serverContent?.turnComplete) {
                clientWs.send(JSON.stringify({ type: 'turn_complete' }));
              }
            } catch (err) {
              console.error('[Lexi Native] Gemini message error:', err.message);
            }
          });

          geminiWs.on('close', (code, reason) => {
            console.log('[Lexi Native] Gemini disconnected:', code, reason?.toString());
            const durationSec = Math.round((Date.now() - sessionStartTime) / 1000);
            saveSessionLocally(companyId, userEmail, durationSec, conversationLog, toolCallsMade);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: 'status', status: 'disconnected', code }));
            }
          });

          geminiWs.on('error', (err) => {
            console.error('[Lexi Native] Gemini error:', err.message);
            try {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: 'error', message: err.message }));
              }
            } catch (e) {}
          });
        }

        connectGemini();

        clientWs.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());

            if (msg.type === 'playback_done') {
              if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
              geminiSpeechEndTimer = setTimeout(() => {
                geminiIsSpeaking = false;
                geminiSpeechEndTimer = null;
                console.log('[Lexi Native] Mic gate opened (playback_done + buffer)');
              }, POST_SPEECH_BUFFER_MS);
            }

            if (msg.type === 'user_interrupted') {
              console.log('[Lexi Native] Client-side user interruption — keeping mic gate closed for', POST_SPEECH_BUFFER_MS, 'ms');
              geminiIsSpeaking = true;
              if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
              geminiSpeechEndTimer = setTimeout(() => {
                geminiIsSpeaking = false;
                geminiSpeechEndTimer = null;
                console.log('[Lexi Native] Mic gate opened (post-interrupt buffer)');
              }, POST_SPEECH_BUFFER_MS);
            }

            if (msg.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN && setupComplete && !geminiIsSpeaking) {
              geminiWs.send(JSON.stringify({
                realtime_input: {
                  media_chunks: [{
                    data: msg.data,
                    mime_type: "audio/pcm;rate=16000"
                  }]
                }
              }));
            }

            if (msg.type === 'text' && geminiWs && geminiWs.readyState === WebSocket.OPEN && setupComplete) {
              geminiWs.send(JSON.stringify({
                client_content: {
                  turns: [{
                    role: "user",
                    parts: [{ text: msg.text }]
                  }],
                  turn_complete: true
                }
              }));
              conversationLog.push({ role: 'User', text: msg.text });
            }
          } catch (err) {
            console.error('[Lexi Native] Client message error:', err.message);
          }
        });

        clientWs.on('close', () => {
          console.log('[Lexi Native] Browser client disconnected');
          const durationSec = Math.round((Date.now() - sessionStartTime) / 1000);
          saveSessionLocally(companyId, userEmail, durationSec, conversationLog, toolCallsMade);
          if (geminiWs && (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING)) {
            geminiWs.close();
          }
        });
      });
    }
  };
}
