/**
 * Pure helpers for the Twilio ↔ Gemini phone receptionist.
 * Kept separate from prod-server.cjs so the turn-taking and status-callback
 * rules can be tested without a database or a live call.
 */

const MISSED_STATUSES = new Set(['no-answer', 'busy', 'failed', 'canceled', 'cancelled']);

function createVoiceTurnState() {
  return {
    awaitingCaller: false,
    turnText: '',
    pendingHangup: false,
    callerSaidGoodbye: false,
    appointmentBooked: false,
    collectedEmail: '',
    collectedPhone: '',
    callerId: '',
    callerIdOnFile: '',
    suppressModelAudio: false,
    didClearPromise: false,
    turnOpen: false,
    heardAssistantAudio: false,
    discardNextTurnComplete: false,
    lastTurnAsked: false,
  };
}

function confirmationFacts(state) {
  const email = state?.collectedEmail || '';
  const phoneDigits = String(state?.collectedPhone || '').replace(/\D/g, '');
  const booked = !!state?.appointmentBooked;
  return {
    appointmentBooked: booked,
    confirmationEmailAllowed: booked && email.includes('@'),
    confirmationSmsAllowed: booked && phoneDigits.length >= 10,
    callbackNumber: state?.collectedPhone || state?.callerIdOnFile || state?.callerId || '',
  };
}

function promisesDisallowedConfirmation(text, facts) {
  const t = String(text || '').toLowerCase();
  const emailPromise = /(confirmation email|email you (a |the )?confirmation|send you (a |an )?confirmation email|send you (an |a )?email)/.test(t);
  const smsPromise = /(confirmation text|confirmation sms|text you (a |the )?confirmation|send you (a |an )?(text|sms))/.test(t);
  if (emailPromise && !facts.confirmationEmailAllowed) return true;
  if (smsPromise && !facts.confirmationSmsAllowed) return true;
  return false;
}

function callerSaidGoodbye(text) {
  const t = String(text || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return /\b(goodbye|good bye|bye|bye bye|that'?s all|thats all|that is all|i'?m done|im done|i am done|gotta go|got to go|have a (good|nice) (day|night|one)|thanks bye|thank you bye)\b/.test(t);
}

function onAssistantTranscript(state, text) {
  const chunk = String(text || '').trim();
  if (!chunk) return { clearPlayback: false };
  state.turnOpen = true;
  state.turnText = state.turnText ? `${state.turnText} ${chunk}` : chunk;
  if (promisesDisallowedConfirmation(state.turnText, confirmationFacts(state))) {
    state.suppressModelAudio = true;
    const clearPlayback = !state.didClearPromise;
    state.didClearPromise = true;
    return { clearPlayback, suppress: true };
  }
  return { clearPlayback: false, suppress: false };
}

function onModelAudio(state) {
  if (state.awaitingCaller || state.suppressModelAudio) {
    const clearPlayback = state.suppressModelAudio && !state.didClearPromise;
    if (state.suppressModelAudio) state.didClearPromise = true;
    return { forward: false, clearPlayback };
  }
  state.turnOpen = true;
  state.heardAssistantAudio = true;
  return { forward: true, clearPlayback: false };
}

function onCallerTranscript(state, text) {
  state.awaitingCaller = false;
  state.suppressModelAudio = false;
  state.didClearPromise = false;
  const goodbye = callerSaidGoodbye(text);
  if (!goodbye) return { goodbye: false, clearPlayback: false, armHangup: false };
  if (state.callerSaidGoodbye) return { goodbye: true, clearPlayback: false, armHangup: false };
  state.callerSaidGoodbye = true;
  state.pendingHangup = true;
  state.heardAssistantAudio = false;
  if (state.turnOpen) state.discardNextTurnComplete = true;
  return { goodbye: true, clearPlayback: true, armHangup: true };
}

function onInterrupted(state) {
  state.awaitingCaller = false;
  state.suppressModelAudio = false;
  state.didClearPromise = false;
  return { clearPlayback: true };
}

function onTurnComplete(state) {
  const asked = /\?/.test(state.turnText || '');
  state.turnText = '';
  state.turnOpen = false;
  state.suppressModelAudio = false;
  state.lastTurnAsked = asked;
  if (state.discardNextTurnComplete) {
    state.discardNextTurnComplete = false;
    state.heardAssistantAudio = false;
    state.lastTurnAsked = false;
    return { sendHangupMark: false, awaitingCaller: state.awaitingCaller, asked: false };
  }
  if (asked && !state.pendingHangup) state.awaitingCaller = true;
  const sendHangupMark = !!(state.pendingHangup && state.heardAssistantAudio);
  return { sendHangupMark, awaitingCaller: state.awaitingCaller, asked };
}

function onEndCallTool(state) {
  state.pendingHangup = true;
  state.awaitingCaller = false;
  state.suppressModelAudio = false;
  // A question is not a closing line. Wait for the goodbye that follows the tool.
  const closingAlreadyAudible = !state.turnOpen && state.heardAssistantAudio && !state.lastTurnAsked && !state.discardNextTurnComplete;
  if (!state.turnOpen && !closingAlreadyAudible) state.heardAssistantAudio = false;
  return { armHangup: true, sendHangupMark: closingAlreadyAudible };
}

function prepareToolArgs(name, args, callerId) {
  const a = { ...(args || {}) };
  if (name !== 'save_lead_details' && name !== 'schedule_inspection' && name !== 'book_appointment') return a;
  const spoken = String(a.phone || a.customer_phone || '').trim();
  if (spoken) {
    a.phone_source = 'spoken';
    if (!a.phone) a.phone = spoken;
    return a;
  }
  if (callerId) {
    a.phone = callerId;
    if (name === 'schedule_inspection' && !a.customer_phone) a.customer_phone = callerId;
    a.phone_source = 'caller_id';
    return a;
  }
  a.phone_source = 'missing';
  return a;
}

function noteToolResult(state, name, args, result) {
  const a = args || {};
  const ok = !!(result && result.success === true);
  if (name === 'save_lead_details') {
    if (a.email && String(a.email).includes('@')) state.collectedEmail = String(a.email);
    if (a.phone_source === 'spoken' && a.phone) state.collectedPhone = String(a.phone);
    if (a.phone_source === 'caller_id' && a.phone) state.callerIdOnFile = String(a.phone);
  }
  if ((name === 'book_appointment' || name === 'schedule_inspection') && ok) {
    state.appointmentBooked = true;
    if (a.email && String(a.email).includes('@')) state.collectedEmail = String(a.email);
    const spokenPhone = a.phone_source === 'spoken' ? (a.phone || a.customer_phone) : '';
    if (spokenPhone) state.collectedPhone = String(spokenPhone);
    if (a.phone_source === 'caller_id' && a.phone) state.callerIdOnFile = String(a.phone);
  }
  if (name === 'end_call') onEndCallTool(state);
}

function enrichToolResponse(state, _name, result) {
  const base = (result && typeof result === 'object') ? { ...result } : { output: String(result) };
  const facts = confirmationFacts(state);
  base.call_facts = {
    appointment_booked: facts.appointmentBooked,
    confirmation_email_allowed: facts.confirmationEmailAllowed,
    confirmation_sms_allowed: facts.confirmationSmsAllowed,
    callback_number: facts.callbackNumber || null,
    caller_id: state.callerId || state.callerIdOnFile || null,
    instruction: 'Tell the caller this result in one short sentence. If you ask a question, stop and wait. Do not say you received information the caller did not say. Do not promise a confirmation email or text unless call_facts allows that channel.',
  };
  return base;
}

/** Only the tool result goes back to Gemini. Extra client_content turns make it keep talking. */
function buildGeminiToolMessage(functionResponses) {
  return { tool_response: { function_responses: functionResponses } };
}

function callerIdPrompt(callerPhone) {
  if (!callerPhone) return '';
  return `\n\nCALLER ID: This call is from ${callerPhone}. When you need a callback number, confirm the number they are calling from and wait for a yes or a different number. Do not read the digits back unless they ask. Do not say you already have a callback number until they confirm.`;
}

function classifyCallStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return 'ignore';
  if (MISSED_STATUSES.has(s)) return 'missed';
  if (s === 'completed') return 'completed';
  return 'ignore';
}

function parseTwilioBody(body, queryString) {
  const params = new URLSearchParams(body || '');
  const query = new URLSearchParams(queryString || '');
  const get = (key) => params.get(key) || query.get(key) || '';
  const callStatus = get('CallStatus');
  return {
    callStatus,
    kind: classifyCallStatus(callStatus),
    callerPhone: get('From') || get('Caller'),
    calledNumber: get('To') || get('Called'),
    callSid: get('CallSid'),
    callDuration: get('CallDuration') || get('Duration') || '',
    direction: get('Direction') || '',
  };
}

function readRequestBody(req, { timeoutMs = 2000, maxBytes = 1000000 } = {}) {
  return new Promise((resolve) => {
    if (!req || typeof req.on !== 'function') {
      resolve('');
      return;
    }
    let body = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(body), timeoutMs);
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) finish(body.slice(0, maxBytes));
    });
    req.on('end', () => finish(body));
    req.on('error', () => finish(body));
    req.on('aborted', () => finish(body));
  });
}

function safeWriteOk(res) {
  try {
    if (!res || res.writableEnded) return;
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('OK');
  } catch (e) {
    /* The proxy already dropped the socket. Twilio must not see a thrown 502. */
  }
}

/**
 * Ack Twilio immediately, then run missed-call / completed-call work.
 * A hung body read used to leave the request open until the proxy returned 502.
 */
async function handleMissedCallRequest(req, res, { queryString = '', processCall, timeoutMs = 2000 } = {}) {
  if (req.method === 'OPTIONS') {
    try {
      if (!res.headersSent) res.writeHead(204);
      res.end();
    } catch (e) { /* ignore */ }
    return;
  }
  // Attach the body listeners before acking. The 200 must not wait on the
  // body: Twilio warning 15003 was a proxy 502 while this route sat on readBody().
  const bodyPromise = readRequestBody(req, { timeoutMs });
  safeWriteOk(res);
  let body = '';
  try {
    body = await bodyPromise;
  } catch (e) {
    body = '';
  }
  const parsed = parseTwilioBody(body, queryString);
  if (typeof processCall === 'function') {
    try {
      await processCall(parsed);
    } catch (e) {
      console.error('[Sarah] status callback background error:', e && e.message ? e.message : e);
    }
  }
}

module.exports = {
  createVoiceTurnState,
  confirmationFacts,
  promisesDisallowedConfirmation,
  callerSaidGoodbye,
  onAssistantTranscript,
  onModelAudio,
  onCallerTranscript,
  onInterrupted,
  onTurnComplete,
  onEndCallTool,
  prepareToolArgs,
  noteToolResult,
  enrichToolResponse,
  buildGeminiToolMessage,
  callerIdPrompt,
  classifyCallStatus,
  parseTwilioBody,
  readRequestBody,
  handleMissedCallRequest,
};
