#!/usr/bin/env node
// Phase 1 Lexi-by-phone policy tests. No database, no Twilio, no Gemini network.
'use strict';

const fs = require('fs');
const path = require('path');
const lexi = require('../lib/lexiPhone.cjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const KEVIN = '+1 555-555-0123';
const STRANGER = '+15555550199';
const PIN = '4271';
const OWNER = { companyId: 'co_lexi', userEmail: 'kevin@example.com', name: 'Kevin', phone: '+15555550123' };

function config(overrides = {}) {
  return {
    ...lexi.configFromEnv({ LEXI_PHONE_ALLOWLIST: '+15555550123' }),
    pin: PIN,
    companyId: OWNER.companyId,
    userEmail: OWNER.userEmail,
    userName: 'Kevin',
    forwardTo: '',
    summarySms: false,
    ...overrides,
  };
}

function createDb() {
  const threads = new Map();
  const queries = [];
  const pool = {
    threads,
    queries,
    query: async (sql, params) => {
      queries.push(sql);
      if (/DELETE\s+FROM/i.test(sql)) throw new Error(`unexpected delete: ${sql}`);
      if (sql.includes('SELECT data FROM generic_entities') && sql.includes('$1')) {
        const row = threads.get(params[1]);
        return { rows: row ? [{ data: row }] : [] };
      }
      if (sql.includes('ON CONFLICT')) {
        threads.set(params[0], JSON.parse(params[3]));
        return { rows: [] };
      }
      if (/^SELECT/i.test(sql.trim())) return { rows: [] };
      return { rows: [], rowCount: 1 };
    },
  };
  return pool;
}

function stateFor(thread) {
  return lexi.sessionFromThread(thread || lexi.emptyThread(KEVIN));
}

async function tool(name, args, state, extra = {}) {
  return lexi.executePhoneTool(
    { name, args },
    { state, config: extra.config || config(), pool: extra.pool || createDb(), owner: OWNER, sendCustomerMessage: extra.sendCustomerMessage }
  );
}

async function main() {
  console.log('\nAllowlist');
  const defaults = lexi.configFromEnv({});
  const configured = lexi.configFromEnv({ LEXI_PHONE_ALLOWLIST: '+15555550123' });
  check('unset allowlist denies every caller', defaults.allowlist.length === 0 && lexi.isAllowlisted(KEVIN, defaults.allowlist) === false);
  check('default summary SMS is off', defaults.summarySms === false);
  check('formatted cell matches', lexi.isAllowlisted(KEVIN, configured.allowlist));
  check('bare 10 digits match', lexi.isAllowlisted('5555550123', configured.allowlist));
  check('a stranger is blocked', lexi.isAllowlisted(STRANGER, configured.allowlist) === false);
  check('short numbers are blocked', lexi.isAllowlisted('555', configured.allowlist) === false);
  check('empty allowlist blocks Kevin', lexi.isAllowlisted(KEVIN, []) === false);

  const forwardTwiml = lexi.buildVoiceTwiml({ allowed: false, host: 'example.test', from: STRANGER, callSid: 'CA1', forwardTo: '+12165551000' });
  check('stranger is told it is private', /private assistant/i.test(forwardTwiml));
  check('stranger is dialed to the configured office number', forwardTwiml.includes('<Dial') && forwardTwiml.includes('+12165551000'));
  check('stranger is not streamed to Lexi or Sarah', !forwardTwiml.includes('Stream') && !forwardTwiml.includes('/ws/twilio'));
  const hangupTwiml = lexi.buildVoiceTwiml({ allowed: false, host: 'example.test', from: STRANGER, callSid: 'CA1', forwardTo: '' });
  check('no forward target hangs up', hangupTwiml.includes('<Hangup/>') && !hangupTwiml.includes('<Dial'));
  const kevinTwiml = lexi.buildVoiceTwiml({ allowed: true, host: 'companysync-web-production.up.railway.app', from: '+15555550123', callSid: 'CA9', forwardTo: '+12165551000' });
  check('Kevin streams to the dedicated Lexi socket', kevinTwiml.includes('wss://companysync-web-production.up.railway.app/ws/lexi-phone'));
  check('Kevin is not handed to the receptionist socket', !kevinTwiml.includes('/ws/twilio') && !kevinTwiml.includes('<Dial'));

  console.log('\nTwilio signature');
  const denied = await lexi.handleVoiceHttp({
    rawBody: 'From=%2B15555550123&CallSid=CA1',
    host: 'example.test',
    config: config(),
    verifySignature: async () => ({ valid: false, reason: 'invalid_signature' }),
  });
  check('invalid signature is rejected', denied.status === 403 && !denied.body.includes('Stream'));
  const allowed = await lexi.handleVoiceHttp({
    rawBody: 'From=%2B15555550123&CallSid=CA1',
    host: 'example.test',
    config: config(),
    verifySignature: async () => ({ valid: true }),
  });
  check('valid signature from Kevin returns the Lexi stream', allowed.status === 200 && allowed.body.includes('/ws/lexi-phone'));
  let generated = false;
  const strangerSms = await lexi.handleSmsHttp({
    rawBody: `From=${encodeURIComponent(STRANGER)}&Body=hello`,
    pool: createDb(),
    config: config(),
    verifySignature: async () => ({ valid: true }),
    generate: async () => { generated = true; return {}; },
  });
  check('stranger SMS gets a private-line reply', strangerSms.status === 200 && /private assistant/i.test(strangerSms.body));
  check('stranger SMS never reaches the model', generated === false);

  console.log('\nPIN gate');
  const locked = stateFor();
  const lookup = await tool('lookup_contact', { name: 'Ada' }, locked);
  check('customer lookup before the PIN is refused', lookup.code === 'PIN_REQUIRED');
  check('refused lookup did not query the database', locked.actions.length === 0);
  const notePool = createDb();
  const note = await tool('create_personal_note', { text: 'Call the adjuster after lunch' }, locked, { pool: notePool });
  check('personal note saves without a PIN', note.success === true);
  check('personal note is an insert', notePool.queries.some((sql) => sql.includes("entity_type, company_id") && sql.includes("'Note'")));
  const task = await tool('create_task', { name: 'Order ridge cap', due_date: '2026-10-20' }, locked);
  check('task saves without a PIN', task.success === true && /Task/.test(task.message));
  const reminder = await tool('create_reminder', { title: 'Leave by 3', when: '2026-10-20T15:00:00Z' }, locked);
  check('reminder saves without a PIN', reminder.success === true);
  const draftBlocked = await tool('draft_customer_message', { channel: 'sms', to: '+15551110000', message: 'On my way' }, locked);
  check('drafting a customer text requires the PIN', draftBlocked.code === 'PIN_REQUIRED');
  const spoken = stateFor();
  lexi.noteUserUtterance(spoken, 'four two seven one', config());
  check('spoken PIN unlocks the session', spoken.pinVerified === true);
  const afterPin = await tool('lookup_contact', { name: 'Ada' }, spoken);
  check('lookup runs after the PIN', afterPin.success === true);
  const wrong = stateFor();
  const bad = await tool('verify_pin', { digits: '0000' }, wrong);
  check('wrong PIN does not unlock', bad.code === 'PIN_REJECTED' && wrong.pinVerified === false);

  console.log('\nConfirm before send');
  const sender = { calls: [] };
  const send = async (draft) => { sender.calls.push(draft); return { success: true }; };
  const drafting = stateFor();
  drafting.pinVerified = true;
  drafting.latestUserText = 'Text Ada that I am running late';
  const drafted = await tool('draft_customer_message', {
    channel: 'sms', to: '+15551110000', message: 'Running late', contact_name: 'Ada',
  }, drafting, { sendCustomerMessage: send });
  check('draft does not send', drafted.sent === false && drafted.drafted === true && sender.calls.length === 0);
  const bareYes = await tool('confirm_send', {}, drafting, { sendCustomerMessage: send });
  check('a bare yes does not send', bareYes.code === 'CONFIRMATION_REQUIRED' && sender.calls.length === 0);
  drafting.latestUserText = 'yes';
  const stillNo = await tool('confirm_send', {}, drafting, { sendCustomerMessage: send });
  check('the word yes alone does not send', stillNo.code === 'CONFIRMATION_REQUIRED' && sender.calls.length === 0);
  drafting.latestUserText = 'Yes, send it.';
  const sent = await tool('confirm_send', {}, drafting, { sendCustomerMessage: send });
  check('yes, send it sends once', sent.sent === true && sender.calls.length === 1 && sender.calls[0].message === 'Running late');
  const again = await tool('confirm_send', {}, drafting, { sendCustomerMessage: send });
  check('a second confirm does not send again', again.code === 'NOTHING_TO_SEND' && sender.calls.length === 1);
  const direct = stateFor();
  direct.pinVerified = true;
  direct.latestUserText = 'yes, send it';
  let directCalls = 0;
  const sneaky = await tool('send_sms', { to: '+15551110000', message: 'hi' }, direct, {
    sendCustomerMessage: async () => { directCalls += 1; return { success: true }; },
  });
  check('send_sms is not a phone tool and does not send', sneaky.code === 'TOOL_NOT_ON_PHONE' && directCalls === 0);

  console.log('\nNo deletes');
  const deletePool = createDb();
  const deleting = stateFor();
  deleting.pinVerified = true;
  const removed = await tool('delete_customer', { id: 'cust_1' }, deleting, { pool: deletePool });
  const managed = await tool('manage_entity', { entity_action: 'delete', entity_name: 'Customer', entity_id: 'cust_1' }, deleting, { pool: deletePool });
  check('delete tool is refused', removed.code === 'DELETE_FORBIDDEN');
  check('manage_entity delete is refused', managed.code === 'DELETE_FORBIDDEN');
  check('no delete SQL ran', deletePool.queries.length === 0);
  check('phone tools do not declare sends or deletes', lexi.PHONE_TOOLS.every((item) => !/delete|send_sms|send_email|manage_entity/.test(item.name)));

  console.log('\nSMS thread is stored on the provided database');
  const poolA = createDb();
  const poolB = createDb();
  const seenHistory = [];
  const generate = async ({ body }) => {
    seenHistory.push(body.contents.map((turn) => turn.parts?.[0]?.text).filter(Boolean));
    return { candidates: [{ content: { parts: [{ text: 'Noted.' }] } }] };
  };
  await lexi.handleSmsTurn({ pool: poolA, config: config(), from: KEVIN, body: 'Remind me about the permit', generate, loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '' }) });
  await lexi.handleSmsTurn({ pool: poolB, config: config(), from: KEVIN, body: 'Second phone', generate, loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '' }) });
  check('a different database does not see the first text', seenHistory[1].length === 1);
  await lexi.handleSmsTurn({ pool: poolA, config: config(), from: KEVIN, body: 'And the shingles', generate, loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '' }) });
  check('the same database reloads the earlier text', seenHistory[2].some((line) => /permit/.test(line)));
  const savedThread = [...poolA.threads.values()][0];
  check('thread row keeps both turns', savedThread.messages.some((m) => /permit/.test(m.content)) && savedThread.messages.some((m) => /shingles/.test(m.content)));

  console.log('\nDedicated endpoints stay off the receptionist path');
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
  check('voice and SMS webhooks are dedicated', serverSrc.includes("pathname === '/api/lexi-phone/voice'") && serverSrc.includes("pathname === '/api/lexi-phone/sms'"));
  check('media stream is /ws/lexi-phone', serverSrc.includes("req.url?.startsWith('/ws/lexi-phone')"));
  check('the phone line does not use ConversationRelay', !serverSrc.includes('ConversationRelay'));

  console.log('\nCall summary flag');
  let summaries = 0;
  const off = await lexi.maybeSendCallSummary({
    config: config({ summarySms: false }),
    summary: 'Lexi: Task: Order ridge cap.',
    ownerPhone: '+15555550123',
    sendSms: async () => { summaries += 1; return { success: true }; },
  });
  check('summary SMS stays off by default', off.sent === false && summaries === 0);
  const on = await lexi.maybeSendCallSummary({
    config: config({ summarySms: true }),
    summary: 'Lexi: Task: Order ridge cap.',
    ownerPhone: '+15555550123',
    sendSms: async () => { summaries += 1; return { success: true }; },
  });
  check('summary SMS can be enabled explicitly', on.sent === true && summaries === 1);
  check('summary names the action item', /Order ridge cap/.test(lexi.buildCallSummary([{ summary: 'Task: Order ridge cap' }])));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
