'use strict';

const staging = require('../stagingSideEffects.cjs');
const { sendPlatformEmail } = require('../emailTransport.cjs');
const { update, id } = require('./salesStore.cjs');
const { smsFromNumber, smsMaySend, transactionalSmsKind } = require('./phonePolicy.cjs');

const DEFAULT_SALES_AGENT_EMAIL_FROM = 'Cole from CompanySync <cole.ai@getcompanysync.com>';
const DEFAULT_SALES_AGENT_REPLY_TO = 'cole.ai@getcompanysync.com';

function smsFrom() {
  return smsFromNumber();
}

function salesAgentEmailFrom() {
  return String(process.env.SALES_AGENT_EMAIL_FROM || DEFAULT_SALES_AGENT_EMAIL_FROM).trim();
}

function salesAgentReplyTo() {
  return String(process.env.SALES_AGENT_REPLY_TO || DEFAULT_SALES_AGENT_REPLY_TO).trim();
}

async function deliverEmail({ to, subject, text, html, attachments, from, replyTo }) {
  if (!to) return { skipped: true, reason: 'no_email' };
  const result = await sendPlatformEmail({
    to,
    from: from || salesAgentEmailFrom(),
    replyTo: replyTo || salesAgentReplyTo(),
    subject,
    text,
    html,
    attachments,
    context: 'sales-agent',
  });
  return {
    ...result,
    suppressed: !!(result && result.suppressed) || staging.sideEffectsDisabled(),
  };
}

async function deliverSms({ to, body, kind }) {
  if (!to) return { skipped: true, reason: 'no_phone' };
  if (kind && !transactionalSmsKind(kind)) {
    return { skipped: true, reason: 'sms_not_transactional', suppressed: true };
  }
  const decision = smsMaySend(to);
  if (!decision.allow) {
    if (decision.reason === 'staging') staging.logSuppressed('sms', { to, from: smsFrom() });
    return { skipped: decision.reason !== 'staging', suppressed: true, reason: decision.reason, sid: 'staging-suppressed', status: 'queued' };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID || 'AC_STAGING';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const from = smsFrom();
  if (!decision.bypassGuard && (!token || !from)) {
    return { skipped: true, reason: 'sms_not_configured' };
  }
  const fetchImpl = decision.bypassGuard && globalThis.__stagingOriginalFetch
    ? globalThis.__stagingOriginalFetch
    : fetch;
  const resp = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      To: to,
      From: from || '+10000000000',
      Body: body,
    }),
  });
  const payload = await resp.json().catch(() => ({}));
  const suppressed = decision.bypassGuard
    ? !!(payload && payload.suppressed)
    : (!!(payload && payload.suppressed) || staging.sideEffectsDisabled());
  return {
    ...payload,
    suppressed,
    status: payload.status || resp.status,
  };
}

async function recordMessage(entry) {
  const row = {
    id: id('msg'),
    at: new Date().toISOString(),
    ...entry,
  };
  await update((state) => {
    state.messages.push(row);
  });
  return row;
}

async function sendPrepared({ lead, kind, channel, to, subject, text, html, attachments, bookingId }) {
  if (lead && lead.optedOut) {
    return recordMessage({
      leadId: lead.id, bookingId: bookingId || null, kind, channel, to, subject, body: text || '',
      skipped: true, reason: 'stop', suppressed: false,
    });
  }
  let result;
  if (channel === 'sms') result = await deliverSms({ to, body: text, kind });
  else result = await deliverEmail({ to, subject, text, html, attachments });
  return recordMessage({
    leadId: lead ? lead.id : null,
    bookingId: bookingId || null,
    kind,
    channel,
    to,
    from: channel === 'email' ? salesAgentEmailFrom() : smsFrom(),
    replyTo: channel === 'email' ? salesAgentReplyTo() : '',
    subject: subject || '',
    body: text || '',
    suppressed: !!(result && result.suppressed),
    skipped: !!(result && result.skipped),
    reason: result && result.reason || '',
    providerId: result && (result.id || result.sid || result.messageId) || '',
  });
}

module.exports = {
  DEFAULT_SALES_AGENT_EMAIL_FROM,
  DEFAULT_SALES_AGENT_REPLY_TO,
  salesAgentEmailFrom,
  salesAgentReplyTo,
  deliverEmail,
  deliverSms,
  recordMessage,
  sendPrepared,
};
