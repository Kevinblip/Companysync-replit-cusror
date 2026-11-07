'use strict';

const crypto = require('crypto');
const staging = require('../stagingSideEffects.cjs');
const { readState, update, id } = require('./salesStore.cjs');
const { recordMessage, salesAgentReplyTo } = require('./outbound.cjs');
const { stopLead } = require('./sequences.cjs');

function secretsMatch(given, expected) {
  const left = Buffer.from(String(given || ''));
  const right = Buffer.from(String(expected || ''));
  if (!right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function inboundSecret() {
  return String(process.env.SALES_AGENT_INBOUND_SECRET || '').trim();
}

function inboundAuthorized(req, url) {
  const secret = inboundSecret();
  if (!secret) return false;
  const header = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  if (/^Bearer\s+/i.test(header) && secretsMatch(header.replace(/^Bearer\s+/i, '').trim(), secret)) return true;
  if (/^Basic\s+/i.test(header)) {
    let decoded = '';
    try { decoded = Buffer.from(header.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8'); }
    catch (_) { decoded = ''; }
    const password = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
    if (secretsMatch(password, secret)) return true;
  }
  const headerToken = req.headers && (req.headers['x-sales-agent-inbound-secret'] || req.headers['X-Sales-Agent-Inbound-Secret']);
  if (headerToken && secretsMatch(String(headerToken), secret)) return true;
  const queryToken = url && url.searchParams ? url.searchParams.get('token') : '';
  if (queryToken && secretsMatch(queryToken, secret)) return true;
  return false;
}

function extractSenderEmail(payload) {
  const full = payload && (payload.FromFull || payload.fromFull || payload.from_full);
  const candidates = [
    full && (full.Email || full.email),
    payload && (payload.From || payload.from || payload.Sender || payload.sender),
  ];
  for (const candidate of candidates) {
    const text = String(candidate || '').trim();
    if (!text) continue;
    const wrapped = text.match(/<([^>]+)>/);
    const bare = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = (wrapped && wrapped[1]) || (bare && bare[0]) || '';
    if (email.includes('@')) return email.trim().toLowerCase();
  }
  return '';
}

function replyText(payload) {
  return String(
    (payload && (payload.StrippedTextReply || payload.TextBody || payload.text || payload.HtmlBody)) || '',
  ).trim();
}

function findLead(email) {
  if (!email) return null;
  return readState().leads.find((row) => row.email && String(row.email).toLowerCase() === email) || null;
}

async function ingestInboundEmail(payload) {
  const fromEmail = extractSenderEmail(payload);
  const subject = String((payload && (payload.Subject || payload.subject)) || '').slice(0, 300);
  const text = replyText(payload).slice(0, 8000);
  const messageId = String((payload && (payload.MessageID || payload.MessageId || payload.messageId)) || '').slice(0, 200);
  if (!fromEmail) return { ok: true, ignored: true, reason: 'no_sender', matched: false };

  if (messageId && readState().messages.some((row) => row.kind === 'inbound_reply' && row.providerId === messageId)) {
    return { ok: true, duplicate: true, matched: !!findLead(fromEmail) };
  }

  const lead = findLead(fromEmail);
  const stop = /^\s*stop\b/i.test(text);
  const message = await recordMessage({
    leadId: lead ? lead.id : null,
    kind: 'inbound_reply',
    channel: 'email',
    direction: 'in',
    to: salesAgentReplyTo(),
    from: fromEmail,
    subject,
    body: text,
    providerId: messageId,
    suppressed: false,
  });

  if (lead) await stopLead(lead.id, stop ? 'stop' : 'reply');

  await update((state) => {
    const row = lead && state.leads.find((item) => item.id === lead.id);
    if (row) {
      row.followUpPaused = true;
      row.followUpPausedReason = stop ? 'stop' : 'reply';
      row.inboundReplyAt = new Date().toISOString();
      row.needsKevinReview = true;
    }
    const who = row
      ? `${row.firstName || fromEmail} <${fromEmail}>`
      : fromEmail;
    state.notifications.push({
      id: id('note'),
      at: new Date().toISOString(),
      title: row
        ? `Reply from ${who} — follow-up paused`
        : `Unmatched sales reply from ${who}`,
      body: [subject, text].filter(Boolean).join('\n').slice(0, 2000),
      leadId: row ? row.id : null,
      kind: row ? 'inbound_reply' : 'inbound_reply_unmatched',
      for: 'Kevin',
    });
  });

  return {
    ok: true,
    matched: !!lead,
    leadId: lead ? lead.id : null,
    paused: !!lead,
    optedOut: !!(lead && stop),
    messageId: message.id,
    suppressedSends: staging.sideEffectsDisabled(),
  };
}

module.exports = {
  inboundAuthorized,
  inboundSecret,
  extractSenderEmail,
  ingestInboundEmail,
};
