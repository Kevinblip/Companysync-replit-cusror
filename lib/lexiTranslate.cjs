'use strict';

// Live English ↔ Spanish bridge for Lexi's private line.
//
// Two Twilio call legs, each with its own Media Stream and its own Gemini Live
// session. Kevin's English audio is translated to Spanish on the crew leg only,
// and the crew member's Spanish comes back as English on Kevin's leg only.
// A conference cannot play raw PCM without a third phone leg, and this process
// already converts mulaw ↔ PCM for /ws/lexi-phone.
//
// Numbers come from the owner's company subcontractors and staff. The
// LEXI_TRANSLATE_CONTACTS JSON is used only when that lookup finds nobody.
// A number the caller speaks is never dialed.

const crypto = require('crypto');
const stagingSideEffects = require('./stagingSideEffects.cjs');

const SPANISH_NOTICE = 'Esta llamada se graba y se traduce entre inglés y español.';
const ANSWER_TIMEOUT_MS = 50000;
const PENDING_MEDIA_CAP = 100;
const sessions = new Map();

const TRANSLATE_VAD = {
  disabled: false,
  start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
  end_of_speech_sensitivity: 'END_SENSITIVITY_LOW',
  prefix_padding_ms: 200,
  silence_duration_ms: 700,
};

const SUBCONTRACTOR_SQL = `SELECT id, data FROM generic_entities WHERE entity_type = 'Subcontractor' AND (company_id = $1 OR (data->>'company_id') = $1) ORDER BY created_date DESC NULLS LAST LIMIT 100`;
const STAFF_SQL = `SELECT id, full_name, name, cell_phone, phone, is_active FROM staff_profiles WHERE company_id = $1 LIMIT 100`;

const STOP_TOOL = {
  name: 'stop_live_translation',
  description: 'End the live translation and both phone legs. Use it when Kevin says stop translating.',
  parameters: { type: 'object', properties: {} },
};

function phoneLib() {
  return require('./lexiPhone.cjs');
}

function digitsOnly(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function last10(phone) {
  const d = digitsOnly(phone);
  return d.length >= 10 ? d.slice(-10) : d;
}

function toE164(phone) {
  const d = digitsOnly(phone);
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(phone || '').trim().startsWith('+') && d) return `+${d}`;
  return d ? `+${d}` : '';
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(spoken, recordName) {
  const left = normalizeName(spoken);
  const right = normalizeName(recordName);
  if (left.length < 2 || right.length < 2) return false;
  if (left === right) return true;
  const words = new Set(right.split(' '));
  return left.split(' ').every((word) => words.has(word));
}

function personMatches(person, spoken) {
  return namesMatch(spoken, person.name) || namesMatch(spoken, person.contactPerson);
}

function displayName(person, spoken) {
  if (namesMatch(spoken, person.name)) return person.name;
  if (person.contactPerson && namesMatch(spoken, person.contactPerson)) return person.contactPerson;
  return person.name;
}

function inactive(value) {
  return value === false || value === 0 || value === 'false' || value === '0';
}

function parseData(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  return raw;
}

function firstPhone(row, keys) {
  for (const key of keys) {
    const phone = toE164(row?.[key]);
    if (last10(phone).length >= 10) return phone;
  }
  return '';
}

function parseTranslateContacts(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return [];
    try { parsed = JSON.parse(text); } catch (e) { return []; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const people = [];
  for (const [name, phone] of Object.entries(parsed)) {
    const e164 = toE164(phone);
    if (!normalizeName(name) || last10(e164).length < 10) continue;
    people.push({
      id: `env:${normalizeName(name)}`,
      name: String(name).trim(),
      contactPerson: '',
      phone: e164,
      source: 'test contact list',
    });
  }
  return people;
}

function translationEnabled(config, env = process.env) {
  if (config && typeof config.translateEnabled === 'boolean') return config.translateEnabled;
  if (config && /^(1|true|yes|on)$/i.test(String(config.translateEnabled || ''))) return true;
  return /^(1|true|yes|on)$/i.test(String(env?.LEXI_TRANSLATE_ENABLED || ''));
}

function isExplicitTranslateConfirmation(text) {
  const original = String(text || '');
  if (original.length > 40) return false;
  if (/send it/i.test(original)) return false;
  const t = original
    .toLowerCase()
    .replace(/[“”"]/g, '')
    .replace(/[.!]+$/g, '')
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 40) return false;
  return /^(yes|yeah|yep|yes please|yes call|yes call him|yes call her|yes call them|yes translate|yes dial|yes do it|go ahead)$/.test(t);
}

function isStopTranslation(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[“”".,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 60) return false;
  if (!/\bstop translat(ing|ion)\b/.test(t)) return false;
  const leftover = t
    .replace(/\b(hey|hi|hello|ok|okay|alright|lexi|please|now|the|this|call|stop|translating|translation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return leftover.length === 0;
}

async function loadCompanyPeople(pool, companyId) {
  if (!pool || typeof pool.query !== 'function' || !companyId) return [];
  const people = [];
  try {
    const subs = await pool.query(SUBCONTRACTOR_SQL, [String(companyId)]);
    for (const row of subs.rows || []) {
      const data = parseData(row.data);
      if (inactive(data.is_active)) continue;
      const phone = firstPhone(data, ['phone', 'phone_2', 'cell_phone']);
      if (!phone) continue;
      people.push({
        id: String(row.id || ''),
        name: String(data.name || data.contact_person || 'Subcontractor').trim(),
        contactPerson: String(data.contact_person || '').trim(),
        phone,
        source: 'subcontractor record',
      });
    }
  } catch (err) {
    console.warn('[LexiTranslate] subcontractor lookup failed:', err.message);
  }
  try {
    const staff = await pool.query(STAFF_SQL, [String(companyId)]);
    for (const row of staff.rows || []) {
      if (inactive(row.is_active)) continue;
      const phone = firstPhone(row, ['cell_phone', 'phone']);
      if (!phone) continue;
      people.push({
        id: String(row.id || ''),
        name: String(row.full_name || row.name || 'Staff').trim(),
        contactPerson: '',
        phone,
        source: 'staff record',
      });
    }
  } catch (err) {
    console.warn('[LexiTranslate] staff lookup failed:', err.message);
  }
  return people;
}

function dialablePhones(crmPeople, envPeople) {
  const seen = new Set();
  const phones = [];
  for (const person of [...crmPeople, ...envPeople]) {
    const key = last10(person.phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    phones.push(person.phone);
  }
  return phones;
}

async function findTranslateCandidates({ pool, companyId, spokenName, translateContacts }) {
  const spoken = String(spokenName || '').trim();
  const crm = await loadCompanyPeople(pool, companyId);
  const env = parseTranslateContacts(translateContacts);
  const dialable = dialablePhones(crm, env);
  if (normalizeName(spoken).length < 2) return { matches: [], dialable, spoken };
  const crmHits = crm.filter((person) => personMatches(person, spoken));
  if (crmHits.length) return { matches: crmHits, dialable, spoken };
  const envHits = env.filter((person) => personMatches(person, spoken));
  return { matches: envHits, dialable, spoken };
}

async function matchSavedCaller({ pool, companyId, from, translateContacts }) {
  const caller = last10(from);
  if (caller.length < 10) return null;
  const crm = await loadCompanyPeople(pool, companyId);
  const fromCrm = crm.find((person) => last10(person.phone) === caller);
  if (fromCrm) return fromCrm;
  return parseTranslateContacts(translateContacts).find((person) => last10(person.phone) === caller) || null;
}

function describeMatch(person, spoken) {
  const name = displayName(person, spoken);
  return `${name} at ${person.phone} (${person.source})`;
}

function dialGate({ to, savedNumbers, config, env = process.env, fetchImpl }) {
  const target = toE164(to);
  const allowed = (savedNumbers || []).some((n) => last10(n) && last10(n) === last10(target));
  if (!allowed || last10(target).length < 10) {
    return {
      allow: false,
      bypassStagingGuard: false,
      result: {
        success: false,
        code: 'NUMBER_NOT_SAVED',
        dialed: false,
        error: 'That number is not saved on this company. Nothing was dialed.',
      },
    };
  }
  const enabled = translationEnabled(config, env);
  const staging = stagingSideEffects.sideEffectsDisabled(env);
  if (!enabled) {
    if (staging) stagingSideEffects.logSuppressed('call', { action: 'lexi-translate-dial', to: target });
    return {
      allow: false,
      bypassStagingGuard: false,
      result: {
        success: false,
        code: 'TRANSLATE_DISABLED',
        dialed: false,
        suppressed: staging,
        error: 'Translation dialing is off until LEXI_TRANSLATE_ENABLED=1. Nothing was dialed.',
      },
    };
  }
  if (staging) {
    const original = typeof fetchImpl === 'function' ? fetchImpl : globalThis.__stagingOriginalFetch;
    if (typeof original !== 'function') {
      stagingSideEffects.logSuppressed('call', { action: 'lexi-translate-dial', to: target, reason: 'no-bypass-fetch' });
      return {
        allow: false,
        bypassStagingGuard: true,
        result: {
          success: false,
          code: 'TRANSLATE_DISABLED',
          dialed: false,
          suppressed: true,
          error: 'Translation dialing is off until LEXI_TRANSLATE_ENABLED=1. Nothing was dialed.',
        },
      };
    }
    return { allow: true, bypassStagingGuard: true, fetchImpl: original, to: target };
  }
  return {
    allow: true,
    bypassStagingGuard: false,
    fetchImpl: typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch,
    to: target,
  };
}

function buildStreamTwiml({ host, sessionId, role, say, language, voice }) {
  const sayTag = say
    ? `<Say language="${xmlEscape(language || 'en-US')}" voice="${xmlEscape(voice || 'Polly.Joanna')}">${xmlEscape(say)}</Say>`
    : '';
  const wsUrl = `wss://${host}/ws/lexi-translate`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${sayTag}<Connect><Stream url="${xmlEscape(wsUrl)}"><Parameter name="role" value="${xmlEscape(role || '')}" /><Parameter name="sessionId" value="${xmlEscape(sessionId || '')}" /><Parameter name="host" value="${xmlEscape(host || '')}" /></Stream></Connect></Response>`;
}

function peerNoticeTwiml(host, sessionId) {
  return buildStreamTwiml({
    host,
    sessionId,
    role: 'peer',
    say: SPANISH_NOTICE,
    language: 'es-MX',
    voice: 'Polly.Lupe',
  });
}

function ownerNoticeTwiml(host, sessionId, name) {
  const who = String(name || 'A crew member').trim() || 'A crew member';
  return buildStreamTwiml({
    host,
    sessionId,
    role: 'owner',
    say: `${who} is calling. This call is recorded and I will translate.`,
    language: 'en-US',
    voice: 'Polly.Joanna',
  });
}

async function placeTranslateCall({ to, from, twiml, accountSid, authToken, fetchImpl, timeoutSec = 45 }) {
  if (typeof fetchImpl !== 'function' || !accountSid || !authToken || !to || !from || !twiml) {
    return { success: false, error: 'Twilio is not configured for a translated call.' };
  }
  const resp = await fetchImpl(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Twiml: twiml,
        Timeout: String(timeoutSec),
      }).toString(),
    }
  );
  const json = typeof resp.json === 'function' ? await resp.json().catch(() => ({})) : {};
  if (!resp.ok) return { success: false, error: `Dial failed (${resp.status})` };
  return { success: true, callSid: json.sid || '' };
}

function newSessionId() {
  return `lxt_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function resetTranslateSessions() {
  for (const session of [...sessions.values()]) session.stop('reset');
  sessions.clear();
}

function getTranslateSession(id) {
  return sessions.get(id) || null;
}

class TranslateSession {
  constructor(fields) {
    this.id = fields.id || newSessionId();
    this.direction = fields.direction || 'owner_outbound';
    this.companyId = fields.companyId || '';
    this.host = fields.host || '';
    this.owner = fields.owner || {};
    this.peerName = fields.peerName || '';
    this.peerPhone = fields.peerPhone || '';
    this.ownerPhone = fields.ownerPhone || '';
    this.ownerCallSid = fields.ownerCallSid || '';
    this.peerCallSid = fields.peerCallSid || '';
    this.legs = { owner: null, peer: null };
    this.geminis = { owner: null, peer: null };
    this.lines = [];
    this.recorded = new Set();
    this.bridgeStarted = false;
    this.peerConnected = false;
    this.stopped = false;
    this.answerTimer = null;
    this.answerTimeoutMs = fields.answerTimeoutMs === undefined ? ANSWER_TIMEOUT_MS : fields.answerTimeoutMs;
    this.onPeerConnected = null;
    this.completeCall = fields.completeCall || null;
    this.bridgeOptions = null;
    sessions.set(this.id, this);
  }

  armAnswerTimer() {
    if (this.answerTimer || this.stopped) return;
    const ms = Number(this.answerTimeoutMs);
    if (!ms) return;
    this.answerTimer = setTimeout(() => {
      if (!this.peerConnected && !this.stopped) {
        console.log('[LexiTranslate] peer did not answer; owner call stays up', { sessionId: this.id });
        this.abandonOutbound();
      }
    }, ms);
    if (this.answerTimer.unref) this.answerTimer.unref();
  }

  clearAnswerTimer() {
    if (this.answerTimer) clearTimeout(this.answerTimer);
    this.answerTimer = null;
  }

  addLine(role, text) {
    const line = String(text || '').trim();
    if (!line) return;
    this.lines.push({ role, text: line.slice(0, 500) });
  }

  bindLeg(role, leg) {
    if (this.stopped || (role !== 'owner' && role !== 'peer')) return;
    this.legs[role] = leg;
    if (role === 'peer') {
      this.peerConnected = true;
      this.clearAnswerTimer();
      if (leg.callSid) this.peerCallSid = leg.callSid;
    }
    if (role === 'owner' && leg.callSid) this.ownerCallSid = leg.callSid;
    if (this.direction === 'owner_outbound' && role === 'peer' && typeof this.onPeerConnected === 'function') {
      this.onPeerConnected();
    }
    if (this.direction === 'crew_inbound' && this.legs.owner && this.legs.peer && this.bridgeOptions) {
      this.startBridge(this.bridgeOptions);
    }
  }

  streamSid(role) {
    const leg = this.legs[role];
    if (!leg) return '';
    return typeof leg.streamSid === 'function' ? leg.streamSid() : (leg.streamSid || '');
  }

  ingest(role, pcmB64) {
    const socket = this.geminis[role];
    if (!pcmB64 || !socket) return;
    if (!socket.setupComplete || socket.ws.readyState !== socket.openState) {
      socket.pending.push(pcmB64);
      if (socket.pending.length > PENDING_MEDIA_CAP) socket.pending.shift();
      return;
    }
    try {
      socket.ws.send(JSON.stringify(phoneLib().geminiRealtimeAudioMessage(pcmB64)));
    } catch (err) {
      console.warn('[LexiTranslate] audio forward failed:', err.message);
    }
  }

  async startBridge(options = {}) {
    if (this.bridgeStarted || this.stopped) return;
    if (!this.legs.owner || !this.legs.peer) return;
    this.bridgeStarted = true;
    this.clearAnswerTimer();
    this.bridgeOptions = options;
    const WS = options.WebSocket || require('ws');
    const apiKey = typeof options.geminiApiKey === 'function'
      ? await options.geminiApiKey(this.owner)
      : (options.geminiApiKey || options.apiKey || '');
    if (!apiKey) {
      console.error('[LexiTranslate] missing Gemini API key');
      this.stop('no-key');
      return;
    }
    this.maybeRecord(options, this.ownerCallSid, this.ownerPhone || this.owner.phone);
    this.maybeRecord(options, this.peerCallSid, this.peerPhone);
    this.openGemini(WS, 'owner', apiKey, options);
    this.openGemini(WS, 'peer', apiKey, options);
  }

  maybeRecord(options, callSid, callerPhone) {
    if (!callSid || this.recorded.has(callSid)) return;
    if (!String(callSid).startsWith('CA')) return;
    if (typeof options.recordCall !== 'function') return;
    this.recorded.add(callSid);
    const pool = typeof options.pool === 'function' ? options.pool() : options.pool;
    Promise.resolve(options.recordCall({
      pool,
      companyId: this.companyId,
      callSid,
      publicHost: this.host,
      callerPhone: callerPhone || '',
    })).catch((err) => console.warn('[LexiTranslate] recording failed:', err.message));
  }

  openGemini(WS, role, apiKey, options) {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const ws = new WS(url);
    const socket = {
      ws,
      role,
      setupComplete: false,
      pending: [],
      openState: WS.OPEN ?? 1,
    };
    this.geminis[role] = socket;
    const prompt = role === 'owner'
      ? 'You are a live phone interpreter. The caller speaks English. Speak only the Spanish translation, in natural Latin American Spanish. Do not greet, explain, or add words. If he says stop translating, call stop_live_translation and stay silent.'
      : 'You are a live phone interpreter. The caller speaks Spanish. Speak only the English translation. Do not greet, explain, or add words.';
    ws.on('open', () => {
      if (this.stopped) return;
      const setup = {
        setup: {
          model: phoneLib().LIVE_MODEL,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: { voice_config: { prebuilt_voice_config: { voice_name: 'Kore' } } },
          },
          input_audio_transcription: {},
          output_audio_transcription: {},
          realtime_input_config: { automatic_activity_detection: TRANSLATE_VAD },
          system_instruction: { parts: [{ text: prompt }] },
        },
      };
      if (role === 'owner') setup.setup.tools = [{ function_declarations: [STOP_TOOL] }];
      ws.send(JSON.stringify(setup));
    });
    ws.on('message', (raw) => this.onGeminiMessage(role, socket, raw, options));
    ws.on('close', () => {
      if (!this.stopped && this.geminis[role]?.ws === ws) this.stop(`gemini-close:${role}`);
    });
    ws.on('error', (err) => console.error('[LexiTranslate] Gemini error:', err.message));
  }

  onGeminiMessage(role, socket, raw, options) {
    let data;
    try { data = JSON.parse(raw.toString()); } catch (e) { return; }
    if (data.setupComplete) {
      socket.setupComplete = true;
      const queued = socket.pending.splice(0, socket.pending.length);
      for (const pcm of queued) this.ingest(role, pcm);
    }
    const serverContent = data.serverContent || {};
    const inputText = serverContent.inputTranscript || serverContent.inputTranscription?.text || '';
    if (inputText) {
      this.addLine(role === 'owner' ? (this.owner.name || 'Kevin') : this.peerName || 'Crew', inputText);
      if (role === 'owner' && isStopTranslation(inputText)) this.stop('stop-phrase');
    }
    const outputText = serverContent.outputTranscript || serverContent.outputTranscription?.text || '';
    if (outputText) this.addLine(role === 'owner' ? 'Spanish' : 'English', outputText);
    const other = role === 'owner' ? 'peer' : 'owner';
    const parts = serverContent.modelTurn?.parts || [];
    for (const part of parts) {
      if (!part.inlineData?.mimeType?.startsWith('audio/')) continue;
      const mulaw = typeof options.geminiToTwilio === 'function'
        ? options.geminiToTwilio(part.inlineData.data)
        : part.inlineData.data;
      this.playTo(other, mulaw);
    }
    const toolEnvelope = data.toolCall || data.tool_call;
    if (toolEnvelope && role === 'owner') {
      const calls = toolEnvelope.functionCalls || toolEnvelope.function_calls || [];
      if (calls.some((call) => call.name === 'stop_live_translation')) this.stop('stop-tool');
    }
  }

  playTo(role, mulawB64) {
    const leg = this.legs[role];
    const sid = this.streamSid(role);
    if (!leg?.ws || !sid || !mulawB64) return;
    if (leg.ws.readyState !== undefined && leg.ws.readyState !== 1 && leg.ws.readyState !== leg.ws.OPEN) return;
    const frames = phoneLib().twilioOutboundMediaMessages(sid, mulawB64);
    for (const frame of frames) {
      try { leg.ws.send(JSON.stringify(frame)); } catch (e) { /* socket already closing */ }
    }
  }

  abandonOutbound() {
    if (this.stopped || this.bridgeStarted) return;
    this.stopped = true;
    this.clearAnswerTimer();
    sessions.delete(this.id);
    const sid = this.direction === 'crew_inbound' ? this.ownerCallSid : this.peerCallSid;
    if (this.direction === 'crew_inbound') {
      try { this.legs.peer?.ws?.close(); } catch (e) { /* crew leg already gone */ }
    }
    if (sid && typeof this.completeCall === 'function') {
      Promise.resolve(this.completeCall({ callSid: sid })).catch((err) => {
        console.warn('[LexiTranslate] unanswered leg complete failed:', err.message);
      });
    }
  }

  stop(reason) {
    if (this.stopped) return;
    this.stopped = true;
    this.clearAnswerTimer();
    sessions.delete(this.id);
    console.log('[LexiTranslate] stop', { reason: reason || '', sessionId: this.id });
    for (const role of ['owner', 'peer']) {
      try { this.geminis[role]?.ws?.close(); } catch (e) { /* already closed */ }
    }
    if (reason !== 'owner-hangup' && reason !== 'reset' && reason !== 'dial-failed') {
      try { this.legs.owner?.ws?.close(); } catch (e) { /* already closed */ }
    }
    if (reason !== 'reset' && reason !== 'dial-failed') {
      try { this.legs.peer?.ws?.close(); } catch (e) { /* already closed */ }
    }
    if (reason !== 'reset' && reason !== 'dial-failed') {
      this.saveTranscript().catch((err) => console.warn('[LexiTranslate] transcript save failed:', err.message));
    }
  }

  async saveTranscript() {
    const pool = this.bridgeOptions && (typeof this.bridgeOptions.pool === 'function'
      ? this.bridgeOptions.pool()
      : this.bridgeOptions.pool);
    if (!pool || !this.lines.length) return;
    const transcript = this.lines.map((line) => `${line.role}: ${line.text}`).join('\n');
    await phoneLib().saveCallTranscript({
      pool,
      owner: {
        companyId: this.companyId || this.owner.companyId,
        userEmail: this.owner.userEmail || '',
        name: this.owner.name || 'Kevin',
        phone: this.ownerPhone || this.owner.phone || '',
      },
      callSid: this.ownerCallSid || this.peerCallSid || '',
      transcript,
      actions: [{ type: 'live_translation', summary: `Translated with ${this.peerName || 'crew'}` }],
      summary: `Live translation with ${this.peerName || 'crew'}`,
      data: {
        channel: 'lexi_translate',
        peer_name: this.peerName || '',
        peer_phone: this.peerPhone || '',
        peer_call_sid: this.peerCallSid || '',
        owner_call_sid: this.ownerCallSid || '',
      },
    });
  }
}

async function prepareTranslation({ state, pool, owner, config, name }) {
  const spoken = String(name || '').trim();
  const companyId = owner?.companyId || config?.companyId || '';
  const found = await findTranslateCandidates({
    pool,
    companyId,
    spokenName: spoken,
    translateContacts: config?.translateContacts,
  });
  if (normalizeName(spoken).length < 2) {
    state.pendingTranslation = null;
    return {
      success: false,
      code: 'TRANSLATE_NO_MATCH',
      dialed: false,
      error: 'A translated call needs the person\'s name. Nothing was dialed.',
    };
  }
  const matches = found.matches.map((person) => ({
    ...person,
    name: displayName(person, spoken),
  }));
  if (matches.length > 1) {
    state.pendingTranslation = null;
    return {
      success: false,
      code: 'TRANSLATE_SEVERAL',
      dialed: false,
      error: `Several people match. ${matches.map((person) => describeMatch(person, spoken)).join('; ')}. Ask which one. Nothing was dialed.`,
    };
  }
  if (!matches.length) {
    state.pendingTranslation = null;
    return {
      success: false,
      code: 'TRANSLATE_NO_MATCH',
      dialed: false,
      error: `Nobody named ${spoken} is a subcontractor or staff member on this company, and the test list has no match. Ask which person. Nothing was dialed.`,
    };
  }
  const match = matches[0];
  state.pendingTranslation = {
    id: match.id,
    name: match.name,
    phone: match.phone,
    source: match.source,
  };
  if (state.actions) state.actions.push({ type: 'translate_prepare', summary: `${match.name} ${match.phone}` });
  return {
    success: true,
    dialed: false,
    name: match.name,
    phone: match.phone,
    source: match.source,
    message: `${match.name} at ${match.phone}, from the ${match.source}. Read that name and number back. Do not dial until Kevin says yes.`,
  };
}

function twilioCreds(ctx, config) {
  return {
    accountSid: ctx?.twilioAccountSid || config?.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || '',
    authToken: ctx?.twilioAuthToken || config?.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN || '',
  };
}

async function confirmTranslation({ state, pool, owner, config, ctx }) {
  const pending = state?.pendingTranslation;
  if (!pending?.phone) {
    return { success: false, code: 'NOTHING_TO_CALL', dialed: false, error: 'There is no call waiting to dial. Ask who to call.' };
  }
  if (!isExplicitTranslateConfirmation(state.latestUserText)) {
    return {
      success: false,
      code: 'CONFIRMATION_REQUIRED',
      dialed: false,
      error: 'Do not dial. Kevin has not said yes. Read the name and number back and wait.',
    };
  }
  const companyId = owner?.companyId || config?.companyId || '';
  const crm = await loadCompanyPeople(pool, companyId);
  const env = parseTranslateContacts(config?.translateContacts);
  const savedNumbers = dialablePhones(crm, env);
  const gate = dialGate({
    to: pending.phone,
    savedNumbers,
    config,
    env: process.env,
    fetchImpl: ctx?.fetchImpl,
  });
  if (!gate.allow) return gate.result;
  const host = ctx?.publicHost || config?.publicHost || '';
  const session = new TranslateSession({
    direction: 'owner_outbound',
    companyId,
    host,
    owner: owner || {},
    peerName: pending.name,
    peerPhone: gate.to,
    ownerPhone: owner?.phone || '',
    ownerCallSid: ctx?.callSid || '',
    answerTimeoutMs: ctx?.answerTimeoutMs,
    completeCall: ctx?.completeCall,
  });
  const twiml = peerNoticeTwiml(host, session.id);
  const creds = twilioCreds(ctx, config);
  let placed;
  try {
    placed = await placeTranslateCall({
      to: gate.to,
      from: toE164(config?.lexiNumber),
      twiml,
      accountSid: creds.accountSid,
      authToken: creds.authToken,
      fetchImpl: gate.fetchImpl,
    });
  } catch (err) {
    session.stop('dial-failed');
    return { success: false, dialed: false, error: 'The call was not placed. The number is still waiting.' };
  }
  if (!placed.success) {
    session.stop('dial-failed');
    return { success: false, dialed: false, error: placed.error || 'The call was not placed. The number is still waiting.' };
  }
  session.peerCallSid = placed.callSid || '';
  session.armAnswerTimer();
  state.pendingTranslation = null;
  if (typeof ctx?.armTranslation === 'function') ctx.armTranslation(session);
  if (state.actions) state.actions.push({ type: 'translate_dial', summary: `Calling ${pending.name}` });
  return {
    success: true,
    dialed: true,
    sessionId: session.id,
    to: gate.to,
    message: 'Say you are connecting him now. The call is recorded. He can say stop translating.',
  };
}

function stopTranslation({ state, ctx }) {
  if (state) state.pendingTranslation = null;
  const session = ctx?.translateSession || null;
  if (!session || session.stopped) {
    return { success: true, stopped: true, message: 'Nothing is being translated.' };
  }
  if (!session.bridgeStarted) {
    session.abandonOutbound();
    return { success: true, stopped: true, message: 'The outbound call was cancelled. Kevin stays on this call.' };
  }
  session.stop('stop-tool');
  return { success: true, stopped: true, message: 'Translation stopped and both legs are ending.' };
}

async function maybeCrewInbound({ from, host, callSid, config, pool, fetchImpl, twilioAccountSid, twilioAuthToken, completeCall, answerTimeoutMs }) {
  const contacts = parseTranslateContacts(config?.translateContacts);
  const companyId = config?.companyId || '';
  const canQuery = pool && typeof pool.query === 'function' && companyId;
  if (!canQuery && contacts.length === 0) return null;
  const match = await matchSavedCaller({
    pool: canQuery ? pool : null,
    companyId,
    from,
    translateContacts: config?.translateContacts,
  });
  if (!match) return null;
  const kevin = toE164((config?.allowlist || [])[0]);
  if (last10(kevin).length < 10) return null;
  const gate = dialGate({
    to: kevin,
    savedNumbers: [kevin],
    config,
    env: process.env,
    fetchImpl,
  });
  if (!gate.allow) return null;
  const session = new TranslateSession({
    direction: 'crew_inbound',
    companyId,
    host,
    owner: { companyId, name: config?.userName || 'Kevin', phone: kevin, userEmail: config?.userEmail || '' },
    peerName: match.name,
    peerPhone: match.phone,
    ownerPhone: kevin,
    peerCallSid: callSid || '',
    answerTimeoutMs,
    completeCall,
  });
  const creds = twilioCreds({ twilioAccountSid, twilioAuthToken }, config);
  let placed;
  try {
    placed = await placeTranslateCall({
      to: gate.to,
      from: toE164(config?.lexiNumber),
      twiml: ownerNoticeTwiml(host, session.id, match.name),
      accountSid: creds.accountSid,
      authToken: creds.authToken,
      fetchImpl: gate.fetchImpl,
    });
  } catch (err) {
    session.stop('dial-failed');
    return null;
  }
  if (!placed.success) {
    session.stop('dial-failed');
    return null;
  }
  session.ownerCallSid = placed.callSid || '';
  session.armAnswerTimer();
  return {
    status: 200,
    contentType: 'text/xml',
    body: peerNoticeTwiml(host, session.id),
    allowed: false,
    translating: true,
    sessionId: session.id,
  };
}

function isOpenSocket(ws) {
  return !!ws && (ws.readyState === 1 || ws.readyState === ws.OPEN);
}

function attachTranslateStream(twilioWs, options = {}) {
  const config = options.config || {};
  let role = '';
  let session = null;
  const converters = {
    WebSocket: options.WebSocket,
    geminiToTwilio: options.geminiToTwilio,
    twilioToGemini: options.twilioToGemini,
    geminiApiKey: options.geminiApiKey,
    recordCall: options.recordCall,
    pool: options.pool,
    completeCall: options.completeCall,
  };

  twilioWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.event === 'start') {
      const custom = msg.start?.customParameters || {};
      role = custom.role === 'owner' ? 'owner' : 'peer';
      session = getTranslateSession(custom.sessionId);
      if (!session || session.stopped) {
        try { twilioWs.close(); } catch (e) { /* unknown session */ }
        return;
      }
      if (custom.host) session.host = custom.host;
      const callSid = msg.start?.callSid || custom.callSid || '';
      session.bindLeg(role, {
        ws: twilioWs,
        streamSid: msg.start?.streamSid || '',
        callSid,
        role,
      });
      session.bridgeOptions = { ...(session.bridgeOptions || {}), ...converters };
      if (session.direction === 'crew_inbound' && session.legs.owner && session.legs.peer) {
        session.startBridge(session.bridgeOptions);
      }
      console.log('[LexiTranslate] stream start', { role, sessionId: session.id, callSid });
    } else if (msg.event === 'media' && session && role) {
      const payload = msg.media?.payload || '';
      if (!payload || typeof options.twilioToGemini !== 'function') return;
      session.ingest(role, options.twilioToGemini(payload));
    } else if (msg.event === 'stop' && session) {
      session.stop(role === 'owner' ? 'owner-hangup' : 'peer-hangup');
    }
  });
  twilioWs.on('close', () => {
    if (session && !session.stopped) session.stop(role === 'owner' ? 'owner-hangup' : 'peer-hangup');
  });
  twilioWs.on('error', (err) => console.error('[LexiTranslate] stream error:', err.message));
}

module.exports = {
  SPANISH_NOTICE,
  TRANSLATE_VAD,
  SUBCONTRACTOR_SQL,
  parseTranslateContacts,
  namesMatch,
  isExplicitTranslateConfirmation,
  isStopTranslation,
  translationEnabled,
  loadCompanyPeople,
  findTranslateCandidates,
  dialGate,
  buildStreamTwiml,
  peerNoticeTwiml,
  ownerNoticeTwiml,
  placeTranslateCall,
  prepareTranslation,
  confirmTranslation,
  stopTranslation,
  maybeCrewInbound,
  attachTranslateStream,
  resetTranslateSessions,
  getTranslateSession,
  TranslateSession,
};
