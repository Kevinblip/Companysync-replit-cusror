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
    { state, config: extra.config || config(), pool: extra.pool || createDb(), owner: OWNER, sendCustomerMessage: extra.sendCustomerMessage, syncCalendar: extra.syncCalendar }
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
  const aliased = await tool('create_calendar_event', {
    title: 'Remind me to leave', event_type: 'reminder', start_time: '2026-10-20T15:00:00Z',
  }, stateFor());
  check('a reminder-shaped calendar call saves a reminder', aliased.success === true && /Reminder/.test(aliased.message));
  const meeting = await tool('create_calendar_event', {
    title: 'Meet the adjuster', event_type: 'meeting', start_time: '2026-10-20T15:00:00Z',
  }, stateFor());
  check('a meeting is not booked from the phone', meeting.code === 'CALENDAR_NOT_ON_PHONE' && /Do not say no access/.test(meeting.error));
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
  const phoneSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'lexiPhone.cjs'), 'utf8');
  check('voice and SMS webhooks are dedicated', serverSrc.includes("pathname === '/api/lexi-phone/voice'") && serverSrc.includes("pathname === '/api/lexi-phone/sms'"));
  check('media stream is /ws/lexi-phone', serverSrc.includes("req.url?.startsWith('/ws/lexi-phone')"));
  check('the phone line does not use ConversationRelay', !serverSrc.includes('ConversationRelay'));
  const phoneUpgrade = serverSrc.split("req.url?.startsWith('/ws/lexi-phone')")[1]?.split('else')[0] || '';
  check('the Lexi phone stream is not hung up by the staging socket guard', phoneUpgrade.includes('handleUpgrade') && !phoneUpgrade.includes('socket.destroy'));
  check('customer and summary sends name the staging guard', serverSrc.includes("action: 'lexi-phone-customer'") && serverSrc.includes("action: 'lexi-phone-summary'"));
  check('SMS still uses gemini-2.5-flash', phoneSrc.includes("const TEXT_MODEL = 'gemini-2.5-flash'"));
  check('voice uses the in-app Gemini 3.8 Live model', phoneSrc.includes('GEMINI_38_MODEL') && phoneSrc.includes('model: LIVE_MODEL') && !phoneSrc.includes('media_chunks'));
  check('inbound audio uses the native realtime message', phoneSrc.includes("mimeType: 'audio/pcm;rate=16000'"));
  check('phone setup answers toolCall and tool_call with tool_response', phoneSrc.includes('data.toolCall || data.tool_call') && phoneSrc.includes('tool_response'));
  const phonePromptFn = serverSrc.split('async function loadLexiPhonePrompt')[1]?.split('async function lexiPhoneSendCustomerMessage')[0] || '';
  check('phone company context is facts, not the CRM tool catalog', phonePromptFn.length > 0 && !phonePromptFn.includes('buildLexiSystemPrompt'));

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

  console.log('\nOwner resolution when company id is unset');
  const ownerPool = {
    query: async (sql, params) => {
      if (/staff_profiles/i.test(sql) && /cell_phone/i.test(sql)) {
        if (params[0] === '2163318323') {
          return { rows: [{ company_id: 'co_from_cell', email: 'yicnteam@gmail.com', full_name: 'Kevin Blip' }] };
        }
        return { rows: [] };
      }
      if (/staff_profiles/i.test(sql) && /user_email/i.test(sql)) {
        if (String(params[0] || '').toLowerCase() === 'yicnteam@gmail.com') {
          return { rows: [{ company_id: 'co_from_email', email: 'yicnteam@gmail.com', full_name: 'Kevin Blip' }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const fromCell = await lexi.resolveOwner(ownerPool, lexi.configFromEnv({}), '+1 216-331-8323');
  check('caller cell fills company id and staff email', fromCell.companyId === 'co_from_cell' && fromCell.userEmail === 'yicnteam@gmail.com');
  const fromEmail = await lexi.resolveOwner(ownerPool, lexi.configFromEnv({ LEXI_PHONE_USER_EMAIL: 'yicnteam@gmail.com' }), '+15555550123');
  check('LEXI_PHONE_USER_EMAIL fills company id when the cell does not match', fromEmail.companyId === 'co_from_email' && fromEmail.userEmail === 'yicnteam@gmail.com');
  let ownerQueries = 0;
  const countingPool = { query: async () => { ownerQueries += 1; return { rows: [] }; } };
  const explicit = await lexi.resolveOwner(countingPool, lexi.configFromEnv({ LEXI_PHONE_COMPANY_ID: 'co_set', LEXI_PHONE_USER_EMAIL: 'yicnteam@gmail.com' }), '+12163318323');
  check('an explicit company id and email skip the staff lookup', explicit.companyId === 'co_set' && ownerQueries === 0);
  const unresolved = await lexi.resolveOwner(ownerPool, lexi.configFromEnv({}), '+15555550123');
  check('no staff match leaves company id empty', unresolved.companyId === '');
  const loginPool = {
    query: async (sql, params) => {
      if (/staff_profiles/i.test(sql)) return { rows: [] };
      if (/FROM users/i.test(sql) && String(params[0] || '').toLowerCase() === 'yicnteam@gmail.com') {
        return { rows: [{ company_id: 'co_login' }] };
      }
      if (/FROM companies/i.test(sql)) return { rows: [{ company_id: 'co_owned' }] };
      return { rows: [] };
    },
  };
  const fromLogin = await lexi.resolveOwner(loginPool, lexi.configFromEnv({ LEXI_PHONE_USER_EMAIL: 'yicnteam@gmail.com' }), '+12163318323');
  check('the in-app login company fills company id when staff has no row', fromLogin.companyId === 'co_login');
  const companyPool = {
    query: async (sql) => {
      if (/staff_profiles/i.test(sql) || /FROM users/i.test(sql)) return { rows: [] };
      if (/FROM companies/i.test(sql)) return { rows: [{ company_id: 'co_owned' }] };
      return { rows: [] };
    },
  };
  const fromCompany = await lexi.resolveOwner(companyPool, lexi.configFromEnv({ LEXI_PHONE_USER_EMAIL: 'yicnteam@gmail.com' }), '+12163318323');
  check('a company owned by that email fills company id when the login row is empty', fromCompany.companyId === 'co_owned');
  const phonePrompt = lexi.buildPhoneSystemPrompt({
    basePrompt: 'Company name: YICN. Timezone: America/New_York.',
    ownerName: 'Kevin',
    memories: '',
    recentSessions: '',
    pinVerified: false,
    companyResolved: true,
  });
  check('phone prompt calls create_reminder and forbids an access denial', /call create_reminder/.test(phonePrompt) && /Never say "no access"/.test(phonePrompt));
  check('phone prompt does not route reminders through the CRM calendar tool', !/call create_calendar_event with event_type/.test(phonePrompt));

  console.log('\nStaging outbound guard');
  const priorFlag = process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  try {
    const staged = await lexi.handleVoiceHttp({
      rawBody: `From=${encodeURIComponent(STRANGER)}&CallSid=CA1`,
      host: 'example.test',
      config: config({ forwardTo: '+12165551000' }),
      verifySignature: async () => ({ valid: true }),
    });
    check('staging does not dial the forward number', staged.status === 200 && !staged.body.includes('<Dial') && staged.body.includes('<Hangup/>') && /private assistant/i.test(staged.body));
    let smsFetches = 0;
    const suppressed = await lexi.deliverTwilioSms({
      to: '+15551110000',
      body: 'On my way',
      from: '+12165160246',
      accountSid: 'ACtest',
      authToken: 'token',
      fetchImpl: async () => { smsFetches += 1; return { ok: true }; },
    });
    check('staging does not post a customer or summary SMS', suppressed.suppressed === true && suppressed.success === false && smsFetches === 0);
    const reminderInserts = [];
    const reminderPool = {
      query: async (sql, params) => {
        if (/INSERT INTO calendar_events/i.test(sql)) reminderInserts.push(params);
        return { rows: [], rowCount: 1 };
      },
    };
    const stagedReminder = await lexi.executePhoneTool(
      { name: 'create_reminder', args: { title: 'Call the adjuster', when: '2026-10-20T15:00:00Z', note: 'permit' } },
      { state: stateFor(), config: config(), pool: reminderPool, owner: { companyId: 'co_live', userEmail: 'yicnteam@gmail.com', name: 'Kevin' } }
    );
    check('staging still inserts an internal reminder', stagedReminder.success === true && reminderInserts.length === 1 && reminderInserts[0][1] === 'co_live' && reminderInserts[0][2] === 'Call the adjuster');
    const unlinked = await lexi.executePhoneTool(
      { name: 'create_reminder', args: { title: 'Call the adjuster', when: '2026-10-20T15:00:00Z' } },
      { state: stateFor(), config: config({ companyId: '', userEmail: 'yicnteam@gmail.com' }), pool: reminderPool, owner: { companyId: '', userEmail: 'yicnteam@gmail.com', name: 'Kevin' } }
    );
    check('an unlinked company is reported as not linked', unlinked.code === 'COMPANY_UNRESOLVED' && /^No company is linked to yicnteam@gmail.com/.test(unlinked.error) && reminderInserts.length === 1);
  } finally {
    if (priorFlag === undefined) delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
    else process.env.STAGING_READ_ONLY_SIDE_EFFECTS = priorFlag;
  }
  let liveFetches = 0;
  const delivered = await lexi.deliverTwilioSms({
    to: '+15551110000',
    body: 'On my way',
    from: '+12165160246',
    accountSid: 'ACtest',
    authToken: 'token',
    fetchImpl: async () => { liveFetches += 1; return { ok: true }; },
  });
  check('SMS send still uses the provided fetch when staging is off', delivered.success === true && liveFetches === 1);

  console.log('\nMedia stream audio path');
  const audioMessage = lexi.geminiRealtimeAudioMessage('pcm-bytes');
  check('Gemini audio message matches the native socket', audioMessage.realtime_input.audio.mimeType === 'audio/pcm;rate=16000' && audioMessage.realtime_input.audio.data === 'pcm-bytes' && !audioMessage.realtime_input.media_chunks);
  const outboundFrames = lexi.twilioOutboundMediaMessages('MZ1', 'abcdefghijklmnopqrstuvwxyz012345');
  check('Twilio outbound frames keep streamSid and 160-char chunks', outboundFrames.length === 1 && outboundFrames[0].streamSid === 'MZ1' && outboundFrames[0].event === 'media' && outboundFrames[0].media.payload.length === 32);

  const { inspect } = require('util');
  const logs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  const capture = (...args) => args.map((arg) => typeof arg === 'string' ? arg : inspect(arg)).join(' ');
  console.log = (...args) => { logs.push(capture(...args)); origLog(...args); };
  console.warn = (...args) => { logs.push(capture(...args)); origWarn(...args); };
  console.error = (...args) => { logs.push(capture(...args)); origError(...args); };
  try {
    const geminiSockets = [];
    class FakeGeminiSocket {
      constructor(url) {
        this.url = url;
        this.readyState = FakeGeminiSocket.CONNECTING;
        this.sent = [];
        this.handlers = {};
        geminiSockets.push(this);
      }
      static get CONNECTING() { return 0; }
      static get OPEN() { return 1; }
      send(data) { this.sent.push(JSON.parse(data)); }
      on(event, fn) { this.handlers[event] = fn; }
      close() { this.readyState = 3; }
      open() { this.readyState = FakeGeminiSocket.OPEN; this.handlers.open?.(); }
      receive(obj) { return this.handlers.message?.(Buffer.from(JSON.stringify(obj))); }
      closed(code, reason) { this.readyState = 3; this.handlers.close?.(code, Buffer.from(reason || '')); }
    }
    const twilio = {
      readyState: FakeGeminiSocket.OPEN,
      sent: [],
      handlers: {},
      send(data) { this.sent.push(JSON.parse(data)); },
      on(event, fn) { this.handlers[event] = fn; },
      close() { this.readyState = 3; },
    };
    lexi.attachCallStream(twilio, {
      WebSocket: FakeGeminiSocket,
      config: config({ pin: PIN }),
      pool: () => null,
      geminiApiKey: 'test-key-do-not-log',
      loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '', voice: 'Aoede' }),
      twilioToGemini: (mulaw) => `pcm:${mulaw}`,
      geminiToTwilio: (pcm) => `mulaw:${pcm}`,
    });
    twilio.handlers.message(Buffer.from(JSON.stringify({
      event: 'start',
      start: { streamSid: 'MZ123', callSid: 'CA9', customParameters: { from: '+15555550123', callSid: 'CA9' } },
    })));
    for (let i = 0; i < 20 && geminiSockets.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
    check('Twilio start opens a Gemini socket', geminiSockets.length === 1);
    const gemini = geminiSockets[0];
    twilio.handlers.message(Buffer.from(JSON.stringify({ event: 'media', media: { payload: 'aW5ib3VuZA==' } })));
    check('media before setupComplete is not sent yet', gemini.sent.length === 0);
    gemini.open();
    const setup = gemini.sent[0]?.setup;
    check('setup uses models/gemini-3.8-live', setup?.model === 'models/gemini-3.8-live');
    check('setup keeps the hands-free end-of-speech pause', setup?.realtime_input_config?.automatic_activity_detection?.silence_duration_ms === 1600);
    check('socket URL is not logged', logs.every((line) => !line.includes('test-key-do-not-log') && !line.includes('BidiGenerateContent')));
    await gemini.receive({ setupComplete: true });
    const greeting = gemini.sent.find((item) => item.client_content);
    const flushed = gemini.sent.filter((item) => item.realtime_input);
    check('greeting does not block queued caller audio', Boolean(greeting) && flushed.length === 1 && flushed[0].realtime_input.audio.data === 'pcm:aW5ib3VuZA==' && flushed[0].realtime_input.audio.mimeType === 'audio/pcm;rate=16000');
    check('queued audio is not the retired media_chunks shape', !flushed[0].realtime_input.media_chunks);
    twilio.handlers.message(Buffer.from(JSON.stringify({ event: 'media', media: { payload: 'bGl2ZQ==' } })));
    const live = gemini.sent.filter((item) => item.realtime_input);
    check('live media is forwarded after setup', live.length === 2 && live[1].realtime_input.audio.data === 'pcm:bGl2ZQ==');
    const beforeTwilio = twilio.sent.length;
    await gemini.receive({
      serverContent: {
        inputTranscription: { text: '4271' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'UklGRg==' } }] },
      },
    });
    const toTwilio = twilio.sent.slice(beforeTwilio);
    check('Gemini audio is returned as mulaw with the Twilio streamSid', toTwilio.length === 1 && toTwilio[0].event === 'media' && toTwilio[0].streamSid === 'MZ123' && toTwilio[0].media.payload === 'mulaw:UklGRg==');
    check('logs name connect, open, setup, and both audio directions', ['Gemini connecting', 'Gemini open', 'Gemini setupComplete', 'first inbound media frame', 'first outbound audio chunk'].every((bit) => logs.some((line) => line.includes(bit))));
    check('logs never include the PIN', logs.every((line) => !line.includes(PIN)));
    gemini.closed(1000, 'test-done');
    check('Gemini close logs code and reason', logs.some((line) => line.includes('Gemini close') && line.includes('1000') && line.includes('test-done')));
    const declared = (setup?.tools?.[0]?.function_declarations || []).map((tool) => tool.name);
    check('setup declares the reminder, note, and task tools', ['create_reminder', 'create_personal_note', 'create_task'].every((name) => declared.includes(name)));
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  console.log('\nReminder tool call on the phone stream');
  const reminderLogs = [];
  const captureReminder = (...args) => args.map((arg) => typeof arg === 'string' ? arg : inspect(arg)).join(' ');
  console.log = (...args) => { reminderLogs.push(captureReminder(...args)); origLog(...args); };
  console.warn = (...args) => { reminderLogs.push(captureReminder(...args)); origWarn(...args); };
  console.error = (...args) => { reminderLogs.push(captureReminder(...args)); origError(...args); };
  try {
    const sockets = [];
    class ReminderSocket {
      constructor() {
        this.readyState = ReminderSocket.CONNECTING;
        this.sent = [];
        this.handlers = {};
        sockets.push(this);
      }
      static get CONNECTING() { return 0; }
      static get OPEN() { return 1; }
      send(data) { this.sent.push(JSON.parse(data)); }
      on(event, fn) { this.handlers[event] = fn; }
      close() { this.readyState = 3; }
      open() { this.readyState = ReminderSocket.OPEN; this.handlers.open?.(); }
      receive(obj) { return this.handlers.message?.(Buffer.from(JSON.stringify(obj))); }
    }
    const reminderInserts = [];
    const streamPool = {
      query: async (sql, params) => {
        if (/staff_profiles/i.test(sql)) return { rows: [] };
        if (/FROM users/i.test(sql)) return { rows: [{ company_id: 'co_login' }] };
        if (/FROM companies/i.test(sql)) return { rows: [{ company_id: 'co_owned' }] };
        if (/INSERT INTO calendar_events/i.test(sql)) {
          reminderInserts.push(params);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [] };
      },
    };
    const twilio = {
      readyState: 1,
      sent: [],
      handlers: {},
      send(data) { this.sent.push(JSON.parse(data)); },
      on(event, fn) { this.handlers[event] = fn; },
      close() { this.readyState = 3; },
    };
    lexi.attachCallStream(twilio, {
      WebSocket: ReminderSocket,
      config: config({ pin: PIN, companyId: '', userEmail: 'yicnteam@gmail.com' }),
      pool: () => streamPool,
      geminiApiKey: 'test-key-do-not-log',
      loadPrompt: async () => ({ basePrompt: 'Company name: YICN.', memories: '', recentSessions: '', voice: 'Kore' }),
      twilioToGemini: (mulaw) => mulaw,
      geminiToTwilio: (pcm) => pcm,
    });
    twilio.handlers.message(Buffer.from(JSON.stringify({
      event: 'start',
      start: { streamSid: 'MZREM', callSid: 'CAREM', customParameters: { from: '+12163318323', callSid: 'CAREM' } },
    })));
    for (let i = 0; i < 20 && sockets.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
    const gemini = sockets[0];
    check('reminder stream opens Gemini', Boolean(gemini));
    gemini.open();
    const names = (gemini.sent[0]?.setup?.tools?.[0]?.function_declarations || []).map((tool) => tool.name);
    check('reminder setup lists create_reminder', names.includes('create_reminder'));
    await gemini.receive({ setupComplete: true });
    await gemini.receive({
      toolCall: {
        functionCalls: [{ id: 'fn_1', name: 'create_reminder', args: { title: 'Leave by 3', when: '2026-10-20T15:00:00Z' } }],
      },
    });
    const toolResponse = gemini.sent.find((item) => item.tool_response);
    const saved = toolResponse?.tool_response?.function_responses?.[0];
    check('tool response reports the reminder saved', saved?.name === 'create_reminder' && saved?.id === 'fn_1' && saved?.response?.success === true);
    check('mocked database received the calendar insert for the login company', reminderInserts.length === 1 && reminderInserts[0][1] === 'co_login' && reminderInserts[0][2] === 'Leave by 3');
    check('logs name the tool, the resolved company, and the result', ['tool call', 'create_reminder', 'owner resolved', 'co_login', 'tool result'].every((bit) => reminderLogs.some((line) => line.includes(bit))));
    check('reminder logs omit the PIN and the API key', reminderLogs.every((line) => !line.includes(PIN) && !line.includes('test-key-do-not-log')));
    const beforeSnake = reminderInserts.length;
    await gemini.receive({
      tool_call: {
        function_calls: [{ id: 'fn_2', name: 'create_reminder', args: { title: 'Pick up the permit', when: '2026-10-21T16:00:00Z' } }],
      },
    });
    check('snake_case tool_call also saves', reminderInserts.length === beforeSnake + 1 && reminderInserts[1][2] === 'Pick up the permit');
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }

  console.log('\nCalendar');
  const eveningBefore = new Date('2026-10-18T03:00:00.000Z');
  const tomorrowBounds = lexi.zonedDayBounds('tomorrow', 'America/New_York', eveningBefore);
  const todayBounds = lexi.zonedDayBounds('today', 'America/New_York', eveningBefore);
  check('tomorrow in New York starts at local midnight', tomorrowBounds.start === '2026-10-18T04:00:00.000Z' && tomorrowBounds.end === '2026-10-19T03:59:59.999Z');
  check('today in New York is still the previous local date', todayBounds.start === '2026-10-17T04:00:00.000Z' && todayBounds.label === 'today');
  const winter = lexi.zonedDayBounds('tomorrow', 'America/New_York', new Date('2026-11-02T04:30:00.000Z'));
  check('tomorrow after the clocks change uses Eastern Standard Time', winter.start === '2026-11-02T05:00:00.000Z');
  check('an unknown day word has no bounds', lexi.zonedDayBounds('next week', 'America/New_York', eveningBefore) === null);
  check('yes, send it is not a calendar confirmation', lexi.isExplicitCalendarConfirmation('yes, send it', 'create') === false && lexi.isExplicitCalendarConfirmation('Yes, book it.', 'create') === true && lexi.isExplicitCalendarConfirmation('yes, move it', 'move') === true && lexi.isExplicitCalendarConfirmation('yes, cancel that', 'cancel') === true);

  const schedulePool = createDb();
  schedulePool.query = async (sql, params) => {
    schedulePool.queries.push(sql);
    schedulePool.params = schedulePool.params || [];
    schedulePool.params.push(params);
    if (/start_time >=/.test(sql)) {
      return { rows: [{ id: 'evt_1', title: 'Adjuster visit', event_type: 'appointment', start_time: '2026-10-18T14:00:00.000Z', end_time: '2026-10-18T15:00:00.000Z', location: '12 Main Street', status: 'scheduled' }] };
    }
    return { rows: [] };
  };
  const listed = await tool('list_my_schedule', { day: 'tomorrow', timezone: 'America/New_York' }, stateFor(), { pool: schedulePool });
  const listSql = schedulePool.queries.find((sql) => /FROM calendar_events/.test(sql));
  const expectedWindow = lexi.zonedDayBounds('tomorrow', 'America/New_York');
  check('tomorrow is read back with the place', listed.success === true && /Adjuster visit/.test(listed.read_back) && /12 Main Street/.test(listed.read_back));
  check('the schedule query skips cancelled events and uses the New York day', /<> 'cancelled'/.test(listSql) && schedulePool.params[0][2] === expectedWindow.start && schedulePool.params[0][3] === expectedWindow.end);

  const bookPool = createDb();
  const booking = stateFor();
  const prepared = await tool('prepare_calendar_change', {
    action: 'create', title: 'Adjuster visit', start_time: '2026-10-20T18:00:00.000Z', location: '12 Main Street',
  }, booking, { pool: bookPool });
  check('preparing an appointment reads it back and does not insert', prepared.written === false && prepared.success === true && /Adjuster visit/.test(prepared.read_back) && /12 Main Street/.test(prepared.read_back) && !bookPool.queries.some((sql) => /INSERT/i.test(sql)));
  booking.latestUserText = 'yes';
  const bareBook = await tool('confirm_calendar_change', {}, booking, { pool: bookPool });
  check('a bare yes does not book', bareBook.code === 'CONFIRMATION_REQUIRED' && !bookPool.queries.some((sql) => /INSERT INTO calendar_events/i.test(sql)));
  booking.latestUserText = 'yes, send it';
  const sendIsNotBook = await tool('confirm_calendar_change', {}, booking, { pool: bookPool });
  check('yes, send it does not change the calendar', sendIsNotBook.code === 'CONFIRMATION_REQUIRED' && booking.pendingCalendar?.title === 'Adjuster visit');
  booking.latestUserText = 'Yes, book it.';
  let syncCalls = 0;
  let customerSends = 0;
  const booked = await tool('confirm_calendar_change', {}, booking, {
    pool: bookPool,
    syncCalendar: async () => { syncCalls += 1; return { success: true, suppressed: true, staging: true }; },
    sendCustomerMessage: async () => { customerSends += 1; return { success: true }; },
  });
  check('yes, book it inserts a scheduled appointment and does not delete', booked.written === true && booked.deleted === false && booked.google_sync === 'skipped on staging' && syncCalls === 1 && customerSends === 0);
  check('the insert is the only calendar write', bookPool.queries.some((sql) => /INSERT INTO calendar_events/.test(sql) && sql.includes("'scheduled'")) && !bookPool.queries.some((sql) => /DELETE/i.test(sql)) && booking.pendingCalendar === null);

  const clashPool = createDb();
  const originalClash = clashPool.query.bind(clashPool);
  clashPool.query = async (sql, params) => {
    clashPool.queries.push(sql);
    if (/NOT IN \('cancelled', 'tentative'\)/.test(sql)) {
      return { rows: [{ id: 'evt_busy', title: 'Crew meeting', start_time: '2026-10-20T18:00:00.000Z' }] };
    }
    return originalClash(sql, params);
  };
  const clashing = stateFor();
  await tool('prepare_calendar_change', { action: 'create', title: 'Adjuster visit', start_time: '2026-10-20T18:00:00.000Z' }, clashing, { pool: clashPool });
  clashing.latestUserText = 'yes, book it';
  const beforeClashWrites = clashPool.queries.filter((sql) => /INSERT INTO calendar_events/i.test(sql)).length;
  const clash = await tool('confirm_calendar_change', {}, clashing, { pool: clashPool });
  check('an overlap is refused and nothing is inserted', clash.code === 'CALENDAR_CONFLICT' && /Crew meeting/.test(clash.error) && clashPool.queries.filter((sql) => /INSERT INTO calendar_events/i.test(sql)).length === beforeClashWrites && clashing.pendingCalendar?.title === 'Adjuster visit');

  function ownedPool(rows) {
    const pool = createDb();
    pool.query = async (sql, params) => {
      pool.queries.push(sql);
      if (/DELETE\s+FROM/i.test(sql)) throw new Error(`unexpected delete: ${sql}`);
      if (/LIKE/.test(sql)) return { rows };
      return { rows: [] };
    };
    return pool;
  }
  const ambiguous = stateFor();
  const two = await tool('prepare_calendar_change', { action: 'move', title: 'visit', start_time: '2026-10-21T15:00:00.000Z' }, ambiguous, {
    pool: ownedPool([
      { id: 'evt_a', title: 'Adjuster visit', start_time: '2026-10-20T14:00:00.000Z', end_time: '2026-10-20T15:00:00.000Z', location: '', status: 'scheduled' },
      { id: 'evt_b', title: 'Site visit', start_time: '2026-10-20T16:00:00.000Z', end_time: '2026-10-20T17:00:00.000Z', location: '', status: 'scheduled' },
    ]),
  });
  check('two matching appointments are not prepared', two.success === false && /Several appointments/.test(two.error) && !ambiguous.pendingCalendar);

  const movePool = ownedPool([
    { id: 'evt_9', title: 'Adjuster visit', start_time: '2026-10-20T14:00:00.000Z', end_time: '2026-10-20T15:30:00.000Z', location: '12 Main Street', status: 'scheduled' },
  ]);
  const moving = stateFor();
  const moveReady = await tool('prepare_calendar_change', { action: 'move', title: 'Adjuster visit', start_time: '2026-10-21T18:00:00.000Z' }, moving, { pool: movePool });
  check('a move is read back before it is written', moveReady.written === false && /Move Adjuster visit/.test(moveReady.read_back) && !movePool.queries.some((sql) => /UPDATE calendar_events/i.test(sql)));
  moving.latestUserText = 'yes, book it';
  const wrongWord = await tool('confirm_calendar_change', {}, moving, { pool: movePool });
  check('yes, book it does not move an appointment', wrongWord.code === 'CONFIRMATION_REQUIRED');
  moving.latestUserText = 'yes, move it';
  const moved = await tool('confirm_calendar_change', {}, moving, { pool: movePool, syncCalendar: async () => { throw new Error('google down'); } });
  check('yes, move it updates the time and keeps the row', moved.written === true && moved.deleted === false && moved.google_sync === 'failed' && movePool.queries.some((sql) => /UPDATE calendar_events SET start_time/.test(sql)) && !movePool.queries.some((sql) => /DELETE/i.test(sql)));

  const cancelPool = ownedPool([
    { id: 'evt_3', title: 'Adjuster visit', start_time: '2026-10-20T14:00:00.000Z', end_time: '2026-10-20T15:00:00.000Z', location: '12 Main Street', status: 'scheduled' },
  ]);
  const cancelling = stateFor();
  const cancelReady = await tool('prepare_calendar_change', { action: 'cancel', event_id: 'evt_3' }, cancelling, { pool: cancelPool });
  check('a cancel is read back as a mark, not a delete', cancelReady.written === false && /marked cancelled, not deleted/.test(cancelReady.read_back));
  cancelling.latestUserText = 'yes, cancel it';
  const cancelled = await tool('confirm_calendar_change', {}, cancelling, { pool: cancelPool, syncCalendar: async () => ({ success: true }) });
  check('yes, cancel it marks the appointment cancelled', cancelled.written === true && cancelled.deleted === false && cancelled.google_sync === 'started' && cancelPool.queries.some((sql) => /status = 'cancelled'/.test(sql)) && !cancelPool.queries.some((sql) => /DELETE/i.test(sql)));

  const calendarPrompt = lexi.buildPhoneSystemPrompt({ basePrompt: 'Company name: YICN.', ownerName: 'Kevin', pinVerified: true, companyResolved: true });
  check('the phone prompt reads the day and waits for the matching yes', /list_my_schedule/.test(calendarPrompt) && /prepare_calendar_change/.test(calendarPrompt) && /yes, book it/.test(calendarPrompt) && /Never delete an event/.test(calendarPrompt) && /yes, send it/.test(calendarPrompt));

  const calendarSmsPool = createDb();
  let smsStep = 0;
  let smsSends = 0;
  const calendarSmsGenerate = async () => {
    smsStep += 1;
    if (smsStep === 1) {
      return { candidates: [{ content: { parts: [{ functionCall: { name: 'prepare_calendar_change', args: { action: 'create', title: 'Adjuster visit', start_time: '2026-10-20T18:00:00.000Z', location: '12 Main Street' } } }] } }] };
    }
    if (smsStep === 3) {
      return { candidates: [{ content: { parts: [{ functionCall: { name: 'confirm_calendar_change', args: {} } }] } }] };
    }
    return { candidates: [{ content: { parts: [{ text: 'Read back.' }] } }] };
  };
  const calendarSmsExtras = {
    pool: calendarSmsPool,
    config: config(),
    from: KEVIN,
    generate: calendarSmsGenerate,
    loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '' }),
    sendCustomerMessage: async () => { smsSends += 1; return { success: true }; },
    syncCalendar: async () => ({ success: true, suppressed: true, staging: true }),
  };
  await lexi.handleSmsTurn({ ...calendarSmsExtras, body: 'Book the adjuster at 12 Main Street tomorrow at 2' });
  const held = [...calendarSmsPool.threads.values()][0];
  check('an SMS draft of the appointment is stored and not inserted', held.pending_calendar?.title === 'Adjuster visit' && held.pending_calendar?.location === '12 Main Street' && !calendarSmsPool.queries.some((sql) => /INSERT INTO calendar_events/i.test(sql)) && smsSends === 0);
  await lexi.handleSmsTurn({ ...calendarSmsExtras, body: 'yes, book it' });
  const bookedThread = [...calendarSmsPool.threads.values()][0];
  check('the next SMS saying yes, book it inserts and clears the pending change', calendarSmsPool.queries.some((sql) => /INSERT INTO calendar_events/.test(sql) && sql.includes("'scheduled'")) && bookedThread.pending_calendar == null && smsSends === 0);
  check('staging calendar sync is blocked before Google is loaded', /async function lexiPhoneSyncCalendar[\s\S]*?blockedAction\('google-calendar-sync'\)[\s\S]*?syncUserGoogleCalendar/.test(serverSrc) && serverSrc.includes('syncCalendar: lexiPhoneSyncCalendar'));

  console.log('\nHang up on goodbye');
  check('a clear goodbye is recognized', lexi.isClearGoodbye('Bye Lexi') && lexi.isClearGoodbye('goodbye') && lexi.isClearGoodbye("that's all, thanks"));
  check('goodbye inside a request does not hang up', lexi.isClearGoodbye('bye the way, remind me to call the adjuster') === false);
  check('company candidate diagnostic is removed', !phoneSrc.includes('logStagingCompanyCandidates') && !serverSrc.includes('logStagingCompanyCandidates') && !phoneSrc.includes('TODO: remove this staging-only company diagnostic'));
  const ended = await tool('end_call', {}, stateFor());
  check('end_call asks for a short goodbye', ended.ending === true && /goodbye/i.test(ended.message));
  const priorHangupFlag = process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  let stagingFetches = 0;
  try {
    const stagedHangup = await lexi.completeTwilioCall({
      callSid: 'CAHANG', accountSid: 'ACtest', authToken: 'token',
      fetchImpl: async () => { stagingFetches += 1; return { ok: true }; },
    });
    check('staging does not post a call-complete update', stagedHangup.suppressed === true && stagingFetches === 0);
  } finally {
    if (priorHangupFlag === undefined) delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
    else process.env.STAGING_READ_ONLY_SIDE_EFFECTS = priorHangupFlag;
  }
  let liveCallBody = '';
  const liveHangup = await lexi.completeTwilioCall({
    callSid: 'CAHANG', accountSid: 'ACtest', authToken: 'token',
    fetchImpl: async (url, init) => { liveCallBody = `${url} ${init.body}`; return { ok: true }; },
  });
  check('a live call is marked completed', liveHangup.success === true && /Calls\/CAHANG\.json/.test(liveCallBody) && /Status=completed/.test(liveCallBody));

  const hangupInserts = [];
  const hangupPool = { query: async (sql, params) => { if (/INSERT INTO communications/i.test(sql)) hangupInserts.push(params); return { rows: [] }; } };
  const hangSockets = [];
  class HangSocket {
    constructor() { this.readyState = 0; this.sent = []; this.handlers = {}; hangSockets.push(this); }
    static get OPEN() { return 1; }
    send(data) { this.sent.push(JSON.parse(data)); }
    on(event, fn) { this.handlers[event] = fn; }
    close() { this.readyState = 3; this.handlers.close?.(); }
    open() { this.readyState = HangSocket.OPEN; this.handlers.open?.(); }
    receive(obj) { return this.handlers.message?.(Buffer.from(JSON.stringify(obj))); }
  }
  const hangTwilio = {
    readyState: 1, sent: [], handlers: {}, closed: false,
    send(data) { this.sent.push(JSON.parse(data)); },
    on(event, fn) { this.handlers[event] = fn; },
    close() { this.readyState = 3; this.closed = true; this.handlers.close?.(); },
  };
  const completedCalls = [];
  lexi.attachCallStream(hangTwilio, {
    WebSocket: HangSocket,
    config: config({ pin: PIN }),
    pool: () => hangupPool,
    geminiApiKey: 'test-key-do-not-log',
    hangupQuietMs: 40,
    hangupMaxMs: 400,
    loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '', voice: 'Kore' }),
    twilioToGemini: (mulaw) => mulaw,
    geminiToTwilio: (pcm) => pcm,
    completeCall: async (payload) => { completedCalls.push(payload); return { success: true }; },
  });
  hangTwilio.handlers.message(Buffer.from(JSON.stringify({
    event: 'start',
    start: { streamSid: 'MZH', callSid: 'CAHANG', customParameters: { from: '+15555550123', callSid: 'CAHANG' } },
  })));
  for (let i = 0; i < 20 && hangSockets.length === 0; i++) await new Promise((resolve) => setImmediate(resolve));
  const hangGemini = hangSockets[0];
  hangGemini.open();
  await hangGemini.receive({ setupComplete: true });
  await hangGemini.receive({ serverContent: { inputTranscription: { text: 'goodbye' } } });
  await hangGemini.receive({
    serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'QQ==' } }] } },
  });
  for (let i = 0; i < 20 && !hangTwilio.closed; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  check('a spoken goodbye closes the stream', hangTwilio.closed === true);
  check('the goodbye call is marked completed and the transcript is saved', completedCalls[0]?.callSid === 'CAHANG' && hangupInserts.length === 1 && String(hangupInserts[0]).includes('goodbye'));

  console.log('\nLookup, draft, and SMS');
  const spokenAgain = stateFor();
  lexi.noteUserUtterance(spokenAgain, '4271', config());
  const firstLookup = await tool('lookup_contact', { name: 'Ada' }, spokenAgain);
  const secondLookup = await tool('lookup_contact', { phone: '5551110000' }, spokenAgain);
  check('PIN is required only once in the call', spokenAgain.pinVerified === true && firstLookup.code !== 'PIN_REQUIRED' && secondLookup.code !== 'PIN_REQUIRED');
  const factPool = {
    query: async (sql) => {
      if (/FROM customers/i.test(sql)) {
        return { rows: [{ id: 'cust_ada', name: 'Ada Lopez', phone: '+15551110000', email: 'ada@example.com', status: 'active', address: '12 Main Street', street: '12 Main Street', city: 'Cleveland', state: 'OH', zip: '44114' }] };
      }
      if (/FROM communications/i.test(sql)) return { rows: [{ direction: 'outbound', kind: 'sms', created_at: '2026-10-01T15:00:00Z' }] };
      if (/FROM estimates/i.test(sql)) return { rows: [{ status: 'sent', title: 'Roof' }] };
      if (/FROM projects/i.test(sql)) return { rows: [{ status: 'scheduled', title: 'Tear-off' }] };
      return { rows: [] };
    },
  };
  const facts = await tool('lookup_contact', { address: 'Main Street' }, spokenAgain, { pool: factPool });
  check('address lookup reads back the key facts', facts.success === true && /Ada Lopez/.test(facts.read_back) && /12 Main Street/.test(facts.read_back) && /5551110000|15551110000/.test(facts.read_back) && /sms 2026-10-01/.test(facts.read_back) && /Estimate: sent/.test(facts.read_back) && /Job: scheduled/.test(facts.read_back) && !/portal_token/.test(JSON.stringify(facts)));
  const editDraft = stateFor();
  editDraft.pinVerified = true;
  editDraft.latestUserText = 'Text Ada that I am running late';
  const firstDraft = await tool('draft_customer_message', { channel: 'sms', to: '+15551110000', message: 'Running late', contact_name: 'Ada' }, editDraft);
  const revised = await tool('draft_customer_message', { message: 'Running ten minutes late' }, editDraft);
  check('an edit re-drafts and reads back the full text and recipient', revised.revised === true && revised.sent === false && /Running ten minutes late/.test(revised.read_back) && /\+15551110000/.test(revised.read_back) && editDraft.pendingDraft.message === 'Running ten minutes late');
  check('the first draft was not sent', firstDraft.sent === false);
  const priorSendFlag = process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  let stagedSendFetches = 0;
  try {
    editDraft.latestUserText = 'yes, send it';
    const stagedSend = await lexi.executePhoneTool({ name: 'confirm_send', args: {} }, {
      state: editDraft,
      config: config(),
      pool: createDb(),
      owner: OWNER,
      sendCustomerMessage: (draft) => lexi.deliverTwilioSms({
        to: draft.to, body: draft.message, from: '+12165160246', accountSid: 'ACtest', authToken: 'token',
        fetchImpl: async () => { stagedSendFetches += 1; return { ok: true }; },
      }),
    });
    check('staging blocks the customer send and keeps the draft', stagedSend.success === false && stagedSend.sent !== true && stagedSendFetches === 0 && editDraft.pendingDraft && /Running ten minutes late/.test(editDraft.pendingDraft.message));
  } finally {
    if (priorSendFlag === undefined) delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
    else process.env.STAGING_READ_ONLY_SIDE_EFFECTS = priorSendFlag;
  }

  const smsPool = createDb();
  smsPool.query = async (sql, params) => {
    if (/DELETE\s+FROM/i.test(sql)) throw new Error(`unexpected delete: ${sql}`);
    if (sql.includes('SELECT data FROM generic_entities') && sql.includes('$1')) {
      const row = smsPool.threads.get(params[1]);
      return { rows: row ? [{ data: row }] : [] };
    }
    if (sql.includes('ON CONFLICT')) {
      smsPool.threads.set(params[0], JSON.parse(params[3]));
      return { rows: [] };
    }
    if (/FROM customers/i.test(sql)) {
      return { rows: [{ id: 'cust_ada', name: 'Ada Lopez', phone: '+15551110000', email: 'ada@example.com', status: 'active', address: '12 Main Street', street: '', city: '', state: '', zip: '' }] };
    }
    if (/^SELECT/i.test(sql.trim())) return { rows: [] };
    return { rows: [], rowCount: 1 };
  };
  const seenTools = [];
  const smsGenerate = async ({ body }) => {
    const blob = JSON.stringify(body);
    if (blob.includes('functionResponse')) {
      seenTools.push(body.contents[body.contents.length - 1]);
      return { candidates: [{ content: { parts: [{ text: 'Ada Lopez, 12 Main Street.' }] } }] };
    }
    return { candidates: [{ content: { parts: [{ functionCall: { name: 'lookup_contact', args: { name: 'Ada Lopez' } } }] } }] };
  };
  const pinTurn = await lexi.handleSmsTurn({
    pool: smsPool, config: config(), from: KEVIN, body: PIN, generate: smsGenerate,
    loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '' }),
  });
  const lookupTurn = await lexi.handleSmsTurn({
    pool: smsPool, config: config(), from: KEVIN, body: 'Look up Ada Lopez', generate: smsGenerate,
    loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '' }),
  });
  const toolBlob = JSON.stringify(seenTools);
  check('SMS accepts the PIN once and then looks up a contact', /verified/i.test(pinTurn.reply) && /12 Main Street/.test(lookupTurn.reply) && /Ada Lopez/.test(toolBlob) && !/PIN_REQUIRED/.test(toolBlob));
  const prompt = lexi.buildPhoneSystemPrompt({ basePrompt: '', ownerName: 'Kevin', memories: '', recentSessions: '', pinVerified: true, companyResolved: true });
  check('the phone prompt covers lookup, redraft, and yes send it', /lookup_contact/.test(prompt) && /change it to/.test(prompt) && /yes, send it/.test(prompt));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
