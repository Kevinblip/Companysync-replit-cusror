'use strict';

// Lexi by phone — Kevin's private cell line.
//
// Separate from the Sarah/Alex receptionist (/api/twilio/voice, /ws/twilio).
// Phase 1 can save Kevin's own notes, tasks, and reminders immediately, and can
// look up a contact. Anything that would message a customer is drafted and sent
// only after an explicit "yes, send it". Deletes are refused. The SMS thread and
// call transcripts live in the database.

const crypto = require('crypto');

const TEXT_MODEL = 'gemini-2.5-flash';
const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-latest';
const PIN_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_LOCK_MS = 15 * 60 * 1000;
const MAX_PIN_FAILURES = 5;
const THREAD_ENTITY = 'LexiPhoneThread';

const WORD_DIGITS = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

const PHONE_TOOLS = [
  {
    name: 'verify_pin',
    description: 'Check the short PIN Kevin just spoke or texted. Required before any customer lookup or customer message. Personal notes, tasks, and reminders do not need this.',
    parameters: { type: 'object', properties: { digits: { type: 'string', description: 'The PIN digits he just gave, with no extra words.' } }, required: ['digits'] },
  },
  {
    name: 'create_personal_note',
    description: 'Save a personal note for Kevin immediately. Not a customer record and not a message to anyone.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'create_task',
    description: 'Create a task for Kevin and save it immediately.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'create_reminder',
    description: 'Create a personal reminder on Kevin\'s calendar and save it immediately. This does not text or email anyone.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, when: { type: 'string', description: 'ISO datetime' }, note: { type: 'string' } }, required: ['title', 'when'] },
  },
  {
    name: 'list_my_tasks',
    description: 'Read Kevin\'s open tasks. Does not change anything.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_my_schedule',
    description: 'Read Kevin\'s upcoming calendar events and reminders. Does not change anything.',
    parameters: { type: 'object', properties: { start_date: { type: 'string' }, end_date: { type: 'string' } } },
  },
  {
    name: 'lookup_contact',
    description: 'Read-only lookup of one customer or lead by name or phone. Requires Kevin\'s PIN first. Does not message them.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' } } },
  },
  {
    name: 'draft_customer_message',
    description: 'Prepare an email or text to a customer. Does NOT send it. Read the draft back and wait until Kevin says "yes, send it". Requires the PIN.',
    parameters: { type: 'object', properties: { channel: { type: 'string', enum: ['sms', 'email'] }, to: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' }, contact_name: { type: 'string' } }, required: ['channel', 'to', 'message'] },
  },
  {
    name: 'confirm_send',
    description: 'Send the draft already read back, and only when Kevin\'s latest words are an explicit "yes, send it". Never call this in the same breath as creating the draft.',
    parameters: { type: 'object', properties: {} },
  },
];

const CUSTOMER_TOOLS = new Set(['lookup_contact', 'draft_customer_message', 'confirm_send']);

function configFromEnv(env = process.env) {
  const allowRaw = env.LEXI_PHONE_ALLOWLIST;
  return {
    lexiNumber: env.LEXI_PHONE_NUMBER || '+12165160246',
    // No built-in owner number. An unset allowlist denies every caller.
    allowlist: allowRaw === undefined || allowRaw === null
      ? []
      : String(allowRaw).split(',').map((s) => s.trim()).filter(Boolean),
    pin: String(env.LEXI_PHONE_PIN || ''),
    forwardTo: String(env.LEXI_PHONE_FORWARD_TO || '').trim(),
    companyId: String(env.LEXI_PHONE_COMPANY_ID || '').trim(),
    userEmail: String(env.LEXI_PHONE_USER_EMAIL || '').trim(),
    userName: String(env.LEXI_PHONE_USER_NAME || 'Kevin').trim() || 'Kevin',
    summarySms: /^(1|true|yes|on)$/i.test(String(env.LEXI_PHONE_SUMMARY_SMS || '')),
  };
}

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function last10(phone) {
  const d = digitsOnly(phone);
  return d.length >= 10 ? d.slice(-10) : d;
}

function toE164(phone) {
  const d = digitsOnly(phone);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(phone || '').trim().startsWith('+') && d) return `+${d}`;
  return d ? `+${d}` : '';
}

function isAllowlisted(from, allowlist) {
  const caller = last10(from);
  if (!caller || caller.length < 10) return false;
  return (allowlist || []).some((n) => last10(n) === caller);
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function signatureAccepted(result) {
  return !!(result && result.valid === true);
}

function buildVoiceTwiml({ allowed, host, from, callSid, forwardTo }) {
  if (!allowed) {
    const say = forwardTo
      ? "This number is a private assistant. I'll connect you with the office."
      : 'This number is a private assistant. Please call the main office line. Goodbye.';
    const next = forwardTo
      ? `<Dial timeout="20">${xmlEscape(toE164(forwardTo))}</Dial>`
      : '<Hangup/>';
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${xmlEscape(say)}</Say>${next}</Response>`;
  }
  const wsUrl = `wss://${host}/ws/lexi-phone`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xmlEscape(wsUrl)}"><Parameter name="from" value="${xmlEscape(from || '')}" /><Parameter name="callSid" value="${xmlEscape(callSid || '')}" /></Stream></Connect></Response>`;
}

function buildSmsTwiml(message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`;
}

function pinMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  if (!b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function spokenDigits(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => {
      if (WORD_DIGITS[word] !== undefined) return WORD_DIGITS[word];
      if (/^\d+$/.test(word)) return word;
      return '';
    })
    .join('');
}

function utteranceUnlocksPin(text, pin) {
  if (!pin) return false;
  const stripped = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(my|the|pin|is|its|it's|number|code|please)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return false;
  const raw = digitsOnly(stripped);
  const words = stripped.split(' ').filter(Boolean);
  const leftover = words.filter((word) => WORD_DIGITS[word] === undefined && !/^\d+$/.test(word));
  if (leftover.length) return false;
  if (raw && raw === String(pin)) return true;
  const spoken = spokenDigits(stripped);
  return !!spoken && spoken === String(pin);
}

function redactPin(text, pin) {
  const original = String(text || '');
  if (!pin) return original;
  if (utteranceUnlocksPin(original, pin)) return '[PIN]';
  return original.split(String(pin)).join('[PIN]');
}

function isExplicitSendConfirmation(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(yes(?:,| )+please send it|yes(?:,| )+send it|go ahead and send it|send it)( now)?$/.test(t);
}

function isDeleteRequest(name, args) {
  const n = String(name || '').toLowerCase();
  if (n.includes('delete') || n.includes('destroy') || /(^|_)(remove|trash)($|_)/.test(n)) return true;
  const action = String(args?.entity_action || args?.action || '').toLowerCase();
  return action === 'delete' || action === 'remove' || action === 'destroy';
}

function emptyThread(phone) {
  return {
    id: `lexiphone_${last10(phone) || 'unknown'}`,
    phone: toE164(phone),
    messages: [],
    pin_verified_until: null,
    failed_pin_attempts: 0,
    locked_until: null,
    pending_draft: null,
  };
}

function sessionFromThread(thread, now = Date.now()) {
  const verifiedUntil = Date.parse(thread?.pin_verified_until || '') || 0;
  const lockedUntil = Date.parse(thread?.locked_until || '') || 0;
  return {
    pinVerified: verifiedUntil > now,
    pinVerifiedUntil: verifiedUntil > now ? thread.pin_verified_until : null,
    pendingDraft: thread?.pending_draft || null,
    failedPinAttempts: thread?.failed_pin_attempts || 0,
    lockedUntil: lockedUntil > now ? thread.locked_until : null,
    latestUserText: '',
    actions: [],
  };
}

function applySessionToThread(thread, state) {
  return {
    ...thread,
    pin_verified_until: state.pinVerifiedUntil || null,
    failed_pin_attempts: state.failedPinAttempts || 0,
    locked_until: state.lockedUntil || null,
    pending_draft: state.pendingDraft || null,
    messages: thread.messages || [],
  };
}

function noteUserUtterance(state, text, config, now = Date.now()) {
  const original = String(text || '');
  state.latestUserText = redactPin(original, config.pin);
  if (state.latestUserText === '[PIN]') state.latestUserText = '';
  if (!isLocked(state, now) && utteranceUnlocksPin(original, config.pin)) {
    markPinVerified(state, now);
  }
  return redactPin(original, config.pin);
}

function isLocked(state, now = Date.now()) {
  return Date.parse(state?.lockedUntil || '') > now;
}

function markPinVerified(state, now = Date.now()) {
  state.pinVerified = true;
  state.failedPinAttempts = 0;
  state.lockedUntil = null;
  state.pinVerifiedUntil = new Date(now + PIN_TTL_MS).toISOString();
}

function pinRequiredResult() {
  return {
    success: false,
    code: 'PIN_REQUIRED',
    error: 'PIN required before any customer lookup or customer message. Ask Kevin for his PIN. Personal notes, tasks, and reminders are still allowed.',
  };
}

function deleteForbiddenResult() {
  return {
    success: false,
    code: 'DELETE_FORBIDDEN',
    error: 'Deletes are not available on the phone line. Nothing was deleted.',
  };
}

function newId() {
  return `lxp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

async function executePhoneTool(functionCall, ctx) {
  const name = functionCall?.name || functionCall?.functionCall?.name || '';
  let args = functionCall?.args || functionCall?.functionCall?.args || {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch (e) { args = {}; }
  }
  const state = ctx.state;
  const config = ctx.config || {};
  const pool = ctx.pool;
  const owner = ctx.owner || {};

  if (isDeleteRequest(name, args)) {
    state.actions.push({ type: 'refused_delete', summary: `Refused ${name}` });
    return deleteForbiddenResult();
  }

  if (!PHONE_TOOLS.some((tool) => tool.name === name)) {
    return {
      success: false,
      code: 'TOOL_NOT_ON_PHONE',
      error: `${name || 'That action'} is not available on the phone line. Nothing was sent or deleted.`,
    };
  }

  if (isLocked(state) && (name === 'verify_pin' || CUSTOMER_TOOLS.has(name))) {
    return { success: false, code: 'PIN_LOCKED', error: 'Too many wrong PINs. Customer actions are locked for 15 minutes.' };
  }

  if (CUSTOMER_TOOLS.has(name) && !state.pinVerified) return pinRequiredResult();

  switch (name) {
    case 'verify_pin': {
      const given = digitsOnly(args.digits || args.pin || '');
      if (pinMatches(given, config.pin)) {
        markPinVerified(state);
        return { success: true, message: 'PIN accepted. Customer lookups and drafts are unlocked. Do not repeat the PIN.' };
      }
      state.pinVerified = false;
      state.failedPinAttempts = (state.failedPinAttempts || 0) + 1;
      if (state.failedPinAttempts >= MAX_PIN_FAILURES) {
        state.lockedUntil = new Date(Date.now() + PIN_LOCK_MS).toISOString();
      }
      return { success: false, code: 'PIN_REJECTED', error: 'That PIN is not right. Ask him to try again. Do not guess a PIN.' };
    }
    case 'create_personal_note':
      return savePersonalNote(pool, owner, args, state);
    case 'create_task':
      return saveTask(pool, owner, args, state);
    case 'create_reminder':
      return saveReminder(pool, owner, args, state);
    case 'list_my_tasks':
      return listTasks(pool, owner);
    case 'list_my_schedule':
      return listSchedule(pool, owner, args);
    case 'lookup_contact':
      return lookupContact(pool, owner, args);
    case 'draft_customer_message':
      return storeDraft(state, args);
    case 'confirm_send':
      return confirmSend(state, ctx.sendCustomerMessage);
    default:
      return { success: false, code: 'TOOL_NOT_ON_PHONE', error: 'That action is not available on the phone line.' };
  }
}

function requireCompany(owner) {
  if (!owner?.companyId) {
    return { success: false, error: 'Lexi phone is missing LEXI_PHONE_COMPANY_ID, so nothing was saved.' };
  }
  return null;
}

async function savePersonalNote(pool, owner, args, state) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const text = String(args.text || args.note || '').trim();
  if (!text) return { success: false, error: 'A note needs text.' };
  const id = newId();
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'Note', $2, $3::jsonb, NOW(), NOW())`,
    [id, owner.companyId, JSON.stringify({
      note: text,
      personal: true,
      owner_email: owner.userEmail || null,
      owner_name: owner.name || 'Kevin',
      source: 'lexi_phone',
      created_at: new Date().toISOString(),
    })]
  );
  state.actions.push({ type: 'note', summary: `Note: ${text.slice(0, 80)}` });
  return { success: true, id, message: 'Personal note saved.' };
}

async function saveTask(pool, owner, args, state) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const name = String(args.name || args.title || '').trim();
  if (!name) return { success: false, error: 'A task needs a name.' };
  const id = newId();
  await pool.query(
    `INSERT INTO tasks (id, company_id, title, name, description, assigned_to, due_date, priority, status, created_by)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,'pending',$5)`,
    [id, owner.companyId, name, args.description || null, owner.userEmail || null, args.due_date || null, args.priority || 'medium']
  );
  state.actions.push({ type: 'task', summary: `Task: ${name}` });
  return { success: true, id, message: `Task "${name}" saved.` };
}

async function saveReminder(pool, owner, args, state) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const title = String(args.title || '').trim();
  const when = new Date(args.when || args.start_time || '');
  if (!title || Number.isNaN(when.getTime())) return { success: false, error: 'A reminder needs a title and a time.' };
  const id = newId();
  const end = new Date(when.getTime() + 15 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, description, created_by, assigned_to)
     VALUES ($1,$2,$3,'reminder',$4,$5,$6,$7,$7)`,
    [id, owner.companyId, title, when.toISOString(), end, args.note || null, owner.userEmail || null]
  );
  state.actions.push({ type: 'reminder', summary: `Reminder: ${title}` });
  return { success: true, id, message: `Reminder "${title}" saved.` };
}

async function listTasks(pool, owner) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (!owner.userEmail) return { success: false, error: 'LEXI_PHONE_USER_EMAIL is not set, so I did not list company tasks.' };
  const { rows } = await pool.query(
    `SELECT title, name, status, priority, due_date
     FROM tasks
     WHERE company_id = $1
       AND LOWER(COALESCE(assigned_to, created_by, '')) = LOWER($2)
       AND COALESCE(status, 'pending') NOT IN ('completed', 'done', 'cancelled')
     ORDER BY due_date ASC NULLS LAST
     LIMIT 8`,
    [owner.companyId, owner.userEmail]
  );
  return { success: true, tasks: rows };
}

async function listSchedule(pool, owner, args) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  if (!owner.userEmail) return { success: false, error: 'LEXI_PHONE_USER_EMAIL is not set, so I did not list the company calendar.' };
  const start = args.start_date || new Date().toISOString();
  const end = args.end_date || new Date(Date.now() + 7 * 86400000).toISOString();
  const { rows } = await pool.query(
    `SELECT title, event_type, start_time, location
     FROM calendar_events
     WHERE company_id = $1
       AND LOWER(COALESCE(assigned_to, created_by, '')) = LOWER($2)
       AND start_time >= $3 AND start_time <= $4
     ORDER BY start_time ASC
     LIMIT 8`,
    [owner.companyId, owner.userEmail, start, end]
  );
  return { success: true, events: rows };
}

async function lookupContact(pool, owner, args) {
  const missing = requireCompany(owner);
  if (missing) return missing;
  const name = String(args.name || '').trim().toLowerCase();
  const phone = last10(args.phone || '');
  if (!name && !phone) return { success: false, error: 'Give a name or a phone number.' };
  const params = [owner.companyId];
  let where = 'company_id = $1';
  if (phone) {
    params.push(phone);
    where += ` AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $${params.length}`;
  } else {
    params.push(`%${name}%`);
    where += ` AND LOWER(name) LIKE $${params.length}`;
  }
  const customers = await pool.query(
    `SELECT id, name, phone, email, status FROM customers WHERE ${where} ORDER BY created_at DESC NULLS LAST LIMIT 3`,
    params
  );
  if (customers.rows.length) return { success: true, contact_type: 'customer', matches: customers.rows };
  const leads = await pool.query(
    `SELECT id, name, phone, email, status FROM leads WHERE ${where} ORDER BY created_at DESC NULLS LAST LIMIT 3`,
    params
  );
  if (!leads.rows.length) return { success: true, matches: [], message: 'No matching contact.' };
  return { success: true, contact_type: 'lead', matches: leads.rows };
}

function storeDraft(state, args) {
  const channel = String(args.channel || '').toLowerCase();
  if (channel !== 'sms' && channel !== 'email') return { success: false, error: 'Channel must be sms or email.' };
  const message = String(args.message || '').trim();
  const to = String(args.to || '').trim();
  if (!to || !message) return { success: false, error: 'A draft needs a recipient and a message.' };
  if (channel === 'email' && !String(args.subject || '').trim()) {
    return { success: false, error: 'An email draft needs a subject.' };
  }
  state.pendingDraft = {
    channel,
    to,
    subject: String(args.subject || '').trim(),
    message,
    contact_name: String(args.contact_name || '').trim(),
    drafted_at: new Date().toISOString(),
  };
  const who = state.pendingDraft.contact_name || to;
  const readBack = channel === 'email'
    ? `Email to ${who}. Subject: ${state.pendingDraft.subject}. ${message}`
    : `Text to ${who}: ${message}`;
  return {
    success: true,
    drafted: true,
    sent: false,
    read_back: readBack,
    message: `Draft only. Read this back and wait. Do not say it was sent. He must say "yes, send it". ${readBack}`,
  };
}

async function confirmSend(state, sendCustomerMessage) {
  if (!state.pendingDraft) {
    return { success: false, code: 'NOTHING_TO_SEND', sent: false, error: 'There is no draft waiting. Read a draft back first.' };
  }
  if (!isExplicitSendConfirmation(state.latestUserText)) {
    return {
      success: false,
      code: 'CONFIRMATION_REQUIRED',
      sent: false,
      error: 'Do not send. Kevin has not said "yes, send it". Read the draft back and wait.',
    };
  }
  if (typeof sendCustomerMessage !== 'function') {
    return { success: false, sent: false, error: 'Sending is not configured. The draft was kept.' };
  }
  const draft = state.pendingDraft;
  let sent;
  try {
    sent = await sendCustomerMessage(draft);
  } catch (err) {
    return { success: false, sent: false, error: 'The message was not sent. The draft is still waiting.' };
  }
  if (!sent || sent.success === false) {
    return { success: false, sent: false, error: sent?.error || 'The message was not sent. The draft is still waiting.' };
  }
  state.pendingDraft = null;
  state.actions.push({ type: 'sent', summary: `${draft.channel} to ${draft.contact_name || draft.to}` });
  return { success: true, sent: true, message: `Sent the ${draft.channel} to ${draft.contact_name || draft.to}.` };
}

function buildPhoneSystemPrompt({ basePrompt, ownerName, memories, recentSessions, pinVerified }) {
  const name = ownerName || 'Kevin';
  return `${basePrompt || `You are Lexi, ${name}'s assistant.`}

LEXI BY PHONE — PHASE 1, THIS OVERRIDES ANY BROADER CRM INSTRUCTIONS ABOVE:
You are on ${name}'s private cell while he may be driving. One or two short sentences. No markdown.
Tools you may call: verify_pin, create_personal_note, create_task, create_reminder, list_my_tasks, list_my_schedule, lookup_contact, draft_customer_message, confirm_send.
Save his personal notes, tasks, and reminders immediately. Do not ask permission for those.
Customer lookups and any text or email to a customer require his PIN first. Call verify_pin with the digits he just gave.
A customer message is a draft only. Read it back, then wait. Call confirm_send only after he says "yes, send it". Never say a message was sent unless confirm_send returns success true.
You cannot delete, update, or remove records. If he asks, say you can't delete from the phone.
Do not invent send_sms, send_email, or manage_entity results. Those tools are not on this line.
PIN status: ${pinVerified ? 'verified for this session.' : 'not verified. Ask before any customer lookup or message.'}

RECENT PHONE SESSIONS:
${recentSessions || '(none yet)'}

MEMORY:
${memories || '(none loaded)'}`;
}

async function loadThread(pool, phone) {
  const id = emptyThread(phone).id;
  const { rows } = await pool.query(
    `SELECT data FROM generic_entities WHERE entity_type = $1 AND id = $2 LIMIT 1`,
    [THREAD_ENTITY, id]
  );
  if (!rows.length) return emptyThread(phone);
  const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {});
  return { ...emptyThread(phone), ...data, id, messages: Array.isArray(data.messages) ? data.messages : [] };
}

async function saveThread(pool, phone, thread, companyId) {
  const id = emptyThread(phone).id;
  const data = { ...thread, id, phone: toE164(phone) };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE
       SET data = EXCLUDED.data, company_id = COALESCE(EXCLUDED.company_id, generic_entities.company_id), updated_date = NOW()`,
    [id, THREAD_ENTITY, companyId || null, JSON.stringify(data)]
  );
  return data;
}

async function insertCommunication(pool, row) {
  const id = row.id || newId();
  await pool.query(
    `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_name, contact_phone, body, message, status, created_by, ai_summary, data, created_at, updated_at)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())`,
    [
      id,
      row.companyId || null,
      row.type || 'sms',
      row.direction || 'inbound',
      row.contactName || null,
      row.contactPhone || null,
      row.body || '',
      row.status || 'completed',
      row.createdBy || null,
      row.summary || null,
      JSON.stringify({ channel: 'lexi_phone', ...(row.data || {}) }),
    ]
  );
  return id;
}

async function loadMemoryBlock(pool, owner) {
  if (!pool || !owner?.companyId) return '';
  const { rows } = await pool.query(
    `SELECT data FROM generic_entities
     WHERE entity_type = 'AIMemory'
       AND company_id = $1
       AND COALESCE((data->>'is_active')::boolean, true) = true
       AND (
         COALESCE(data->>'user_email', '') = ''
         OR LOWER(data->>'user_email') = LOWER($2)
         OR data->>'category' = 'company'
       )
     ORDER BY (data->>'importance')::int DESC NULLS LAST
     LIMIT 30`,
    [owner.companyId, owner.userEmail || '']
  );
  return rows.map((row) => {
    const data = row.data || {};
    const label = data.key || data.title || data.category || 'Memory';
    const detail = data.value || data.content || '';
    return detail ? `- ${label}: ${detail}` : '';
  }).filter(Boolean).join('\n');
}

async function loadRecentSessionBlock(pool, owner) {
  if (!pool) return '';
  const phone = last10(owner?.phone || '');
  const { rows } = await pool.query(
    `SELECT direction, body, ai_summary, created_at
     FROM communications
     WHERE (data->>'channel') = 'lexi_phone'
       AND ($1 = '' OR company_id = $1)
       AND ($2 = '' OR right(regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g'), 10) = $2)
     ORDER BY created_at DESC
     LIMIT 5`,
    [owner?.companyId || '', phone]
  );
  return rows.slice().reverse().map((row) => {
    const when = row.created_at ? new Date(row.created_at).toISOString() : '';
    const summary = row.ai_summary ? ` Summary: ${row.ai_summary}` : '';
    const body = String(row.body || '').slice(0, 500);
    return `- ${when} ${row.direction || ''}: ${body}${summary}`;
  }).join('\n');
}

async function resolveOwner(pool, config, fromPhone) {
  const owner = {
    companyId: config.companyId || '',
    userEmail: config.userEmail || '',
    name: config.userName || 'Kevin',
    phone: toE164(fromPhone),
  };
  if (!pool || (owner.companyId && owner.userEmail)) return owner;
  try {
    const { rows } = await pool.query(
      `SELECT company_id, COALESCE(user_email, email) AS email, full_name
       FROM staff_profiles
       WHERE is_active = true
         AND right(regexp_replace(COALESCE(cell_phone, ''), '\\D', '', 'g'), 10) = $1
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      [last10(fromPhone)]
    );
    if (rows[0]) {
      if (!owner.companyId) owner.companyId = rows[0].company_id || '';
      if (!owner.userEmail) owner.userEmail = rows[0].email || '';
      if (!config.userName && rows[0].full_name) owner.name = String(rows[0].full_name).split(' ')[0] || owner.name;
    }
  } catch (err) {
    console.warn('[LexiPhone] owner lookup failed:', err.message);
  }
  return owner;
}

function buildCallSummary(actions) {
  const items = (actions || []).map((item) => item.summary).filter(Boolean);
  const text = items.length ? `Lexi: ${items.join('; ')}.` : 'Lexi: call finished. Nothing new saved.';
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

async function maybeSendCallSummary({ config, summary, ownerPhone, sendSms }) {
  if (!config?.summarySms) return { sent: false, reason: 'disabled' };
  if (typeof sendSms !== 'function') return { sent: false, reason: 'no_sender' };
  if (!ownerPhone) return { sent: false, reason: 'no_phone' };
  const result = await sendSms({ to: ownerPhone, body: summary });
  if (result && result.success === false) return { sent: false, reason: result.error || 'failed' };
  return { sent: true };
}

async function defaultGenerate({ apiKey, body, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const resp = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error?.message || `Gemini HTTP ${resp.status}`);
  return data;
}

async function runTextTurn({ systemPrompt, history, userText, state, executeTool, generate }) {
  const contents = [];
  for (const message of (history || []).slice(-20)) {
    if (!message?.content) continue;
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: userText }] });
  let finalText = '';
  for (let turn = 0; turn < 4; turn++) {
    const data = await generate({
      body: {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: PHONE_TOOLS }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      },
    });
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((part) => part.functionCall);
    const text = parts.map((part) => part.text).filter(Boolean).join(' ').trim();
    if (text) finalText = text;
    if (!calls.length) break;
    contents.push({ role: 'model', parts });
    const responses = [];
    for (const part of calls) {
      const result = await executeTool(part.functionCall);
      responses.push({ functionResponse: { name: part.functionCall.name, response: result } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return finalText || 'Saved. What else?';
}

async function handleSmsTurn({ pool, config, from, body, generate, sendCustomerMessage, loadPrompt, getApiKey }) {
  const owner = await resolveOwner(pool, config, from);
  const thread = await loadThread(pool, from);
  const state = sessionFromThread(thread);
  const redacted = noteUserUtterance(state, body, config);
  const onlyPin = utteranceUnlocksPin(body, config.pin);
  let reply;
  if (onlyPin && state.pinVerified) {
    reply = "You're verified. What do you need?";
  } else if (onlyPin) {
    reply = 'That PIN is locked for now. Personal notes and tasks still work.';
  } else {
    const promptParts = typeof loadPrompt === 'function'
      ? await loadPrompt(owner, state)
      : { basePrompt: '', memories: await loadMemoryBlock(pool, owner), recentSessions: await loadRecentSessionBlock(pool, owner) };
    const systemPrompt = buildPhoneSystemPrompt({
      basePrompt: promptParts.basePrompt,
      ownerName: owner.name,
      memories: promptParts.memories,
      recentSessions: promptParts.recentSessions,
      pinVerified: state.pinVerified,
    });
    const apiKey = typeof getApiKey === 'function' ? await getApiKey(owner) : '';
    reply = await runTextTurn({
      systemPrompt,
      history: thread.messages,
      userText: redacted,
      state,
      generate: (request) => generate({ ...request, apiKey }),
      executeTool: (call) => executePhoneTool(call, { state, config, pool, owner, sendCustomerMessage }),
    });
  }
  thread.messages = (thread.messages || []).concat([
    { role: 'user', content: redacted, at: new Date().toISOString() },
    { role: 'assistant', content: reply, at: new Date().toISOString() },
  ]).slice(-40);
  const saved = applySessionToThread(thread, state);
  await saveThread(pool, from, saved, owner.companyId);
  await insertCommunication(pool, {
    companyId: owner.companyId,
    type: 'sms',
    direction: 'inbound',
    contactName: owner.name,
    contactPhone: owner.phone,
    body: redacted,
    createdBy: owner.userEmail,
    data: { peer: 'owner' },
  });
  await insertCommunication(pool, {
    companyId: owner.companyId,
    type: 'sms',
    direction: 'outbound',
    contactName: owner.name,
    contactPhone: owner.phone,
    body: reply,
    createdBy: 'lexi_phone',
    data: { peer: 'lexi' },
  });
  return { reply, owner, actions: state.actions };
}

function formParams(rawBody) {
  const params = new URLSearchParams(rawBody || '');
  return {
    from: params.get('From') || params.get('Caller') || '',
    to: params.get('To') || '',
    callSid: params.get('CallSid') || '',
    body: params.get('Body') || '',
    messageSid: params.get('MessageSid') || '',
  };
}

async function handleVoiceHttp({ rawBody, host, config, verifySignature }) {
  const verify = await verifySignature(rawBody);
  if (!signatureAccepted(verify)) {
    return { status: 403, contentType: 'text/plain', body: 'Invalid Twilio signature' };
  }
  const params = formParams(rawBody);
  const allowed = isAllowlisted(params.from, config.allowlist);
  const twiml = buildVoiceTwiml({
    allowed,
    host,
    from: params.from,
    callSid: params.callSid,
    forwardTo: allowed ? '' : config.forwardTo,
  });
  return { status: 200, contentType: 'text/xml', body: twiml, allowed };
}

async function handleSmsHttp({ rawBody, pool, config, verifySignature, generate, sendCustomerMessage, loadPrompt, getApiKey }) {
  const verify = await verifySignature(rawBody);
  if (!signatureAccepted(verify)) {
    return { status: 403, contentType: 'text/plain', body: 'Invalid Twilio signature' };
  }
  const params = formParams(rawBody);
  if (!isAllowlisted(params.from, config.allowlist)) {
    const where = config.forwardTo ? ` Call ${config.forwardTo} for the office.` : ' Please call the main office line.';
    return {
      status: 200,
      contentType: 'text/xml',
      body: buildSmsTwiml(`This number is a private assistant.${where}`),
      allowed: false,
    };
  }
  const text = String(params.body || '').trim();
  if (!text) {
    return { status: 200, contentType: 'text/xml', body: buildSmsTwiml('I did not catch that. What do you need?'), allowed: true };
  }
  try {
    const result = await handleSmsTurn({
      pool, config, from: params.from, body: text, generate, sendCustomerMessage, loadPrompt, getApiKey,
    });
    return { status: 200, contentType: 'text/xml', body: buildSmsTwiml(result.reply), allowed: true };
  } catch (err) {
    console.error('[LexiPhone] SMS turn failed:', err.message);
    return { status: 200, contentType: 'text/xml', body: buildSmsTwiml('I hit a snag. Try that again in a moment.'), allowed: true };
  }
}

async function saveCallTranscript({ pool, owner, callSid, transcript, actions, summary }) {
  await insertCommunication(pool, {
    companyId: owner.companyId,
    type: 'call',
    direction: 'inbound',
    contactName: owner.name,
    contactPhone: owner.phone,
    body: transcript || '',
    summary,
    createdBy: owner.userEmail || 'lexi_phone',
    data: { call_sid: callSid || '', tool_actions: actions || [], assistant: 'lexi_phone' },
  });
}

function attachCallStream(twilioWs, options) {
  const WebSocket = options.WebSocket || require('ws');
  const config = options.config || configFromEnv();
  let streamSid = '';
  let callSid = '';
  let from = '';
  let geminiWs = null;
  let setupComplete = false;
  let saved = false;
  let sessionReady = false;
  let owner = null;
  let state = sessionFromThread(emptyThread(''));
  const conversation = [];
  const pool = typeof options.pool === 'function' ? options.pool : () => options.pool;

  async function finish(reason) {
    if (saved) return;
    saved = true;
    try { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); } catch (e) {}
    const transcript = conversation.map((line) => `${line.role}: ${line.text}`).join('\n');
    const summary = buildCallSummary(state.actions);
    const db = pool();
    if (!owner) owner = { companyId: config.companyId, userEmail: config.userEmail, name: config.userName, phone: toE164(from) };
    try {
      if (db) {
        if (sessionReady) {
          const thread = await loadThread(db, from || owner.phone);
          const merged = applySessionToThread(thread, {
            pinVerifiedUntil: state.pinVerifiedUntil || thread.pin_verified_until,
            failedPinAttempts: state.failedPinAttempts,
            lockedUntil: state.lockedUntil,
            pendingDraft: thread.pending_draft,
          });
          await saveThread(db, from || owner.phone, merged, owner.companyId);
        }
        if (transcript) {
          await saveCallTranscript({ pool: db, owner, callSid, transcript, actions: state.actions, summary });
        }
      }
      await maybeSendCallSummary({
        config,
        summary,
        ownerPhone: toE164(from || owner.phone),
        sendSms: options.sendSummarySms,
      });
    } catch (err) {
      console.error(`[LexiPhone] call save failed (${reason}):`, err.message);
    }
  }

  async function connectGemini() {
    const db = pool();
    owner = await resolveOwner(db, config, from);
    const thread = db ? await loadThread(db, from) : emptyThread(from);
    state = sessionFromThread(thread);
    sessionReady = true;
    const promptParts = typeof options.loadPrompt === 'function'
      ? await options.loadPrompt(owner, state)
      : { basePrompt: '', memories: db ? await loadMemoryBlock(db, owner) : '', recentSessions: db ? await loadRecentSessionBlock(db, owner) : '', voice: 'Kore' };
    const systemPrompt = buildPhoneSystemPrompt({
      basePrompt: promptParts.basePrompt,
      ownerName: owner.name,
      memories: promptParts.memories,
      recentSessions: promptParts.recentSessions,
      pinVerified: state.pinVerified,
    });
    const apiKey = typeof options.geminiApiKey === 'function' ? await options.geminiApiKey(owner) : options.geminiApiKey;
    if (!apiKey) {
      console.error('[LexiPhone] missing Gemini API key');
      try { twilioWs.close(); } catch (e) {}
      return;
    }
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    geminiWs = new WebSocket(url);
    geminiWs.on('open', () => {
      const voice = promptParts.voice || 'Kore';
      geminiWs.send(JSON.stringify({
        setup: {
          model: LIVE_MODEL,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voice } } },
          },
          input_audio_transcription: {},
          output_audio_transcription: {},
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: false,
              start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
              end_of_speech_sensitivity: 'END_SENSITIVITY_LOW',
              prefix_padding_ms: 300,
              silence_duration_ms: 1600,
            },
          },
          system_instruction: { parts: [{ text: systemPrompt }] },
          tools: [{ function_declarations: PHONE_TOOLS }],
        },
      }));
    });
    geminiWs.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.setupComplete) {
          setupComplete = true;
          geminiWs.send(JSON.stringify({
            client_content: {
              turns: [{ role: 'user', parts: [{ text: `Greet ${owner.name} in under 12 words. You are on his private phone. Do not ask for a PIN yet.` }] }],
              turn_complete: true,
            },
          }));
        }
        const serverContent = data.serverContent || {};
        const inputText = serverContent.inputTranscript || serverContent.inputTranscription?.text || '';
        if (inputText) {
          const redacted = noteUserUtterance(state, inputText, config);
          conversation.push({ role: owner?.name || 'Kevin', text: redacted });
        }
        const outputText = serverContent.outputTranscript || serverContent.outputTranscription?.text || '';
        if (outputText) conversation.push({ role: 'Lexi', text: outputText });
        const parts = serverContent.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.text && !/\*\*/.test(part.text)) conversation.push({ role: 'Lexi', text: part.text });
          if (part.inlineData?.mimeType?.startsWith('audio/') && streamSid && twilioWs.readyState === WebSocket.OPEN) {
            const mulawB64 = options.geminiToTwilio(part.inlineData.data);
            const chunk = 160;
            for (let off = 0; off < mulawB64.length; off += chunk) {
              twilioWs.send(JSON.stringify({
                event: 'media',
                streamSid,
                media: { payload: mulawB64.slice(off, off + chunk) },
              }));
            }
          }
        }
        if (serverContent.interrupted && streamSid && twilioWs.readyState === WebSocket.OPEN) {
          twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
        }
        if (data.toolCall) {
          const calls = data.toolCall.functionCalls || [];
          const responses = [];
          for (const call of calls) {
            const result = await executePhoneTool(call, {
              state,
              config,
              pool: db,
              owner,
              sendCustomerMessage: options.sendCustomerMessage,
            });
            responses.push({ id: call.id, name: call.name, response: result });
          }
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));
          }
        }
      } catch (err) {
        console.error('[LexiPhone] Gemini message error:', err.message);
      }
    });
    geminiWs.on('close', () => finish('gemini-close'));
    geminiWs.on('error', (err) => console.error('[LexiPhone] Gemini error:', err.message));
  }

  twilioWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.event === 'start') {
      streamSid = msg.start?.streamSid || '';
      const custom = msg.start?.customParameters || {};
      from = custom.from || '';
      callSid = msg.start?.callSid || custom.callSid || '';
      connectGemini().catch((err) => console.error('[LexiPhone] connect failed:', err.message));
    } else if (msg.event === 'media' && setupComplete && geminiWs?.readyState === WebSocket.OPEN) {
      const pcmB64 = options.twilioToGemini(msg.media?.payload || '');
      geminiWs.send(JSON.stringify({
        realtime_input: { media_chunks: [{ data: pcmB64, mime_type: 'audio/pcm;rate=16000' }] },
      }));
    } else if (msg.event === 'stop') {
      finish('twilio-stop');
    }
  });
  twilioWs.on('close', () => finish('twilio-close'));
  twilioWs.on('error', (err) => console.error('[LexiPhone] Twilio stream error:', err.message));
}

async function deliverTwilioSms({ to, body, from, accountSid, authToken, fetchImpl }) {
  if (!accountSid || !authToken || !from || !to || !body) {
    return { success: false, error: 'Twilio is not configured for this Lexi phone send.' };
  }
  const fetchFn = fetchImpl || fetch;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const resp = await fetchFn(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    }
  );
  if (!resp.ok) return { success: false, error: `SMS failed (${resp.status})` };
  return { success: true };
}

module.exports = {
  TEXT_MODEL,
  LIVE_MODEL,
  PHONE_TOOLS,
  THREAD_ENTITY,
  configFromEnv,
  last10,
  toE164,
  isAllowlisted,
  xmlEscape,
  signatureAccepted,
  buildVoiceTwiml,
  buildSmsTwiml,
  pinMatches,
  utteranceUnlocksPin,
  redactPin,
  isExplicitSendConfirmation,
  isDeleteRequest,
  emptyThread,
  sessionFromThread,
  noteUserUtterance,
  executePhoneTool,
  buildPhoneSystemPrompt,
  loadThread,
  saveThread,
  insertCommunication,
  loadMemoryBlock,
  loadRecentSessionBlock,
  resolveOwner,
  buildCallSummary,
  maybeSendCallSummary,
  defaultGenerate,
  runTextTurn,
  handleSmsTurn,
  handleVoiceHttp,
  handleSmsHttp,
  saveCallTranscript,
  attachCallStream,
  deliverTwilioSms,
};
