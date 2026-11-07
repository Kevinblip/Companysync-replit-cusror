#!/usr/bin/env node
// Live translation policy tests. No database, no Twilio, no Gemini network.
'use strict';

const fs = require('fs');
const path = require('path');
const lexi = require('../lib/lexiPhone.cjs');
const translate = require('../lib/lexiTranslate.cjs');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const COMPANY = 'yicn_roofing_001';
const KEVIN = '+15555550123';
const MCDANIEL = '+15551110001';
const OTHER = '+15552220002';
const SPOKEN = '+19995550000';
const LEXI_NUMBER = '+12165160246';
const PIN = '4271';
const OWNER = { companyId: COMPANY, userEmail: 'yicnteam@gmail.com', name: 'Kevin', phone: KEVIN };

function config(overrides = {}) {
  return {
    ...lexi.configFromEnv({ LEXI_PHONE_ALLOWLIST: KEVIN, LEXI_PHONE_NUMBER: LEXI_NUMBER }),
    pin: PIN,
    companyId: COMPANY,
    userEmail: OWNER.userEmail,
    userName: 'Kevin',
    lexiNumber: LEXI_NUMBER,
    allowlist: [KEVIN],
    translateContacts: '',
    translateEnabled: true,
    forwardTo: '',
    summarySms: false,
    ...overrides,
  };
}

function subRow(id, data, companyId = COMPANY) {
  return { id, data: { ...data, company_id: companyId } };
}

function peoplePool({ subs = [], staff = [], inserts } = {}) {
  return {
    query: async (sql, params) => {
      const companyId = params && String(params[0] || '');
      if (sql.includes("entity_type = 'Subcontractor'")) {
        return {
          rows: subs.filter((row) => {
            const data = row.data && typeof row.data === 'object' ? row.data : {};
            const rowCompany = row.company_id || data.company_id || '';
            return rowCompany === companyId;
          }),
        };
      }
      if (/staff_profiles/i.test(sql)) {
        return {
          rows: staff.filter((row) => !row.company_id || row.company_id === companyId),
        };
      }
      if (/INSERT INTO communications/i.test(sql)) {
        if (inserts) inserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
  };
}

function verifiedState() {
  const state = lexi.sessionFromThread(lexi.emptyThread(KEVIN));
  state.pinVerified = true;
  state.latestUserText = '';
  state.actions = [];
  return state;
}

async function prepare(name, extra = {}) {
  const state = extra.state || verifiedState();
  const result = await translate.prepareTranslation({
    state,
    pool: extra.pool,
    owner: extra.owner || OWNER,
    config: extra.config || config(),
    name,
    phone: extra.phone,
  });
  return { state, result };
}

function parseBody(body) {
  return new URLSearchParams(String(body || ''));
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  console.log('\nContact source');
  const onePool = peoplePool({
    subs: [subRow('sub_1', { name: 'McDaniel', contact_person: 'Luis Vega', phone: MCDANIEL, is_active: true })],
  });
  let fetches = [];
  const single = await prepare('McDaniel', { pool: onePool });
  check('one subcontractor match is read back and not dialed', single.result.success === true && single.result.dialed === false && single.result.phone === MCDANIEL && /subcontractor record/.test(single.result.message) && /Do not dial until Kevin says yes/.test(single.result.message));
  check('prepare stores one pending crew member', single.state.pendingTranslation?.phone === MCDANIEL && single.state.pendingTranslation?.name === 'McDaniel');

  const ignored = await translate.confirmTranslation({
    state: single.state,
    pool: onePool,
    owner: OWNER,
    config: config(),
    ctx: {
      publicHost: 'example.test',
      fetchImpl: async (url, init) => { fetches.push({ url, init }); return { ok: true, json: async () => ({ sid: 'CAPEER' }) }; },
      twilioAccountSid: 'ACtest',
      twilioAuthToken: 'token',
      answerTimeoutMs: 0,
    },
  });
  check('confirm before yes does not dial', ignored.code === 'CONFIRMATION_REQUIRED' && fetches.length === 0 && single.state.pendingTranslation?.phone === MCDANIEL);

  single.state.latestUserText = 'yes, send it';
  const sendPhrase = await translate.confirmTranslation({
    state: single.state,
    pool: onePool,
    owner: OWNER,
    config: config(),
    ctx: { fetchImpl: async () => { fetches.push({ leaked: true }); return { ok: true, json: async () => ({}) }; }, twilioAccountSid: 'ACtest', twilioAuthToken: 'token', answerTimeoutMs: 0 },
  });
  check('yes, send it does not place the translated call', sendPhrase.code === 'CONFIRMATION_REQUIRED' && fetches.length === 0);

  single.state.latestUserText = 'yes';
  const dialed = await translate.confirmTranslation({
    state: single.state,
    pool: onePool,
    owner: OWNER,
    config: config(),
    ctx: {
      publicHost: 'example.test',
      fetchImpl: async (url, init) => { fetches.push({ url, body: String(init.body) }); return { ok: true, json: async () => ({ sid: 'CAPEER1' }) }; },
      twilioAccountSid: 'ACtest',
      twilioAuthToken: 'token',
      answerTimeoutMs: 0,
      callSid: 'CAOWNER',
    },
  });
  const posted = fetches[0] ? parseBody(fetches[0].body) : new URLSearchParams();
  check('yes dials the saved subcontractor number', dialed.dialed === true && fetches.length === 1 && fetches[0].url.includes('/Calls.json') && posted.get('To') === MCDANIEL && posted.get('From') === LEXI_NUMBER);
  check('the dialed call speaks the Spanish recording notice', posted.get('Twiml').includes(translate.SPANISH_NOTICE) && posted.get('Twiml').includes('es-MX') && posted.get('Twiml').includes('/ws/lexi-translate'));
  check('a spoken number is not the dial target', !fetches[0].body.includes(SPOKEN) && posted.get('To') !== SPOKEN);
  translate.resetTranslateSessions();

  const spokenPool = peoplePool({
    subs: [subRow('sub_1', { name: 'McDaniel', phone: MCDANIEL })],
  });
  const withSpoken = verifiedState();
  const preparedSpoken = await lexi.executePhoneTool(
    { name: 'prepare_live_translation', args: { name: 'McDaniel', phone: SPOKEN } },
    { state: withSpoken, config: config(), pool: spokenPool, owner: OWNER }
  );
  check('a phone argument on prepare is ignored', preparedSpoken.phone === MCDANIEL && preparedSpoken.dialed === false);
  withSpoken.latestUserText = 'yes call him';
  const spokenFetches = [];
  await lexi.executePhoneTool(
    { name: 'confirm_live_translation', args: { phone: SPOKEN, to: SPOKEN } },
    {
      state: withSpoken,
      config: config(),
      pool: spokenPool,
      owner: OWNER,
      fetchImpl: async (url, init) => { spokenFetches.push(String(init.body)); return { ok: true, json: async () => ({ sid: 'CAPEER2' }) }; },
      twilioAccountSid: 'ACtest',
      twilioAuthToken: 'token',
      publicHost: 'example.test',
      answerTimeoutMs: 0,
    }
  );
  check('confirm dials the record even if the tool arguments name another number', spokenFetches.length === 1 && parseBody(spokenFetches[0]).get('To') === MCDANIEL && !spokenFetches[0].includes('9995550000'));
  translate.resetTranslateSessions();

  const many = await prepare('McDaniel', {
    pool: peoplePool({
      subs: [
        subRow('sub_1', { name: 'Jose McDaniel', phone: MCDANIEL }),
        subRow('sub_2', { name: 'Ana McDaniel', phone: OTHER }),
      ],
    }),
  });
  check('several subcontractors ask which one and do not dial', many.result.code === 'TRANSLATE_SEVERAL' && /Nothing was dialed/.test(many.result.error) && many.state.pendingTranslation === null && many.result.error.includes(MCDANIEL) && many.result.error.includes(OTHER));

  const mixed = await prepare('McDaniel', {
    pool: peoplePool({
      subs: [subRow('sub_1', { name: 'McDaniel', phone: MCDANIEL })],
      staff: [{ id: 'staff_1', full_name: 'McDaniel', cell_phone: OTHER, is_active: true }],
    }),
  });
  check('a subcontractor and a staff member with the same name both count', mixed.result.code === 'TRANSLATE_SEVERAL' && /staff record/.test(mixed.result.error) && /subcontractor record/.test(mixed.result.error));

  const inactive = await prepare('McDaniel', {
    pool: peoplePool({
      subs: [subRow('sub_off', { name: 'McDaniel', phone: MCDANIEL, is_active: false })],
    }),
    config: config({ translateContacts: JSON.stringify({ McDaniel: OTHER }) }),
  });
  check('an inactive subcontractor is skipped and the test list is the fallback', inactive.result.success === true && inactive.result.phone === OTHER && /test contact list/.test(inactive.result.message));

  const otherCompany = await prepare('McDaniel', {
    pool: peoplePool({
      companyId: COMPANY,
      subs: [subRow('sub_other', { name: 'McDaniel', phone: SPOKEN }, 'someone_else')],
    }),
  });
  check('another company\'s subcontractor is not a match', otherCompany.result.code === 'TRANSLATE_NO_MATCH' && otherCompany.state.pendingTranslation === null);

  const crmWins = await prepare('McDaniel', {
    pool: peoplePool({ subs: [subRow('sub_1', { name: 'McDaniel', phone: MCDANIEL })] }),
    config: config({ translateContacts: JSON.stringify({ mcdaniel: OTHER }) }),
  });
  check('a CRM hit wins over the test contact list', crmWins.result.phone === MCDANIEL && /subcontractor record/.test(crmWins.result.message));

  const envOnly = await prepare('mcdaniel', {
    pool: peoplePool({ subs: [] }),
    config: config({ translateContacts: JSON.stringify({ McDaniel: MCDANIEL }) }),
  });
  check('the test list is used only when the CRM has nobody by that name', envOnly.result.success === true && envOnly.result.phone === MCDANIEL && /test contact list/.test(envOnly.result.message));

  const nobody = await prepare('McDaniel', { pool: peoplePool({ subs: [] }), config: config({ translateContacts: '{}' }) });
  check('no CRM row and no test contact asks Kevin to clarify', nobody.result.code === 'TRANSLATE_NO_MATCH' && /Nothing was dialed/.test(nobody.result.error));

  const staffOnly = await prepare('Luis', {
    pool: peoplePool({ staff: [{ id: 'staff_9', full_name: 'Luis Vega', phone: '', cell_phone: MCDANIEL, is_active: true }] }),
  });
  check('staff cell is used when that is the saved number', staffOnly.result.success === true && staffOnly.result.phone === MCDANIEL && /staff record/.test(staffOnly.result.message));

  console.log('\nPIN and dial gate');
  let pinQueries = 0;
  const locked = lexi.sessionFromThread(lexi.emptyThread(KEVIN));
  const pinBlocked = await lexi.executePhoneTool(
    { name: 'prepare_live_translation', args: { name: 'McDaniel' } },
    {
      state: locked,
      config: config(),
      owner: OWNER,
      pool: { query: async () => { pinQueries += 1; return { rows: [] }; } },
    }
  );
  check('prepare before the PIN does not look anyone up', pinBlocked.code === 'PIN_REQUIRED' && pinQueries === 0);

  const priorSide = process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  const priorFlag = process.env.LEXI_TRANSLATE_ENABLED;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  delete process.env.LEXI_TRANSLATE_ENABLED;
  try {
    const offState = verifiedState();
    offState.pendingTranslation = { id: 'sub_1', name: 'McDaniel', phone: MCDANIEL, source: 'subcontractor record' };
    offState.latestUserText = 'yes';
    let offFetches = 0;
    const off = await translate.confirmTranslation({
      state: offState,
      pool: onePool,
      owner: OWNER,
      config: config({ translateEnabled: false }),
      ctx: {
        fetchImpl: async () => { offFetches += 1; return { ok: true, json: async () => ({ sid: 'CAOFF' }) }; },
        twilioAccountSid: 'ACtest',
        twilioAuthToken: 'token',
        answerTimeoutMs: 0,
      },
    });
    check('staging without LEXI_TRANSLATE_ENABLED does not dial', off.code === 'TRANSLATE_DISABLED' && off.dialed === false && offFetches === 0 && /LEXI_TRANSLATE_ENABLED=1/.test(off.error));
    const bypass = translate.dialGate({
      to: MCDANIEL,
      savedNumbers: [MCDANIEL],
      config: {},
      env: { STAGING_READ_ONLY_SIDE_EFFECTS: '1', LEXI_TRANSLATE_ENABLED: '1' },
    });
    check('an enabled staging dial asks to bypass the outbound guard', bypass.bypassStagingGuard === true);
    const onState = verifiedState();
    onState.pendingTranslation = { id: 'sub_1', name: 'McDaniel', phone: MCDANIEL, source: 'subcontractor record' };
    onState.latestUserText = 'yes please';
    let onFetches = 0;
    const on = await translate.confirmTranslation({
      state: onState,
      pool: onePool,
      owner: OWNER,
      config: config({ translateEnabled: true }),
      ctx: {
        publicHost: 'example.test',
        fetchImpl: async () => { onFetches += 1; return { ok: true, json: async () => ({ sid: 'CAON' }) }; },
        twilioAccountSid: 'ACtest',
        twilioAuthToken: 'token',
        answerTimeoutMs: 0,
      },
    });
    check('LEXI_TRANSLATE_ENABLED=1 places the saved-number call on staging', on.dialed === true && onFetches === 1);
  } finally {
    if (priorSide === undefined) delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
    else process.env.STAGING_READ_ONLY_SIDE_EFFECTS = priorSide;
    if (priorFlag === undefined) delete process.env.LEXI_TRANSLATE_ENABLED;
    else process.env.LEXI_TRANSLATE_ENABLED = priorFlag;
    translate.resetTranslateSessions();
  }

  const unsaved = verifiedState();
  unsaved.pendingTranslation = { id: 'nope', name: 'McDaniel', phone: SPOKEN, source: 'subcontractor record' };
  unsaved.latestUserText = 'yes';
  let unsavedFetches = 0;
  const refused = await translate.confirmTranslation({
    state: unsaved,
    pool: onePool,
    owner: OWNER,
    config: config(),
    ctx: { fetchImpl: async () => { unsavedFetches += 1; return { ok: true, json: async () => ({}) }; }, twilioAccountSid: 'ACtest', twilioAuthToken: 'token' },
  });
  check('a number that is not on the company is not dialed', refused.code === 'NUMBER_NOT_SAVED' && unsavedFetches === 0);

  check('stop translating is a short phrase', translate.isStopTranslation('Lexi, stop translating') === true && translate.isStopTranslation('please stop translation') === true);
  check('a longer sentence is not a stop phrase', translate.isStopTranslation('Lexi, stop translating and then book the adjuster for tomorrow morning') === false);
  check('translation setup uses a short silence window', translate.TRANSLATE_VAD.silence_duration_ms === 700 && translate.TRANSLATE_VAD.prefix_padding_ms === 200 && translate.TRANSLATE_VAD.start_of_speech_sensitivity === 'START_SENSITIVITY_HIGH');
  check('subcontractor lookup is scoped like the CRM tool', translate.SUBCONTRACTOR_SQL.includes("entity_type = 'Subcontractor'") && translate.SUBCONTRACTOR_SQL.includes("company_id = $1 OR (data->>'company_id') = $1"));

  console.log('\nCrew inbound');
  let crewFetches = [];
  const crew = await lexi.handleVoiceHttp({
    rawBody: `From=${encodeURIComponent(MCDANIEL)}&CallSid=CAPEERIN&To=${encodeURIComponent(LEXI_NUMBER)}&PhoneNumber=${encodeURIComponent(SPOKEN)}`,
    host: 'example.test',
    config: config(),
    pool: onePool,
    verifySignature: async () => ({ valid: true }),
    fetchImpl: async (url, init) => { crewFetches.push({ url, body: String(init.body) }); return { ok: true, json: async () => ({ sid: 'CAOWNERIN' }) }; },
    twilioAccountSid: 'ACtest',
    twilioAuthToken: 'token',
  });
  const crewPost = crewFetches[0] ? parseBody(crewFetches[0].body) : new URLSearchParams();
  check('a saved crew caller is answered with the Spanish notice', crew.translating === true && crew.body.includes(translate.SPANISH_NOTICE) && crew.body.includes('es-MX') && crew.body.includes('name="role" value="peer"'));
  check('crew inbound dials Kevin\'s allowlisted cell', crewFetches.length === 1 && crewPost.get('To') === KEVIN && crewPost.get('From') === LEXI_NUMBER && crewPost.get('Twiml').includes('Polly.Joanna') && crewPost.get('Twiml').includes('is calling'));
  check('crew inbound does not dial a number from the webhook body', crewPost.get('To') !== SPOKEN && !crewFetches[0].body.includes('9995550000'));
  translate.resetTranslateSessions();

  crewFetches = [];
  const stranger = await lexi.handleVoiceHttp({
    rawBody: `From=${encodeURIComponent('+15555550999')}&CallSid=CASTRANGER&PhoneNumber=${encodeURIComponent(SPOKEN)}`,
    host: 'example.test',
    config: config(),
    pool: onePool,
    verifySignature: async () => ({ valid: true }),
    fetchImpl: async () => { crewFetches.push('nope'); return { ok: true, json: async () => ({ sid: 'CA' }) }; },
    twilioAccountSid: 'ACtest',
    twilioAuthToken: 'token',
  });
  check('a stranger still hears the private assistant and is not dialed', stranger.status === 200 && /private assistant/i.test(stranger.body) && !stranger.body.includes('/ws/lexi-translate') && crewFetches.length === 0);

  crewFetches = [];
  const crewOff = await lexi.handleVoiceHttp({
    rawBody: `From=${encodeURIComponent(MCDANIEL)}&CallSid=CAOFF`,
    host: 'example.test',
    config: config({ translateEnabled: false }),
    pool: onePool,
    verifySignature: async () => ({ valid: true }),
    fetchImpl: async () => { crewFetches.push('nope'); return { ok: true, json: async () => ({ sid: 'CA' }) }; },
    twilioAccountSid: 'ACtest',
    twilioAuthToken: 'token',
  });
  check('crew inbound stays quiet while translation dialing is off', /private assistant/i.test(crewOff.body) && crewFetches.length === 0 && !crewOff.body.includes('/ws/lexi-translate'));

  console.log('\nBridge');
  const recordings = [];
  const inserts = [];
  const bridgePool = peoplePool({ inserts });
  const session = new translate.TranslateSession({
    direction: 'owner_outbound',
    companyId: COMPANY,
    host: 'example.test',
    owner: OWNER,
    peerName: 'McDaniel',
    peerPhone: MCDANIEL,
    ownerPhone: KEVIN,
    ownerCallSid: 'CAOWNER',
    peerCallSid: 'CAPEER',
    answerTimeoutMs: 0,
  });
  const ownerWs = fakeTwilio();
  const peerWs = fakeTwilio();
  const geminiSockets = [];
  class FakeGemini {
    constructor(url) {
      this.url = url;
      this.readyState = FakeGemini.CONNECTING;
      this.sent = [];
      this.handlers = {};
      geminiSockets.push(this);
    }
    static get CONNECTING() { return 0; }
    static get OPEN() { return 1; }
    send(data) { this.sent.push(JSON.parse(data)); }
    on(event, fn) { this.handlers[event] = fn; }
    close() { this.readyState = 3; this.handlers.close?.(); }
    open() { this.readyState = FakeGemini.OPEN; this.handlers.open?.(); }
    receive(obj) { return this.handlers.message?.(Buffer.from(JSON.stringify(obj))); }
  }
  session.bindLeg('peer', { ws: peerWs, streamSid: 'MZpeer', callSid: 'CAPEER', role: 'peer' });
  session.bindLeg('owner', { ws: ownerWs, streamSid: 'MZowner', callSid: 'CAOWNER', role: 'owner' });
  await session.startBridge({
    WebSocket: FakeGemini,
    apiKey: 'test-key-do-not-log',
    twilioToGemini: (mulaw) => mulaw,
    geminiToTwilio: (pcm) => `mulaw:${pcm}`,
    recordCall: (args) => { recordings.push(args); return { started: true }; },
    pool: bridgePool,
  });
  check('both legs open their own Gemini session', geminiSockets.length === 2);
  geminiSockets[0].open();
  geminiSockets[1].open();
  const ownerSetup = geminiSockets[0].sent[0]?.setup;
  check('owner translator waits 700ms of silence', ownerSetup?.realtime_input_config?.automatic_activity_detection?.silence_duration_ms === 700);
  check('owner translator speaks Spanish and the peer translator speaks English', /Spanish/.test(ownerSetup?.system_instruction?.parts?.[0]?.text || '') && /English/.test(geminiSockets[1].sent[0]?.setup?.system_instruction?.parts?.[0]?.text || ''));
  const beforeOwner = ownerWs.sent.length;
  const beforePeer = peerWs.sent.length;
  await geminiSockets[0].receive({
    serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'SPANISH_AUDIO' } }] } },
  });
  check('English-side audio is played only on the crew leg', peerWs.sent.length === beforePeer + 1 && peerWs.sent[beforePeer].streamSid === 'MZpeer' && peerWs.sent[beforePeer].media.payload === 'mulaw:SPANISH_AUDIO' && ownerWs.sent.length === beforeOwner);
  await geminiSockets[1].receive({
    serverContent: {
      inputTranscription: { text: 'hola' },
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'ENGLISH_AUDIO' } }] },
    },
  });
  check('Spanish-side audio is played only on Kevin\'s leg', ownerWs.sent.length === beforeOwner + 1 && ownerWs.sent[0].streamSid === 'MZowner' && ownerWs.sent[0].media.payload === 'mulaw:ENGLISH_AUDIO' && !peerWs.sent.some((frame) => frame.media?.payload === 'mulaw:ENGLISH_AUDIO'));
  check('recording is requested for both call legs', recordings.map((row) => row.callSid).sort().join() === 'CAOWNER,CAPEER' && recordings.every((row) => String(row.callSid).startsWith('CA') && row.companyId === COMPANY));
  await geminiSockets[0].receive({ serverContent: { inputTranscription: { text: 'Lexi, stop translating' } } });
  check('stop translating closes the crew leg', peerWs.closed === true && session.stopped === true);
  await flush();
  const saved = inserts.map((params) => params.find((value) => typeof value === 'string' && value.includes('lexi_translate'))).find(Boolean);
  const savedJson = saved ? JSON.parse(saved) : {};
  check('the translation transcript is saved on the call', savedJson.channel === 'lexi_translate' && /hola/.test(JSON.stringify(inserts)) && /Kevin: Lexi, stop translating/.test(JSON.stringify(inserts)));
  check('the bridge does not log the Gemini key', geminiSockets.every((socket) => !JSON.stringify(socket.sent).includes('test-key-do-not-log')));
  translate.resetTranslateSessions();

  console.log('\nOwner stream swap');
  const swapInserts = [];
  const swapFetches = [];
  const swapGemini = [];
  class SwapGemini {
    constructor() {
      this.readyState = SwapGemini.CONNECTING;
      this.sent = [];
      this.handlers = {};
      swapGemini.push(this);
    }
    static get CONNECTING() { return 0; }
    static get OPEN() { return 1; }
    send(data) { this.sent.push(JSON.parse(data)); }
    on(event, fn) { this.handlers[event] = fn; }
    close() { this.readyState = 3; if (this.handlers.close) this.handlers.close(1000, Buffer.from('swap')); }
    open() { this.readyState = SwapGemini.OPEN; this.handlers.open?.(); }
    receive(obj) { return this.handlers.message?.(Buffer.from(JSON.stringify(obj))); }
  }
  const swapTwilio = fakeTwilio();
  lexi.attachCallStream(swapTwilio, {
    WebSocket: SwapGemini,
    config: config(),
    pool: () => peoplePool({
      subs: [subRow('sub_1', { name: 'McDaniel', phone: MCDANIEL })],
      inserts: swapInserts,
    }),
    geminiApiKey: 'test-key-do-not-log',
    loadPrompt: async () => ({ basePrompt: 'Lexi', memories: '', recentSessions: '', voice: 'Kore' }),
    twilioToGemini: (mulaw) => mulaw,
    geminiToTwilio: (pcm) => pcm,
    fetchImpl: async (url, init) => { swapFetches.push(String(init.body)); return { ok: true, json: async () => ({ sid: 'CAPEERSWAP' }) }; },
    twilioAccountSid: 'ACtest',
    twilioAuthToken: 'token',
    answerTimeoutMs: 0,
    recordCall: (args) => recordings.push(args),
  });
  swapTwilio.handlers.message(Buffer.from(JSON.stringify({
    event: 'start',
    start: { streamSid: 'MZkevin', callSid: 'CAOWNER', customParameters: { from: KEVIN, callSid: 'CAOWNER', host: 'example.test' } },
  })));
  for (let i = 0; i < 20 && swapGemini.length === 0; i++) await flush();
  const assistant = swapGemini[0];
  assistant.open();
  await assistant.receive({ setupComplete: true });
  await assistant.receive({ toolCall: { functionCalls: [{ id: 'pin', name: 'verify_pin', args: { digits: PIN } }] } });
  await assistant.receive({ toolCall: { functionCalls: [{ id: 'prep', name: 'prepare_live_translation', args: { name: 'McDaniel', phone: SPOKEN } }] } });
  check('the live call can prepare McDaniel without dialing', swapFetches.length === 0 && assistant.sent.some((item) => item.tool_response?.function_responses?.[0]?.response?.phone === MCDANIEL));
  await assistant.receive({ serverContent: { inputTranscription: { text: 'yes' } } });
  await assistant.receive({ toolCall: { functionCalls: [{ id: 'go', name: 'confirm_live_translation', args: {} }] } });
  const confirmResponse = [...assistant.sent].reverse().find((item) => item.tool_response?.function_responses?.some((row) => row.name === 'confirm_live_translation'));
  const sessionId = confirmResponse?.tool_response?.function_responses?.find((row) => row.name === 'confirm_live_translation')?.response?.sessionId;
  check('confirm on the live call dials and leaves the assistant connected', Boolean(sessionId) && swapFetches.length === 1 && parseBody(swapFetches[0]).get('To') === MCDANIEL && assistant.readyState === SwapGemini.OPEN && swapTwilio.readyState === 1);
  const peer = fakeTwilio();
  translate.attachTranslateStream(peer, {
    WebSocket: SwapGemini,
    twilioToGemini: (mulaw) => mulaw,
    geminiToTwilio: (pcm) => pcm,
    geminiApiKey: 'test-key-do-not-log',
    recordCall: () => ({ started: true }),
    pool: () => null,
  });
  peer.handlers.message(Buffer.from(JSON.stringify({
    event: 'start',
    start: { streamSid: 'MZpeer2', callSid: 'CAPEERSWAP', customParameters: { role: 'peer', sessionId, host: 'example.test' } },
  })));
  await flush();
  check('answering the crew leg retires the assistant without hanging up Kevin', assistant.readyState === 3 && swapTwilio.readyState === 1 && swapTwilio.closed !== true && swapInserts.length === 0);
  check('the crew leg starts the two translation sessions', swapGemini.length >= 3);

  const server = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
  const upgrade = server.slice(server.indexOf("server.on('upgrade'"), server.indexOf('salesDemoWss.on'));
  check('the translate socket is upgraded on its own path', upgrade.includes('/ws/lexi-translate'));
  check('staging still destroys only the receptionist media socket', /\/ws\/twilio[\s\S]{0,220}socket\.destroy/.test(upgrade) && !/\/ws\/lexi-translate[\s\S]{0,160}socket\.destroy/.test(upgrade));

  translate.resetTranslateSessions();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

function fakeTwilio() {
  return {
    readyState: 1,
    closed: false,
    sent: [],
    handlers: {},
    send(data) { this.sent.push(JSON.parse(data)); },
    on(event, fn) { this.handlers[event] = fn; },
    close() { this.readyState = 3; this.closed = true; this.handlers.close?.(); },
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
