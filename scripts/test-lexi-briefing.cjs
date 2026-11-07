#!/usr/bin/env node
// Lexi morning briefing. Fixture rows only. No Twilio send and no customer text.
'use strict';

const fs = require('fs');
const path = require('path');
const lexi = require('../lib/lexiPhone.cjs');
const briefing = require('../lib/lexiBriefing.cjs');
const team = require('../lib/lexiTeamChat.cjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const OWNER = { companyId: 'co_lexi', userEmail: 'kevin@example.com', name: 'Kevin', phone: '+15555550123' };
const NOW = new Date('2026-10-20T11:10:00Z'); // Tuesday 7:10 AM EDT
const SIX_THIRTY = new Date('2026-10-20T10:30:00Z');
const SEVEN = new Date('2026-10-20T11:00:00Z');
const SUNDAY = new Date('2026-10-18T11:00:00Z');
const WEDNESDAY = new Date('2026-10-21T11:10:00Z');
const THURSDAY = new Date('2026-10-22T11:10:00Z');

function env(extra = {}) {
  return {
    LEXI_PHONE_COMPANY_ID: OWNER.companyId,
    LEXI_PHONE_USER_EMAIL: OWNER.userEmail,
    LEXI_PHONE_USER_NAME: 'Kevin',
    LEXI_PHONE_ALLOWLIST: '+15555550123',
    LEXI_PHONE_NUMBER: '+12165160246',
    ...extra,
  };
}

function config() {
  return {
    ...lexi.configFromEnv(env()),
    pin: '4271',
    companyId: OWNER.companyId,
    userEmail: OWNER.userEmail,
    userName: 'Kevin',
  };
}

function unlocked() {
  const state = lexi.sessionFromThread(lexi.emptyThread('+15555550123'));
  state.pinVerified = true;
  state.actions = [];
  return state;
}

const EVENTS = [
  { id: 'ev_kevin', company_id: 'co_lexi', title: 'Permit meeting', event_type: 'meeting', start_time: '2026-10-20T14:00:00.000Z', end_time: '2026-10-20T15:00:00.000Z', location: 'Office', status: 'confirmed', assigned_to: 'kevin@example.com' },
  { id: 'ev_luis', company_id: 'co_lexi', title: 'Pine roof', event_type: 'job', start_time: '2026-10-20T15:00:00.000Z', end_time: '2026-10-20T18:00:00.000Z', location: '9 Pine St', status: 'confirmed', assigned_to: 'Luis' },
  { id: 'ev_cancel', company_id: 'co_lexi', title: 'Cancelled walk', start_time: '2026-10-20T16:00:00.000Z', status: 'cancelled', assigned_to: 'kevin@example.com' },
  { id: 'ev_other', company_id: 'co_other', title: 'Zelda job', start_time: '2026-10-20T14:00:00.000Z', status: 'confirmed', assigned_to: 'kevin@example.com', location: 'Elsewhere' },
];

const INVOICES = [
  { id: 'inv_smith', company_id: 'co_lexi', customer_name: 'Sam Smith', invoice_number: 'INV-1', status: 'sent', total_amount: 800, amount_paid: 0, due_date: '2026-09-01', data: {} },
  { id: 'inv_jones', company_id: 'co_lexi', customer_name: 'Jo Jones', invoice_number: 'INV-2', status: 'sent', total_amount: 200, amount_paid: 0, due_date: '2026-10-01', data: {} },
  { id: 'inv_other', company_id: 'co_other', customer_name: 'Zelda Quinn', invoice_number: 'INV-9', status: 'sent', total_amount: 9000, amount_paid: 0, due_date: '2026-01-01', data: {} },
];

const PAYMENTS = [
  { id: 'pay_ok', company_id: 'co_lexi', customer_name: 'Paid Pat', amount: 470, payment_method: 'card', payment_date: '2026-10-19T15:00:00.000Z', status: 'completed', created_at: '2026-10-19T15:00:00.000Z' },
  { id: 'pay_fail', company_id: 'co_lexi', customer_name: 'Failed Fran', amount: 9000, payment_date: '2026-10-19T16:00:00.000Z', status: 'failed', created_at: '2026-10-19T16:00:00.000Z' },
  { id: 'pay_other', company_id: 'co_other', customer_name: 'Zelda Quinn', amount: 9000, payment_date: '2026-10-19T15:00:00.000Z', status: 'completed', created_at: '2026-10-19T15:00:00.000Z' },
];

const LEADS = [
  { id: 'lead_mina', company_id: 'co_lexi', name: 'Mina Cho', phone: '+15555550131', status: 'new', source: 'web', created_at: '2026-10-20T13:00:00.000Z' },
  { id: 'lead_other', company_id: 'co_other', name: 'Zelda Quinn', created_at: '2026-10-20T13:00:00.000Z' },
];

const COMMS = [
  {
    id: 'call_owen', company_id: 'co_lexi', type: 'call', communication_type: 'call', direction: 'inbound',
    contact_name: 'Owen Pike', contact_phone: '+15555550140', status: 'missed',
    data: { assistant_name: 'alex', called_number: '+12167777154' }, created_at: '2026-10-20T12:00:00.000Z',
  },
  {
    id: 'call_other', company_id: 'co_other', type: 'call', communication_type: 'call', direction: 'inbound',
    contact_name: 'Zelda Quinn', contact_phone: '+15555550141', status: 'missed',
    data: { assistant_name: 'alex' }, created_at: '2026-10-20T12:00:00.000Z',
  },
];

const ESTIMATES = [
  { id: 'est_eve', company_id: 'co_lexi', customer_name: 'Eve Cole', estimate_number: 'EST-0004', title: 'Roof', status: 'sent', total_amount: 1000, updated_at: '2026-10-20T12:00:00.000Z', data: { sent_at: '2026-10-01' } },
  { id: 'est_other', company_id: 'co_other', customer_name: 'Zelda Quinn', estimate_number: 'EST-0099', status: 'sent', total_amount: 9000, updated_at: '2026-01-01T12:00:00.000Z', data: { sent_at: '2026-01-01' } },
];

function briefingPool() {
  const settings = new Map();
  const conversations = [];
  const messages = [];
  const queries = [];
  const genericWrites = [];
  const pool = {
    settings, conversations, messages, queries, genericWrites,
    query: async (sql, params = []) => {
      queries.push(sql);
      const text = sql.replace(/\s+/g, ' ');
      const company = params[0];
      const own = (rows) => rows.filter((row) => String(row.company_id) === String(company));

      if (/FROM calendar_events/i.test(text) && /LOWER\(\$2\)/i.test(text)) {
        const email = String(params[1] || '').toLowerCase();
        return {
          rows: own(EVENTS).filter((row) => String(row.assigned_to || '').toLowerCase() === email && row.status !== 'cancelled' && row.start_time >= params[2] && row.start_time <= params[3]),
        };
      }
      if (/FROM calendar_events/i.test(text)) {
        return {
          rows: own(EVENTS).filter((row) => row.status !== 'cancelled' && row.start_time >= params[1] && row.start_time <= params[2]),
        };
      }
      if (/FROM invoices/i.test(text)) return { rows: own(INVOICES) };
      if (/FROM payments/i.test(text)) return { rows: own(PAYMENTS) };
      if (/FROM estimates/i.test(text) && /customer_phone/i.test(text)) return { rows: own(ESTIMATES) };
      if (/FROM leads/i.test(text)) return { rows: own(LEADS) };
      if (/FROM communications/i.test(text) && /lead_id IS NOT NULL/i.test(text)) return { rows: [] };
      if (/FROM communications/i.test(text)) return { rows: own(COMMS) };
      if (/missed_call/i.test(text)) return { rows: [] };
      if (/LexiBriefingSetting/i.test(text) && /^\s*SELECT/i.test(text)) {
        const row = [...settings.values()].find((item) => item.company_id === company);
        return { rows: row ? [{ id: row.id, company_id: row.company_id, data: row.data }] : [] };
      }
      if (/INSERT INTO generic_entities/i.test(text) && /LexiBriefingSetting/i.test(text)) {
        const id = params[0];
        const companyId = params[1];
        if (/DO NOTHING/i.test(text)) {
          if (!settings.has(id)) settings.set(id, { id, company_id: companyId, data: {} });
          return { rows: [], rowCount: 1 };
        }
        const data = JSON.parse(params[2]);
        settings.set(id, { id, company_id: companyId, data });
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO generic_entities/i.test(text)) {
        genericWrites.push({ params });
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE generic_entities/i.test(text)) {
        const id = params[0];
        const companyId = params[1];
        const patch = JSON.parse(params[2] || '{}');
        const ymd = params[3];
        const row = settings.get(id);
        if (!row || String(row.company_id) !== String(companyId)) return { rows: [], rowCount: 0 };
        const release = /- 'last_sent_ymd'/.test(text);
        if (release) {
          if (String(row.data.last_sent_ymd || '') !== String(ymd)) return { rows: [], rowCount: 0 };
          const next = { ...row.data, ...patch };
          delete next.last_sent_ymd;
          row.data = next;
          return { rows: [], rowCount: 1 };
        }
        if (String(row.data.last_sent_ymd || '') === String(ymd)) return { rows: [], rowCount: 0 };
        row.data = { ...row.data, ...patch };
        return { rows: [], rowCount: 1 };
      }
      if (/FROM chat_conversations/i.test(text) && /chat_type = 'direct'/i.test(text)) {
        return { rows: conversations.filter((row) => row.company_id === company && row.chat_type === 'direct') };
      }
      if (/FROM chat_conversations/i.test(text)) {
        const row = conversations.find((item) => item.id === params[0] && item.company_id === params[1]);
        return { rows: row ? [row] : [] };
      }
      if (/INSERT INTO chat_conversations/i.test(text)) {
        if (!conversations.some((row) => row.id === params[0])) {
          conversations.push({
            id: params[0],
            company_id: params[1],
            chat_type: 'direct',
            participants: JSON.parse(params[2]),
            created_by: params[3],
          });
        }
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO chat_messages/i.test(text)) {
        messages.push({
          id: params[0], company_id: params[1], conversation_id: params[2],
          sender_email: params[3], sender_name: params[4], message: params[5],
        });
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE chat_conversations/i.test(text)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  return pool;
}

function smsSpy() {
  const sent = [];
  return {
    sent,
    send: async (payload) => {
      sent.push(payload);
      return { success: true };
    },
  };
}

async function main() {
  console.log('\nClock and schedule');
  check('6:30 and 6:30 pm parse', briefing.parseClock('6:30') === '06:30' && briefing.parseClock('6:30 pm') === '18:30' && briefing.parseClock('7') === '07:00');
  check('a spoken time reads in the morning', briefing.speakTime('06:30') === '6:30 AM');
  const storedOff = briefing.resolveSchedule({ enabled: false, time: '06:30' }, env({ LEXI_BRIEFING_ENABLED: '1', LEXI_BRIEFING_TIME: '08:00' }));
  check('a saved stop and time beat the env vars', storedOff.enabled === false && storedOff.time === '06:30' && storedOff.stopped === true);
  const defaults = briefing.resolveSchedule({}, {});
  check('the default is 7:00 Monday through Saturday and off', defaults.enabled === false && defaults.time === '07:00' && defaults.days.join(',') === 'mon,tue,wed,thu,fri,sat' && !defaults.days.includes('sun'));
  check('Tuesday 7:10 is inside the send window', briefing.isDue(NOW, briefing.resolveSchedule({}, env({ LEXI_BRIEFING_ENABLED: '1' }))));
  check('Sunday 7:00 is not a briefing day', !briefing.isDue(SUNDAY, defaults));
  check('staging does not arm this job unless both flags are on', briefing.shouldArmScheduler(env({ LEXI_BRIEFING_ENABLED: '1', STAGING_READ_ONLY_SIDE_EFFECTS: '1' })) === false && briefing.shouldArmScheduler(env({ LEXI_BRIEFING_ENABLED: '1', STAGING_READ_ONLY_SIDE_EFFECTS: '1', LEXI_BRIEFING_RUN_ON_STAGING: '1' })) === true);
  check('the timer stays off until LEXI_BRIEFING_ENABLED is 1', briefing.shouldArmScheduler(env()) === false && briefing.shouldArmScheduler(env({ LEXI_BRIEFING_ENABLED: '1' })) === true);

  console.log('\nShape');
  const fat = briefing.formatBriefing({
    calendar: { events: Array.from({ length: 30 }, (_, i) => ({ title: `Calendar item ${i} with a long title`, start_time: NOW.toISOString(), location: `Address lane number ${i}` })) },
    crew: { rows: Array.from({ length: 30 }, (_, i) => ({ crew: `Crew member ${i}`, address: `Job address ${i}` })) },
    payments: { success: true, total_spoken: '$470.00', count: 4 },
    receivables: { overdue_total: 1000, overdue_invoices: Array.from({ length: 20 }, (_, i) => ({ customer_name: `Overdue Person ${i}`, balance: '$100.00', days_overdue: 40 - i })) },
    leads: { count: 20, rows: Array.from({ length: 20 }, (_, i) => ({ name: `Lead Person ${i}` })) },
    callbacks: { count: 20, rows: Array.from({ length: 20 }, (_, i) => ({ name: `Callback Person ${i}` })) },
    followups: { count: 20, total: '$2,000.00', rows: Array.from({ length: 20 }, (_, i) => ({ customer_name: `Estimate Person ${i}`, total: '$50.00' })) },
    leadLabel: 'today',
  }, NOW);
  check('SMS stays within 1,200 characters', fat.sms.length <= briefing.SMS_LIMIT, String(fat.sms.length));
  check('Team Chat keeps later names that SMS drops', fat.team_chat.includes('Lead Person 5') && !fat.sms.includes('Lead Person 5') && fat.team_chat.length > fat.sms.length);
  check('the spoken line has the money and the counts', /\$470\.00/.test(fat.spoken) && /30 on your calendar/.test(fat.spoken) && /20 new leads/.test(fat.spoken));

  console.log('\nOn demand');
  const readPool = briefingPool();
  const read = await briefing.getMorningBriefing(readPool, OWNER, NOW);
  check('the briefing names today, yesterday, and the top overdue invoice', read.success === true && /Permit meeting/.test(read.sms) && /Luis/.test(read.sms) && /\$470\.00/.test(read.sms) && /\$1,000\.00/.test(read.sms) && /Sam Smith/.test(read.sms) && /Mina Cho/.test(read.sms) && /Owen Pike/.test(read.sms) && /Eve Cole/.test(read.sms));
  check('another company stays out of the briefing', !/Zelda/.test(read.sms) && !/9000|\$9,000/.test(read.sms) && !/Failed Fran/.test(read.sms) && !/Cancelled walk/.test(read.sms));
  check('asking for it does not text anyone or claim the day', readPool.messages.length === 0 && readPool.settings.get('lexi_briefing_co_lexi').data.last_briefing_at && !readPool.settings.get('lexi_briefing_co_lexi').data.last_sent_ymd);
  check('the spoken version is the short one', /Tuesday/.test(read.spoken) === false ? /Oct/.test(read.spoken) && /\$470\.00/.test(read.spoken) && read.spoken.length < read.team_chat.length : /\$470\.00/.test(read.spoken) && read.spoken.length < read.sms.length);
  const lockedPool = briefingPool();
  const denied = await lexi.executePhoneTool(
    { name: 'get_morning_briefing', args: {} },
    { state: lexi.sessionFromThread(lexi.emptyThread('+15555550123')), config: config(), pool: lockedPool, owner: OWNER }
  );
  check('the briefing needs the PIN once', denied.code === 'PIN_REQUIRED' && lockedPool.queries.length === 0);
  const wiredPool = briefingPool();
  const wired = await lexi.executePhoneTool(
    { name: 'get_morning_briefing', args: {} },
    { state: unlocked(), config: config(), pool: wiredPool, owner: OWNER }
  );
  check('the phone tool returns the spoken briefing and does not send', wired.success === true && wired.spoken && /do not text/i.test(wired.message) && wiredPool.messages.length === 0 && !wiredPool.settings.get('lexi_briefing_co_lexi').data.last_sent_ymd);
  const prompt = lexi.buildPhoneSystemPrompt({ ownerName: 'Kevin', pinVerified: false, companyResolved: true, channel: 'sms' });
  const chatPrompt = lexi.buildPhoneSystemPrompt({ ownerName: 'Kevin', pinVerified: true, companyResolved: true, channel: 'team_chat' });
  check('SMS and voice know to read the briefing back', /get_morning_briefing/.test(prompt) && /say only the spoken text/.test(prompt) && /sms text/.test(prompt));
  check('Team Chat stays signed in and can list rows', /Do not ask for a PIN/.test(chatPrompt) && /up to 10/.test(chatPrompt) && /team_chat text/.test(chatPrompt));
  const pending = unlocked();
  pending.pendingBriefingChange = { action: 'stop', read_back: 'Stop the morning briefing. It will not be sent.' };
  const thread = lexi.applySessionToThread(lexi.emptyThread('+15555550123'), pending);
  const restored = lexi.sessionFromThread({ ...thread, pin_verified_until: new Date(Date.now() + 60000).toISOString() });
  check('a pending briefing change survives the thread', thread.pending_briefing_change.action === 'stop' && restored.pendingBriefingChange.action === 'stop');
  const teamPool = briefingPool();
  await team.saveTeamSession(teamPool, 'conv_1', pending, OWNER.companyId);
  const teamSaved = JSON.parse(teamPool.genericWrites[0].params[3]);
  check('Team Chat stores the pending briefing change', teamSaved.pending_briefing_change.action === 'stop');

  console.log('\nSettings');
  const stopPool = briefingPool();
  const stopState = unlocked();
  const preparedStop = await briefing.prepareBriefingChange(stopPool, OWNER, { action: 'stop' }, stopState, NOW);
  check('stop is read back before it is saved', preparedStop.written === false && /will not be sent/.test(preparedStop.read_back));
  stopState.latestUserText = 'yes, send it';
  const sendDoesNotStop = await briefing.confirmBriefingChange(stopPool, OWNER, stopState);
  check('"yes, send it" does not stop the briefing', sendDoesNotStop.code === 'CONFIRMATION_REQUIRED' && sendDoesNotStop.written === false && !stopPool.settings.has('lexi_briefing_co_lexi'));
  stopState.latestUserText = 'yes';
  const stopped = await briefing.confirmBriefingChange(stopPool, OWNER, stopState);
  check('yes saves the stop and texts nobody', stopped.written === true && stopPool.settings.get('lexi_briefing_co_lexi').data.enabled === false && stopPool.messages.length === 0);
  const timePool = briefingPool();
  const timeState = unlocked();
  const preparedTime = await briefing.prepareBriefingChange(timePool, OWNER, { action: 'time', time: '6:30' }, timeState, NOW);
  check('a new time is read back', /6:30 AM/.test(preparedTime.read_back) && preparedTime.written === false);
  timeState.latestUserText = 'yes, move it';
  const calendarYes = await briefing.confirmBriefingChange(timePool, OWNER, timeState);
  check('"yes, move it" stays a calendar confirmation', calendarYes.written === false);
  timeState.latestUserText = 'yes';
  await briefing.confirmBriefingChange(timePool, OWNER, timeState);
  check('yes moves the saved time to 6:30', timePool.settings.get('lexi_briefing_co_lexi').data.time === '06:30');
  const skipPool = briefingPool();
  const skipState = unlocked();
  const preparedSkip = await briefing.prepareBriefingChange(skipPool, OWNER, { action: 'skip' }, skipState, NOW);
  check('skip tomorrow names the next date', preparedSkip.read_back === 'Skip the briefing on 2026-10-21.');
  skipState.latestUserText = 'yes';
  await briefing.confirmBriefingChange(skipPool, OWNER, skipState);
  check('yes stores that skip', skipPool.settings.get('lexi_briefing_co_lexi').data.skip_ymd === '2026-10-21');

  console.log('\nScheduled delivery');
  const due = smsSpy();
  const duePool = briefingPool();
  duePool.conversations.push({ id: 'broadcast_1', company_id: 'co_lexi', chat_type: 'broadcast', participants: [{ email: OWNER.userEmail }] });
  const first = await briefing.runScheduled({ pool: duePool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: due.send, now: NOW });
  check('7:10 on Tuesday texts Kevin once from Lexi', first.sent === true && first.reason === 'sent' && due.sent.length === 1 && due.sent[0].to === '+15555550123' && due.sent[0].from === '+12165160246' && due.sent[0].body.length <= 1200 && /Sam Smith/.test(due.sent[0].body));
  check('the same run posts only in the Lexi direct thread', duePool.messages.length === 1 && duePool.messages[0].sender_email === 'lexi@system' && duePool.messages[0].conversation_id === 'conv_lexi_co_lexi' && !duePool.messages.some((row) => row.conversation_id === 'broadcast_1'));
  const second = await briefing.runScheduled({ pool: duePool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: due.send, now: NOW });
  check('a second tick the same day does not send again', second.reason === 'already_sent' && due.sent.length === 1 && duePool.messages.length === 1);
  const sunday = smsSpy();
  const sundayRun = await briefing.runScheduled({ pool: briefingPool(), env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: sunday.send, now: SUNDAY });
  check('Sunday does not send', sundayRun.reason === 'not_due' && sunday.sent.length === 0);
  const off = smsSpy();
  const offRun = await briefing.runScheduled({ pool: briefingPool(), env: env(), sendSms: off.send, now: NOW });
  check('the timer does nothing while the env flag is off', offRun.reason === 'disabled' && off.sent.length === 0);
  const early = smsSpy();
  const earlyRun = await briefing.runScheduled({ pool: timePool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: early.send, now: SEVEN });
  const atSix = smsSpy();
  const sixRun = await briefing.runScheduled({ pool: briefingPool(), env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: atSix.send, now: SIX_THIRTY });
  const movedPool = briefingPool();
  const movedState = unlocked();
  await briefing.prepareBriefingChange(movedPool, OWNER, { action: 'time', time: '6:30' }, movedState, NOW);
  movedState.latestUserText = 'yes';
  await briefing.confirmBriefingChange(movedPool, OWNER, movedState);
  const movedEarly = await briefing.runScheduled({ pool: movedPool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: atSix.send, now: SIX_THIRTY });
  const movedLate = await briefing.runScheduled({ pool: briefingPool(), env: env({ LEXI_BRIEFING_ENABLED: '1', LEXI_BRIEFING_TIME: '06:30' }), sendSms: early.send, now: SEVEN });
  check('6:30 is due and 7:00 is outside that window', earlyRun.reason === 'not_due' && sixRun.reason === 'not_due' && movedEarly.sent === true && movedLate.reason === 'not_due', `${earlyRun.reason} ${sixRun.reason} ${movedEarly.reason} ${movedLate.reason}`);
  const skipSend = smsSpy();
  const skippedDay = await briefing.runScheduled({ pool: skipPool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: skipSend.send, now: WEDNESDAY });
  const dayAfter = await briefing.runScheduled({ pool: skipPool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: skipSend.send, now: THURSDAY });
  check('a skipped day stays quiet and the next day sends', skippedDay.reason === 'skipped' && dayAfter.sent === true && skipSend.sent.length === 1);
  const stoppedRun = await briefing.runScheduled({ pool: stopPool, env: env({ LEXI_BRIEFING_ENABLED: '1' }), sendSms: smsSpy().send, now: NOW, manual: true });
  check('a saved stop blocks a manual run too', stoppedRun.reason === 'stopped' && stoppedRun.sent === false);

  console.log('\nOwner trigger');
  const manualSpy = smsSpy();
  const manualPool = briefingPool();
  const stranger = await briefing.runBriefingRequest({ userEmail: 'ada@example.com', env: env({ LEXI_BRIEFING_TOKEN: 'secret' }), pool: manualPool, sendSms: manualSpy.send, now: SUNDAY });
  check('another email cannot run it', stranger.status === 403 && manualSpy.sent.length === 0);
  const wrongToken = await briefing.runBriefingRequest({ token: 'nope', env: env({ LEXI_BRIEFING_TOKEN: 'secret' }), pool: manualPool, sendSms: manualSpy.send, now: SUNDAY });
  check('a bad token cannot run it', wrongToken.status === 403 && manualSpy.sent.length === 0);
  const anonymous = await briefing.runBriefingRequest({ env: env({ LEXI_BRIEFING_TOKEN: 'secret' }), pool: manualPool, sendSms: manualSpy.send, now: SUNDAY });
  check('no identity is unauthorized', anonymous.status === 401);
  const ownerRun = await briefing.runBriefingRequest({ userEmail: 'Kevin@Example.com', env: env(), pool: manualPool, sendSms: manualSpy.send, now: SUNDAY });
  check('the owner can run it on Sunday while the timer is off', ownerRun.status === 200 && ownerRun.body.sent === true && ownerRun.body.from === '+12165160246' && manualSpy.sent.length === 1);
  const ownerAgain = await briefing.runBriefingRequest({ token: 'secret', env: env({ LEXI_BRIEFING_TOKEN: 'secret' }), pool: manualPool, sendSms: manualSpy.send, now: SUNDAY });
  check('the token can run it, and the same day is already sent', ownerAgain.status === 200 && ownerAgain.body.reason === 'already_sent' && manualSpy.sent.length === 1);

  console.log('\nSMS guard and scheduler');
  let fetched = 0;
  const refusedSms = await briefing.defaultDeliverSms({
    to: '+15555550999',
    body: 'customer',
    fetchImpl: async () => { fetched += 1; return { ok: true }; },
  }, env());
  check('a customer number is not texted', refusedSms.success === false && fetched === 0);
  const priorFlag = process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  try {
    const logged = await briefing.defaultDeliverSms({
      to: '+15555550123',
      body: 'owner briefing',
      fetchImpl: async () => { fetched += 1; return { ok: true }; },
    }, env());
    check('staging logs the owner text and does not call Twilio', logged.suppressed === true && fetched === 0);
  } finally {
    if (priorFlag === undefined) delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
    else process.env.STAGING_READ_ONLY_SIDE_EFFECTS = priorFlag;
  }
  const quietLog = [];
  const quiet = briefing.startBriefingScheduler({
    env: env({ LEXI_BRIEFING_ENABLED: '1', STAGING_READ_ONLY_SIDE_EFFECTS: '1' }),
    setIntervalFn: () => { throw new Error('interval should not start'); },
    log: { log: (line) => quietLog.push(line), error() {} },
  });
  check('staging logs that this scheduler did not start', quiet.started === false && quietLog.some((line) => /scheduler not started: lexi-briefing/.test(line)));
  let ticks = 0;
  const optedLog = [];
  const opted = briefing.startBriefingScheduler({
    env: env({ LEXI_BRIEFING_ENABLED: '1', STAGING_READ_ONLY_SIDE_EFFECTS: '1', LEXI_BRIEFING_RUN_ON_STAGING: '1' }),
    setIntervalFn: () => { ticks += 1; return { unref() {} }; },
    log: { log: (line) => optedLog.push(line), error() {} },
  });
  check('the staging opt-in starts only this timer', opted.started === true && ticks === 1 && optedLog.some((line) => /opted in/.test(line)));
  const plain = briefing.startBriefingScheduler({
    env: env({ LEXI_BRIEFING_ENABLED: '1' }),
    setIntervalFn: () => { ticks += 1; return { unref() {} }; },
    log: { log() {}, error() {} },
  });
  check('production starts the timer when the flag is on', plain.started === true && ticks === 2);

  console.log('\nBoundaries');
  const source = fs.readFileSync(path.join(__dirname, '../lib/lexiBriefing.cjs'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../prod-server.cjs'), 'utf8');
  const hook = fs.readFileSync(path.join(__dirname, '../.githooks/pre-push'), 'utf8');
  check('the briefing does not update invoices or estimates', !/UPDATE\s+(estimates|invoices|payments)\b/i.test(source));
  check('the owner route and the dedicated timer are wired', /pathname === '\/api\/lexi\/briefing\/run'/.test(server) && /startBriefingScheduler\(/.test(server) && !/armInterval\(\s*['"]lexi-briefing/.test(server));
  check('pre-push runs the briefing suite', /test-lexi-briefing\.cjs/.test(hook));
  check('confirmation rejects the customer send phrase', briefing.isExplicitBriefingConfirmation('yes, send it') === false && briefing.isExplicitBriefingConfirmation('yes') === true && briefing.isExplicitBriefingConfirmation('Yes.') === true);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
