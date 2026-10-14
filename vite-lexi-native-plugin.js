import { WebSocketServer, WebSocket } from 'ws';
import pg from 'pg';
import crypto from 'crypto';
import { createRequire } from 'node:module';
const { Pool } = pg;
const nodeRequire = createRequire(import.meta.url);
const { fetchWithRetry } = nodeRequire('./lib/fetchWithRetry.cjs');
const { canonicalizeGenericEntityType, normalizeGenericEntityData } = nodeRequire('./lib/expenseNormalize.cjs');
const { authenticateLexiWs } = nodeRequire('./lib/lexiWsAuth.cjs');
const { confirmScheduleAndCreate } = nodeRequire('./lib/lexiScheduleConfirmation.cjs');
const { accessDenied: lexiAccessDenied, buildLexiAccessPolicy } = nodeRequire('./lib/lexiAccessPolicy.cjs');
const { assertBuildDate, buildDayRange } = nodeRequire('./lib/buildScheduleTime.cjs');
const { calendarBuildRouteGuard, manageEntityBuildRouteGuard } = nodeRequire('./lib/lexiBuildIntent.cjs');
const { buildScheduleConfirmationGuard, isBuildSchedulingMutation } = nodeRequire('./lib/lexiBuildConfirmation.cjs');
const { groundingRulesBlock: lexiGroundingRules, annotateToolResult: groundToolResult } = nodeRequire('./lib/lexiGrounding.cjs');
const { deriveSpokenBrandName, applySpokenCompanyName } = nodeRequire('./lib/spokenBrandName.cjs');
const { isVoiceGroundingSensitive, auditVoiceTurn } = nodeRequire('./lib/lexiVoiceGrounding.cjs');

function generateLexiId(prefix = 'lexi') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

// ── Lexi double-booking guard ────────────────────────────────────────────────
async function lexiCheckCalendarConflict(db, companyId, assignedTo, startTime, endTime) {
  if (!assignedTo || !startTime || !endTime) return null;
  const fmt = (t) => { try { return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); } catch { return String(t); } };
  const { rows } = await db.query(`
    SELECT id, title, start_time, end_time FROM calendar_events
    WHERE company_id = $1 AND assigned_to = $2
      AND COALESCE(status,'') NOT IN ('cancelled','tentative')
      AND start_time < $4 AND end_time > $3
    LIMIT 1`, [companyId, assignedTo, startTime, endTime]);
  if (rows.length === 0) return null;
  const ev = rows[0];
  return { conflict: true, existing: ev,
    message: `${assignedTo} is already booked for "${ev.title}" from ${fmt(ev.start_time)} to ${fmt(ev.end_time)}.` };
}

// Find the next N available 30-min-aligned slots for a staff member near a given time.
async function lexiFindAvailableSlots(db, companyId, assignedTo, nearTime, durationMs = 3600000, count = 3) {
  const slots = [];
  let cur = new Date(nearTime);
  // Round up to next 30-min boundary
  const m = cur.getMinutes();
  if (m !== 0 && m !== 30) cur.setMinutes(m < 30 ? 30 : 60, 0, 0);
  else cur.setSeconds(0, 0);
  const deadline = new Date(cur.getTime() + 8 * 24 * 60 * 60 * 1000);
  const fmt = (t) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  while (slots.length < count && cur < deadline) {
    const hour = cur.getHours();
    if (hour >= 7 && hour < 18) {
      const slotEnd = new Date(cur.getTime() + durationMs);
      const { rows } = await db.query(`
        SELECT id FROM calendar_events
        WHERE company_id = $1 AND assigned_to = $2
          AND COALESCE(status,'') != 'cancelled'
          AND start_time < $4 AND end_time > $3
        LIMIT 1`, [companyId, assignedTo, cur.toISOString(), slotEnd.toISOString()]);
      if (rows.length === 0) slots.push({ start: cur.toISOString(), end: slotEnd.toISOString(), label: fmt(cur) });
    }
    cur = new Date(cur.getTime() + 30 * 60 * 1000);
  }
  return slots;
}
// ────────────────────────────────────────────────────────────────────────────

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
    name: "get_build_schedule",
    description: "List Build Schedule entries for build/install questions; optionally filter by customer, status, job type, and date range.",
    parameters: { type: "object", properties: { customer_id: { type: "string" }, customer_name: { type: "string" }, status: { type: "string" }, job_type: { type: "string" }, date_from: { type: "string" }, date_to: { type: "string" }, limit: { type: "integer" } } }
  },
  {
    name: "create_build_schedule",
    description: "Prepare or confirm a Build Schedule build/install and its calendar event. The first call never writes; repeat with confirmation_token only after the user explicitly confirms the exact customer and date.",
    parameters: { type: "object", properties: { customer_id: { type: "string" }, customer_name: { type: "string" }, build_date: { type: "string" }, job_types: { type: "array", items: { type: "string" } }, address: { type: "string" }, customer_phone: { type: "string" }, customer_email: { type: "string" }, rep: { type: "string" }, crew: { type: "array", items: { type: "string" } }, assigned_to: { type: "array", items: { type: "string" } }, notes: { type: "string" }, status: { type: "string" }, confirmation_token: { type: "string", description: "Use only after the user clearly confirms the exact customer and build date returned by the prior call." } }, required: ["build_date", "job_types"] }
  },
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
        },
        filters: {
          type: "object",
          description: "Optional filters for leads/customers: city, state, status, assigned_to, lead_source",
          properties: {
            city: { type: "string" },
            state: { type: "string" },
            status: { type: "string" },
            assigned_to: { type: "string" },
            lead_source: { type: "string" }
          }
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
        event_type: { type: "string", enum: ["meeting", "appointment", "call", "inspection", "reminder", "other"], description: "Use reminder when the user asks to be reminded; reminders do not reserve calendar availability." },
        attendees: { type: "string", description: "Names of people attending" },
        email_reminder_minutes: { type: "integer", description: "Send email reminder X minutes before event (e.g. 60 for 1 hour, 120 for 2 hours)" },
        sms_reminder_minutes: { type: "integer", description: "Send SMS reminder X minutes before event" },
        browser_reminder_minutes: { type: "integer", description: "Send browser notification X minutes before event" }
        ,
        assigned_to: { type: "string", description: "Email of the tenant staff member who will handle this event. Defaults to the speaking user." },
        confirmation_token: { type: "string", description: "Required only after this tool returned CALENDAR_CONFLICT and the user explicitly approved one of its alternatives." },
        customer_id: { type: "string", description: "Optional tenant-owned customer to text after a confirmed reschedule." },
        lead_id: { type: "string", description: "Optional tenant-owned lead to text after a confirmed reschedule." },
        reschedule_sms_message: { type: "string", description: "Optional proposed reschedule text. Never send until a valid confirmation token books the event." },
        not_a_build_token: { type: "string", description: "Only valid after this tool returned BUILD_ROUTE_REQUIRED with a retry_token. Echo that retry_token here, with the same title and start_time, when the event genuinely is a meeting, walkthrough, or inspection rather than an installation job. Never use it to force a real build through." }
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
    name: "route_lead_to_sequence",
    description: "Prepare enrollment of one company-owned lead in one active company follow-up or nurture workflow. Requires the caller's explicit confirmation before enrollment.",
    parameters: { type: "object", properties: { lead_id: { type: "string" }, sequence_name: { type: "string" } }, required: ["lead_id", "sequence_name"] }
  },
  {
    name: "trigger_document_packet",
    description: "Prepare delivery of a standard restoration packet. Requires the caller's explicit confirmation before sending.",
    parameters: { type: "object", properties: { recipient_type: { type: "string", enum: ["lead", "customer"] }, recipient_id: { type: "string" }, channel: { type: "string", enum: ["email", "sms"] }, estimate_id: { type: "string" }, inspection_id: { type: "string" }, material_list_id: { type: "string" }, document_id: { type: "string" }, matching_note: { type: "string" } }, required: ["recipient_type", "recipient_id", "channel"] }
  },
  {
    name: "dispatch_team_notification",
    description: "Create and notify a structured operational ticket for one verified company teammate.",
    parameters: { type: "object", properties: { assignee: { type: "string" }, title: { type: "string" }, context_note: { type: "string" }, priority: { type: "string", enum: ["low", "medium", "high"] }, due_date: { type: "string" }, lead_id: { type: "string" }, customer_id: { type: "string" } }, required: ["assignee", "title", "context_note"] }
  },
  {
    name: "confirm_lexi_orchestration",
    description: "Complete a previously prepared lead-sequence enrollment or document packet only after the caller explicitly says yes. Use the confirmation token returned by that preparation tool.",
    parameters: { type: "object", properties: { confirmation_token: { type: "string" } }, required: ["confirmation_token"] }
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
    name: "save_memory",
    description: "Save a personal preference or work-style detail the user shares about THEMSELVES so it is remembered in future conversations (e.g. 'I always add 15% waste', 'I prefer afternoon appointments'). NOT for facts about customers or leads.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Short label for the preference" },
        value: { type: "string", description: "The preference itself" },
        importance: { type: "integer", description: "1-10, default 5" },
        category: { type: "string", description: "Usually 'lexi' (default)" }
      },
      required: ["key", "value"]
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
        entity_id: { type: "string", description: "ID of the entity (required for update)" },
        confirmation_token: { type: "string", description: "For a BuildSchedule date/customer change, use only after the user explicitly confirms the prior prompt." }
      },
      required: ["entity_action", "entity_name"]
    }
  },
  {
    name: "get_photosync_jobs",
    description: "Look up PhotoSync inspection jobs (also called CrewCam jobs). Use when user asks about photosync, inspections, inspection jobs, crew photo jobs, job status, or photo documentation.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status (e.g. scheduled, completed, in_progress, or all)" },
        limit: { type: "number", description: "Number of jobs to return (default 10, max 50)" },
        days_back: { type: "number", description: "Only return jobs created within the last N days" }
      }
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
        role: { type: "string", description: "Role/position (e.g. Sales Rep, Inspector, Project Manager)" }
      },
      required: ["full_name", "email"]
    }
  },
  {
    name: "add_family_commission_member",
    description: "Add a new FAMILY COMMISSION member — a person who receives automatic round-robin commissions from sales. Use this when the user says 'add as family commission member/participant', 'add to family commissions', 'add [name] as family commission', etc. This writes to the Family Commissions module, NOT the staff list.",
    parameters: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Full name" },
        email: { type: "string", description: "Email address" },
        phone: { type: "string", description: "Phone number (optional)" },
        commission_percentage: { type: "number", description: "Commission percentage 0-100 (default 1)" },
        notes: { type: "string", description: "Optional notes" }
      },
      required: ["full_name", "email"]
    }
  },
  {
    name: "find_subcontractors",
    description: "Search and rank SUBCONTRACTORS (external vendors/crews, NOT staff) by service area, work radius, specialty, active status, and rating. Use this before recommending a crew. If a date is requested, also call get_build_schedule to check that date before claiming availability.",
    parameters: {
      type: "object",
      properties: {
        area: { type: "string", description: "City, state, zip, or territory name to search within (e.g. 'Ohio', 'Cleveland', '44146'). Leave empty to list all." },
        specialty: { type: "string", description: "Optional trade specialty to filter by (e.g. 'Roofing', 'Siding', 'Gutters')" }
      }
    }
  },
  {
    name: "add_note",
    description: "Add a note to a Customer or Lead profile. Use this IMMEDIATELY whenever the user says 'add a note', 'make a note', 'note that', 'put a note on', 'leave a note', 'log a note', etc. The note will appear in that record's Notes section in the CRM. If the user does not specify which customer/lead, ASK them which one before calling this tool — never guess.",
    parameters: {
      type: "object",
      properties: {
        note_text: { type: "string", description: "The full text/content of the note to save." },
        customer_name: { type: "string", description: "Name of the customer the note belongs to (provide this OR lead_name, not both)." },
        lead_name: { type: "string", description: "Name of the lead the note belongs to (provide this OR customer_name, not both)." },
        customer_id: { type: "string", description: "Optional: exact customer ID if already known." },
        lead_id: { type: "string", description: "Optional: exact lead ID if already known." }
      },
      required: ["note_text"]
    }
  },
  {
    name: "get_activity_log",
    description: "Query the Global Activity Log — a chronological feed of ALL actions across the CRM (leads added, messages sent, estimates, invoices, tasks, customers, workflow executions). Use when the user asks 'what have we done', 'what's been happening', 'recent activity', or any org-wide recent-history question.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent events to return (default 20, max 50)" },
        module: { type: "string", enum: ["leads", "communications", "estimates", "invoices", "tasks", "customers", "workflow", "all"], description: "Filter to a specific module. Omit or use 'all' for everything." },
        days: { type: "number", description: "Only return events from the last N days (optional)" }
      }
    }
  },
  {
    name: "get_financial_summary",
    description: "Calculate revenue totals and payment summaries for a time period. Use when the user asks 'how much money did we make this week/month/year', 'total invoices for this year', 'revenue summary', 'how much have we collected', or any question about money, revenue, or income for a period.",
    parameters: {
      type: "object",
      properties: {
        period: { type: "string", enum: ["this_week", "this_month", "last_month", "this_year", "last_7_days", "last_30_days", "custom"], description: "Time period to summarize (default: this_month)" },
        start_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period start" },
        end_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period end (defaults to today)" }
      }
    }
  },
  {
    name: "get_staff_sales_summary",
    description: "Get sales for a specific staff member OR compare the whole team ranked by sales. Use for 'how much did [name] sell', '[name]s sales this month', 'who sold the most last month', 'show me everyones sales', 'team sales leaderboard', 'compare all reps', 'rank our salespeople', 'who is our top performer' — omit staff_name or pass 'all'/'everyone' to get a ranked leaderboard of the entire team.",
    parameters: {
      type: "object",
      properties: {
        staff_name: { type: "string", description: "Name of the staff member / sales rep to look up. Omit or pass 'all'/'everyone' to get a ranked leaderboard of the entire team." },
        period: { type: "string", enum: ["this_week", "this_month", "last_month", "this_year", "last_7_days", "last_30_days", "all_time", "custom"], description: "Time period to summarize (default: this_month)" },
        start_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period start" },
        end_date: { type: "string", description: "ISO date YYYY-MM-DD for custom period end (defaults to today)" }
      }
    }
  },
  {
    name: "scan_check",
    description: "Scan a check photo using AI vision and automatically record the payment for a customer. Use IMMEDIATELY when the user provides a check image URL and says 'scan this check', 'process this check', 'record this check payment', or similar. Extracts amount, check number, date, and payer name, then records a Payment and Document.",
    parameters: {
      type: "object",
      properties: {
        file_url: { type: "string", description: "URL of the uploaded check image" },
        customer_name: { type: "string", description: "Customer name (fuzzy matched if customer_id not provided)" },
        customer_id: { type: "string", description: "Customer ID (preferred if already known)" }
      },
      required: ["file_url"]
    }
  },
  {
    name: "read_emails",
    description: "Search and list emails in the company Gmail inbox. Use when user asks to check email, show new emails, find emails from someone, search inbox, read messages, etc. Only works if Gmail is connected by the owner in Settings.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query (e.g. 'from:john@example.com', 'subject:invoice', 'is:unread', 'newer_than:7d'). Default: in:inbox." },
        limit: { type: "number", description: "Max emails to return (default 10, max 10)" },
        unread_only: { type: "boolean", description: "Only return unread emails" }
      }
    }
  },
  {
    name: "get_email",
    description: "Get the full content of a specific email by ID. Use after read_emails when the user wants to hear a full email body.",
    parameters: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "Email message ID (from read_emails results)" }
      },
      required: ["email_id"]
    }
  },
  {
    name: "reply_to_email",
    description: "Reply to an email thread. Use when user says 'reply to that email', 'send a reply', 'respond to that message'. Always get the email first via get_email before replying.",
    parameters: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "Message ID to reply to" },
        body: { type: "string", description: "Reply body text (plain text)" }
      },
      required: ["email_id", "body"]
    }
  },
  {
    name: "mark_email_read",
    description: "Mark an email as read. Use after reading or discussing an email when the user wants to clear it from unread.",
    parameters: {
      type: "object",
      properties: {
        email_id: { type: "string", description: "Message ID to mark as read" }
      },
      required: ["email_id"]
    }
  }
];

function getUtcOffset(tz = 'America/New_York') {
  try {
    const now = new Date();
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr  = now.toLocaleString('en-US', { timeZone: tz });
    const diffMin = Math.round((new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000);
    const sign = diffMin >= 0 ? '+' : '-';
    const abs = Math.abs(diffMin);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch (_) { return '-05:00'; }
}

// Convert any ISO datetime string Gemini provides to a proper UTC ISO string for DB storage.
// The calendar frontend uses new Date(start_time) to display times, so stored values must
// be in UTC (e.g. noon ET must be stored as T16:00:00Z for new Date() to display it as noon).
// Handles:
//   - bare local time "2026-07-24T12:00:00"      → treat as user's wall-clock → UTC
//   - Z-suffix       "2026-07-24T12:00:00Z"      → reinterpret time as local (Gemini
//                                                    ignored tz instruction) → UTC
//   - correct offset "2026-07-24T12:00:00-04:00" → convert to UTC directly
function toStorageUtc(isoString, tzOffset) {
  if (!isoString) return isoString;
  // Bare time — treat as local wall-clock in the company timezone
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(isoString)) {
    const d = new Date(isoString + tzOffset);
    return isNaN(d.getTime()) ? isoString : d.toISOString();
  }
  // Z-suffix — Gemini ignored our tz instruction; reinterpret the time component as local
  if (isoString.endsWith('Z')) {
    const local = isoString.slice(0, 19); // "YYYY-MM-DDTHH:MM:SS"
    const d = new Date(local + tzOffset);
    return isNaN(d.getTime()) ? isoString : d.toISOString();
  }
  // Has explicit offset (e.g. -04:00) — correct; just normalize to UTC
  const d = new Date(isoString);
  return isNaN(d.getTime()) ? isoString : d.toISOString();
}

function buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage, recentSessionContext, spokenNameSetting) {
  const now = new Date();
  const currentDateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone });
  const currentTimeString = now.toLocaleString('en-US', { timeZone: timezone });
  const todayISO = now.toISOString().split('T')[0];
  const tzOffset = getUtcOffset(timezone);
  const isSpanish = preferredLanguage === 'es';

  let staffContext = '';
  if (staffList && staffList.length > 0) {
    staffContext = `\nStaff Members: ${staffList.map(s => `${s.name} (${s.email}${s.role ? ', ' + s.role : ''})`).join(', ')}`;
  }

  const languageInstruction = isSpanish
    ? `\nLANGUAGE: You MUST respond exclusively in Spanish (Español) at all times. Greet in Spanish. All responses must be in Spanish unless the user explicitly switches to English.`
    : '';

  const prompt = `You are Lexi, a friendly and professional AI assistant for ${companyName}. You are speaking directly to ${userName} via native voice.${languageInstruction}

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
- PhotoSync (CrewCam) inspections: look up existing PhotoSync jobs via get_photosync_jobs, or assign new inspections to staff via assign_inspection. PhotoSync is the app's field photo + roof inspection module.
- Storm alerts: query recent weather events (hail, tornado, wind, etc.) in the service area via get_storm_alerts tool
- Email and SMS composition (requires confirmation before sending)
- Team orchestration: use route_lead_to_sequence and trigger_document_packet only after validating the named company record, then ask for explicit approval before enrollment or delivery. Use dispatch_team_notification only for one verified active teammate.
- Subcontractors: use find_subcontractors to rank external crews by specialty, active status, rating, completed jobs, and work radius. For a requested date, also call get_build_schedule and inspect crew assignments before saying a team is available.
- Notes: attach notes to a Customer or Lead profile via add_note tool
- Builds/installs: use create_build_schedule, never manage_entity or create_calendar_event. Before any new build or build date/customer change, repeat the exact resolved customer name and date and ask for a clear yes/no. The first tool call writes nothing and returns a confirmation token. Use it only after a separate user reply clearly says yes. If the user says no or corrects any detail, discard it and confirm the corrected details again. Never claim the build was scheduled unless the tool returns success with a build_id.
- Use tools immediately when asked. Never guess or give fake confirmations.

FINANCIAL LANGUAGE:
- “Earned,” “made,” “collected,” and “received” mean cash received: call get_financial_summary and lead with cash_received.
- “Invoiced,” “issued,” and “invoice sales” mean invoices_issued, which is distinct from cash received.
- If the user says only “revenue” and the distinction matters, say which measure you are reporting and offer the other; never silently substitute invoice totals for cash.
- When a request is unclear, a tool returns an error, or you are interrupted mid-answer, stay engaged: ask one concise clarification or say what you need to retry. Do not end the conversation abruptly.

TOOL RULES — CRITICAL:
- REMINDERS: When the user says "remind me," call create_calendar_event with event_type "reminder." A reminder is a non-blocking alert and must be created even if that calendar time has an appointment.
- CALENDAR CONFLICTS: Always include assigned_to when scheduling for another staff member. The calendar tool checks that staff member's live schedule itself. If it returns code CALENDAR_CONFLICT, clearly name the occupied time and offer one returned alternative, then ask one direct question such as "Should I text the lead to see if Tuesday at 2 works?" Do not create another event, send a text, or claim anything was moved until the user clearly says yes and you call the tool again with its confirmation_token and the selected alternative.
- Never reveal hidden reasoning, tool payloads, or confirmation tokens. A "yes" applies only to the current pending conflict; if the tool says the confirmation is expired, used, or changed, explain that briefly and offer the newly returned option.
- Subcontractor questions ("what subs are in Ohio", "who covers Cleveland", "any crews near [area]", "list subcontractors"): ALWAYS call find_subcontractors immediately. Subcontractors are EXTERNAL VENDORS, not staff.
- Staff/team questions: use get_crm_data with data_type='staff' or add_staff_member
- Notes ("add a note", "make a note", "note that...", "put a note on...", "log a note"): ALWAYS use the add_note tool — never manage_entity. If the user did not specify which customer or lead the note is for, ASK them first ("Which customer or lead should I add that note to?"), then call add_note with their answer in customer_name or lead_name. Pass the spoken note text exactly as note_text.
- Do NOT say "I cannot access" or "I don't have the ability" — you have full tool access. Use the tools.

RESTRICTIONS:
- You CANNOT delete ANY records under any circumstances — if asked, always say "I can't delete that, you'll need to do it directly in the CRM"
- You CANNOT add, delete, or modify Payments — payment operations must be done by a human
- You CANNOT modify Company settings, subscription plans, or subscription usage data
- For staff profiles and invoices: you can update their status only, never remove them

DATE CONTEXT:
- Today: ${currentDateString}
- Current Time: ${currentTimeString}
- TZ: ${timezone} (offset: ${tzOffset}), Today: ${todayISO}
⚠️ CALENDAR DATES: ALWAYS include the timezone offset in start_time. "at 12pm" → "${todayISO}T12:00:00${tzOffset}". NEVER use bare times like T12:00:00 or Z-suffix — they parse as UTC and display ${Math.abs(parseInt(tzOffset))} hours off.

Start by greeting ${userName} warmly.${recentSessionContext ? `\n\nRECENT CONVERSATION CONTEXT (from your last session with ${userName} — use to maintain continuity, don't re-introduce yourself):\n${recentSessionContext}` : ''}

VOICE & BEHAVIOR RULES (always apply):
1. BREVITY: Keep every response to 1 to 2 short sentences unless you are reading back specific data. Never give long speeches or bulleted lists.
2. NATURAL FLOW: Speak like a real person. Use natural phrases like "Got it," "Sure thing," "On it," or "One sec."
3. ONE QUESTION AT A TIME: When you need clarification, ask a single clear question then stop and wait. Never stack questions.
4. HANDLING INTERRUPTIONS: If the user cuts in or speaks over you, stop immediately and address what they just said.
5. INTENT: Be fast, direct, and action-oriented. Confirm what you did in one short sentence.
${lexiGroundingRules({ compact: true })}`;
  return applySpokenCompanyName(prompt, companyName, deriveSpokenBrandName(spokenNameSetting, companyName));
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
  let spokenName = '';

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
      if (parsed.spoken_name || parsedSettings.spoken_name) {
        spokenName = parsed.spoken_name || parsedSettings.spoken_name;
      }
    }
  } catch (e) {
    console.warn('[Lexi Native] Could not load company settings:', e.message);
  }

  try {
    const spokenRes = await db.query(
      `SELECT data->>'spoken_name' AS spoken_name
         FROM generic_entities
        WHERE entity_type = 'AssistantSettings' AND company_id = $1
          AND COALESCE(data->>'spoken_name', '') <> ''
        ORDER BY updated_date DESC NULLS LAST
        LIMIT 1`,
      [companyId]
    );
    if (spokenRes.rows[0]?.spoken_name) spokenName = spokenRes.rows[0].spoken_name;
  } catch (e) {
    console.warn('[Lexi Native] Could not load spoken company name:', e.message);
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

  // Do not preload customer or staff lists into a voice prompt. Those lists
  // are company-wide and must be returned only by a policy-scoped tool call.

  return { companyName, timezone, knowledgeBase, customerList, staffList, voiceName, preferredLanguage, spokenName };
}

async function getGmailTokenForCompany_native(db, companyId) {
  const res = await db.query(
    `SELECT u.gmail_access_token, u.gmail_refresh_token, u.gmail_token_expires_at, u.gmail_email, u.email
     FROM users u
     JOIN companies c ON LOWER(c.created_by) = LOWER(u.email)
     WHERE c.id = $1 AND u.gmail_connected = true AND u.gmail_access_token IS NOT NULL
     LIMIT 1`,
    [String(companyId)]
  );
  if (res.rows.length === 0) return null;
  const u = res.rows[0];
  let token = u.gmail_access_token;
  const expiry = u.gmail_token_expires_at;
  if (expiry && new Date(expiry) < new Date() && u.gmail_refresh_token) {
    try {
      const refreshResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '', refresh_token: u.gmail_refresh_token, grant_type: 'refresh_token' })
      });
      const rd = await refreshResp.json();
      if (!rd.error && rd.access_token) {
        token = rd.access_token;
        const newExp = new Date(Date.now() + (rd.expires_in * 1000)).toISOString();
        await db.query('UPDATE users SET gmail_access_token = $1, gmail_token_expires_at = $2, updated_at = NOW() WHERE email = $3', [token, newExp, u.email]);
      }
    } catch (refErr) { console.warn('[Gmail Native] Token refresh failed:', refErr.message); }
  }
  return { token, gmail_email: u.gmail_email, user_email: u.email };
}
async function gmailApiCall_native(token, path, method, body) {
  method = method || 'GET';
  const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gmail API error ${resp.status}`);
  }
  return resp.json();
}

async function handleLocalToolCall(name, args, companyId, userEmail, companyTimezone = 'America/New_York', confirmationState = null) {
  const db = getPool();
  console.log(`[Lexi Native] Executing local tool: ${name}`, JSON.stringify(args).substring(0, 200));

  try {
    // This legacy dev-native dispatcher contains unrestricted historical tool
    // implementations. Fail closed for non-admins until each one is migrated
    // to the scoped shared handler used by production voice.
    const [companyResult, profileResult] = await Promise.all([
      db.query('SELECT created_by FROM companies WHERE id = $1 LIMIT 1', [companyId]),
      db.query('SELECT * FROM staff_profiles WHERE company_id = $1 AND (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2)) LIMIT 1', [companyId, userEmail]),
    ]);
    const nativePolicy = buildLexiAccessPolicy({
      company: companyResult.rows[0],
      userProfile: profileResult.rows[0],
      effectiveEmail: userEmail,
    });
    if (!nativePolicy.isAdmin && !['get_build_schedule', 'create_build_schedule'].includes(name)) {
      return lexiAccessDenied('Voice CRM access is limited to administrators while assigned-record voice controls are being completed.');
    }
    if (name === 'get_build_schedule') {
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const r = nativePolicy.isAdmin ? await db.query(`SELECT id, data FROM generic_entities WHERE entity_type='BuildSchedule' AND company_id=$1 ORDER BY data->>'build_date' ASC NULLS LAST LIMIT $2`, [companyId, limit]) : await db.query(`SELECT id, data FROM generic_entities WHERE entity_type='BuildSchedule' AND company_id=$1 AND (LOWER(COALESCE(data->>'created_by',''))=LOWER($2) OR LOWER(COALESCE(data->>'rep_email',''))=LOWER($2) OR COALESCE(data->'assigned_to_users','[]'::jsonb) @> jsonb_build_array(to_jsonb($2::text))) ORDER BY data->>'build_date' ASC NULLS LAST LIMIT $3`, [companyId, userEmail, limit]);
      const builds = r.rows.map(x => x.data || {}).filter(b => (!args.customer_id || b.customer_id === args.customer_id) && (!args.customer_name || (b.customer_name || '').toLowerCase().includes(args.customer_name.toLowerCase())) && (!args.status || (b.status || '').toLowerCase() === args.status.toLowerCase()) && (!args.job_type || JSON.stringify(b.job_type || []).toLowerCase().includes(args.job_type.toLowerCase())) && (!args.date_from || b.build_date >= args.date_from) && (!args.date_to || b.build_date <= args.date_to));
      return { success: true, count: builds.length, builds: builds.map(b => ({ customer_name: b.customer_name, build_date: b.build_date, status: b.status, job_type: b.job_type || [], address: b.address, rep: b.rep, crew: b.crew || b.assigned_to || [], notes: b.notes || null })) };
    }
    if (name === 'create_build_schedule') {
      const types = Array.isArray(args.job_types) ? args.job_types.filter(Boolean) : (args.job_type ? [args.job_type] : []);
      if (!(args.customer_id || args.customer_name) || !args.build_date || !types.length) return { error: 'Build requires customer_name or customer_id, build_date, and one or more job_types.' };
      try { assertBuildDate(args.build_date); } catch (e) { return { error: e.message }; }
      const cr = args.customer_id ? await db.query(`SELECT id,name,phone,email,address FROM customers WHERE id=$1 AND company_id=$2 LIMIT 1`, [args.customer_id, companyId]) : await db.query(`SELECT id,name,phone,email,address FROM customers WHERE company_id=$1 AND name ILIKE $2 LIMIT 1`, [companyId, args.customer_name]);
      const customer = cr.rows[0]; if (!customer) return { error: 'Customer was not found in this company.' };
      const canUseConfirmation = confirmationState
        ? Boolean(
            confirmationState.pendingToken &&
            args.confirmation_token === confirmationState.pendingToken &&
            /^(yes|yeah|yep|yup|sure|okay|ok|go ahead|do it|confirm|confirmed)(\b|[\s,.!])/i.test(String(confirmationState.userReply || '').trim())
          )
        : Boolean(args.confirmation_token);
      const confirmation = buildScheduleConfirmationGuard({
        companyId, userEmail, action: 'create', customerId: customer.id,
        customerName: customer.name, buildDate: args.build_date, jobTypes: types,
      }, canUseConfirmation ? args.confirmation_token : undefined);
      if (confirmation) {
        if (confirmationState) {
          confirmationState.pendingToken = confirmation.confirmation_token;
          confirmationState.userReply = '';
        }
        return confirmation;
      }
      if (confirmationState) {
        confirmationState.pendingToken = null;
        confirmationState.userReply = '';
      }
      const id = generateLexiId('build'), assigned = nativePolicy.isAdmin ? (Array.isArray(args.assigned_to) ? args.assigned_to : [args.assigned_to || userEmail]) : [userEmail];
      const data = { id, company_id: companyId, customer_id: customer.id, customer_name: customer.name, build_date: args.build_date, job_type: types, address: args.address || customer.address || '', customer_phone: args.customer_phone || customer.phone || '', customer_email: args.customer_email || customer.email || '', rep: args.rep || userEmail, rep_email: userEmail, crew: args.crew || [], assigned_to: assigned, assigned_to_users: assigned, notes: args.notes || '', status: args.status || 'scheduled', created_by: userEmail, created_by_name: userEmail };
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'BuildSchedule',$2,$3,NOW(),NOW())`, [id, companyId, JSON.stringify(data)]);
        const day = buildDayRange(args.build_date, companyTimezone);
        const ev = await client.query(`INSERT INTO calendar_events (id,title,start_time,end_time,event_type,company_id,assigned_to,created_by,location,description,status,created_at) VALUES ($1,$2,$3,$4,'build',$5,$6,$6,$7,$8,'scheduled',NOW()) RETURNING id`, [generateLexiId('cal'), `${types.join(' & ')}: ${customer.name}`, day.start_time, day.end_time, companyId, assigned[0], data.address, data.notes]);
        await client.query(`UPDATE generic_entities SET data=data || $1 WHERE id=$2 AND company_id=$3`, [JSON.stringify({ calendar_event_id: ev.rows[0].id }), id, companyId]);
        await client.query('COMMIT'); return { success: true, build_id: id, calendar_event_id: ev.rows[0].id };
      } catch (e) { await client.query('ROLLBACK').catch(() => {}); return { error: `No build was created: ${e.message}` }; } finally { client.release(); }
    }
    if (name === 'get_crm_data') {
      const tableMap = {
        customers: 'customers', leads: 'leads', estimates: 'estimates',
        invoices: 'invoices', tasks: 'tasks', projects: 'projects',
        payments: 'payments', staff: 'staff_profiles', calendar_events: 'calendar_events'
      };
      const table = tableMap[args.data_type];
      if (!table) return { error: `Unknown data type: ${args.data_type}` };

      const f = args.filters || {};

      if (args.data_type === 'leads') {
        let sql = `SELECT * FROM leads WHERE company_id = $1`;
        const sqlParams = [companyId];
        if (f.city) { sqlParams.push(`%${f.city.toLowerCase()}%`); sql += ` AND LOWER(city) LIKE $${sqlParams.length}`; }
        if (f.state) { sqlParams.push(`%${f.state.toLowerCase()}%`); sql += ` AND LOWER(state) LIKE $${sqlParams.length}`; }
        if (f.status) { sqlParams.push(f.status.toLowerCase()); sql += ` AND LOWER(status) = $${sqlParams.length}`; }
        if (f.assigned_to) { sqlParams.push(`%${f.assigned_to.toLowerCase()}%`); sql += ` AND LOWER(assigned_to) LIKE $${sqlParams.length}`; }
        if (f.lead_source) { sqlParams.push(`%${f.lead_source.toLowerCase()}%`); sql += ` AND LOWER(lead_source) LIKE $${sqlParams.length}`; }
        sql += ` ORDER BY created_at DESC NULLS LAST LIMIT 500`;
        const leadsRes = await db.query(sql, sqlParams);
        return { count: leadsRes.rows.length, filter_applied: f, leads: leadsRes.rows.map(r => ({ name: r.name, status: r.status, phone: r.phone, email: r.email, city: r.city, state: r.state, assigned_to: r.assigned_to, lead_source: r.lead_source })) };

      } else if (args.data_type === 'customers') {
        let sql = `SELECT * FROM customers WHERE company_id = $1`;
        const sqlParams = [companyId];
        if (f.city) { sqlParams.push(`%${f.city.toLowerCase()}%`); sql += ` AND LOWER(city) LIKE $${sqlParams.length}`; }
        if (f.state) { sqlParams.push(`%${f.state.toLowerCase()}%`); sql += ` AND LOWER(state) LIKE $${sqlParams.length}`; }
        sql += ` ORDER BY created_at DESC NULLS LAST LIMIT 200`;
        const custRes = await db.query(sql, sqlParams);
        return { count: custRes.rows.length, filter_applied: f, customers: custRes.rows.map(r => ({ name: r.name, email: r.email, phone: r.phone, city: r.city, state: r.state })) };

      } else {
        const countRes = await db.query(`SELECT COUNT(*) as count FROM ${table} WHERE company_id = $1`, [companyId]);
        const sampleRes = await db.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 10`, [companyId]);
        const count = parseInt(countRes.rows[0].count);
        if (args.data_type === 'invoices') {
          // Total every invoice in SQL. Summing the 10-row sample reported a
          // fraction of the real figure, and legacy `amount` is a frozen copy —
          // `total_amount` is the live value.
          const invTotalRes = await db.query(`SELECT COALESCE(SUM(total_amount),0) AS total FROM invoices WHERE company_id = $1 AND COALESCE(status,'') NOT IN ('cancelled','void')`, [companyId]);
          const totalRevenue = Number(invTotalRes.rows[0].total);
          return { count, total_revenue: totalRevenue, total_invoiced_all_time: totalRevenue, sample_is_partial: true, sample: sampleRes.rows.slice(0, 5).map(r => ({ number: r.invoice_number, amount: r.total_amount ?? r.amount, status: r.status })) };
        } else if (args.data_type === 'staff') {
          return { count, staff: sampleRes.rows.map(r => ({ name: r.full_name, email: r.user_email, role: r.role_name })) };
        }
        return { count };
      }

    } else if (name === 'get_calendar_events') {
      const startDate = args.start_date;
      const endDate = args.end_date || startDate;
      const evRes = await db.query(
        `SELECT * FROM calendar_events WHERE company_id = $1 AND start_time >= $2 AND start_time < ($3::date + interval '1 day') ORDER BY start_time`,
        [companyId, startDate, endDate]
      );
      return { events: evRes.rows.map(e => ({ title: e.title, start: e.start_time, end: e.end_time, location: e.location, type: e.event_type })), count: evRes.rows.length };

    } else if (name === 'create_calendar_event') {
      const buildRouteBlock = calendarBuildRouteGuard(args);
      if (buildRouteBlock) return buildRouteBlock;
      // Normalize start_time to a wall-clock ISO string in the company timezone.
      // Gemini sometimes outputs a Z-suffix (UTC) or a bare local time (no offset);
      // both need correcting before we store in the TIMESTAMP (no tz) column.
      let companyTimezone = 'America/New_York';
      try {
        const compRow = await db.query(`SELECT data, settings FROM companies WHERE id = $1`, [companyId]);
        if (compRow.rows[0]) {
          const cd = typeof compRow.rows[0].data === 'string' ? JSON.parse(compRow.rows[0].data) : (compRow.rows[0].data || {});
          const cs = typeof compRow.rows[0].settings === 'string' ? JSON.parse(compRow.rows[0].settings) : (compRow.rows[0].settings || {});
          companyTimezone = cd.timezone || cs.timezone || 'America/New_York';
        }
      } catch (_) {}
      const tzOff = getUtcOffset(companyTimezone);
      // Normalize to UTC ISO string — calendar uses new Date() so times must be UTC
      const calStart = toStorageUtc(args.start_time, tzOff);
      const calEnd   = args.end_time ? toStorageUtc(args.end_time, tzOff) : null;
      const parsedStart = new Date(calStart);
      if (!calStart || isNaN(parsedStart.getTime())) {
        return { error: `I couldn't understand the date/time for "${args.title || 'the event'}". Please give me a specific date and time.` };
      }
      let endTime = calEnd;
      if (!endTime) { endTime = new Date(parsedStart.getTime() + 3600000).toISOString(); }
      const parseReminder = (val) => { const n = parseInt(val); return (!isNaN(n) && n > 0 && n <= 10080) ? n : null; };
      const emailReminder = parseReminder(args.email_reminder_minutes);
      const smsReminder = parseReminder(args.sms_reminder_minutes);
      const browserReminder = parseReminder(args.browser_reminder_minutes);
      // Resolve the real assignee from the tenant; never let a model invent an
      // external email and use it to evade a staff member's calendar guard.
      const assignedTo = String(args.assigned_to || args.assigned_to_email || userEmail).trim().toLowerCase();
      if (assignedTo !== String(userEmail).trim().toLowerCase()) {
        const staff = await db.query(
          `SELECT 1 FROM staff_profiles WHERE company_id = $1
           AND LOWER(COALESCE(user_email, email, '')) = $2 LIMIT 1`,
          [companyId, assignedTo]
        );
        if (!staff.rowCount) return { success: false, code: 'INVALID_ASSIGNEE', error: 'That staff member is not part of this company.' };
      }
      if (args.confirmation_token) {
        const confirmed = await confirmScheduleAndCreate(db, {
          token: args.confirmation_token, companyId, userEmail, title: args.title,
          assignedTo, startTime: calStart, endTime,
        }, async (client) => {
          const id = generateLexiId('cal');
          const result = await client.query(
            `INSERT INTO calendar_events (id, title, start_time, end_time, location, description, event_type, company_id, assigned_to, created_by, created_at,
             send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,NOW(),$10,$11,$12,$13,$14,$15) RETURNING id`,
            [id, args.title, calStart, endTime, args.location || '', args.description || '', args.event_type || 'meeting', companyId, assignedTo,
              emailReminder != null, emailReminder, smsReminder != null, smsReminder, browserReminder != null, browserReminder]
          );
          return result.rows[0].id;
        });
        if (!confirmed.ok) return { success: false, code: confirmed.code, conflict: confirmed.conflict, error: confirmed.code === 'CALENDAR_CONFLICT' ? 'That alternative was just taken. Please choose another available time.' : 'That scheduling confirmation is no longer valid.' };
        let rescheduleSms = null;
        if (args.reschedule_sms_message && (args.customer_id || args.lead_id)) {
          const table = args.customer_id ? 'customers' : 'leads';
          const contact = await db.query(`SELECT name, phone FROM ${table} WHERE id = $1 AND company_id = $2 LIMIT 1`, [args.customer_id || args.lead_id, companyId]);
          if (!contact.rowCount || !contact.rows[0].phone) rescheduleSms = { sent: false, error: 'The selected customer or lead has no phone number in this company.' };
          else {
            const settings = await db.query(`SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [companyId]);
            const tw = settings.rows[0]?.data || {};
            const sid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
            const authToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
            const from = tw.main_phone_number || process.env.TWILIO_PHONE_FROM || process.env.TWILIO_PHONE_NUMBER;
            if (!sid || !authToken || !from) rescheduleSms = { sent: false, error: 'Twilio is not configured for this company.' };
            else {
              const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ To: contact.rows[0].phone, From: from, Body: args.reschedule_sms_message }).toString() });
              rescheduleSms = response.ok ? { sent: true } : { sent: false, error: `SMS provider returned ${response.status}` };
            }
          }
        }
        return { success: true, event_id: confirmed.event, sms: rescheduleSms, message: `Event "${args.title}" created after confirmation.` };
      }
      const requestFingerprint = JSON.stringify({ title: args.title, start_time: calStart, end_time: endTime, assigned_to: assignedTo });
      if (args.confirmation_token) {
        const pending = await db.query(
          `SELECT id, data FROM generic_entities WHERE id = $1 AND entity_type = 'LexiPendingSchedule'
           AND company_id = $2 FOR UPDATE`,
          [args.confirmation_token, companyId]
        );
        const saved = pending.rows[0]?.data || {};
        const selectedOfferedSlot = Array.isArray(saved.alternatives) && saved.alternatives.some(
          (slot) => slot.start === calStart && slot.end === endTime
        );
        if (!pending.rowCount || saved.user_email !== userEmail || saved.status !== 'pending'
          || new Date(saved.expires_at || 0).getTime() < Date.now()
          || saved.requested?.title !== args.title || saved.requested?.assigned_to !== assignedTo
          || !selectedOfferedSlot) {
          return { success: false, code: 'SCHEDULE_CONFIRMATION_INVALID', error: 'That scheduling confirmation is no longer valid. Please review the current availability.' };
        }
      }
      // A personal reminder is an alert, not a commitment of calendar availability.
      // Meetings, calls, appointments, and inspections remain double-booking protected.
      const isReminder = String(args.event_type || '').trim().toLowerCase() === 'reminder';
      const lexiConflict = isReminder ? null : await lexiCheckCalendarConflict(db, companyId, assignedTo, calStart, endTime);
      if (lexiConflict) {
        const durationMs = new Date(endTime).getTime() - new Date(calStart).getTime();
        const alternatives = await lexiFindAvailableSlots(db, companyId, assignedTo, calStart, durationMs, 3);
        const confirmationToken = generateLexiId('lexiconfirm');
        await db.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
           VALUES ($1, 'LexiPendingSchedule', $2, $3::jsonb, NOW(), NOW())`,
          [confirmationToken, companyId, JSON.stringify({
            user_email: userEmail, status: 'pending',
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            request_fingerprint: requestFingerprint, requested: { title: args.title, start_time: calStart, end_time: endTime, assigned_to: assignedTo },
            conflicts: [lexiConflict.existing], alternatives,
          })]
        );
        return {
          success: false, code: 'CALENDAR_CONFLICT', conflict: true,
          requested: { title: args.title, start_time: calStart, end_time: endTime, assigned_to: assignedTo },
          conflicts: [lexiConflict.existing], alternatives, confirmation_token: confirmationToken,
          message: `${lexiConflict.message} Ask whether an available alternative works before booking or texting anyone.`,
        };
      }
      if (args.confirmation_token) {
        await db.query(
          `UPDATE generic_entities SET data = data || $1::jsonb, updated_date = NOW()
           WHERE id = $2 AND entity_type = 'LexiPendingSchedule' AND company_id = $3`,
          [JSON.stringify({ status: 'used', used_at: new Date().toISOString() }), args.confirmation_token, companyId]
        );
      }
      const calId = generateLexiId('cal');
      const evRes = await db.query(
        `INSERT INTO calendar_events (id, title, start_time, end_time, location, description, event_type, company_id, assigned_to, created_by, created_at,
         send_email_notification, email_reminder_minutes, send_sms_notification, sms_reminder_minutes, send_browser_notification, browser_reminder_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NOW(),
         $10, $11, $12, $13, $14, $15) RETURNING id`,
         [calId, args.title, calStart, endTime, args.location || '', args.description || '', args.event_type || 'meeting', companyId, assignedTo,
         emailReminder != null, emailReminder, smsReminder != null, smsReminder, browserReminder != null, browserReminder]
      );
      const reminders = [];
      if (emailReminder) reminders.push(`email ${emailReminder} min before`);
      if (smsReminder) reminders.push(`SMS ${smsReminder} min before`);
      if (browserReminder) reminders.push(`browser ${browserReminder} min before`);
      const reminderMsg = reminders.length > 0 ? ` with reminders: ${reminders.join(', ')}` : '';
      // The booking is committed first. Resolve a contact by tenant-owned ID
      // rather than trusting an LLM-supplied phone number.
      let rescheduleSms = null;
      if (args.confirmation_token && args.reschedule_sms_message && (args.customer_id || args.lead_id)) {
        const contactTable = args.customer_id ? 'customers' : 'leads';
        const contactId = args.customer_id || args.lead_id;
        const contact = await db.query(`SELECT name, phone FROM ${contactTable} WHERE id = $1 AND company_id = $2 LIMIT 1`, [contactId, companyId]);
        if (!contact.rowCount || !contact.rows[0].phone) {
          rescheduleSms = { sent: false, error: 'The selected customer or lead has no phone number in this company.' };
        } else {
          const twSettings = await db.query(`SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [companyId]);
          const tw = twSettings.rows[0]?.data || {};
          const sid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
          const token = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
          const from = tw.main_phone_number || process.env.TWILIO_PHONE_FROM || process.env.TWILIO_PHONE_NUMBER;
          if (!sid || !token || !from) {
            rescheduleSms = { sent: false, error: 'Twilio is not configured for this company.' };
          } else {
            const auth = Buffer.from(`${sid}:${token}`).toString('base64');
            const body = new URLSearchParams({ To: contact.rows[0].phone, From: from, Body: args.reschedule_sms_message });
            const sent = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
              method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
            });
            rescheduleSms = sent.ok
              ? { sent: true }
              : { sent: false, error: `SMS provider returned ${sent.status}` };
          }
        }
      }
      return { success: true, event_id: evRes.rows[0].id, sms: rescheduleSms, message: `Event "${args.title}" created${reminderMsg}` };

    } else if (name === 'create_task') {
      const taskRes = await db.query(
        `INSERT INTO tasks (name, description, due_date, priority, status, company_id, assigned_to, created_at)
         VALUES ($1, $2, $3, $4, 'not_started', $5, $6, NOW()) RETURNING id`,
        [args.name, args.description || '', args.due_date || null, args.priority || 'medium', companyId, userEmail]
      );
      return { success: true, task_id: taskRes.rows[0].id, message: `Task "${args.name}" created` };

    } else if (name === 'route_lead_to_sequence') {
      const lead = await db.query(`SELECT id,name FROM leads WHERE id=$1 AND company_id=$2 LIMIT 1`, [args.lead_id, companyId]);
      const workflow = await db.query(`SELECT id FROM generic_entities WHERE entity_type='Workflow' AND company_id=$1 AND COALESCE(data->>'is_active','true') <> 'false' AND LOWER(COALESCE(data->>'workflow_name',data->>'name',''))=LOWER($2) LIMIT 1`, [companyId, args.sequence_name]);
      if (!lead.rowCount) return { success: false, error: 'That lead is not in this company.' };
      if (!workflow.rowCount) return { success: false, error: 'I could not find an active company follow-up sequence with that name.' };
      const confirmationToken = generateLexiId('lexiorch');
      const action = { type: 'lexi_sequence', lead_id: args.lead_id, workflow_id: workflow.rows[0].id, sequence_name: args.sequence_name };
      await db.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'LexiPendingOrchestration',$2,$3,NOW(),NOW())`, [confirmationToken, companyId, JSON.stringify({ user_email: userEmail, action, status: 'pending', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })]);
      return { requires_confirmation: true, confirmation_token: confirmationToken, proposed_action: action, message: `Ready to enroll ${lead.rows[0].name} in ${args.sequence_name}. Ask for explicit approval before enrolling.` };

    } else if (name === 'trigger_document_packet') {
      const table = args.recipient_type === 'lead' ? 'leads' : args.recipient_type === 'customer' ? 'customers' : null;
      if (!table) return { success: false, error: 'Choose a lead or customer for this packet.' };
      const recipient = await db.query(`SELECT id,name,email,phone FROM ${table} WHERE id=$1 AND company_id=$2 LIMIT 1`, [args.recipient_id, companyId]);
      if (!recipient.rowCount) return { success: false, error: 'That recipient is not in this company.' };
      if (args.channel === 'email' && !recipient.rows[0].email) return { success: false, error: 'That recipient has no email address.' };
      if (args.channel === 'sms' && !recipient.rows[0].phone) return { success: false, error: 'That recipient has no phone number.' };
      const confirmationToken = generateLexiId('lexiorch');
      const action = { type: 'lexi_packet', ...args };
      await db.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'LexiPendingOrchestration',$2,$3,NOW(),NOW())`, [confirmationToken, companyId, JSON.stringify({ user_email: userEmail, action, status: 'pending', expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })]);
      return { requires_confirmation: true, confirmation_token: confirmationToken, proposed_action: action, message: `Ready to send a restoration packet to ${recipient.rows[0].name} by ${String(args.channel).toUpperCase()}. Ask for explicit approval before sending.` };

    } else if (name === 'confirm_lexi_orchestration') {
      const pending = await db.query(`SELECT data FROM generic_entities WHERE id=$1 AND entity_type='LexiPendingOrchestration' AND company_id=$2 FOR UPDATE`, [args.confirmation_token, companyId]);
      const saved = pending.rows[0]?.data || {};
      if (!pending.rowCount || saved.user_email !== userEmail || saved.status !== 'pending' || new Date(saved.expires_at || 0).getTime() < Date.now()) return { success: false, error: 'That approval is no longer valid. Please prepare the action again.' };
      const claimed = await db.query(`UPDATE generic_entities SET data=data || $1::jsonb,updated_date=NOW() WHERE id=$2 AND entity_type='LexiPendingOrchestration' AND company_id=$3 AND data->>'status'='pending' AND (data->>'expires_at')::timestamptz > NOW() RETURNING id`, [JSON.stringify({ status: 'used', used_at: new Date().toISOString() }), args.confirmation_token, companyId]);
      if (!claimed.rowCount) return { success: false, error: 'That approval was already used or expired.' };
      const action = saved.action || {};
      const { functionHandlers } = await import('./vite-functions-plugin.js');
      return await functionHandlers.executeLexiOrchestration(
        { companyId, action },
        process.env.GOOGLE_GEMINI_API_KEY,
        { __lexiNativeCaller: { source: 'lexi_native', companyId, email: userEmail } }
      );
      if (action.type === 'lexi_sequence') {
        const lead = await db.query(`SELECT id,name FROM leads WHERE id=$1 AND company_id=$2 LIMIT 1`, [action.lead_id, companyId]);
        const workflow = await db.query(`SELECT id FROM generic_entities WHERE id=$1 AND entity_type='Workflow' AND company_id=$2 AND COALESCE(data->>'is_active','true') <> 'false' LIMIT 1`, [action.workflow_id, companyId]);
        if (!lead.rowCount || !workflow.rowCount) return { success: false, error: 'The lead or active sequence is no longer available in this company.' };
        const existing = await db.query(`SELECT id FROM generic_entities WHERE entity_type='SequenceEnrollment' AND company_id=$1 AND data->>'lead_id'=$2 AND data->>'workflow_id'=$3 AND data->>'status'='active' LIMIT 1`, [companyId, String(action.lead_id), String(action.workflow_id)]);
        if (existing.rowCount) return { success: true, already_enrolled: true, message: `${lead.rows[0].name} is already enrolled in ${action.sequence_name}.` };
        const enrollmentId = generateLexiId('enrollment');
        await db.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'SequenceEnrollment',$2,$3,NOW(),NOW())`, [enrollmentId, companyId, JSON.stringify({ company_id: companyId, lead_id: action.lead_id, workflow_id: action.workflow_id, sequence_name: action.sequence_name, status: 'active', enrolled_at: new Date().toISOString(), enrolled_by: userEmail })]);
        return { success: true, enrollment_id: enrollmentId, message: `${lead.rows[0].name} was enrolled in ${action.sequence_name}.` };
      }
      if (action.type === 'lexi_packet') {
        const table = action.recipient_type === 'lead' ? 'leads' : action.recipient_type === 'customer' ? 'customers' : null;
        const recipient = table ? await db.query(`SELECT id,name,email,phone FROM ${table} WHERE id=$1 AND company_id=$2 LIMIT 1`, [action.recipient_id, companyId]) : { rowCount: 0 };
        if (!recipient.rowCount) return { success: false, error: 'The packet recipient is no longer available in this company.' };
        const packetId = generateLexiId('packet');
        await db.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'DocumentPacket',$2,$3,NOW(),NOW())`, [packetId, companyId, JSON.stringify({ company_id: companyId, recipient_type: action.recipient_type, recipient_id: action.recipient_id, channel: action.channel, requested_contents: action, delivered_at: new Date().toISOString(), delivered_by: userEmail })]);
        return { success: true, packet_id: packetId, message: `Restoration packet approved for ${recipient.rows[0].name}.` };
      }
      return { success: false, error: 'That approval does not contain a supported action.' };

    } else if (name === 'dispatch_team_notification') {
      const needle = String(args.assignee || '').trim().toLowerCase();
      const staff = await db.query(`SELECT full_name,COALESCE(NULLIF(user_email,''),email) AS email FROM staff_profiles WHERE company_id=$1 AND is_active IS NOT FALSE AND (LOWER(COALESCE(user_email,''))=$2 OR LOWER(COALESCE(email,''))=$2 OR LOWER(COALESCE(full_name,''))=$2) LIMIT 2`, [companyId, needle]);
      if (staff.rowCount !== 1) return { success: false, error: staff.rowCount ? 'More than one teammate matches that name; please use their email.' : 'That teammate is not an active member of this company.' };
      const taskId = generateLexiId('task'), assignee = staff.rows[0];
      await db.query(`INSERT INTO tasks (id,name,description,due_date,priority,status,company_id,assigned_to,created_at) VALUES ($1,$2,$3,$4,$5,'not_started',$6,$7,NOW())`, [taskId, args.title, args.context_note, args.due_date || null, args.priority || 'medium', companyId, assignee.email]);
      await db.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'Notification',$2,$3,NOW(),NOW())`, [generateLexiId('notice'), companyId, JSON.stringify({ company_id: companyId, user_email: assignee.email, title: 'New operational ticket', message: `${args.title}: ${args.context_note}`, type: 'task_assigned', related_entity_type: 'Task', related_entity_id: taskId, link_url: '/Tasks', is_read: false })]);
      return { success: true, task_id: taskId, assignee: assignee.full_name, message: `Operational ticket assigned to ${assignee.full_name}.` };

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

    } else if (name === 'add_note') {
      const noteText = (args.note_text || args.text || args.content || args.body || args.note || '').toString().trim();
      if (!noteText) return { error: 'note_text is required' };

      let customerId = args.customer_id || null;
      let leadId = args.lead_id || null;
      let parentLabel = '';

      if (customerId) {
        const own = await db.query(`SELECT name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(customerId), companyId]);
        if (own.rows.length === 0) return { error: `Customer ${customerId} not found in your company.` };
        parentLabel = `customer "${own.rows[0].name}"`;
      }
      if (leadId) {
        const own = await db.query(`SELECT name FROM leads WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(leadId), companyId]);
        if (own.rows.length === 0) return { error: `Lead ${leadId} not found in your company.` };
        parentLabel = `lead "${own.rows[0].name}"`;
      }

      if (!customerId && args.customer_name) {
        const cn = args.customer_name.trim().toLowerCase();
        const cMatch = await db.query(
          `SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`,
          [companyId, `%${cn}%`, cn]
        );
        if (cMatch.rows.length === 0) {
          return { error: `No customer found matching "${args.customer_name}". Please ask the user for the exact customer name or provide a lead instead.` };
        }
        if (cMatch.rows.length > 1 && cMatch.rows[0].name.toLowerCase() !== cn) {
          return { error: `Multiple customers match "${args.customer_name}": ${cMatch.rows.map(r => r.name).join(', ')}. Ask the user which one.`, candidates: cMatch.rows };
        }
        customerId = cMatch.rows[0].id;
        parentLabel = `customer "${cMatch.rows[0].name}"`;
      }

      if (!customerId && !leadId && args.lead_name) {
        const ln = args.lead_name.trim().toLowerCase();
        const lMatch = await db.query(
          `SELECT id, name FROM leads WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`,
          [companyId, `%${ln}%`, ln]
        );
        if (lMatch.rows.length === 0) {
          return { error: `No lead found matching "${args.lead_name}". Please ask the user for the exact lead name or provide a customer instead.` };
        }
        if (lMatch.rows.length > 1 && lMatch.rows[0].name.toLowerCase() !== ln) {
          return { error: `Multiple leads match "${args.lead_name}": ${lMatch.rows.map(r => r.name).join(', ')}. Ask the user which one.`, candidates: lMatch.rows };
        }
        leadId = lMatch.rows[0].id;
        parentLabel = `lead "${lMatch.rows[0].name}"`;
      }

      if (!customerId && !leadId) {
        return { error: 'No customer or lead specified. Ask the user which customer or lead this note should be attached to before calling add_note again.' };
      }

      let createdByName = null;
      try {
        const spRes = await db.query(`SELECT full_name FROM staff_profiles WHERE user_email = $1 LIMIT 1`, [userEmail]);
        if (spRes.rows.length > 0) createdByName = spRes.rows[0].full_name || null;
      } catch (e) {}

      const noteId = generateLexiId('note');
      const noteData = {
        note: noteText,
        created_at: new Date().toISOString(),
        created_by: userEmail,
        created_by_name: createdByName,
        source_type: 'lexi_voice',
        source_label: 'Lexi Voice'
      };
      if (customerId) noteData.customer_id = customerId;
      if (leadId) noteData.lead_id = leadId;

      await db.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'CustomerNote', $2, $3, NOW(), NOW())`,
        [noteId, companyId, JSON.stringify(noteData)]
      );

      return { success: true, note_id: noteId, message: `Note added to ${parentLabel || 'record'}.` };

    } else if (name === 'send_email') {
      return { requires_confirmation: true, type: 'email', to: args.to, subject: args.subject, message: args.message, status: 'Awaiting confirmation from user' };

    } else if (name === 'send_sms') {
      return { requires_confirmation: true, type: 'sms', to: args.to, message: args.message, status: 'Awaiting confirmation from user' };

    } else if (name === 'save_memory') {
      const memKey = String(args.key || '').trim();
      const memValue = String(args.value || '').trim();
      if (!memKey || !memValue) return { error: 'Both key and value are required to save a memory.', success: false };
      const memImportance = Math.min(10, Math.max(1, parseInt(args.importance, 10) || 5));
      // Personal memories only: never allow 'company' (would inject into every
      // user's sessions) or the calibration categories (different schema).
      let memCategory = String(args.category || 'lexi').trim().toLowerCase() || 'lexi';
      if (['company', 'estimator_calibration', 'job_calibration'].includes(memCategory)) memCategory = 'lexi';
      const memId = crypto.randomUUID();
      await db.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'AIMemory', $2, $3, NOW(), NOW())`,
        [memId, String(companyId), JSON.stringify({
          company_id: String(companyId),
          user_email: userEmail || null,
          key: memKey,
          value: memValue,
          importance: memImportance,
          category: memCategory,
          is_active: true,
          created_by: userEmail || null,
          source: 'lexi_auto'
        })]
      );
      return { success: true, id: memId, message: `Preference saved — I'll remember "${memKey}".` };
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
      };
      const entityName = canonicalizeGenericEntityType(entityNameMap[entityNameRaw.toLowerCase()] || entityNameRaw);
      const entityData = args.entity_data || {};
      const entityId = args.entity_id;

      // A build must not reach the calendar through the generic CRUD tool either.
      const entityBuildRouteBlock = manageEntityBuildRouteGuard(entityName, action, entityData);
      if (entityBuildRouteBlock) return entityBuildRouteBlock;

      if (LEXI_PROTECTED_ENTITIES.map(e => e.toLowerCase()).includes(entityName.toLowerCase())) {
        return { error: `Cannot ${action} ${entityName} — this is a protected entity type. Only a super admin can manage these.` };
      }
      if (entityName.toLowerCase() === 'payment' && LEXI_PAYMENT_BLOCKED_ACTIONS.includes(action)) {
        return { error: `Cannot ${action} Payments — payment operations must be done by a human for security reasons.` };
      }
      if (action === 'create' && entityName === 'BuildSchedule' && isBuildSchedulingMutation(entityData)) {
        const confirmation = buildScheduleConfirmationGuard({
          companyId, userEmail, action: 'create',
          customerId: entityData.customer_id, customerName: entityData.customer_name,
          buildDate: entityData.build_date, jobTypes: entityData.job_type || entityData.job_types,
        }, args.confirmation_token);
        if (confirmation) return confirmation;
        entityData.created_by = entityData.created_by || userEmail;
        entityData.created_by_name = entityData.created_by_name || userEmail;
      }

      const entityTableMap = {
        'Lead': 'leads', 'Customer': 'customers', 'Project': 'projects',
        'Task': 'tasks', 'Estimate': 'estimates',
        'Invoice': 'invoices', 'Payment': 'payments',
        'CalendarEvent': 'calendar_events',
        'StaffProfile': 'staff_profiles',
      };
      const table = entityTableMap[entityName];
      if ((table === 'staff_profiles' || entityName === 'StaffProfile') && action !== 'list') {
        return { error: `I can't ${action} staff records directly. Ask me to add a staff member (added without admin access); changing roles or admin access must be done by an administrator in Settings.` };
      }

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
          [geId, entityName, companyId, JSON.stringify(normalizeGenericEntityData(entityName, { ...entityData, created_by: userEmail }, { applyDefaults: true }))]
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
        if (entityName === 'BuildSchedule' && isBuildSchedulingMutation(entityData)) {
          const proposed = { ...(existing.rows[0].data || {}), ...entityData };
          const confirmation = buildScheduleConfirmationGuard({
            companyId, userEmail, action: 'update', recordId: entityId,
            customerId: proposed.customer_id, customerName: proposed.customer_name,
            buildDate: proposed.build_date, jobTypes: proposed.job_type || proposed.job_types,
          }, args.confirmation_token);
          if (confirmation) return confirmation;
        }
        const mergedData = normalizeGenericEntityData(entityName, { ...(existing.rows[0].data || {}), ...entityData });
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
        `INSERT INTO staff_profiles (id, company_id, name, full_name, user_email, email, phone, role, position, is_administrator, is_super_admin, is_active, created_at, updated_at, created_by)
         VALUES ($1, $2, $3, $3, $4, $4, $5, $6, $6, false, false, true, NOW(), NOW(), $7) RETURNING id`,
        [staffId, companyId, args.full_name, args.email, args.phone || '', args.role || 'Team Member', userEmail]
      );
      return { success: true, staff_id: insertRes.rows[0].id, message: `Staff member "${args.full_name}" added as ${args.role || 'Team Member'}. Added without admin access — an admin can grant that in Settings.` };

    } else if (name === 'add_family_commission_member') {
      const famId = generateLexiId('fam');
      const famMemberData = { full_name: args.full_name, email: args.email, phone: args.phone || '', commission_percentage: args.commission_percentage || 1, notes: args.notes || '', is_active: true, company_id: companyId };
      const famRes = await db.query(`INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'FamilyMember', $2, $3, NOW(), NOW()) RETURNING id`, [famId, companyId, famMemberData]);
      return { success: true, member_id: famRes.rows[0].id, message: `"${args.full_name}" has been added as a Family Commission Member with ${args.commission_percentage || 1}% commission. They will now appear in the Family Commissions page.` };

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

      matched.sort((a, b) =>
        Number(b.is_active !== false) - Number(a.is_active !== false)
        || (Number(b.rating) || 0) - (Number(a.rating) || 0)
        || (Number(b.total_jobs_completed) || 0) - (Number(a.total_jobs_completed) || 0)
      );
      const summary = matched.map(sub => ({
        id: sub.id,
        name: sub.name,
        contact: sub.contact_person || '',
        phone: sub.phone || '',
        base_address: sub.base_address || '',
        rating: Number(sub.rating) || 0,
        rating_count: Number(sub.rating_count) || 0,
        service_radius_miles: Number(sub.service_radius_miles ?? sub.service_radius) || 0,
        specialty: Array.isArray(sub.specialty) ? sub.specialty.join(', ') : (sub.specialty || ''),
        availability: sub.availability || '',
        total_jobs_completed: Number(sub.total_jobs_completed) || 0,
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
        recommended_teams: summary.filter(sub => sub.is_active).slice(0, 3),
        recommendation_basis: 'Active crews are ranked by rating, then completed jobs. Work radius is shown for the dispatcher to compare with the job location. Check get_build_schedule for the requested date before confirming availability.',
        summary_text: matched.length === 0
          ? `No subcontractors found${args.area ? ` in "${args.area}"` : ''}. There are ${allSubs.length} total in the system.`
          : `Found ${matched.length} subcontractor${matched.length !== 1 ? 's' : ''}${args.area ? ` in "${args.area}"` : ''}: ${summary.map(s => s.name).join(', ')}.`
      };

    } else if (name === 'get_activity_log') {
      const limit = Math.max(1, Math.min(args.limit || 20, 50));
      const moduleFilter = (args.module && args.module !== 'all') ? args.module : null;
      const events = [];
      const moduleTableMap = {
        leads: { table: 'leads', module: 'Leads', action: 'Lead Added', descFn: r => `New lead: ${r.name || 'Unknown'} (${r.status || 'New'})${r.lead_source ? ' via ' + r.lead_source : ''}` },
        communications: { table: 'generic_entities', entityType: 'Communication', module: 'Communications', action: 'Message', descFn: r => `${(r.type || 'message').toUpperCase()} ${r.direction || ''} ${r.direction === 'inbound' ? 'from' : 'to'} ${r.contact_name || r.to_number || 'Unknown'}${r.body ? ': ' + String(r.body).slice(0, 80) : ''}` },
        estimates: { table: 'generic_entities', entityType: 'Estimate', module: 'Sales', action: 'Estimate Created', descFn: r => `Estimate for ${r.customer_name || 'Unknown'} — ${r.status || 'Draft'}${r.total ? ', $' + Number(r.total).toLocaleString() : ''}` },
        invoices: { table: 'invoices', module: 'Billing', action: 'Invoice Created', descFn: r => `Invoice for ${r.customer_name || 'Unknown'} — $${Number(r.amount || 0).toLocaleString()} (${r.status || 'Draft'})` },
        tasks: { table: 'tasks', module: 'Tasks', action: 'Task Created', descFn: r => `Task: "${r.name || 'Untitled'}" — ${r.status || 'Open'}${r.assigned_to ? ', assigned to ' + r.assigned_to : ''}` },
        customers: { table: 'customers', module: 'Customers', action: 'Customer Added', descFn: r => `New customer: ${r.name || 'Unknown'}${r.email ? ' (' + r.email + ')' : ''}` },
        workflow: { table: 'generic_entities', entityType: 'WorkflowExecution', module: 'Automation', action: 'Workflow Executed', descFn: r => `Workflow "${r.workflow_name || 'Unknown'}" ran — ${r.status || 'completed'}` },
      };
      const modulesToQuery = moduleFilter ? [moduleFilter] : Object.keys(moduleTableMap);
      for (const mod of modulesToQuery) {
        const cfg = moduleTableMap[mod];
        if (!cfg) continue;
        try {
          let rows = [];
          if (cfg.entityType) {
            const res = await db.query(`SELECT data, created_date FROM generic_entities WHERE entity_type = $1 AND (company_id = $2 OR (data->>'company_id') = $2) ORDER BY created_date DESC NULLS LAST LIMIT 30`, [cfg.entityType, String(companyId)]);
            rows = res.rows.map(r => ({ ...r.data, _created_at: r.created_date }));
          } else {
            const res = await db.query(`SELECT * FROM ${cfg.table} WHERE company_id = $1 ORDER BY created_at DESC NULLS LAST LIMIT 30`, [companyId]);
            rows = res.rows;
          }
          for (const r of rows) {
            const ts = r.created_date || r._created_at || r.created_at;
            if (!ts) continue;
            events.push({ timestamp: ts instanceof Date ? ts.toISOString() : String(ts), module: cfg.module, action: cfg.action, description: cfg.descFn(r), actor: r.created_by || (mod === 'workflow' ? 'System' : undefined) });
          }
        } catch (e) {}
      }
      events.sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());
      if (args.days && args.days > 0) { const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000); events.splice(0, events.length, ...events.filter(e => new Date(e.timestamp) >= cutoff)); }
      const sliced = events.slice(0, limit);
      const byModule = {};
      for (const e of sliced) byModule[e.module] = (byModule[e.module] || 0) + 1;
      const moduleSummary = Object.entries(byModule).map(([m, c]) => `${c} ${m}`).join(', ');
      return { count: sliced.length, summary_by_module: byModule, events: sliced, summary_text: sliced.length === 0 ? 'No recent activity found.' : `Found ${sliced.length} recent activity events: ${moduleSummary}.` };

    } else if (name === 'get_financial_summary') {
      const period = (args.period || 'this_month').toString().toLowerCase();
      // Financial reports run on the company's reporting day and use the date the
      // money actually came in (payment_date), falling back to the row's creation
      // time only when a payment has no date. Filtering on created_at instead
      // reports back-dated entries in the month somebody typed them in.
      // Withheld-fee offsets are bookkeeping entries, not cash, so they are excluded.
      const zonedDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: companyTimezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
      const addDays = (date, days) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
      const today = zonedDate(new Date());
      const [year, month, day] = today.split('-').map(Number);
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      let startDay, endDay = addDays(today, 1);
      if (period === 'this_week') startDay = addDays(today, -(weekday === 0 ? 6 : weekday - 1));
      else if (period === 'last_month') {
        const firstThisMonth = new Date(`${year}-${String(month).padStart(2, '0')}-01T12:00:00Z`);
        firstThisMonth.setUTCMonth(firstThisMonth.getUTCMonth() - 1);
        startDay = firstThisMonth.toISOString().slice(0, 10);
        endDay = `${year}-${String(month).padStart(2, '0')}-01`;
      }
      else if (period === 'this_year') startDay = `${year}-01-01`;
      else if (period === 'last_7_days') startDay = addDays(today, -6);
      else if (period === 'last_30_days') startDay = addDays(today, -29);
      else if (period === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(args.start_date || '')) { startDay = args.start_date; endDay = /^\d{4}-\d{2}-\d{2}$/.test(args.end_date || '') ? addDays(args.end_date, 1) : endDay; }
      else startDay = `${year}-${String(month).padStart(2, '0')}-01`;
      const [fsPayRes, fsInvRes] = await Promise.all([
        db.query(`SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM payments WHERE company_id=$1 AND COALESCE(payment_date, created_at) >= $2::date AND COALESCE(payment_date, created_at) < $3::date AND COALESCE(status,'received') IN ('received','paid','completed') AND COALESCE(data->>'is_withheld_offset', data->'data'->>'is_withheld_offset', 'false') NOT IN ('true','t','1')`, [companyId, startDay, endDay]),
        db.query(`SELECT status, COUNT(*) as count, COALESCE(SUM(total_amount),0) as total FROM invoices WHERE company_id=$1 AND created_at >= $2::date AND created_at < $3::date AND COALESCE(status,'') NOT IN ('cancelled','void') GROUP BY status ORDER BY total DESC`, [companyId, startDay, endDay])
      ]);
      const fsTotalCollected = Number(fsPayRes.rows[0].total);
      const fsTotalInvoiced = fsInvRes.rows.reduce((s,r) => s + Number(r.total), 0);
      const fsInvoiceCount = fsInvRes.rows.reduce((s,r) => s + Number(r.count), 0);
      const fsBreakdown = fsInvRes.rows.map(r => ({ status: r.status || 'unknown', count: Number(r.count), total: Number(r.total) }));
      const fsFmt = n => '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      return { success: true, period, reporting_timezone: companyTimezone, period_range: { start: startDay, end_exclusive: endDay }, cash_received: fsTotalCollected, total_collected: fsTotalCollected, invoices_issued: fsTotalInvoiced, total_invoiced: fsTotalInvoiced, invoice_count: fsInvoiceCount, payment_count: Number(fsPayRes.rows[0].count), invoice_breakdown_by_status: fsBreakdown, summary: `Cash received for ${period.replace(/_/g,' ')}: ${fsFmt(fsTotalCollected)} across ${fsPayRes.rows[0].count} received payment(s). Separately, ${fsInvoiceCount} invoice(s) issued totaled ${fsFmt(fsTotalInvoiced)}.` };

    } else if (name === 'get_staff_sales_summary') {
      const rawStaffName = (args.staff_name || args.rep_name || args.name || '').toString().trim();
      const ssTeamKeywords = ['all', 'team', 'everyone', 'all staff', 'all reps', 'whole team', 'the team', 'the whole team'];
      const isTeamQuery = !rawStaffName || ssTeamKeywords.includes(rawStaffName.toLowerCase());
      const period = (args.period || 'this_month').toString().toLowerCase();
      const nowSs = new Date();
      let startDate, endDate = new Date();
      if (period === 'this_week') { const dow = nowSs.getDay(); const back = dow === 0 ? 6 : dow - 1; startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), nowSs.getDate() - back); }
      else if (period === 'last_month') { startDate = new Date(nowSs.getFullYear(), nowSs.getMonth() - 1, 1); endDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 0, 23, 59, 59, 999); }
      else if (period === 'this_year') { startDate = new Date(nowSs.getFullYear(), 0, 1); }
      else if (period === 'last_7_days') { startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); }
      else if (period === 'last_30_days') { startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); }
      else if (period === 'all_time') { startDate = new Date(0); }
      else if (period === 'custom' && args.start_date) { startDate = new Date(args.start_date); if (args.end_date) endDate = new Date(args.end_date); }
      else { startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 1); }
      if (!startDate || isNaN(startDate.getTime())) startDate = new Date(nowSs.getFullYear(), nowSs.getMonth(), 1);
      const ssFmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const ssInvRes = await db.query(
        `SELECT total_amount, sale_agent, created_by, issue_date, created_at, commission_splits FROM invoices WHERE company_id = $1 AND status = 'paid'`,
        [companyId]
      );
      if (isTeamQuery) {
        const allStaffRes = await db.query(
          `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL ORDER BY full_name`,
          [companyId]
        );
        const salesMap = {}, countMap = {};
        for (const s of allStaffRes.rows) { salesMap[s.user_email] = 0; countMap[s.user_email] = 0; }
        for (const inv of ssInvRes.rows) {
          const dRaw = inv.issue_date || inv.created_at;
          const d = new Date(dRaw);
          if (!dRaw || isNaN(d.getTime()) || d < startDate || d > endDate) continue;
          const invTotal = Number(inv.total_amount || 0);
          const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
          if (splits.length > 0) {
            for (const sp of splits) {
              if (sp && sp.user_email && sp.user_email in salesMap) {
                salesMap[sp.user_email] += invTotal * (Number(sp.split_percentage || 0) / 100);
                countMap[sp.user_email]++;
              }
            }
          } else {
            const email = inv.sale_agent || inv.created_by;
            if (email && email in salesMap) { salesMap[email] += invTotal; countMap[email]++; }
          }
        }
        const ranked = allStaffRes.rows
          .map(s => ({ name: s.full_name, total_sales: salesMap[s.user_email] || 0, invoice_count: countMap[s.user_email] || 0 }))
          .sort((a, b) => b.total_sales - a.total_sales)
          .map((s, i) => ({ rank: i + 1, ...s }));
        const lines = ranked.map(s => `${s.rank}. ${s.name}: ${ssFmt(s.total_sales)} (${s.invoice_count} invoice${s.invoice_count === 1 ? '' : 's'})`);
        return {
          success: true,
          period,
          period_range: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },
          leaderboard: ranked,
          total_reps: ranked.length,
          summary: ranked.length > 0 ? `Sales leaderboard for ${period.replace(/_/g, ' ')}:\n${lines.join('\n')}` : `No sales recorded for ${period.replace(/_/g, ' ')}.`
        };
      } else {
        const escSs = rawStaffName.replace(/[\\%_]/g, '\\$&');
        const staffRes = await db.query(
          `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_active IS NOT FALSE AND user_email IS NOT NULL AND (LOWER(full_name) = LOWER($2) OR full_name ILIKE $3)`,
          [companyId, rawStaffName, `%${escSs}%`]
        );
        const ssRows = staffRes.rows || [];
        const ssExact = ssRows.filter(r => (r.full_name || '').toLowerCase() === rawStaffName.toLowerCase());
        const ssPick = ssExact.length ? ssExact : ssRows;
        if (ssPick.length === 0) return { error: `I couldn't find a team member named "${rawStaffName}". Please check the name or pick someone from your staff list.` };
        if (ssPick.length > 1) {
          const names = ssPick.slice(0, 5).map(r => r.full_name).join(', ');
          return { error: `More than one team member matches "${rawStaffName}": ${names}. Which one did you mean?` };
        }
        const staffMember = ssPick[0];
        const ssEmail = staffMember.user_email;
        let totalSales = 0, invoiceCount = 0;
        for (const inv of ssInvRes.rows) {
          const dRaw = inv.issue_date || inv.created_at;
          const d = new Date(dRaw);
          if (!dRaw || isNaN(d.getTime()) || d < startDate || d > endDate) continue;
          const invTotal = Number(inv.total_amount || 0);
          const splits = Array.isArray(inv.commission_splits) ? inv.commission_splits : [];
          const mySplit = splits.find(s => s && s.user_email === ssEmail);
          if (mySplit) {
            totalSales += invTotal * (Number(mySplit.split_percentage || 0) / 100);
            invoiceCount++;
          } else if (splits.length === 0 && (inv.sale_agent === ssEmail || inv.created_by === ssEmail)) {
            totalSales += invTotal;
            invoiceCount++;
          }
        }
        return {
          success: true,
          staff_name: staffMember.full_name,
          period,
          period_range: { start: startDate.toISOString().split('T')[0], end: endDate.toISOString().split('T')[0] },
          total_sales: totalSales,
          invoice_count: invoiceCount,
          summary: `${staffMember.full_name} brought in ${ssFmt(totalSales)} in sales across ${invoiceCount} paid invoice${invoiceCount === 1 ? '' : 's'} for ${period.replace(/_/g, ' ')}.`
        };
      }

    } else if (name === 'get_photosync_jobs') {
      const psStatus = args.status || 'all';
      const psLimit = Math.min(args.limit || 10, 50);
      const psDaysBack = args.days_back;
      const psWhere = [`entity_type = 'InspectionJob'`, `company_id = $1`];
      const psParams = [companyId];
      if (psStatus && psStatus !== 'all') { psParams.push(psStatus); psWhere.push(`data->>'status' = $${psParams.length}`); }
      if (psDaysBack) psWhere.push(`created_date >= NOW() - INTERVAL '${parseInt(psDaysBack)} days'`);
      const psRes = await db.query(`SELECT id, data, created_date FROM generic_entities WHERE ${psWhere.join(' AND ')} ORDER BY created_date DESC LIMIT ${psLimit}`, psParams);
      const psJobs = psRes.rows.map(r => ({ id: r.id, client: r.data.client_name || r.data.customer_name, client_phone: r.data.client_phone, client_email: r.data.client_email, address: r.data.property_address, status: r.data.status || 'scheduled', priority: r.data.priority, assigned_to: r.data.assigned_to_email, date: r.data.inspection_date || r.data.scheduled_date, time: r.data.inspection_time, damage_type: r.data.damage_type, notes: r.data.notes || null, special_instructions: r.data.special_instructions || null, created: r.created_date }));
      return { jobs: psJobs, total: psJobs.length };

    } else if (name === 'scan_check') {
      const { file_url: scUrl, customer_name: scCustName, customer_id: scCustId } = args;
      if (!scUrl) return { error: 'file_url is required.' };
      let scCustomerId = scCustId || null;
      let scCustomerName = '';
      if (scCustomerId) {
        const scCR = await db.query(`SELECT id, name FROM customers WHERE id::text = $1 AND company_id = $2 LIMIT 1`, [String(scCustomerId), companyId]);
        if (scCR.rows.length > 0) { scCustomerName = scCR.rows[0].name; }
        else { return { error: `Customer "${scCustomerId}" not found.` }; }
      } else if (scCustName) {
        const scCn = scCustName.trim().toLowerCase();
        const scCR = await db.query(`SELECT id, name FROM customers WHERE company_id = $1 AND LOWER(name) LIKE $2 ORDER BY (LOWER(name) = $3) DESC, created_at DESC LIMIT 5`, [companyId, `%${scCn}%`, scCn]);
        if (scCR.rows.length === 0) { return { error: `No customer found matching "${scCustName}".` }; }
        if (scCR.rows.length > 1 && scCR.rows[0].name.toLowerCase() !== scCn) { return { error: `Multiple customers match "${scCustName}": ${scCR.rows.map(r => r.name).join(', ')}. Which one?` }; }
        scCustomerId = scCR.rows[0].id; scCustomerName = scCR.rows[0].name;
      } else { return { error: 'Which customer is this check for? Provide customer_name or customer_id.' }; }
      const scToday = new Date().toISOString().split('T')[0];
      const scApiKey = process.env.GOOGLE_GEMINI_API_KEY;
      let scB64 = null, scMime = 'image/jpeg';
      try {
        const scFR = await fetch(scUrl);
        if (scFR.ok) { scB64 = Buffer.from(await scFR.arrayBuffer()).toString('base64'); scMime = scFR.headers.get('content-type') || 'image/jpeg'; }
      } catch (e) { console.warn('[Lexi Native] scan_check img:', e.message); }
      if (!scB64) return { error: 'Could not read the check image. Ensure the file was uploaded successfully.' };
      let scX = {};
      try {
        const scGR = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${scApiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: scMime, data: scB64 } }, { text: `Extract check details as JSON: amount (number, no $ or commas), check_number (string), check_date (YYYY-MM-DD), payer_name (string), memo (string or null). Today is ${scToday}. Never return a future date. Return JSON only.` }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 256, responseMimeType: 'application/json' } }) }, { timeoutMs: 30000 });
        const scGD = await scGR.json();
        if (!scGD.error) { try { scX = JSON.parse(scGD.candidates?.[0]?.content?.parts?.[0]?.text || '{}'); } catch (e) {} }
      } catch (e) { console.warn('[Lexi Native] scan_check AI:', e.message); }
      const { amount: scAmt, check_number: scChkNum, check_date: scChkDate, payer_name: scPayer, memo: scMemo } = scX;
      let scDate = scToday;
      if (typeof scChkDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(scChkDate)) {
        const scPd = new Date(scChkDate + 'T00:00:00Z');
        if (!isNaN(scPd.getTime()) && scPd <= new Date()) { const scDf = (Date.now() - scPd.getTime()) / 86400000; if (scDf <= 180) { scDate = scChkDate; } else { const [,sm,sd] = scChkDate.split('-').map(Number); const sc = new Date(new Date().getFullYear(), (sm||1)-1, sd||1); if (sc <= new Date()) scDate = sc.toISOString().split('T')[0]; } }
      }
      let scPmtNum = `PMT-${Date.now().toString().slice(-6)}`;
      try { const scLp = await db.query(`SELECT payment_number FROM payments WHERE company_id = $1 ORDER BY created_at DESC LIMIT 1`, [companyId]); if (scLp.rows.length > 0 && scLp.rows[0].payment_number) { const scM = scLp.rows[0].payment_number.match(/\d+$/); if (scM) scPmtNum = `PMT-${String(parseInt(scM[0])+1).padStart(5,'0')}`; } } catch (e) {}
      const { randomUUID: scUUID } = await import('crypto');
      try { await db.query(`INSERT INTO generic_entities (id,entity_type,company_id,data,created_date,updated_date) VALUES ($1,'Document',$2,$3,NOW(),NOW())`, [scUUID(), String(companyId), JSON.stringify({ company_id: String(companyId), document_name: `Check ${scChkNum||scPmtNum}`, file_url: scUrl, category: 'Check', related_entity_type: 'Customer', related_entity_id: scCustomerId, description: `Check: $${scAmt||0} from ${scPayer||'N/A'}`, uploaded_by: userEmail })]); } catch (e) {}
      const scPmtId = scUUID();
      await db.query(`INSERT INTO payments (id,company_id,customer_id,customer_name,payment_number,amount,payment_method,payment_date,reference_number,notes,status,file_url,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'check',$7,$8,$9,'received',$10,NOW(),NOW())`,
        [scPmtId, companyId, scCustomerId, scCustomerName, scPmtNum, scAmt||0, scDate, scChkNum||'', scMemo ? `Payer: ${scPayer||'N/A'}\nMemo: ${scMemo}` : `Payer: ${scPayer||'N/A'}`, scUrl]);
      return { success: true, payment_number: scPmtNum, customer: scCustomerName, amount: scAmt, check_number: scChkNum, check_date: scDate, payer_name: scPayer, message: `Check payment recorded for ${scCustomerName}: $${scAmt||0}, Check #${scChkNum||'N/A'}, Date: ${scDate}` };

    } else if (name === 'read_emails') {
      const { query: gmQ, limit: gmL, unread_only: gmU } = args;
      const gmTok = await getGmailTokenForCompany_native(db, companyId);
      if (!gmTok) return { error: 'Gmail is not connected. The owner needs to go to Settings → Integrations and click Connect Gmail.' };
      const gmLimit = Math.min(gmL || 10, 10);
      let gmSearch = gmQ || 'in:inbox';
      if (gmU) gmSearch = `is:unread ${gmSearch}`;
      const gmList = await gmailApiCall_native(gmTok.token, `/messages?q=${encodeURIComponent(gmSearch)}&maxResults=${gmLimit}`);
      const gmMsgs = gmList.messages || [];
      if (gmMsgs.length === 0) return { emails: [], count: 0, message: 'No emails found.' };
      const gmDetails = await Promise.all(gmMsgs.slice(0, gmLimit).map(async m => {
        try {
          const md = await gmailApiCall_native(gmTok.token, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
          const hdrs = Object.fromEntries((md.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
          return { id: m.id, from: hdrs.from, to: hdrs.to, subject: hdrs.subject, date: hdrs.date, snippet: md.snippet, unread: (md.labelIds || []).includes('UNREAD') };
        } catch (e) { return { id: m.id, error: e.message }; }
      }));
      return { emails: gmDetails, count: gmDetails.length, gmail_account: gmTok.gmail_email };

    } else if (name === 'get_email') {
      const { email_id: gmId } = args;
      if (!gmId) return { error: 'email_id is required' };
      const gmTok = await getGmailTokenForCompany_native(db, companyId);
      if (!gmTok) return { error: 'Gmail is not connected.' };
      const gmMsg = await gmailApiCall_native(gmTok.token, `/messages/${gmId}?format=full`);
      const gmHdrs = Object.fromEntries((gmMsg.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
      function gmExtractBody(payload) {
        if (payload.mimeType === 'text/plain' && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
        if (payload.parts) { for (const p of payload.parts) { const t = gmExtractBody(p); if (t) return t; } }
        if (payload.mimeType?.startsWith('text/') && payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
        return '';
      }
      const gmBody = gmExtractBody(gmMsg.payload || {}).substring(0, 4000);
      return { id: gmId, from: gmHdrs.from, to: gmHdrs.to, subject: gmHdrs.subject, date: gmHdrs.date, body: gmBody, unread: (gmMsg.labelIds || []).includes('UNREAD') };

    } else if (name === 'reply_to_email') {
      const { email_id: gmReId, body: gmReBody } = args;
      if (!gmReId || !gmReBody) return { error: 'email_id and body are both required' };
      const gmTok = await getGmailTokenForCompany_native(db, companyId);
      if (!gmTok) return { error: 'Gmail is not connected.' };
      const gmOrig = await gmailApiCall_native(gmTok.token, `/messages/${gmReId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Message-ID`);
      const gmHdrs = Object.fromEntries((gmOrig.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value]));
      const gmSubject = gmHdrs.subject?.startsWith('Re:') ? gmHdrs.subject : `Re: ${gmHdrs.subject || '(no subject)'}`;
      const gmReplyTo = gmHdrs.from || '';
      const gmMsgId = gmHdrs['message-id'] || '';
      const gmRaw = [`From: ${gmTok.gmail_email}`, `To: ${gmReplyTo}`, `Subject: ${gmSubject}`, `In-Reply-To: ${gmMsgId}`, `References: ${gmMsgId}`, `Content-Type: text/plain; charset=utf-8`, ``, gmReBody].join('\r\n');
      const gmEncoded = Buffer.from(gmRaw).toString('base64url');
      await gmailApiCall_native(gmTok.token, '/messages/send', 'POST', { raw: gmEncoded, threadId: gmOrig.threadId });
      return { success: true, message: `Reply sent to ${gmReplyTo}`, subject: gmSubject };

    } else if (name === 'mark_email_read') {
      const { email_id: gmMrId } = args;
      if (!gmMrId) return { error: 'email_id is required' };
      const gmTok = await getGmailTokenForCompany_native(db, companyId);
      if (!gmTok) return { error: 'Gmail is not connected.' };
      await gmailApiCall_native(gmTok.token, `/messages/${gmMrId}/modify`, 'POST', { removeLabelIds: ['UNREAD'] });
      return { success: true, message: 'Email marked as read' };

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

      wss.on('connection', async (clientWs, req) => {
        console.log('[Lexi Native] Browser client connected');

        const url = new URL(req.url, `http://${req.headers.host}`);
        const requestedCompanyId = url.searchParams.get('companyId') || '';

        // Verify the login session server-side. The companyId/userEmail query
        // params are display hints only — the session cookie decides who this
        // connection acts as and which company's data it can touch.
        let auth;
        try {
          auth = await authenticateLexiWs(req, requestedCompanyId, getPool());
        } catch (e) {
          auth = { ok: false, reason: `auth error: ${e.message}` };
        }
        if (!auth.ok) {
          console.warn(`[Lexi Native] Connection rejected: ${auth.reason} (requested company: ${requestedCompanyId || 'none'})`);
          try {
            clientWs.send(JSON.stringify({ type: 'error', message: 'Not authorized. Please sign in again.' }));
          } catch {}
          clientWs.close(1008, 'unauthorized');
          return;
        }

        const companyId = auth.companyId;
        const userEmail = auth.email;
        const rawUserName = (url.searchParams.get('userName') || '').trim();
        function normalizeFirstName(raw, email) {
          let candidate = (raw || '').trim();
          if (candidate.includes('@')) candidate = candidate.split('@')[0] || '';
          candidate = candidate.split(/\s+/)[0] || '';
          candidate = candidate.split(/[._\-+0-9]/).filter(Boolean)[0] || '';
          if (!candidate && email) {
            const local = email.split('@')[0] || '';
            candidate = (local.split(/[._\-+0-9]/).filter(Boolean)[0]) || '';
          }
          if (!candidate) return 'there';
          return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
        }
        const userName = normalizeFirstName(rawUserName, userEmail);
        const requestedVoice = url.searchParams.get('voice') || 'Kore';
        // hands_free=1 → car-friendly VAD (longer pause, forgiving echo tail)
        // hands_free=0 (default) → snappier desktop profile
        const handsFree = url.searchParams.get('hands_free') === '1';
        console.log(`[Lexi Native] Session mode: ${handsFree ? 'hands-free/Drive Mode' : 'standard continuous voice'}`);

        let geminiWs = null;
        let setupComplete = false;
        let sessionStartTime = Date.now();
        let conversationLog = [];
        let toolCallsMade = [];
        let voiceToolCallsInFlight = 0;
        let voiceTurn = { userMessage: '', assistantText: '', toolCalls: [], audioChunks: [], sensitive: false };
        const buildConfirmationState = { pendingToken: null, userReply: '' };
        const resetVoiceTurn = () => {
          voiceTurn = { userMessage: '', assistantText: '', toolCalls: [], audioChunks: [], sensitive: false };
        };
        let geminiIsSpeaking = false;
        let geminiSpeechEndTimer = null;
        const POST_SPEECH_BUFFER_MS = 1200;
        // Drive Mode: one logical session for the user even if the upstream
        // Gemini socket drops. Bounded so a hard failure still surfaces instead
        // of reconnecting forever and silently billing AI minutes.
        let clientClosed = false;
        let sessionSaved = false;
        let geminiReconnects = 0;
        const MAX_GEMINI_RECONNECTS = 3;
        // A socket that connects but never finishes setup would otherwise hang
        // Drive Mode in "reconnecting" forever without consuming an attempt.
        let setupWatchdog = null;
        const SETUP_TIMEOUT_MS = 15000;

        function saveSessionOnce() {
          if (sessionSaved) return;
          sessionSaved = true;
          const durationSec = Math.round((Date.now() - sessionStartTime) / 1000);
          saveSessionLocally(companyId, userEmail, durationSec, conversationLog, toolCallsMade);
        }

        // Drive Mode deliberately survives silence, but an abandoned tab must not
        // bill AI minutes indefinitely. Only real conversation counts as activity:
        // the mic streams continuously, so raw audio frames would defeat the cap.
        const MAX_IDLE_MS = Number(process.env.LEXI_MAX_IDLE_MS || 15 * 60 * 1000);
        let lastActivityAt = Date.now();
        const markActivity = () => { lastActivityAt = Date.now(); };
        const idleTimer = setInterval(() => {
          if (Date.now() - lastActivityAt < MAX_IDLE_MS) return;
          console.log('[Lexi Native] Session idle past cap — ending to stop billing', {
            handsFree,
            durationSec: Math.round((Date.now() - sessionStartTime) / 1000),
            idleForSec: Math.round((Date.now() - lastActivityAt) / 1000),
          });
          clientClosed = true;
          try { clientWs.send(JSON.stringify({ type: 'status', status: 'disconnected', reason: 'idle' })); } catch (e) {}
          try { geminiWs?.close(); } catch (e) {}
          saveSessionOnce();
          try { clientWs.close(4002, 'idle'); } catch (e) {}
        }, 30000);

        const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!geminiApiKey) {
          console.error('[Lexi Native] GOOGLE_GEMINI_API_KEY not set!');
          clientWs.send(JSON.stringify({ type: 'error', message: 'API key not configured' }));
          clientWs.close();
          return;
        }

        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

        async function connectGemini(isReconnect = false) {
          // Must be reset BEFORE the socket is created: a stale `true` from the
          // previous socket would let audio be relayed into a socket that has
          // not finished setup, and Gemini closes the connection with 1007.
          setupComplete = false;
          let voiceName = requestedVoice;
          let companyName = 'CompanySync';
          let timezone = 'America/New_York';
          let knowledgeBase = '';
          let customerList = '';
          let staffList = [];
          let preferredLanguage = 'en';
          let spokenName = '';

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
              spokenName = settings.spokenName || '';
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

          // The browser may have hung up while the settings/transcript queries
          // above were awaiting. Opening a socket now would orphan it.
          if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
            console.log('[Lexi Native] Client gone during setup — skipping Gemini connect');
            return;
          }

          // On a reconnect, carry the live conversation forward so Lexi resumes
          // mid-thought instead of restarting cold.
          if (isReconnect && conversationLog.length > 0) {
            recentSessionContext = conversationLog
              .slice(-20)
              .map(e => `${e.role}: ${e.text}`)
              .join('\n');
          }

          console.log(`[Lexi Native] Connecting to Gemini: voice=${voiceName}, company=${companyName}, reconnect=${isReconnect}`);

          geminiWs = new WebSocket(geminiUrl);
          const thisWs = geminiWs;

          if (setupWatchdog) clearTimeout(setupWatchdog);
          setupWatchdog = setTimeout(() => {
            if (geminiWs !== thisWs || setupComplete) return;
            console.warn('[Lexi Native] Gemini setup stalled — closing so the attempt is retried');
            try { thisWs.terminate(); } catch (e) {}
          }, SETUP_TIMEOUT_MS);

          geminiWs.on('open', () => {
            console.log('[Lexi Native] Connected to Gemini, sending setup...');

            const systemPrompt = buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage, recentSessionContext, spokenName);

            const setupMsg = {
              setup: {
                // Keep in lockstep with the Lexi bridge in prod-server.cjs.
                // Env var overrides for rollback (same lever as the phone bridges).
                model: process.env.GEMINI_NATIVE_AUDIO_MODEL || "models/gemini-3.1-flash-live-preview",
                generation_config: {
                  response_modalities: ["AUDIO"],
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: { voice_name: voiceName }
                    }
                  }
                },
                input_audio_transcription: {},
                output_audio_transcription: {},
                realtime_input_config: {
                  automatic_activity_detection: {
                    disabled: false,
                    start_of_speech_sensitivity: "START_SENSITIVITY_HIGH",
                    // Hands-free/car: LOW sensitivity waits longer before declaring
                    // end-of-speech — prevents cutting off mid-thought pauses while
                    // driving. Gemini Live accepts LOW/HIGH only; HIGH keeps
                    // desktop sessions responsive without a rejected setup.
                    end_of_speech_sensitivity: handsFree ? "END_SENSITIVITY_LOW" : "END_SENSITIVITY_HIGH",
                    prefix_padding_ms: 300,
                    // Hands-free: 1600ms lets the user pause (checking mirrors, stopping
                    // at lights) without triggering end-of-turn. Desktop: 1000ms keeps
                    // the conversation feeling snappy.
                    silence_duration_ms: handsFree ? 1600 : 1000
                  }
                },
                system_instruction: {
                  parts: [
                    { text: systemPrompt },
                    { text: 'If the user explicitly says stop, stop talking, or asks you to be quiet, stop the current response immediately and wait silently for their next request. Do not continue or repeat the interrupted answer.' }
                  ]
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
                // The browser can hang up between socket open and setupComplete.
                // Without this guard the socket (and its keepalive) is orphaned.
                if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
                  console.log('[Lexi Native] Client gone before setupComplete — closing Gemini socket');
                  try { thisWs.close(); } catch (e) {}
                  return;
                }
                console.log('[Lexi Native] Setup complete, ready for voice');
                setupComplete = true;
                if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }
                markActivity();
                clientWs.send(JSON.stringify({ type: 'status', status: 'ready' }));

                // Re-greeting after every network blip would be jarring in a car;
                // the reconnect carries prior turns in the system prompt instead.
                if (!isReconnect) {
                  thisWs.send(JSON.stringify({
                    client_content: {
                      turns: [{
                        role: "user",
                        parts: [{ text: `Greet ${userName} warmly. Keep it under 15 words.` }]
                      }],
                      turn_complete: true
                    }
                  }));
                }
              }

              if (data.toolCall) {
                markActivity();
                console.log('[Lexi Native] Gemini requested tool call:', JSON.stringify(data.toolCall).substring(0, 300));
                const functionCalls = data.toolCall.functionCalls || [];
                voiceToolCallsInFlight += functionCalls.length;
                const toolResponses = [];

                // Every send below targets thisWs, never the mutable geminiWs:
                // a reconnect during the awaits would otherwise deliver this
                // socket's tool response into a session that never asked for it.
                for (const fc of functionCalls) {
                  let parsedArgs = {};
                  try {
                    parsedArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                  } catch (e) {
                    parsedArgs = {};
                  }

                  const result = await handleLocalToolCall(fc.name, parsedArgs, companyId, userEmail, timezone, buildConfirmationState);
                  toolCallsMade.push(fc.name);
                  voiceTurn.toolCalls.push({ name: fc.name, args: parsedArgs, result });
                  conversationLog.push({ role: 'Tool', text: `${fc.name}(${JSON.stringify(parsedArgs).substring(0, 100)})` });

                  const responseObj = groundToolResult(fc.name, (typeof result === 'object' && result !== null) ? result : { output: String(result) });
                  toolResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: responseObj
                  });
                  voiceToolCallsInFlight = Math.max(0, voiceToolCallsInFlight - 1);

                  clientWs.send(JSON.stringify({ type: 'tool_call', name: fc.name }));
                }

                // The tool handlers above are awaited and side-effecting. If the
                // socket was superseded meanwhile, drop the response rather than
                // injecting it into the new session.
                if (geminiWs !== thisWs) {
                  console.warn('[Lexi Native] Gemini socket superseded during tool call — discarding stale tool response');
                } else if (thisWs.readyState === WebSocket.OPEN) {
                  thisWs.send(JSON.stringify({
                    tool_response: {
                      function_responses: toolResponses
                    }
                  }));
                  console.log('[Lexi Native] Tool responses sent to Gemini');

                  const toolNames = toolResponses.map(t => t.name).join(', ');
                  thisWs.send(JSON.stringify({
                    client_content: {
                      turns: [{ role: "user", parts: [{ text: `[System: Tool results above for ${toolNames}. Now respond VERBALLY to the user with a brief, conversational summary. Keep it natural and under 30 words.]` }] }],
                      turn_complete: true
                    }
                  }));
                }
              }

              if (data.serverContent?.inputTranscription?.text) {
                const userText = data.serverContent.inputTranscription.text;
                markActivity();
                if (buildConfirmationState.pendingToken) {
                  buildConfirmationState.userReply = userText;
                }
                voiceTurn.userMessage += `${voiceTurn.userMessage ? ' ' : ''}${userText}`;
                voiceTurn.sensitive = isVoiceGroundingSensitive(voiceTurn.userMessage);
                conversationLog.push({ role: 'User', text: userText });
                clientWs.send(JSON.stringify({ type: 'transcript', role: 'user', text: userText }));
              }

              if (data.serverContent?.outputTranscription?.text) {
                const lexiText = data.serverContent.outputTranscription.text;
                markActivity();
                voiceTurn.assistantText += `${voiceTurn.assistantText ? ' ' : ''}${lexiText}`;
                if (!voiceTurn.sensitive) {
                  conversationLog.push({ role: 'Lexi', text: lexiText });
                  clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: lexiText }));
                }
              }

              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.text) {
                    const isThinking = /\*\*/.test(part.text) || part.text.includes("I'm starting") || part.text.includes("I've formulated") || part.text.includes("My immediate focus") || part.text.includes("I will leverage");
                    if (!isThinking) {
                      textChunksSent++;
                      voiceTurn.assistantText += `${voiceTurn.assistantText ? ' ' : ''}${part.text}`;
                      if (!voiceTurn.sensitive) {
                        conversationLog.push({ role: 'Lexi', text: part.text });
                        clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: part.text }));
                      }
                    } else {
                      console.log('[Lexi Native] Filtered thinking text:', part.text.substring(0, 80));
                    }
                  }
                  if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
                    const audioSize = part.inlineData.data?.length || 0;
                    if (audioSize > 0 && clientWs.readyState === WebSocket.OPEN) {
                      audioChunksSent++;
                      if (voiceTurn.sensitive) {
                        voiceTurn.audioChunks.push({ data: part.inlineData.data, mimeType: part.inlineData.mimeType });
                      } else {
                        geminiIsSpeaking = true;
                        if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
                        clientWs.send(JSON.stringify({
                          type: 'audio',
                          data: part.inlineData.data,
                          mimeType: part.inlineData.mimeType
                        }));
                      }
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
                if (voiceTurn.sensitive && voiceToolCallsInFlight > 0) {
                  console.log('[Lexi Native] Deferring sensitive turn completion until tool results arrive');
                  return;
                }
                if (voiceTurn.sensitive) {
                  const verdict = auditVoiceTurn(voiceTurn);
                  const finalText = String(verdict.response || voiceTurn.assistantText || '').trim();
                  if (verdict.replaced || verdict.blocked) {
                    console.warn(`[Lexi Native] Blocked/replaced voice answer: ${verdict.reason || 'grounding audit'}`);
                    if (finalText) {
                      conversationLog.push({ role: 'Lexi', text: finalText });
                      clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: finalText }));
                      clientWs.send(JSON.stringify({ type: 'speak_text', text: finalText }));
                    }
                  } else {
                    if (finalText) {
                      conversationLog.push({ role: 'Lexi', text: finalText });
                      clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: finalText }));
                    }
                    for (const chunk of voiceTurn.audioChunks) {
                      clientWs.send(JSON.stringify({ type: 'audio', data: chunk.data, mimeType: chunk.mimeType }));
                    }
                    if (voiceTurn.audioChunks.length > 0) geminiIsSpeaking = true;
                  }
                  resetVoiceTurn();
                }
                clientWs.send(JSON.stringify({ type: 'turn_complete' }));
                // Safety: if client never sends playback_done (mobile onended bug),
                // force-open the mic gate after 10s so the user isn't stuck forever.
                if (geminiIsSpeaking) {
                  setTimeout(() => {
                    if (geminiIsSpeaking) {
                      geminiIsSpeaking = false;
                      console.log('[Lexi Native] Safety timeout: force-cleared geminiIsSpeaking after turnComplete');
                    }
                  }, 10000);
                }
              }
            } catch (err) {
              console.error('[Lexi Native] Gemini message error:', err.message);
            }
          });

          geminiWs.on('close', (code, reason) => {
            console.log('[Lexi Native] Gemini disconnected:', {
              code,
              reason: reason?.toString() || '(no reason)',
              handsFree,
              durationSec: Math.round((Date.now() - sessionStartTime) / 1000),
              browserOpen: clientWs.readyState === WebSocket.OPEN,
              clientClosed,
              reconnectAttempt: geminiReconnects,
            });
            // A superseded socket (already replaced by a reconnect) must not
            // trigger another reconnect or tear the live session down.
            if (geminiWs !== thisWs) return;
            setupComplete = false;
            if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }

            if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
              saveSessionOnce();
              return;
            }

            if (geminiReconnects < MAX_GEMINI_RECONNECTS) {
              const attempt = ++geminiReconnects;
              const waitMs = attempt * 700;
              console.log(`[Lexi Native] Reconnecting to Gemini (${attempt}/${MAX_GEMINI_RECONNECTS}) in ${waitMs}ms`);
              // The browser socket stays open, so from the user's side this is
              // still one continuous session.
              clientWs.send(JSON.stringify({ type: 'status', status: 'reconnecting', attempt, max: MAX_GEMINI_RECONNECTS }));
              geminiIsSpeaking = false;
              if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
              setTimeout(() => {
                if (clientClosed || clientWs.readyState !== WebSocket.OPEN) return;
                connectGemini(true).catch(err => {
                  console.error('[Lexi Native] Reconnect failed:', err.message);
                });
              }, waitMs);
              return;
            }

            // Reconnects exhausted. Own the teardown: close the browser socket
            // too, otherwise the client keeps a dead session alive with the mic
            // and wake lock still held and never runs its own recovery.
            saveSessionOnce();
            clientClosed = true;
            clientWs.send(JSON.stringify({ type: 'status', status: 'disconnected', code, fatal: true }));
            try { clientWs.close(4001, 'gemini-unreachable'); } catch (e) {}
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
              // The browser already stopped playback and gated local echo.
              // Forward the user's speech immediately so Gemini can hear the
              // barge-in instead of dropping the word "stop".
              if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
              geminiIsSpeaking = false;
            }

            if (msg.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN && setupComplete && !geminiIsSpeaking) {
              geminiWs.send(JSON.stringify({
                realtime_input: {
                  audio: {
                    data: msg.data,
                    mimeType: "audio/pcm;rate=16000"
                  }
                }
              }));
            }

            if (msg.type === 'text' && geminiWs && geminiWs.readyState === WebSocket.OPEN && setupComplete) {
              if (buildConfirmationState.pendingToken) {
                buildConfirmationState.userReply = String(msg.text || '');
              }
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

        clientWs.on('close', (code, reason) => {
          console.log('[Lexi Native] Browser client disconnected:', {
            code: code || 1005,
            reason: reason?.toString() || '(no reason)',
            handsFree,
            durationSec: Math.round((Date.now() - sessionStartTime) / 1000),
            geminiState: geminiWs?.readyState,
            setupComplete,
            reconnectAttempt: geminiReconnects,
          });
          // Set BEFORE closing the upstream socket so its close handler treats
          // this as an intentional stop and does not schedule a reconnect.
          clientClosed = true;
          saveSessionOnce();
          if (idleTimer) clearInterval(idleTimer);
          if (setupWatchdog) { clearTimeout(setupWatchdog); setupWatchdog = null; }
          if (geminiWs && (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING)) {
            geminiWs.close();
          }
        });
      });
    }
  };
}

// Named exports for the STAFF PHONE MODE in vite-twilio-ws-plugin.js:
// when a verified staff member calls the company line, the phone bridge
// reuses Lexi's full CRM tool set and executes tools through the same
// handler (dev-side). Prod mirrors this via the copies already colocated
// in prod-server.cjs (LEXI_CRM_TOOLS / handleLexiToolCall).
export { LEXI_CRM_TOOLS, handleLocalToolCall };
