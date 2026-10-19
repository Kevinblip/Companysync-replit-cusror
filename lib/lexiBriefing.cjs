'use strict';

// Morning briefing for the owner. Reuses the calendar, crew, payment, lead,
// callback, and estimate tools. The scheduled copy goes to Kevin's Lexi Team
// Chat and to his cell from Lexi's number. It never texts a customer.
// The daily send is claimed once per New York date so a second tick cannot
// send it again.

const crypto = require('crypto');
const lexiPhone = require('./lexiPhone.cjs');
const finance = require('./lexiFinance.cjs');
const leads = require('./lexiLeads.cjs');
const calls = require('./lexiCalls.cjs');
const estimates = require('./lexiEstimates.cjs');
const teamChat = require('./lexiTeamChat.cjs');
const stagingSideEffects = require('./stagingSideEffects.cjs');

const TIME_ZONE = 'America/New_York';
const SMS_LIMIT = 1200;
const CHAT_LIMIT = 3500;
const WINDOW_MINUTES = 15;
const DEFAULT_TIME = '07:00';
const DEFAULT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SETTING_ENTITY = 'LexiBriefingSetting';
const LEXI_FROM = '+12165160246';

function settingId(companyId) {
  return `lexi_briefing_${companyId}`;
}

function parseData(row) {
  if (!row) return {};
  if (row.data && typeof row.data === 'object') return row.data;
  if (typeof row.data === 'string') {
    try { return JSON.parse(row.data) || {}; } catch (e) { return {}; }
  }
  return {};
}

function zonedParts(date, timeZone = TIME_ZONE) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const parts = Object.fromEntries(formatted.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: String(parts.weekday || '').slice(0, 3).toLowerCase(),
    hour,
    minute: Number(parts.minute),
    weekdayLabel: parts.weekday,
  };
}

function addDays(ymd, days) {
  const [year, month, day] = String(ymd).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function parseClock(text) {
  const match = String(text || '').trim().toLowerCase().replace(/\./g, '').match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const suffix = match[3] || '';
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function speakTime(hhmm) {
  const parsed = parseClock(hhmm);
  if (!parsed) return hhmm || DEFAULT_TIME;
  const [hourText, minuteText] = parsed.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const shown = hour % 12 || 12;
  return `${shown}:${minuteText} ${suffix}`;
}

function parseDays(text) {
  if (!text) return null;
  const days = String(text).toLowerCase().split(/[^a-z]+/).map((day) => day.slice(0, 3)).filter((day) => DEFAULT_DAYS.concat('sun').includes(day));
  return days.length ? [...new Set(days)] : null;
}

function resolveSchedule(stored, env = process.env) {
  const saved = stored || {};
  const enabled = typeof saved.enabled === 'boolean'
    ? saved.enabled
    : String(env.LEXI_BRIEFING_ENABLED || '') === '1';
  const time = parseClock(saved.time) || parseClock(env.LEXI_BRIEFING_TIME) || DEFAULT_TIME;
  const days = (Array.isArray(saved.days) && saved.days.length ? saved.days : null)
    || parseDays(env.LEXI_BRIEFING_DAYS)
    || DEFAULT_DAYS;
  const [hour, minute] = time.split(':').map(Number);
  return {
    enabled,
    stopped: saved.enabled === false,
    time,
    days,
    hour,
    minute,
    skip_ymd: saved.skip_ymd || '',
    last_sent_ymd: saved.last_sent_ymd || '',
    last_briefing_at: saved.last_briefing_at || '',
  };
}

function isDue(now, schedule) {
  const parts = zonedParts(now);
  if (!schedule.days.includes(parts.weekday)) return false;
  const minutes = parts.hour * 60 + parts.minute;
  const target = schedule.hour * 60 + schedule.minute;
  return minutes >= target && minutes < target + WINDOW_MINUTES;
}

function shouldArmScheduler(env = process.env) {
  if (String(env.LEXI_BRIEFING_ENABLED || '') !== '1') return false;
  if (stagingSideEffects.sideEffectsDisabled(env) && String(env.LEXI_BRIEFING_RUN_ON_STAGING || '') !== '1') return false;
  return true;
}

function ownerFromEnv(env = process.env) {
  const config = lexiPhone.configFromEnv(env);
  const allow = (config.allowlist || []).map((phone) => lexiPhone.toE164(phone)).filter(Boolean);
  return {
    companyId: config.companyId,
    userEmail: config.userEmail,
    name: config.userName || 'Kevin',
    phone: allow[0] || '',
    from: lexiPhone.toE164(config.lexiNumber || LEXI_FROM) || LEXI_FROM,
    allowlist: allow,
  };
}

async function readRows(pool, sql, params) {
  const result = await pool.query(sql, params);
  return result?.rows || [];
}

async function loadSetting(pool, companyId) {
  const rows = await readRows(
    pool,
    `SELECT id, company_id, data FROM generic_entities
     WHERE entity_type = 'LexiBriefingSetting' AND company_id = $1
     LIMIT 1`,
    [companyId]
  );
  return rows[0] ? { id: rows[0].id || settingId(companyId), ...parseData(rows[0]) } : {};
}

async function saveSetting(pool, companyId, patch) {
  const id = settingId(companyId);
  const current = await loadSetting(pool, companyId);
  const next = { ...current, ...patch };
  delete next.id;
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'LexiBriefingSetting', $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO UPDATE
       SET data = EXCLUDED.data, company_id = EXCLUDED.company_id, updated_date = NOW()`,
    [id, companyId, JSON.stringify(next)]
  );
  return next;
}

async function claimDay(pool, companyId, ymd, at) {
  const id = settingId(companyId);
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'LexiBriefingSetting', $2, '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO NOTHING`,
    [id, companyId]
  );
  const result = await pool.query(
    `UPDATE generic_entities
     SET data = COALESCE(data, '{}'::jsonb) || $3::jsonb, updated_date = NOW()
     WHERE id = $1 AND entity_type = 'LexiBriefingSetting' AND company_id = $2
       AND COALESCE(data->>'last_sent_ymd', '') <> $4`,
    [id, companyId, JSON.stringify({ last_sent_ymd: ymd, last_briefing_at: at }), ymd]
  );
  return !result || result.rowCount !== 0;
}

async function releaseClaim(pool, companyId, ymd) {
  const id = settingId(companyId);
  await pool.query(
    `UPDATE generic_entities
     SET data = (COALESCE(data, '{}'::jsonb) - 'last_sent_ymd') || $3::jsonb, updated_date = NOW()
     WHERE id = $1 AND entity_type = 'LexiBriefingSetting' AND company_id = $2
       AND COALESCE(data->>'last_sent_ymd', '') = $4`,
    [id, companyId, JSON.stringify({ last_briefing_at: null }), ymd]
  );
}

function leadWindow(lastIso, now) {
  const today = zonedParts(now).ymd;
  if (!lastIso) return { args: { period: 'today' }, label: 'today' };
  const lastDay = zonedParts(new Date(lastIso)).ymd;
  const start = lastDay < today ? addDays(lastDay, 1) : today;
  if (start > today || start === today) return { args: { period: 'today' }, label: 'today' };
  return { args: { start_date: start, end_date: today }, label: `since ${start}` };
}

async function safeSection(label, fn) {
  try {
    return await fn();
  } catch (err) {
    return { success: false, error: err.message || `${label} unavailable` };
  }
}

function clock(iso) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
}

function clip(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function lineItems(items, limit) {
  const shown = items.slice(0, limit).filter(Boolean);
  const extra = items.length - shown.length;
  if (!shown.length) return 'none';
  return `${shown.join('; ')}${extra > 0 ? ` +${extra}` : ''}`;
}

function formatBriefing(sections, now = new Date()) {
  const parts = zonedParts(now);
  const dateLabel = new Date(`${parts.ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const calendar = sections.calendar?.events || [];
  const crew = sections.crew?.rows || [];
  const payments = sections.payments || {};
  const receivables = sections.receivables || {};
  const leadRows = sections.leads?.rows || [];
  const callbackRows = sections.callbacks?.rows || [];
  const estimateRows = sections.followups?.rows || [];
  const calendarBits = calendar.map((row) => `${clock(row.start_time) || 'time'} ${clip(row.title, 32)}${row.location ? ` ${clip(row.location, 24)}` : ''}`);
  const crewBits = crew.map((row) => `${clip(row.crew || row.title, 24)}${row.address ? ` ${clip(row.address, 24)}` : ''}`);
  const overdueBits = (receivables.overdue_invoices || []).map((row) => `${clip(row.customer_name, 24)} ${row.balance} ${row.days_overdue}d`);
  const leadBits = leadRows.map((row) => clip(row.name, 24));
  const callbackBits = callbackRows.map((row) => clip(row.name, 24));
  const estimateBits = estimateRows.map((row) => `${clip(row.customer_name, 24)} ${row.total}`);
  const money = payments.success === false ? 'unavailable' : `${payments.total_spoken || '$0.00'}, ${payments.count || 0}`;
  const overdueTotal = receivables.success === false ? 'unavailable' : finance.formatMoney(receivables.overdue_total || 0);
  const leadLabel = sections.leadLabel || 'today';
  const leadCount = sections.leads?.count || 0;
  const callbackCount = sections.callbacks?.count || 0;
  const estimateCount = sections.followups?.count || 0;
  const estimateTotal = sections.followups?.total || finance.formatMoney(0);

  function body(limit) {
    return [
      `Morning briefing, ${dateLabel}`,
      `Calendar: ${calendar.length}. ${lineItems(calendarBits, limit)}`,
      `Crew: ${crew.length}. ${lineItems(crewBits, limit)}`,
      `Yesterday: ${money}`,
      `Overdue: ${overdueTotal}. ${lineItems(overdueBits, limit)}`,
      `Leads ${leadLabel}: ${leadCount}. ${lineItems(leadBits, limit)}`,
      `Callbacks: ${callbackCount}. ${lineItems(callbackBits, limit)}`,
      `Estimates: ${estimateCount} waiting, ${estimateTotal}. ${lineItems(estimateBits, limit)}`,
    ].join('\n');
  }

  let sms = body(2);
  if (sms.length > SMS_LIMIT) sms = body(1);
  if (sms.length > SMS_LIMIT) sms = body(0);
  if (sms.length > SMS_LIMIT) sms = `${sms.slice(0, SMS_LIMIT - 1).trimEnd()}…`;
  let teamChat = body(8);
  if (teamChat.length > CHAT_LIMIT) teamChat = `${teamChat.slice(0, CHAT_LIMIT - 1).trimEnd()}…`;
  const topOverdue = (receivables.overdue_invoices || [])[0];
  const spoken = [
    `${dateLabel} briefing.`,
    `${calendar.length} on your calendar.`,
    `${crew.length} crew job${crew.length === 1 ? '' : 's'}.`,
    `Yesterday ${payments.total_spoken || '$0.00'}.`,
    `Overdue ${overdueTotal}${topOverdue ? `, top is ${topOverdue.customer_name}` : ''}.`,
    `${leadCount} new lead${leadCount === 1 ? '' : 's'}.`,
    `${callbackCount} callback${callbackCount === 1 ? '' : 's'}.`,
    `${estimateCount} estimate${estimateCount === 1 ? '' : 's'} waiting.`,
  ].join(' ');
  return { spoken, sms, team_chat: teamChat, date: parts.ymd };
}

async function buildBriefing(pool, owner, now = new Date(), stored = {}) {
  const window = leadWindow(stored.last_briefing_at, now);
  const [calendar, crew, payments, receivables, leadResult, callbackResult, followups] = await Promise.all([
    safeSection('calendar', () => lexiPhone.listSchedule(pool, owner, { day: 'today', timezone: TIME_ZONE, now })),
    safeSection('crew', () => leads.crewSchedule(pool, owner, { period: 'today' }, now)),
    safeSection('payments', () => finance.summarizePayments(pool, owner, { period: 'yesterday' }, now)),
    safeSection('receivables', () => finance.summarizeReceivables(pool, owner, now)),
    safeSection('leads', () => leads.summarizeLeads(pool, owner, window.args, now)),
    safeSection('callbacks', () => calls.listCallbacks(pool, owner)),
    safeSection('estimates', () => estimates.listEstimateFollowUps(pool, owner, { days: 7 }, now)),
  ]);
  return formatBriefing({
    calendar, crew, payments, receivables,
    leads: leadResult,
    callbacks: callbackResult,
    followups,
    leadLabel: window.label,
  }, now);
}

async function getMorningBriefing(pool, owner, now = new Date()) {
  if (!owner?.companyId) {
    return { success: false, code: 'COMPANY_UNRESOLVED', error: 'No company is linked, so there is no briefing. Say that.' };
  }
  const stored = await loadSetting(pool, owner.companyId).catch(() => ({}));
  const briefing = await buildBriefing(pool, owner, now, stored);
  await saveSetting(pool, owner.companyId, { last_briefing_at: now.toISOString() }).catch(() => {});
  return {
    success: true,
    ...briefing,
    message: `On a call, say only this: ${briefing.spoken} On SMS, reply with the sms text and nothing else. In Team Chat, reply with the team_chat text. Do not text a customer.`,
  };
}

function isExplicitBriefingConfirmation(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/send it|book it|move it|cancel it/.test(t)) return false;
  return /^(yes|yeah|yep|yes please|yes,? do it|yes,? stop it|yes,? move it|yes,? skip it|yes,? skip tomorrow)$/.test(t);
}

async function prepareBriefingChange(pool, owner, args, state, now = new Date()) {
  if (!owner?.companyId) return { success: false, code: 'COMPANY_UNRESOLVED', error: 'No company is linked. Nothing was changed.' };
  const action = String(args.action || '').toLowerCase();
  const pending = { action, company_id: owner.companyId };
  if (action === 'stop') {
    pending.read_back = 'Stop the morning briefing. It will not be sent.';
  } else if (action === 'time' || action === 'move') {
    const time = parseClock(args.time || args.when);
    if (!time) return { success: false, error: 'Say the time, like 6:30. Nothing was changed.' };
    pending.action = 'time';
    pending.time = time;
    pending.read_back = `Move the morning briefing to ${speakTime(time)}.`;
  } else if (action === 'skip') {
    const tomorrow = addDays(zonedParts(now).ymd, 1);
    pending.skip_ymd = tomorrow;
    pending.read_back = `Skip the briefing on ${tomorrow}.`;
  } else {
    return { success: false, error: 'Say stop, a new time, or skip tomorrow. Nothing was changed.' };
  }
  state.pendingBriefingChange = pending;
  return {
    success: true,
    written: false,
    read_back: pending.read_back,
    message: `Read this back and wait. Do not say it is saved. He must say yes. "yes, send it" does not change it. ${pending.read_back}`,
  };
}

async function confirmBriefingChange(pool, owner, state) {
  const pending = state.pendingBriefingChange;
  if (!pending) return { success: false, code: 'NOTHING_TO_CHANGE', written: false, error: 'There is no briefing change waiting. Read one back first.' };
  if (!isExplicitBriefingConfirmation(state.latestUserText)) {
    return { success: false, code: 'CONFIRMATION_REQUIRED', written: false, error: 'Do not change it. He has not said yes.' };
  }
  if (!owner?.companyId || String(pending.company_id) !== String(owner.companyId)) {
    return { success: false, written: false, error: 'That setting is not for this company. Nothing was changed.' };
  }
  const patch = {};
  if (pending.action === 'stop') patch.enabled = false;
  if (pending.action === 'time') patch.time = pending.time;
  if (pending.action === 'skip') patch.skip_ymd = pending.skip_ymd;
  await saveSetting(pool, owner.companyId, patch);
  state.pendingBriefingChange = null;
  state.actions.push({ type: 'briefing', summary: pending.read_back });
  return { success: true, written: true, message: `Saved. ${pending.read_back} No customer was texted.` };
}

async function findOwnerThread(pool, companyId, ownerEmail) {
  const rows = await readRows(
    pool,
    `SELECT id, chat_type, participants FROM chat_conversations
     WHERE company_id = $1 AND chat_type = 'direct'`,
    [companyId]
  );
  const owner = String(ownerEmail || '').trim().toLowerCase();
  return rows.find((row) => {
    const people = Array.isArray(row.participants) ? row.participants : [];
    const emails = people.map((person) => String(person?.email || '').toLowerCase());
    return emails.includes(teamChat.LEXI_EMAIL) && emails.includes(owner);
  }) || null;
}

async function ensureOwnerThread(pool, companyId, ownerEmail) {
  const existing = await findOwnerThread(pool, companyId, ownerEmail);
  if (existing) return existing.id;
  const id = `conv_lexi_${companyId}`;
  const participants = [{ email: ownerEmail }, { email: teamChat.LEXI_EMAIL, name: teamChat.LEXI_NAME }];
  await pool.query(
    `INSERT INTO chat_conversations (id, company_id, chat_type, name, participants, created_by, created_at, updated_at)
     VALUES ($1, $2, 'direct', 'Lexi', $3::jsonb, $4, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, companyId, JSON.stringify(participants), teamChat.LEXI_EMAIL]
  );
  return id;
}

async function deliverBriefing({ pool, env, briefing, sendSms }) {
  const owner = ownerFromEnv(env);
  const to = owner.phone;
  let sms = { success: false, skipped: true, reason: 'no_owner_phone' };
  if (to) {
    if (!owner.allowlist.includes(to) || owner.allowlist[0] !== to) {
      sms = { success: false, error: 'Briefing texts go only to the owner cell.' };
    } else if (typeof sendSms === 'function') {
      sms = await sendSms({ to, from: owner.from, body: briefing.sms });
    } else {
      sms = { success: false, error: 'SMS is not configured.' };
    }
  }
  let posted = false;
  if (owner.userEmail && owner.companyId) {
    const conversationId = await ensureOwnerThread(pool, owner.companyId, owner.userEmail);
    posted = await teamChat.postLexiReply(pool, owner.companyId, conversationId, briefing.team_chat);
  }
  return { sms, posted: posted === true, to: to || '', from: owner.from };
}

function tokensMatch(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorizeBriefingRequest({ userEmail, token, env = process.env }) {
  const owner = String(env.LEXI_PHONE_USER_EMAIL || '').trim().toLowerCase();
  if (!owner) return { ok: false, status: 403, error: 'No owner is configured.' };
  const expected = String(env.LEXI_BRIEFING_TOKEN || '');
  if (expected && token && tokensMatch(token, expected)) return { ok: true };
  const email = String(userEmail || '').trim().toLowerCase();
  if (email && email === owner) return { ok: true };
  return { ok: false, status: email || token ? 403 : 401, error: 'Only the owner can run the briefing.' };
}

async function runScheduled({ pool, env = process.env, sendSms, now = new Date(), manual = false }) {
  const owner = ownerFromEnv(env);
  if (!owner.companyId) return { sent: false, reason: 'company_unresolved' };
  const stored = await loadSetting(pool, owner.companyId);
  const schedule = resolveSchedule(stored, env);
  const today = zonedParts(now).ymd;
  if (schedule.stopped) return { sent: false, reason: 'stopped' };
  if (!manual && !schedule.enabled) return { sent: false, reason: 'disabled' };
  if (schedule.skip_ymd && schedule.skip_ymd === today) return { sent: false, reason: 'skipped' };
  if (!manual && !isDue(now, schedule)) return { sent: false, reason: 'not_due' };
  const claimed = await claimDay(pool, owner.companyId, today, now.toISOString());
  if (!claimed) return { sent: false, reason: 'already_sent' };
  let briefing;
  try {
    briefing = await buildBriefing(pool, owner, now, stored);
  } catch (err) {
    await releaseClaim(pool, owner.companyId, today).catch(() => {});
    return { sent: false, reason: 'failed', error: err.message };
  }
  let delivery;
  try {
    delivery = await deliverBriefing({ pool, env, briefing, sendSms });
  } catch (err) {
    await releaseClaim(pool, owner.companyId, today).catch(() => {});
    return { sent: false, reason: 'not_delivered', error: err.message };
  }
  const smsDone = !owner.phone || delivery.sms?.success === true || delivery.sms?.suppressed === true;
  if (!smsDone && !delivery.posted) {
    await releaseClaim(pool, owner.companyId, today).catch(() => {});
    return { sent: false, reason: 'not_delivered', delivery };
  }
  return { sent: true, reason: 'sent', to: delivery.to, from: delivery.from, posted: delivery.posted, sms: delivery.sms, chars: briefing.sms.length };
}

async function runBriefingRequest({ userEmail, token, env = process.env, pool, sendSms, now = new Date() }) {
  const auth = authorizeBriefingRequest({ userEmail, token, env });
  if (!auth.ok) return { status: auth.status, body: { sent: false, error: auth.error } };
  const result = await runScheduled({ pool, env, sendSms, now, manual: true });
  return { status: 200, body: result };
}

function defaultDeliverSms(payload, env = process.env) {
  const owner = ownerFromEnv(env);
  const to = lexiPhone.toE164(payload?.to || '');
  if (!to || to !== owner.phone) {
    return Promise.resolve({ success: false, error: 'Briefing texts go only to the owner cell.' });
  }
  return lexiPhone.deliverTwilioSms({
    to: owner.phone,
    body: payload?.body,
    from: owner.from,
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    fetchImpl: payload?.fetchImpl,
  });
}

function startBriefingScheduler({ getPool, env = process.env, sendSms, setIntervalFn = setInterval, log = console } = {}) {
  if (!shouldArmScheduler(env)) {
    if (stagingSideEffects.sideEffectsDisabled(env)) log.log('[staging] scheduler not started: lexi-briefing');
    return { started: false };
  }
  if (stagingSideEffects.sideEffectsDisabled(env)) log.log('[staging] lexi briefing scheduler opted in');
  const timer = setIntervalFn(() => {
    const pool = typeof getPool === 'function' ? getPool() : null;
    if (!pool) return;
    runScheduled({ pool, env, sendSms: sendSms || ((payload) => defaultDeliverSms(payload, env)) })
      .catch((err) => log.error('[LexiBriefing] tick failed:', err.message));
  }, 60 * 1000);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return { started: true, timer };
}

module.exports = {
  SMS_LIMIT,
  TIME_ZONE,
  DEFAULT_TIME,
  DEFAULT_DAYS,
  LEXI_FROM,
  SETTING_ENTITY,
  parseClock,
  speakTime,
  resolveSchedule,
  isDue,
  shouldArmScheduler,
  formatBriefing,
  buildBriefing,
  getMorningBriefing,
  isExplicitBriefingConfirmation,
  prepareBriefingChange,
  confirmBriefingChange,
  deliverBriefing,
  authorizeBriefingRequest,
  runScheduled,
  runBriefingRequest,
  defaultDeliverSms,
  startBriefingScheduler,
  ownerFromEnv,
};
