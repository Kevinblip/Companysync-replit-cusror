// ── Lexi as a Team Chat teammate ─────────────────────────────────────────────
// Shared by BOTH dev (vite-functions-plugin.js) and prod (prod-server.cjs).
// Fix once here; do not mirror.
//
// Lexi is a conversational participant in Team Chat. She is pinned in Direct
// Messages and also answers when someone types @Lexi in a Space or group.
// Replies use the same phone tool set as SMS (lib/lexiPhone.cjs): notes, tasks,
// reminders, lookups, drafted texts, and calendar. Customer messages are read
// back and sent only after "yes, send it". Deletes are refused. The in-app CRM
// assistant is not called from here.
//
// She is deliberately a SEPARATE identity from the one-way alert bot in
// lib/chatBot.cjs. That bot posts broadcast alerts into the alerts Space and has
// no reply path; nothing here changes its behaviour.
//
// Delivery rule: Lexi replies are inserted with direct SQL, never through
// POST /api/chat/messages, so they can never re-enter the email/SMS fan-out and
// text the whole company.
//
// Access: the signed-in session is the authentication. There is no PIN. The
// configured phone owner (LEXI_PHONE_USER_EMAIL, any casing) always gets the
// tools, even when Team Chat resolved a different company than
// LEXI_PHONE_COMPANY_ID. An owner or administrator of that pinned company
// does too. A job-title role string does not. Everyone else gets a short
// refusal and no tool calls.

const lexiPhone = require('./lexiPhone.cjs');
const stagingSideEffects = require('./stagingSideEffects.cjs');

const LEXI_EMAIL = 'lexi@system';
const LEXI_NAME = 'Lexi';

const MAX_MESSAGE_CHARS = 4000;
const MAX_REPLY_CHARS = 3900;
const HISTORY_LIMIT = 12;
const PHONE_EMPTY_REPLY = 'Saved. What else?';

const FALLBACK_REPLY = "I couldn't come up with an answer for that. Try asking a different way.";
const FAILURE_REPLY = "I couldn't reach the CRM safely just now. Please try again in a moment.";
const OWNER_ONLY = 'I only work for Kevin.';

// Internal chat identities (the alert bot, Lexi) are addressable inside Team
// Chat but are NOT deliverable mailboxes. The notification fan-out must skip
// them or every Lexi message bounces an email at a fake address.
function isSystemChatAddress(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return true;
  return e.endsWith('@system') || !e.includes('@');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// A Lexi thread is a direct conversation whose participants include Lexi.
function conversationHasLexi(conversation) {
  if (!conversation) return false;
  const participants = Array.isArray(conversation.participants) ? conversation.participants : [];
  return participants.some((p) => normalizeEmail(p?.email) === LEXI_EMAIL);
}

function isLexiDirectConversation(conversation) {
  if (!conversation) return false;
  if (String(conversation.chat_type || '') !== 'direct') return false;
  return conversationHasLexi(conversation);
}

// Lexi may only ever be added to a two-person direct thread. She is not a
// member of Spaces. @Lexi in a Space is a message-time mention, not membership.
function isAllowedLexiConversationRequest(resolvedType, participantEmails) {
  const emails = (Array.isArray(participantEmails) ? participantEmails : []).map(normalizeEmail).filter(Boolean);
  if (!emails.includes(LEXI_EMAIL)) return true; // not a Lexi request at all
  if (resolvedType !== 'direct') return false;
  const unique = [...new Set(emails)];
  return unique.length === 2;
}

function mentionsLexi(text) {
  return /(^|[^A-Za-z0-9_])@lexi\b/i.test(String(text || ''));
}

function messageForLexi(text) {
  return String(text || '')
    .replace(/(^|[^A-Za-z0-9_])@lexi\b/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldLexiAnswer(conversation, text, senderEmail) {
  if (!conversation) return false;
  if (isSystemChatAddress(senderEmail)) return false;
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (isLexiDirectConversation(conversation)) return true;
  const type = String(conversation.chat_type || '');
  if (type === 'broadcast') return false;
  if (type === 'space' || type === 'group') return mentionsLexi(trimmed);
  return false;
}

// Boolean columns, the string forms Postgres and JSON edits actually store,
// and a 1 all count. A job-title role string never does.
function truthyFlag(value) {
  if (value === true || value === 1) return true;
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 't' || text === '1';
}

function staffData(row) {
  if (!row || row.data == null) return {};
  if (typeof row.data === 'object') return row.data;
  try { return JSON.parse(row.data) || {}; } catch { return {}; }
}

function rowIsAdmin(row) {
  if (!row) return false;
  const data = staffData(row);
  return truthyFlag(row.is_administrator)
    || truthyFlag(row.is_super_admin)
    || truthyFlag(data.is_administrator)
    || truthyFlag(data.is_super_admin);
}

function addCompanyId(ids, value) {
  const text = String(value || '').trim();
  if (text) ids.add(text);
}

// Team Chat's company id is whatever the signed-in shell selected. That can be
// the companies.id, the same row's base44_id, or a different company entirely
// (the platform company wins in the shell when that staff row exists).
// Returns every id for the pinned company, or null when the chat company is
// a different company.
async function pinnedCompanyIds(pool, chatCompanyId, pinnedCompany) {
  const chat = String(chatCompanyId || '').trim();
  const pinned = String(pinnedCompany || '').trim();
  const ids = new Set();
  addCompanyId(ids, chat);
  if (!pinned || chat === pinned) return [...ids];
  if (!pool || typeof pool.query !== 'function') return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, base44_id FROM companies
        WHERE id = $1 OR base44_id = $1 OR id = $2 OR base44_id = $2
        LIMIT 5`,
      [chat, pinned]
    );
    const linked = (rows || []).find((row) => {
      const rowIds = new Set([row?.id, row?.base44_id].map((value) => String(value || '').trim()).filter(Boolean));
      return rowIds.has(chat) && rowIds.has(pinned);
    });
    if (!linked) return null;
    addCompanyId(ids, pinned);
    addCompanyId(ids, linked.id);
    addCompanyId(ids, linked.base44_id);
    return [...ids];
  } catch (err) {
    console.warn('[LexiTeamChat] company alias check failed:', err.message);
    return null;
  }
}

// The session already proves who is signed in. Assistant mode is the
// configured phone owner (compared before the company pin, case-insensitive),
// or an owner/administrator of that pinned company. A job-title role string
// is not an administrator flag.
async function isAssistantCaller(pool, companyId, userEmail, phoneConfig) {
  const email = normalizeEmail(userEmail);
  if (!email || isSystemChatAddress(email)) return false;
  const ownerEmail = normalizeEmail(phoneConfig?.userEmail);
  if (ownerEmail && email === ownerEmail) return true;

  const pinnedCompany = String(phoneConfig?.companyId || '').trim();
  const chatCompany = String(companyId || '').trim();
  const companyIds = await pinnedCompanyIds(pool, chatCompany, pinnedCompany);
  if (!companyIds || companyIds.length === 0) return false;

  try {
    const staff = await pool.query(
      `SELECT is_administrator, is_super_admin, data
         FROM staff_profiles
        WHERE company_id = ANY($1::text[])
          AND (
            LOWER(COALESCE(user_email, '')) = LOWER($2)
            OR LOWER(COALESCE(email, '')) = LOWER($2)
            OR LOWER(COALESCE(data->>'user_email', '')) = LOWER($2)
            OR LOWER(COALESCE(data->>'email', '')) = LOWER($2)
          )
        ORDER BY
          CASE WHEN COALESCE(is_administrator, false) OR COALESCE(is_super_admin, false) THEN 0 ELSE 1 END,
          CASE
            WHEN LOWER(COALESCE(data->>'is_administrator', '')) IN ('true', 't', '1')
              OR LOWER(COALESCE(data->>'is_super_admin', '')) IN ('true', 't', '1') THEN 0
            ELSE 1
          END,
          updated_at DESC NULLS LAST
        LIMIT 1`,
      [companyIds, email]
    );
    if (rowIsAdmin(staff.rows[0])) return true;
  } catch (err) {
    console.warn('[LexiTeamChat] admin check failed:', err.message);
  }
  try {
    const owned = await pool.query(
      `SELECT id FROM companies
        WHERE COALESCE(is_deleted, false) = false
          AND (id = ANY($1::text[]) OR base44_id = ANY($1::text[]))
          AND (
            LOWER(COALESCE(created_by, '')) = LOWER($2)
            OR LOWER(COALESCE(email, '')) = LOWER($2)
            OR LOWER(COALESCE(data->>'owner_email', '')) = LOWER($2)
            OR LOWER(COALESCE(data->>'created_by', '')) = LOWER($2)
          )
        LIMIT 1`,
      [companyIds, email]
    );
    if (owned.rows.length > 0) return true;
  } catch (err) {
    console.warn('[LexiTeamChat] company owner check failed:', err.message);
  }
  try {
    const entityOwner = await pool.query(
      `SELECT id FROM generic_entities
        WHERE entity_type = 'Company'
          AND (id = ANY($1::text[]) OR company_id = ANY($1::text[]))
          AND (
            LOWER(COALESCE(data->>'created_by', '')) = LOWER($2)
            OR LOWER(COALESCE(data->>'owner_email', '')) = LOWER($2)
            OR LOWER(COALESCE(data->>'email', '')) = LOWER($2)
          )
        LIMIT 1`,
      [companyIds, email]
    );
    if (entityOwner.rows.length > 0) return true;
  } catch (err) {
    console.warn('[LexiTeamChat] entity owner check failed:', err.message);
  }
  return false;
}

function teamThreadId(conversationId) {
  const safe = String(conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return `lexiteam_${safe || 'unknown'}`;
}

async function loadTeamSession(pool, conversationId) {
  const id = teamThreadId(conversationId);
  try {
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = $1 AND id = $2 LIMIT 1`,
      [lexiPhone.THREAD_ENTITY, id]
    );
    if (!rows.length) return { id, pending_draft: null, pending_calendar: null };
    const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {});
    return { id, pending_draft: null, pending_calendar: null, ...data };
  } catch (err) {
    console.warn('[LexiTeamChat] Could not load conversation state:', err.message);
    return { id, pending_draft: null, pending_calendar: null };
  }
}

async function saveTeamSession(pool, conversationId, state, companyId) {
  const id = teamThreadId(conversationId);
  const data = {
    id,
    channel: 'team_chat',
    pending_draft: state?.pendingDraft || null,
    pending_calendar: state?.pendingCalendar || null,
    pending_reminder_batch: state?.pendingReminderBatch || null,
    pending_record_change: state?.pendingRecordChange || null,
    pending_callback_change: state?.pendingCallbackChange || null,
    pending_estimate: state?.pendingEstimate || null,
    pending_briefing_change: state?.pendingBriefingChange || null,
    pending_email_draft: state?.pendingEmailDraft || null,
    pin_verified_until: null,
    failed_pin_attempts: 0,
    locked_until: null,
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE
       SET data = EXCLUDED.data, company_id = COALESCE(EXCLUDED.company_id, generic_entities.company_id), updated_date = NOW()`,
    [id, lexiPhone.THREAD_ENTITY, companyId || null, JSON.stringify(data)]
  );
}

// Prior turns of this thread, oldest first, in { role, content } shape.
async function loadLexiHistory(pool, companyId, conversationId, limit = HISTORY_LIMIT) {
  try {
    const result = await pool.query(
      `SELECT sender_email, message, message_type
         FROM chat_messages
        WHERE conversation_id = $1 AND company_id = $2
          AND message_type IN ('text', 'system')
        ORDER BY created_at DESC
        LIMIT $3`,
      [conversationId, companyId, Math.max(1, Math.min(40, limit))]
    );
    return result.rows
      .reverse()
      .map((row) => ({
        role: normalizeEmail(row.sender_email) === LEXI_EMAIL ? 'assistant' : 'user',
        content: String(row.message || '').slice(0, MAX_MESSAGE_CHARS),
      }))
      .filter((turn) => turn.content);
  } catch (error) {
    console.warn('[LexiTeamChat] Could not load thread history:', error.message);
    return [];
  }
}

// Insert Lexi's reply with direct SQL. The default refuses anything that is
// not her direct thread, so an unsolicited post cannot land in a Space.
// allowChannel is only for an @Lexi mention in a Space or group.
async function postLexiReply(pool, companyId, conversationId, messageText, options = {}) {
  if (!pool || !companyId || !conversationId || !messageText) return false;
  try {
    const conv = await pool.query(
      `SELECT id, chat_type, participants FROM chat_conversations WHERE id = $1 AND company_id = $2`,
      [conversationId, companyId]
    );
    if (conv.rows.length === 0) return false;
    const row = conv.rows[0];
    const type = String(row.chat_type || '');
    if (options.allowChannel) {
      const channelOk = type === 'space' || type === 'group' || isLexiDirectConversation(row);
      if (!channelOk || type === 'broadcast') return false;
    } else if (!isLexiDirectConversation(row)) {
      return false;
    }
    const text = String(messageText).slice(0, MAX_REPLY_CHARS);
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO chat_messages (id, company_id, conversation_id, sender_email, sender_name, message, message_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'text', NOW())`,
      [id, companyId, conversationId, LEXI_EMAIL, LEXI_NAME, text]
    );
    await pool.query(
      `UPDATE chat_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [text.length > 80 ? text.slice(0, 80) + '…' : text, conversationId]
    );
    return true;
  } catch (error) {
    console.warn('[LexiTeamChat] postLexiReply failed:', error.message);
    return false;
  }
}

// Same staging rule as the phone line: log the customer send and keep the draft.
// A real send happens only when that guard is off and Twilio or email is configured.
async function defaultSendCustomerMessage(draft) {
  const kind = draft?.channel === 'email' ? 'email' : 'sms';
  if (stagingSideEffects.sideEffectsDisabled()) {
    stagingSideEffects.logSuppressed(kind, { action: 'lexi-team-chat-customer', to: draft?.to });
    return {
      success: false,
      suppressed: true,
      error: 'Staging has outbound messages turned off, so this was not sent.',
    };
  }
  if (draft?.channel === 'email') {
    return { success: false, sent: false, error: 'Sending is not configured. The draft was kept.' };
  }
  const config = lexiPhone.configFromEnv();
  return lexiPhone.deliverTwilioSms({
    to: draft?.to,
    body: draft?.message,
    from: config.lexiNumber,
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  });
}

async function defaultSyncCalendar({ userEmail }) {
  const blocked = stagingSideEffects.blockedAction('google-calendar-sync');
  if (blocked) return blocked;
  try {
    const { getFunctionHandlers } = require('../db/prod-integrations.cjs');
    const handlers = await getFunctionHandlers();
    if (typeof handlers.syncUserGoogleCalendar !== 'function') {
      return { success: false, error: 'Google Calendar sync is not available.' };
    }
    return await handlers.syncUserGoogleCalendar({ targetUserEmail: userEmail });
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function forceSignedIn(state) {
  state.pinVerified = true;
  state.failedPinAttempts = 0;
  state.lockedUntil = null;
  state.pinVerifiedUntil = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
}

/**
 * Answer one Team Chat message with the phone brain.
 * Fire-and-forget safe: never throws.
 */
async function handleLexiTeamChatTurn({
  pool,
  companyId,
  conversationId,
  userEmail,
  userName,
  text,
  conversation,
  phoneConfig: phoneConfigOverride,
  generate,
  sendCustomerMessage,
  syncCalendar,
  loadPrompt,
}) {
  if (!pool || !companyId || !conversationId) return false;
  const trimmed = String(text || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!trimmed) return false;
  if (isSystemChatAddress(userEmail)) return false;

  const phoneConfig = { ...lexiPhone.configFromEnv(), ...(phoneConfigOverride || {}) };
  let conv = conversation || null;
  if (!conv) {
    try {
      const loaded = await pool.query(
        `SELECT id, chat_type, participants FROM chat_conversations WHERE id = $1 AND company_id = $2`,
        [conversationId, companyId]
      );
      conv = loaded.rows[0] || null;
    } catch (err) {
      console.warn('[LexiTeamChat] Could not load conversation:', err.message);
      return false;
    }
  }
  if (!shouldLexiAnswer(conv, trimmed, userEmail)) return false;

  const allowChannel = !isLexiDirectConversation(conv);
  const modelText = messageForLexi(trimmed) || trimmed;
  let state = null;
  try {
    const assistant = await isAssistantCaller(pool, companyId, userEmail, phoneConfig);
    if (!assistant) {
      return await postLexiReply(pool, companyId, conversationId, OWNER_ONLY, { allowChannel });
    }

    const history = await loadLexiHistory(pool, companyId, conversationId, HISTORY_LIMIT);
    const last = history[history.length - 1];
    if (last && last.role === 'user' && last.content === trimmed) history.pop();

    const owner = await lexiPhone.resolveOwner(pool, phoneConfig, '');
    if (!owner.companyId) owner.companyId = companyId;
    if (!owner.userEmail) owner.userEmail = normalizeEmail(userEmail);
    if (userName && owner.name === 'Kevin' && !phoneConfig.userName) owner.name = String(userName).split(' ')[0];

    const thread = await loadTeamSession(pool, conversationId);
    state = lexiPhone.sessionFromThread(thread);
    lexiPhone.noteUserUtterance(state, modelText, phoneConfig);
    forceSignedIn(state);

    const promptParts = typeof loadPrompt === 'function'
      ? await loadPrompt(owner)
      : { basePrompt: '', memories: '', recentSessions: '' };
    const systemPrompt = lexiPhone.buildPhoneSystemPrompt({
      basePrompt: promptParts?.basePrompt || '',
      ownerName: owner.name,
      memories: promptParts?.memories || '',
      recentSessions: promptParts?.recentSessions || '',
      pinVerified: true,
      companyResolved: Boolean(owner.companyId),
      channel: 'team_chat',
    });

    const runGenerate = typeof generate === 'function'
      ? generate
      : (request) => lexiPhone.defaultGenerate({
        apiKey: process.env.GOOGLE_GEMINI_API_KEY || '',
        body: request.body,
      });
    const send = typeof sendCustomerMessage === 'function' ? sendCustomerMessage : defaultSendCustomerMessage;
    const sync = typeof syncCalendar === 'function' ? syncCalendar : defaultSyncCalendar;

    const replyRaw = await lexiPhone.runTextTurn({
      systemPrompt,
      history,
      userText: modelText,
      state,
      maxTurns: 3,
      generate: runGenerate,
      executeTool: (call) => {
        forceSignedIn(state);
        const name = call?.name || '';
        if (name === 'verify_pin') {
          return { success: true, message: 'Already signed in. Do not ask for a PIN.' };
        }
        if (name === 'end_call') {
          return { success: true, ending: false, message: 'This is Team Chat. There is no call to end. Answer in the thread.' };
        }
        return lexiPhone.executePhoneTool(call, {
          state,
          config: phoneConfig,
          pool,
          owner,
          sendCustomerMessage: send,
          syncCalendar: sync,
        });
      },
    });

    await saveTeamSession(pool, conversationId, state, owner.companyId || companyId);
    const reply = String(replyRaw || '').trim();
    const posted = (!reply || reply === PHONE_EMPTY_REPLY) ? FALLBACK_REPLY : reply;
    return await postLexiReply(pool, companyId, conversationId, posted, { allowChannel });
  } catch (error) {
    console.error('[LexiTeamChat] Lexi reply failed:', error.message);
    if (state) await saveTeamSession(pool, conversationId, state, companyId).catch(() => {});
    await postLexiReply(pool, companyId, conversationId, FAILURE_REPLY, { allowChannel }).catch(() => {});
    return false;
  }
}

module.exports = {
  LEXI_EMAIL,
  LEXI_NAME,
  FALLBACK_REPLY,
  FAILURE_REPLY,
  OWNER_ONLY,
  isSystemChatAddress,
  conversationHasLexi,
  isLexiDirectConversation,
  isAllowedLexiConversationRequest,
  mentionsLexi,
  messageForLexi,
  shouldLexiAnswer,
  isAssistantCaller,
  loadLexiHistory,
  postLexiReply,
  saveTeamSession,
  handleLexiTeamChatTurn,
  defaultSendCustomerMessage,
  defaultSyncCalendar,
};
