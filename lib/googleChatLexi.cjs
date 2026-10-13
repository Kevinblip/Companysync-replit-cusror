// Google Chat app adapter for Lexi.
//
// The public Google Chat endpoint authenticates the company with its long,
// random URL token before calling this module. This adapter additionally maps
// the Google Chat sender to a real company owner/staff record before any CRM or
// paid-AI work is allowed.

const crypto = require('crypto');

const MAX_MESSAGE_CHARS = 4000;
const MAX_REPLY_CHARS = 3900;
const HISTORY_LIMIT = 10;

function eventType(body) {
  return String(body?.type || body?.eventType || '').toUpperCase();
}

function extractMessage(body) {
  return body?.message || body?.chat?.messagePayload?.message || {};
}

function extractSender(body) {
  const message = extractMessage(body);
  return body?.user || body?.common?.user || message?.sender || {};
}

function extractSenderEmail(body) {
  const sender = extractSender(body);
  return String(sender?.email || sender?.emailAddress || '').trim().toLowerCase();
}

function extractSenderName(body) {
  const sender = extractSender(body);
  return String(sender?.displayName || sender?.name || 'Google Chat user').trim();
}

function extractSpaceName(body) {
  const message = extractMessage(body);
  return String(body?.space?.name || message?.space?.name || 'google-chat').trim();
}

function extractMessageText(body) {
  const message = extractMessage(body);
  // argumentText excludes the app mention in Google Chat MESSAGE events.
  const raw = message?.argumentText || message?.text || '';
  return String(raw)
    .replace(/<users\/[^>]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

function isBotSender(body) {
  const sender = extractSender(body);
  return String(sender?.type || '').toUpperCase() === 'BOT';
}

function lifecycleResponse(body) {
  const type = eventType(body);
  if (type === 'ADDED_TO_SPACE') {
    return {
      text: "Hi, I'm Lexi. Mention me in this space and ask about your CRM, schedule, customers, leads, estimates, invoices, or tasks.",
    };
  }
  if (type === 'REMOVED_FROM_SPACE') {
    return {};
  }
  return null;
}

async function resolveCompanyCaller(pool, companyId, email) {
  if (!pool || !companyId || !email) return null;
  const result = await pool.query(
    `SELECT email, full_name, is_admin
       FROM (
         SELECT LOWER(created_by) AS email,
                COALESCE(company_name, created_by) AS full_name,
                TRUE AS is_admin
           FROM companies
          WHERE id = $1 AND LOWER(created_by) = LOWER($2)
         UNION ALL
         SELECT LOWER(COALESCE(NULLIF(user_email, ''), email)) AS email,
                COALESCE(full_name, name, user_email, email) AS full_name,
                COALESCE(is_administrator, FALSE) AS is_admin
           FROM staff_profiles
          WHERE company_id = $1
            AND is_active IS NOT FALSE
            AND LOWER(COALESCE(NULLIF(user_email, ''), email)) = LOWER($2)
       ) callers
      LIMIT 1`,
    [companyId, email]
  );
  return result.rows[0] || null;
}

async function loadHistory(pool, companyId, spaceName, email) {
  try {
    const result = await pool.query(
      `SELECT data
         FROM generic_entities
        WHERE entity_type = 'GoogleChatLexiTurn'
          AND company_id = $1
          AND data->>'space_name' = $2
          AND LOWER(data->>'user_email') = LOWER($3)
        ORDER BY created_date DESC NULLS LAST
        LIMIT $4`,
      [companyId, spaceName, email, HISTORY_LIMIT]
    );
    return result.rows
      .reverse()
      .flatMap((row) => {
        const data = row.data || {};
        return [
          data.user_text ? { role: 'user', content: String(data.user_text) } : null,
          data.assistant_text ? { role: 'assistant', content: String(data.assistant_text) } : null,
        ].filter(Boolean);
      });
  } catch (error) {
    console.warn('[GoogleChatLexi] Could not load conversation history:', error.message);
    return [];
  }
}

async function saveTurn(pool, { companyId, spaceName, email, senderName, userText, assistantText }) {
  try {
    const id = `gchat_lexi_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await pool.query(
      `INSERT INTO generic_entities
         (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'GoogleChatLexiTurn', $2, $3, NOW(), NOW())`,
      [
        id,
        companyId,
        JSON.stringify({
          company_id: companyId,
          space_name: spaceName,
          user_email: email,
          sender_name: senderName,
          user_text: userText,
          assistant_text: assistantText,
          source: 'google_chat',
        }),
      ]
    );
  } catch (error) {
    console.warn('[GoogleChatLexi] Could not save conversation turn:', error.message);
  }
}

async function handleLexiMessage({ pool, companyId, body, invokeLexi }) {
  const type = eventType(body);
  if (type && type !== 'MESSAGE') return lifecycleResponse(body);
  if (isBotSender(body)) return {};

  const text = extractMessageText(body);
  if (!text) return null;

  const senderEmail = extractSenderEmail(body);
  if (!senderEmail) {
    return {
      text: "I can see your message, but Google Chat didn't include your Workspace email. Ask your Google Workspace admin to allow the Chat app to receive member identity information.",
    };
  }

  const caller = await resolveCompanyCaller(pool, companyId, senderEmail);
  if (!caller) {
    return {
      text: `I can't access this company's CRM for ${senderEmail}. Add that email as an active staff member in CompanySync, then try again.`,
    };
  }

  const spaceName = extractSpaceName(body);
  const senderName = extractSenderName(body);
  const history = await loadHistory(pool, companyId, spaceName, senderEmail);

  try {
    const result = await invokeLexi({
      message: text,
      conversationHistory: history,
      companyId,
      userEmail: caller.email,
      userName: caller.full_name || senderName,
      mode: 'google_chat',
    }, {
      email: caller.email,
      full_name: caller.full_name || senderName,
      is_super_admin: false,
      platform_role: null,
      companyId,
      source: 'google_chat',
    });

    const response = String(result?.response || result?.error || '').trim();
    const safeResponse = (response || "I couldn't complete that request. Please try again.").slice(0, MAX_REPLY_CHARS);
    await saveTurn(pool, {
      companyId,
      spaceName,
      email: caller.email,
      senderName,
      userText: text,
      assistantText: safeResponse,
    });
    return { text: safeResponse };
  } catch (error) {
    console.error('[GoogleChatLexi] Lexi request failed:', error.message);
    return { text: "I couldn't reach the CRM safely just now. Please try again in a moment." };
  }
}

module.exports = {
  eventType,
  extractMessageText,
  extractSenderEmail,
  lifecycleResponse,
  resolveCompanyCaller,
  handleLexiMessage,
};