#!/usr/bin/env node
// Lexi call and voicemail summaries. Fixture rows only. No Twilio.
'use strict';

const fs = require('fs');
const path = require('path');
const lexi = require('../lib/lexiPhone.cjs');
const calls = require('../lib/lexiCalls.cjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const PIN = '4271';
const OWNER = { companyId: 'co_lexi', userEmail: 'kevin@example.com', name: 'Kevin', phone: '+15555550123' };
const NOW = new Date('2026-10-21T15:00:00Z');

function config() {
  return {
    ...lexi.configFromEnv({ LEXI_PHONE_ALLOWLIST: '+15555550123' }),
    pin: PIN,
    companyId: OWNER.companyId,
    userEmail: OWNER.userEmail,
    userName: 'Kevin',
  };
}

function callRow(row) {
  return {
    company_id: 'co_lexi',
    type: 'call',
    communication_type: 'call',
    direction: 'inbound',
    status: 'completed',
    data: {},
    ...row,
  };
}

const COMMS = [
  callRow({
    id: 'call_ada', contact_name: 'Ada Lane', contact_phone: '+15555550111', created_at: '2026-10-21T14:00:00Z',
    ai_summary: 'Ada called about a roof leak.',
    data: {
      source: 'ai_voice', assistant_name: 'Alex', called_number: '+12167777154',
      call_summary: 'Ada called about a roof leak.',
      transcript: 'Caller: The roof is leaking over the kitchen.',
      screening_outcome: 'self_handled',
      call_synopsis: { service_needed: 'roof leak', summary: 'Ada called about a roof leak.', next_action: 'Confirm Thursday inspection' },
    },
  }),
  callRow({
    id: 'call_ben', contact_name: 'Ben Ortiz', contact_phone: '+15555550112', status: 'no-answer',
    communication_type: 'voicemail', created_at: '2026-10-20T16:00:00Z',
    data: { source: 'missed_call', called_number: '+12167777081', voicemail: true, transcript: 'Please call me about the gutter.' },
  }),
  callRow({
    id: 'call_night', contact_name: 'Night Owl', contact_phone: '+15555550114', created_at: '2026-10-21T02:00:00Z',
    data: { source: 'ai_voice', assistant_name: 'Alex', called_number: '+12167777154', call_summary: 'Night owl called.' },
  }),
  callRow({
    id: 'call_cara', contact_name: 'Cara Nguyen', contact_phone: '+15555550113', created_at: '2026-10-19T15:00:00Z',
    data: { source: 'ai_voice', assistant_name: 'Alex', called_number: '+12167777154', call_synopsis: { service_needed: 'estimate', next_action: 'Call Cara back' } },
  }),
  callRow({
    id: 'sms_cara', type: 'sms', communication_type: 'sms', direction: 'outbound', contact_name: 'Cara Nguyen',
    contact_phone: '+15555550113', created_by: 'kevin@example.com', created_at: '2026-10-19T18:00:00Z', data: {},
  }),
  callRow({
    id: 'call_spam', contact_name: 'Spam Co', contact_phone: '+15555550119', created_at: '2026-10-21T15:00:00Z',
    data: { source: 'ai_voice', assistant_name: 'Alex', called_number: '+12167777154', screening_outcome: 'declined', call_summary: 'Declined a solicitor.' },
  }),
  callRow({
    id: 'call_untagged', contact_name: 'Pat Kim', contact_phone: '+15555550118', created_at: '2026-10-21T16:00:00Z',
    data: { source: 'ai_voice', assistant_name: 'Alex', call_summary: 'Pat asked about siding.' },
  }),
  callRow({
    id: 'call_wrong', contact_name: 'Wrong Line', contact_phone: '+15555550120', created_at: '2026-10-21T14:00:00Z',
    data: { source: 'ai_voice', assistant_name: 'Alex', called_number: '+19995550100', call_summary: 'Other number' },
  }),
  callRow({
    id: 'lexi_sms', type: 'sms', communication_type: 'sms', direction: 'inbound', contact_name: 'Kevin',
    created_at: '2026-10-21T14:00:00Z', data: { source: 'lexi_phone' },
  }),
  callRow({
    id: 'call_other', company_id: 'co_other', contact_name: 'Ada Lane', contact_phone: '+15555550111',
    created_at: '2026-10-21T14:00:00Z',
    data: { source: 'ai_voice', called_number: '+12167777154', call_summary: 'Other tenant' },
  }),
];

const NOTES = [
  {
    id: 'note_drew', company_id: 'co_lexi', created_date: '2026-10-21T17:00:00Z',
    data: { type: 'missed_call', caller_name: 'Drew Patel', caller_phone: '+15555550115', called_number: '+12167777081', call_status: 'no-answer', message: 'Missed call from Drew' },
  },
  {
    id: 'note_other', company_id: 'co_other', created_date: '2026-10-21T17:00:00Z',
    data: { type: 'missed_call', caller_name: 'Other Drew', caller_phone: '+15555550999', called_number: '+12167777154', call_status: 'no-answer' },
  },
];

function callPool(extraComms = []) {
  const comms = COMMS.concat(extraComms).map((row) => ({ ...row, data: { ...(row.data || {}) } }));
  const notes = NOTES.map((row) => ({ ...row, data: { ...row.data } }));
  const queries = [];
  const pool = {
    queries,
    comms,
    notes,
    query: async (sql, params) => {
      queries.push(sql);
      if (/twilio\.com|Accounts\//i.test(sql)) throw new Error(`unexpected Twilio call: ${sql}`);
      const companyId = params && params[0];
      if (/FROM communications/i.test(sql)) return { rows: comms.filter((row) => row.company_id === companyId) };
      if (/entity_type = 'Notification'/i.test(sql)) return { rows: notes.filter((row) => row.company_id === companyId) };
      if (/UPDATE communications SET data/i.test(sql)) {
        const row = comms.find((item) => item.id === params[0] && item.company_id === params[1]);
        if (!row) return { rowCount: 0, rows: [] };
        row.data = { ...row.data, ...JSON.parse(params[2]) };
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE generic_entities SET data/i.test(sql)) {
        const row = notes.find((item) => item.id === params[0] && item.company_id === params[1]);
        if (!row) return { rowCount: 0, rows: [] };
        row.data = { ...row.data, ...JSON.parse(params[2]) };
        return { rowCount: 1, rows: [] };
      }
      if (/INSERT|DELETE/i.test(sql)) throw new Error(`unexpected write: ${sql}`);
      return { rows: [] };
    },
  };
  return pool;
}

function unlocked() {
  const state = lexi.sessionFromThread(lexi.emptyThread('+15555550123'));
  state.pinVerified = true;
  return state;
}

async function tool(name, args, state, extra = {}) {
  return lexi.executePhoneTool(
    { name, args },
    { state, config: config(), pool: extra.pool || callPool(), owner: OWNER }
  );
}

async function main() {
  console.log('\nSummaries');
  const pool = callPool();
  const today = await calls.summarizeCalls(pool, OWNER, { period: 'today' }, NOW);
  check('today counts Alex on the two lines and an untagged company call', today.count === 3, String(today.count));
  check('another tenant and another number stay out', !today.rows.some((row) => /Other tenant|Wrong Line|Kevin/.test(row.name)));
  check('the spoken answer names who called and what they wanted', /3 calls today/.test(today.spoken) && /roof leak|siding|solicitor/.test(today.spoken));
  const yesterday = await calls.summarizeCalls(pool, OWNER, { period: 'yesterday' }, NOW);
  check('yesterday uses New York and includes the late UTC call', yesterday.count === 2 && yesterday.rows.some((row) => row.name === 'Night Owl') && yesterday.rows.some((row) => row.name === 'Ben Ortiz'), JSON.stringify(yesterday.rows));
  const week = await calls.summarizeCalls(pool, OWNER, { period: 'this week' }, NOW);
  check('this week includes Monday through today', week.count === 6, String(week.count));
  const custom = await calls.summarizeCalls(pool, OWNER, { start_date: '2026-10-19', end_date: '2026-10-19' }, NOW);
  check('custom dates find Cara', custom.count === 1 && custom.rows[0].name === 'Cara Nguyen');

  console.log('\nCallbacks and lookup');
  const waiting = await calls.listCallbacks(pool, OWNER);
  const names = waiting.rows.map((row) => row.name);
  check('callbacks are newest first and skip returned, declined, and other tenants', waiting.count === 3 && names[0] === 'Drew Patel' && names.includes('Ada Lane') && names.includes('Ben Ortiz') && !names.includes('Cara Nguyen') && !names.includes('Spam Co'), names.join(','));
  const ada = await calls.lookupCallerCalls(pool, OWNER, { phone: '555-555-0111' });
  check('lookup returns the stored snippet for this company only', ada.matches.length === 1 && /roof leak/.test(ada.matches[0].snippet) && /kitchen/.test(ada.matches[0].snippet) === false);
  check('a call answer stays short', /Ada Lane/.test(ada.spoken));

  const many = callPool(Array.from({ length: 12 }, (_, i) => callRow({
    id: `extra_${i}`, contact_name: `Extra ${i}`, contact_phone: `+15555550${String(200 + i)}`,
    created_at: '2026-10-21T18:00:00Z',
    data: { source: 'ai_voice', assistant_name: 'Alex', called_number: '+12167777154', call_summary: `Extra ${i}` },
  })));
  const capped = await calls.summarizeCalls(many, OWNER, { period: 'today' }, NOW);
  check('text rows stop at 10 while the count stays full', capped.rows.length === 10 && capped.count === 15, `${capped.rows.length} ${capped.count}`);

  console.log('\nConfirmed writes');
  const state = unlocked();
  const drafted = await tool('prepare_callback_update', { action: 'handled', name: 'Ben Ortiz' }, state, { pool });
  check('handled is read back and not saved', drafted.written === false && /Ben Ortiz/.test(drafted.read_back) && pool.comms.find((row) => row.id === 'call_ben').data.callback_handled !== true);
  state.latestUserText = 'yes, send it';
  const held = await tool('confirm_callback_change', {}, state, { pool });
  check('yes, send it does not mark it handled', held.code === 'CONFIRMATION_REQUIRED' && pool.comms.find((row) => row.id === 'call_ben').data.callback_handled !== true);
  state.latestUserText = 'yes';
  const saved = await tool('confirm_callback_change', {}, state, { pool });
  check('yes marks only this company handled', saved.written === true && pool.comms.find((row) => row.id === 'call_ben').data.callback_handled === true && pool.comms.find((row) => row.id === 'call_other').data.callback_handled !== true);
  const after = await calls.listCallbacks(pool, OWNER);
  check('a handled callback leaves the list', !after.rows.some((row) => row.name === 'Ben Ortiz'));

  const noteState = unlocked();
  const note = await tool('prepare_callback_update', { action: 'note', name: 'Ada Lane', note: 'Booked Thursday' }, noteState, { pool });
  check('a callback note is read back in full', note.written === false && /Booked Thursday/.test(note.read_back));
  noteState.latestUserText = 'yes';
  await tool('confirm_callback_change', {}, noteState, { pool });
  const adaRow = pool.comms.find((row) => row.id === 'call_ada');
  check('the note is saved and the callback is not auto-handled', /Booked Thursday/.test(adaRow.data.callback_note) && adaRow.data.callback_handled !== true);

  console.log('\nGates');
  const locked = callPool();
  const denied = await tool('list_callbacks', {}, lexi.sessionFromThread(lexi.emptyThread('+15555550123')), { pool: locked });
  check('call answers need the PIN', denied.code === 'PIN_REQUIRED' && locked.queries.length === 0);
  const src = fs.readFileSync(path.join(__dirname, '../lib/lexiCalls.cjs'), 'utf8');
  check('the call tools do not call Twilio', !/api\.twilio\.com|TWILIO_AUTH|TWILIO_ACCOUNT/.test(src));
  const prompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true });
  check('voice call answers stay short and skip Twilio', /summarize_calls/.test(prompt) && /speak only the spoken count/.test(prompt) && /Do not call Twilio/.test(prompt));
  const textPrompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', pinVerified: true, companyResolved: true, channel: 'team_chat' });
  check('Team Chat does not ask for the PIN again', /Do not ask for a PIN/.test(textPrompt) && /up to 10 rows/.test(textPrompt));
  const pending = unlocked();
  pending.pendingCallbackChange = { action: 'handled', label: 'Ben' };
  const thread = lexi.applySessionToThread(lexi.emptyThread('+15555550123'), pending);
  check('a pending callback survives the thread', thread.pending_callback_change.label === 'Ben');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
