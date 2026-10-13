// ── Lexi as a Team Chat teammate ─────────────────────────────────────────────
// Shared by BOTH dev (vite-functions-plugin.js) and prod (prod-server.cjs).
// Fix once here; do not mirror.
//
// Lexi is a conversational participant in Team Chat: she shows up in the Direct
// Messages roster and answers in-thread using the exact same assistant handler
// (and therefore the same tool set and per-user access scoping) that powers her
// own page.
//
// She is deliberately a SEPARATE identity from the one-way alert bot in
// lib/chatBot.cjs. That bot posts broadcast alerts into the alerts Space and has
// no reply path; nothing here changes its behaviour.
//
// Delivery rule: Lexi replies are inserted with direct SQL, never through
// POST /api/chat/messages, so they can never re-enter the email/SMS fan-out and
// text the whole company.

const LEXI_EMAIL = 'lexi@system';
const LEXI_NAME = 'Lexi';

const MAX_MESSAGE_CHARS = 4000;
const MAX_REPLY_CHARS = 3900;
const HISTORY_LIMIT = 12;

const FALLBACK_REPLY = "I couldn't come up with an answer for that. Try asking a different way.";
const FAILURE_REPLY = "I couldn't reach the CRM safely just now. Please try again in a moment.";

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
// member of Spaces — a Space reply would fan out to the whole roster.
function isAllowedLexiConversationRequest(resolvedType, participantEmails) {
  const emails = (Array.isArray(participantEmails) ? participantEmails : []).map(normalizeEmail).filter(Boolean);
  if (!emails.includes(LEXI_EMAIL)) return true; // not a Lexi request at all
  if (resolvedType !== 'direct') return false;
  const unique = [...new Set(emails)];
  return unique.length === 2;
}

// Prior turns of this thread, oldest first, in Lexi's conversationHistory shape.
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

// Insert Lexi's reply with direct SQL. Verifies the thread belongs to the
// company AND actually has Lexi in it, so a forged conversation_id can never
// make Lexi post into a Space.
async function postLexiReply(pool, companyId, conversationId, messageText) {
  if (!pool || !companyId || !conversationId || !messageText) return false;
  try {
    const conv = await pool.query(
      `SELECT id, chat_type, participants FROM chat_conversations WHERE id = $1 AND company_id = $2`,
      [conversationId, companyId]
    );
    if (conv.rows.length === 0) return false;
    if (!isLexiDirectConversation(conv.rows[0])) return false;
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

/**
 * Produce Lexi's answer for a message just posted into her direct thread.
 *
 * `invokeLexi(params)` must call the same assistant handler the Lexi page uses
 * (dev: functionHandlers.lexiChat, prod: prod-integrations handleLexiChat) with
 * the caller's own request, so access scoping is identical to her own page.
 *
 * Fire-and-forget safe: never throws.
 */
async function handleLexiTeamChatTurn({ pool, companyId, conversationId, userEmail, userName, text, invokeLexi }) {
  if (!pool || !companyId || !conversationId || typeof invokeLexi !== 'function') return false;
  const trimmed = String(text || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!trimmed) return false;
  try {
    const history = await loadLexiHistory(pool, companyId, conversationId, HISTORY_LIMIT);
    // The message we are answering was already inserted, so it is the last
    // history entry. Drop it — it is passed separately as `message`.
    const last = history[history.length - 1];
    if (last && last.role === 'user' && last.content === trimmed) history.pop();

    const result = await invokeLexi({
      message: trimmed,
      conversationHistory: history,
      companyId,
      userEmail,
      userName,
      mode: 'team_chat',
    });

    const reply = String(result?.response || '').trim() || FALLBACK_REPLY;
    return await postLexiReply(pool, companyId, conversationId, reply);
  } catch (error) {
    console.error('[LexiTeamChat] Lexi reply failed:', error.message);
    // Fail loudly in the thread rather than leaving the user waiting forever.
    await postLexiReply(pool, companyId, conversationId, FAILURE_REPLY).catch(() => {});
    return false;
  }
}

module.exports = {
  LEXI_EMAIL,
  LEXI_NAME,
  FALLBACK_REPLY,
  FAILURE_REPLY,
  isSystemChatAddress,
  conversationHasLexi,
  isLexiDirectConversation,
  isAllowedLexiConversationRequest,
  loadLexiHistory,
  postLexiReply,
  handleLexiTeamChatTurn,
};
