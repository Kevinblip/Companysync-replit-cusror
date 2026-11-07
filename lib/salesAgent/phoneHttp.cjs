'use strict';

const {
  isColeNumber,
  phoneAllowed,
  signatureUrls,
  signatureValid,
  signatureRequired,
  streamHost,
  streamUrl,
  webhookBase,
  connectTwiml,
  politeTwiml,
  apologyTwiml,
  hangupTwiml,
  rejectTwiml,
  messageTwiml,
  emptyTwiml,
  MISSED_STATUSES,
  smsMaySend,
} = require('./phonePolicy.cjs');
const { update, id, readState } = require('./salesStore.cjs');
const callGate = require('./callGate.cjs');
const { replyToText, storeText, leadsForPhone } = require('./smsBrain.cjs');
const staging = require('../stagingSideEffects.cjs');

function parseForm(raw) {
  const params = {};
  const search = new URLSearchParams(raw || '');
  for (const [key, value] of search.entries()) params[key] = value;
  return params;
}

function readRaw(req, options) {
  if (options && options.rawBody != null) return Promise.resolve(String(options.rawBody));
  if (req && req.rawBody != null) return Promise.resolve(String(req.rawBody));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1000000) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendXml(res, status, xml) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/xml; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(xml);
}

function requestTrusted(req, params) {
  if (req && req.salesSignatureValid === true) return true;
  const token = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const signature = (req.headers && (req.headers['x-twilio-signature'] || req.headers['X-Twilio-Signature'])) || '';
  const urls = signatureUrls(req);
  if (signatureValid({ token, signature, params, urls })) return true;
  return !signatureRequired();
}

function isPhonePath(method, pathname) {
  if (method !== 'POST') return false;
  return pathname === '/api/sales-agent/voice'
    || pathname === '/api/sales-agent/voice-fallback'
    || pathname === '/api/sales-agent/sms'
    || pathname === '/api/sales-agent/status';
}

function storeCall(callSid) {
  if (!callSid) return null;
  try {
    return readState().calls.find((row) => row.callSid === callSid) || null;
  } catch (_) {
    return null;
  }
}

function noticeAlreadyPlayed(callSid) {
  if (callGate.alreadyNoticed(callSid)) return true;
  const call = storeCall(callSid);
  return !!(call && call.noticePlayed);
}

function callerHeardCole(callSid) {
  if (callGate.heardCole(callSid)) return true;
  const call = storeCall(callSid);
  if (!call) return false;
  if (call.agentSpoke) return true;
  return (call.transcript || []).some((line) => line.role === 'agent' && line.text);
}

async function rememberNotice(callSid, from, to) {
  callGate.markNotice(callSid);
  if (!callSid) return;
  try {
    await update((state) => {
      let call = state.calls.find((row) => row.callSid === callSid);
      if (!call) {
        call = {
          id: id('call'),
          channel: 'phone',
          callSid,
          from,
          to,
          leadId: null,
          startedAt: new Date().toISOString(),
          endedAt: null,
          transcript: [],
          clips: [],
          objections: [],
          outcome: '',
          synopsis: '',
          durationSec: 0,
          status: 'ringing',
          noticePlayed: true,
          streamStarted: false,
          agentSpoke: false,
        };
        state.calls.push(call);
        return;
      }
      call.noticePlayed = true;
      call.from = call.from || from;
      call.to = call.to || to;
    });
  } catch (err) {
    console.error('[sales-phone] could not record the notice:', err.message);
  }
}

function sendTerminal(res, callSid) {
  if (callerHeardCole(callSid)) {
    sendXml(res, 200, hangupTwiml());
    return;
  }
  if (callGate.claimApology(callSid)) {
    console.log('[sales-phone] stream failed, apologizing', { callSid: callSid || '' });
    sendXml(res, 200, apologyTwiml());
    return;
  }
  sendXml(res, 200, hangupTwiml());
}

async function handleVoice(req, res, options, params) {
  const from = params.From || params.Caller || '';
  const to = params.To || params.Called || '';
  if (to && !isColeNumber(to)) {
    sendXml(res, 200, politeTwiml());
    return;
  }
  if (!phoneAllowed(from)) {
    sendXml(res, 200, politeTwiml());
    return;
  }
  const callSid = params.CallSid || '';
  if (noticeAlreadyPlayed(callSid)) {
    console.log('[sales-phone] voice webhook repeated', { callSid });
    sendTerminal(res, callSid);
    return;
  }
  await rememberNotice(callSid, from, to || '');
  const base = webhookBase(req);
  const stream = streamUrl(req);
  console.log('[sales-phone] connecting stream', { callSid, streamHost: streamHost(req) });
  sendXml(res, 200, connectTwiml({
    stream,
    from,
    to: to || '',
    callSid,
    statusUrl: `${base}/api/sales-agent/status`,
    actionUrl: `${base}/api/sales-agent/voice-fallback`,
  }));
}

async function handleSms(req, res, options, params) {
  const from = params.From || '';
  const to = params.To || '';
  const body = params.Body || '';
  if (to && !isColeNumber(to)) {
    sendXml(res, 200, emptyTwiml());
    return;
  }
  const lead = leadsForPhone(from)[0];
  await storeText({
    leadId: lead && lead.id,
    direction: 'inbound',
    from,
    to,
    body,
    kind: 'sms_inbound',
  });
  const result = await replyToText({ from, body });
  if (!result.send || !result.reply) {
    if (staging.sideEffectsDisabled() || !phoneAllowed(from)) {
      staging.logSuppressed('sms', { to: from, reason: result.kind || 'allowlist' });
    }
    await storeText({
      leadId: lead && lead.id,
      direction: 'outbound',
      from: to,
      to: from,
      body: result.reply || '',
      kind: result.kind || 'sms_reply',
      skipped: true,
      suppressed: true,
      reason: phoneAllowed(from) ? 'no_reply' : 'allowlist',
    });
    sendXml(res, 200, emptyTwiml());
    return;
  }
  const decision = smsMaySend(from);
  if (!decision.allow) {
    if (decision.reason === 'staging') staging.logSuppressed('sms', { to: from, reason: 'staging' });
    await storeText({
      leadId: lead && lead.id,
      direction: 'outbound',
      from: to,
      to: from,
      body: result.reply,
      kind: result.kind,
      skipped: decision.reason === 'allowlist',
      suppressed: true,
      reason: decision.reason,
    });
    sendXml(res, 200, emptyTwiml());
    return;
  }
  await storeText({
    leadId: lead && lead.id,
    direction: 'outbound',
    from: to,
    to: from,
    body: result.reply,
    kind: result.kind,
    suppressed: false,
  });
  sendXml(res, 200, messageTwiml(result.reply));
}

async function handleStatus(req, res, options, params) {
  const to = params.To || params.Called || '';
  if (to && !isColeNumber(to)) {
    sendXml(res, 200, emptyTwiml());
    return;
  }
  const callSid = params.CallSid || '';
  const status = String(params.CallStatus || params.StreamEvent || '').toLowerCase();
  const from = params.From || params.Caller || '';
  const missed = MISSED_STATUSES.has(status);
  await update((state) => {
    let call = state.calls.find((row) => row.callSid && row.callSid === callSid);
    if (!call) {
      call = {
        id: id('call'),
        channel: 'phone',
        callSid,
        from,
        to,
        leadId: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
        transcript: [],
        clips: [],
        objections: [],
        outcome: '',
        synopsis: '',
        durationSec: 0,
        status: '',
      };
      state.calls.push(call);
    }
    call.status = status || call.status;
    call.from = call.from || from;
    call.to = call.to || to;
    if (params.CallDuration) call.durationSec = Number(params.CallDuration) || call.durationSec;
    if (missed) {
      call.outcome = call.outcome || 'missed';
      call.endedAt = call.endedAt || new Date().toISOString();
      state.notifications.push({
        id: id('note'),
        at: new Date().toISOString(),
        kind: 'missed_call',
        title: `Missed Cole call from ${from || 'unknown'}`,
        body: `Call ${callSid || '(no sid)'} ended ${status}. No marketing text was sent.`,
        leadId: call.leadId,
      });
    } else if (status === 'completed') {
      call.outcome = call.outcome || 'completed';
      call.endedAt = call.endedAt || new Date().toISOString();
    }
  });
  sendXml(res, 200, emptyTwiml());
}

async function handlePhoneRequest(req, res, options = {}) {
  const url = new URL(req.url || '/api/sales-agent/voice', 'http://localhost');
  const pathname = options.pathname || url.pathname;
  try {
    const raw = await readRaw(req, options);
    const params = parseForm(raw);
    if (!requestTrusted(req, params)) {
      sendXml(res, 403, rejectTwiml());
      return true;
    }
    if (pathname === '/api/sales-agent/voice') await handleVoice(req, res, options, params);
    else if (pathname === '/api/sales-agent/voice-fallback') sendTerminal(res, params.CallSid || '');
    else if (pathname === '/api/sales-agent/sms') await handleSms(req, res, options, params);
    else await handleStatus(req, res, options, params);
    return true;
  } catch (err) {
    if (!res.headersSent) sendXml(res, err.status || 500, politeTwiml());
    return true;
  }
}

module.exports = {
  isPhonePath,
  handlePhoneRequest,
  isColeCalledNumber: isColeNumber,
  parseForm,
};
