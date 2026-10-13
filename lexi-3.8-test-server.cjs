/**
 * Isolated Lexi Gemini 3.8 Live experiment.
 *
 * Run: node lexi-3.8-test-server.cjs --public-origin=https://your-test-host:port
 * Set the callback origin explicitly behind a proxy so Twilio signatures and
 * WSS URLs use the external host/port rather than proxy-internal headers.
 * Check: node lexi-3.8-test-server.cjs --self-test
 *
 * Public test server. No database, CRM, production handlers, outbound calls,
 * recordings, or changes to environment variables. The existing Gemini key
 * is read only when a test media session starts.
 *
 * Twilio voice requests require a valid signature from the configured account.
 * They mint short-lived, single-use media URLs; unauthenticated clients cannot
 * open Gemini sessions. Use a TEST-ONLY provider configuration, not an existing
 * production phone number. Vapi exposes only side-effect-free custom functions.
 *
 * Only custom function declarations are configured. Roofing supplement math
 * runs in this backend, not in a built-in code execution sandbox.
 * Failed sessions are visible; there is no silent model fallback.
 */
'use strict';

const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateRequest: validateTwilioRequest } = require('twilio');
const { WebSocket, WebSocketServer } = require('ws');

const HOST = '0.0.0.0';
const PORT = 5098;
const MODEL = 'models/gemini-3.8-live';
const MAX_BODY = 64 * 1024;
const SESSION_LIMIT_MS = 2 * 60 * 1000;
const GEMINI_SETUP_MS = 15000;
const MAX_QUEUED_PCM_BYTES = 16000 * 2 * (GEMINI_SETUP_MS / 1000);
const GEMINI_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const MOCKUP_DECLARATION = {
  name: 'generate_exterior_mockup',
  description: 'Test-only dummy exterior mockup. Returns choices; generates no image and changes no data.',
  parameters: {
    type: 'OBJECT',
    properties: {
      siding_color: { type: 'STRING' },
      stone_type: { type: 'STRING' },
      roof_color: { type: 'STRING' },
    },
    required: ['siding_color', 'stone_type', 'roof_color'],
  },
};

function generate_exterior_mockup(siding_color, stone_type, roof_color) {
  for (const value of [siding_color, stone_type, roof_color]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new Error('Each mockup choice must be a nonempty string of at most 200 characters.');
    }
  }
  return { test_only: true, generated: false, siding_color, stone_type, roof_color };
}

const SUPPLEMENT_DECLARATION = {
  name: 'calculate_roof_supplement',
  description: 'Calculate the signed roofing quantity difference new_sq minus old_sq. '
    + 'Inputs are roofing squares (100 square feet each), not square feet. '
    + 'Multiply the difference by $324.69 per square ($283.58 shingles + $41.11 felt). '
    + 'Return the dollar supplement formatted as USD; no tax, waste, or other items are included.',
  parameters: {
    type: 'OBJECT',
    properties: {
      old_sq: { type: 'NUMBER', description: 'Original nonnegative quantity in roofing squares.' },
      new_sq: { type: 'NUMBER', description: 'Revised nonnegative quantity in roofing squares.' },
    },
    required: ['old_sq', 'new_sq'],
  },
};

function calculate_roof_supplement(old_sq, new_sq) {
  for (const value of [old_sq, new_sq]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || value > Number.MAX_SAFE_INTEGER / 1000000) {
      throw new Error('old_sq and new_sq must be finite, nonnegative roofing-square quantities.');
    }
  }
  // Keep decimal subtraction from leaking floating-point noise into speech.
  const supplement_sq = Number((new_sq - old_sq).toFixed(6));
  // Fixed integer-cent rate, six-decimal quantities, half-away-from-zero rounding.
  const rawMicroCents = BigInt(Math.round(supplement_sq * 1000000)) * 32469n;
  const absMicroCents = rawMicroCents < 0n ? -rawMicroCents : rawMicroCents;
  const roundedCents = ((absMicroCents + 500000n) / 1000000n)
    * (rawMicroCents < 0n ? -1n : 1n);
  if (roundedCents > BigInt(Number.MAX_SAFE_INTEGER)
    || roundedCents < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Supplement exceeds the supported currency range.');
  }
  const supplement_amount = Number(roundedCents) / 100;
  return {
    test_only: true, old_sq, new_sq, supplement_sq,
    supplement_sqft: Number((supplement_sq * 100).toFixed(6)),
    currency: 'USD', rate_per_sq: 324.69,
    shingles_per_sq: 283.58, felt_per_sq: 41.11,
    supplement_amount,
    supplement_amount_formatted: new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
    }).format(supplement_amount),
  };
}

function buildSetup() {
  return {
    setup: {
      model: MODEL,
      generationConfig: { responseModalities: ['AUDIO'] },
      systemInstruction: {
        parts: [{
          text: 'You are Lexi in an isolated voice test. Speak briefly and naturally. '
            + 'You have no access to company records or production data. '
            + 'Exterior mockup results are dummy test results, not generated images. '
            + 'Use calculate_roof_supplement for roofing supplement math at the fixed '
            + '$324.69 per square shingles-and-felt rate. Ask for missing inputs, '
            + 'report the formatted dollar result, and do not add other costs. '
            + 'Never claim to have changed, saved, sent, or generated anything.',
        }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      tools: [
        { functionDeclarations: [MOCKUP_DECLARATION, SUPPLEMENT_DECLARATION] },
      ],
      // No thinkingLevel (unsupported by 3.8 Live) or speech-cutting token cap.
    },
  };
}

function invokeTestTool(name, args) {
  try {
    if (name === 'generate_exterior_mockup') {
      return generate_exterior_mockup(args?.siding_color, args?.stone_type, args?.roof_color);
    }
    if (name === 'calculate_roof_supplement') {
      return calculate_roof_supplement(args?.old_sq, args?.new_sq);
    }
    return { error: 'Unsupported tool. Only the mockup and roofing quantity calculator are available.' };
  } catch (error) {
    return { error: error.message };
  }
}

// Twilio uses G.711 mu-law at 8 kHz; Gemini consumes PCM16 little-endian.
function decodeMuLaw(byte) {
  const value = (~byte) & 0xff;
  const magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7);
  return (value & 128) ? 132 - magnitude : magnitude - 132;
}

function encodeMuLaw(sample) {
  const sign = sample < 0 ? 128 : 0;
  let magnitude = Math.min(Math.abs(sample), 32635) + 132;
  let exponent = 7;
  for (let mask = 0x4000; exponent > 0 && !(magnitude & mask); mask >>= 1) exponent--;
  return (~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 15))) & 0xff;
}

function twilioToPcm16(payload) {
  const input = Buffer.from(payload, 'base64');
  const output = Buffer.alloc(input.length * 4);
  for (let i = 0; i < input.length; i++) {
    const sample = decodeMuLaw(input[i]);
    const next = decodeMuLaw(input[Math.min(i + 1, input.length - 1)]);
    output.writeInt16LE(sample, i * 4);
    output.writeInt16LE(Math.round((sample + next) / 2), i * 4 + 2);
  }
  return output;
}

function pcm24ToTwilio(pcm) {
  if (pcm.length % 2) throw new Error('Invalid PCM16 byte count.');
  const output = Buffer.alloc(Math.floor(pcm.length / 6));
  for (let i = 0; i < output.length; i++) {
    const offset = i * 6;
    const average = Math.round(
      (pcm.readInt16LE(offset) + pcm.readInt16LE(offset + 2) + pcm.readInt16LE(offset + 4)) / 3,
    );
    output[i] = encodeMuLaw(average);
  }
  return output;
}

// ws supplies RawData, not a Fastify socket wrapper. Decode fragmented/binary
// representations as UTF-8 JSON; also support MessageEvent.data adapters.
function parseSocketMessage(raw) {
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)
    && !(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)
    && !Array.isArray(raw) && 'data' in raw) raw = raw.data;
  let text;
  if (typeof raw === 'string') text = raw;
  else if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
  else if (raw instanceof ArrayBuffer) text = Buffer.from(raw).toString('utf8');
  else if (ArrayBuffer.isView(raw)) {
    text = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
  } else if (Array.isArray(raw) && raw.every(Buffer.isBuffer)) {
    text = Buffer.concat(raw).toString('utf8');
  } else throw new Error('Unsupported WebSocket frame data.');
  const message = JSON.parse(text);
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('Expected a JSON event object.');
  }
  return message;
}

function decodeTwilioMedia(message, streamSid) {
  if (!streamSid || (message.streamSid && message.streamSid !== streamSid)) {
    throw new Error('Twilio media stream identity mismatch.');
  }
  // Bidirectional Streams receive inbound audio; never echo outbound tracks.
  if (message.media?.track && message.media.track !== 'inbound') return null;
  const payload = message.media?.payload;
  if (typeof payload !== 'string' || !payload.length || payload.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    throw new Error('Twilio media.payload must contain base64 mu-law audio.');
  }
  return twilioToPcm16(payload);
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Body exceeds 64 KiB.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  if (String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try { return JSON.parse(text); } catch {
    const error = new Error('Invalid JSON body.');
    error.status = 400;
    throw error;
  }
}

function createTestServer({
  apiKey = process.env.GOOGLE_GEMINI_API_KEY, connectGemini,
  twilioAuthToken = process.env.TWILIO_AUTH_TOKEN,
  twilioAccountSid = process.env.TWILIO_ACCOUNT_SID,
  publicUrl,
} = {}) {
  let activeSession = false;
  const mediaPermits = new Map();
  function prunePermits() {
    for (const [id, permit] of mediaPermits) {
      if (permit.expires <= Date.now()) mediaPermits.delete(id);
    }
  }
  function publicOrigin(req) {
    if (publicUrl) return new URL(publicUrl).origin;
    const configured = process.argv.find(arg => arg.startsWith('--public-origin='));
    if (configured) return new URL(configured.slice('--public-origin='.length)).origin;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    if (!['http', 'https'].includes(protocol)) throw new Error('Invalid request protocol.');
    return new URL(`${protocol}://${host}`).origin;
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  const server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
      if (req.method === 'GET' && path === '/health') {
        return json(res, 200, {
          test_only: true, model: MODEL, bind: HOST, active_session: activeSession,
          custom_functions: ['generate_exterior_mockup', 'calculate_roof_supplement'],
          voice_access: 'Signed Twilio account requests; single-use, short-lived media URLs',
          live_audio: 'Twilio media WebSocket: mu-law 8 kHz ↔ PCM16 16/24 kHz',
          vapi: 'Test events and custom tool calls only; not a Vapi Live audio transport',
        });
      }
      if (req.method !== 'POST') return json(res, 404, { error: 'Route not found.' });
      if (path !== '/twilio/voice' && path !== '/vapi/webhook') {
        return json(res, 404, { error: 'Route not found.' });
      }
      const body = await readBody(req);
      if (path === '/twilio/voice') {
        if (!twilioAuthToken || !twilioAccountSid) {
          return json(res, 503, { error: 'Test Twilio credentials are not configured.' });
        }
        const origin = publicOrigin(req);
        if (!validateTwilioRequest(twilioAuthToken, String(req.headers['x-twilio-signature'] || ''),
          origin + req.url, body) || body.AccountSid !== twilioAccountSid) {
          console.warn('[Lexi 3.8 Test] Twilio voice webhook rejected: signature/account mismatch.');
          return json(res, 403, { error: 'A signed request from the configured Twilio account is required.' });
        }
        if (typeof body.CallSid !== 'string' || !body.CallSid) {
          return json(res, 400, { error: 'Twilio CallSid is required.' });
        }
        if (!origin.startsWith('https://')) {
          return json(res, 400, { error: 'A public HTTPS webhook URL is required for Twilio WSS.' });
        }
        prunePermits();
        if (activeSession || mediaPermits.size >= 10) {
          return json(res, 429, { error: 'Isolated test session limit reached.' });
        }
        const permit = crypto.randomUUID();
        mediaPermits.set(permit, { expires: Date.now() + 120000, callSid: body.CallSid });
        const mediaUrl = `${origin.replace(/^https:/, 'wss:')}/twilio/media/${permit}`;
        console.log('[Lexi 3.8 Test] Twilio voice webhook accepted; single-use stream URL issued.');
        res.writeHead(200, { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' });
        return res.end('<?xml version="1.0" encoding="UTF-8"?>'
          + `<Response><Connect><Stream url="${mediaUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"/>`
          + '</Connect></Response>');
      }
      const message = body.message;
      if (!message || typeof message.type !== 'string') {
        return json(res, 400, { error: 'Expected a Vapi message with a type.' });
      }
      if (message.type === 'tool-calls') {
        const calls = message.toolCallList || message.toolCalls;
        if (!Array.isArray(calls) || calls.length > 10) {
          return json(res, 400, { error: 'Expected at most ten tool calls.' });
        }
        return json(res, 200, {
          results: calls.map(call => {
            const fn = call.function || call;
            let args = fn.arguments || {};
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch { args = {}; }
            }
            return { toolCallId: call.id, result: JSON.stringify(invokeTestTool(fn.name, args)) };
          }),
        });
      }
      if (['assistant-request', 'voice-request', 'transfer-destination-request',
        'knowledge-base-request'].includes(message.type)) {
        return json(res, 422, {
          error: 'This isolated Vapi endpoint handles test events and custom tool calls only. '
            + 'Use the Twilio media WebSocket for bidirectional Gemini Live audio.',
        });
      }
      return json(res, 200, { test_only: true, received: message.type });
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.message });
      else res.end();
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
    prunePermits();
    const match = /^\/twilio\/media\/([0-9a-f-]{36})$/.exec(path);
    const permit = match && mediaPermits.get(match[1]);
    // Reject browser-origin connections (including DNS-rebinding attempts).
    if (!permit || req.headers.origin || activeSession) {
      console.warn('[Lexi 3.8 Test] Twilio upgrade rejected: '
        + (!permit ? 'missing/expired stream permit.' : req.headers.origin
          ? 'browser-origin request.' : 'another test session is active.'));
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    mediaPermits.delete(match[1]);
    wss.handleUpgrade(req, socket, head, ws => {
      activeSession = true;
      ws.once('close', () => { activeSession = false; });
      wss.emit('connection', ws, permit);
    });
  });

  wss.on('connection', (twilioWs, permit) => {
    console.log('[Lexi 3.8 Test] Twilio WebSocket connected; awaiting connected/start events.');
    let geminiWs;
    let streamSid;
    let ready = false;
    let finished = false;
    let setupTimer;
    let pendingPcm = Buffer.alloc(0);
    let queuedPcmBytes = 0;
    let loggedMedia = false;
    const inputQueue = [];
    const lifetime = setTimeout(() => fail('Two-minute isolated test limit reached.'), SESSION_LIMIT_MS);
    const startTimer = setTimeout(() => fail('No Twilio start event received.'), 10000);
    const heartbeat = setInterval(() => {
      for (const ws of [twilioWs, geminiWs]) {
        if (ws?.readyState === WebSocket.OPEN) ws.ping();
      }
    }, 20000);

    function cleanup() {
      if (finished) return;
      finished = true;
      clearTimeout(lifetime);
      clearTimeout(startTimer);
      clearTimeout(setupTimer);
      clearInterval(heartbeat);
      inputQueue.length = 0;
      queuedPcmBytes = 0;
      if (geminiWs && geminiWs.readyState !== WebSocket.CLOSED) geminiWs.close();
    }
    function fail(message) {
      if (finished) return;
      console.error(`[Lexi 3.8 Test] ${message}`);
      // Twilio only accepts media/mark/clear JSON. Never send a test-error event
      // into a real call: the server log and close code carry diagnostics.
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.close(1011, 'Isolated Gemini test failed; see server log');
      }
      cleanup();
    }
    function sendAudio(pcm) {
      if (finished || geminiWs?.readyState !== WebSocket.OPEN) return;
      geminiWs.send(JSON.stringify({
        realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
      }));
    }
    function startGemini() {
      if (!apiKey && !connectGemini) return fail('GOOGLE_GEMINI_API_KEY is not configured.');
      geminiWs = connectGemini
        ? connectGemini()
        : new WebSocket(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, { handshakeTimeout: 10000 });
      setupTimer = setTimeout(() => fail('Gemini setup timed out.'), GEMINI_SETUP_MS);
      geminiWs.on('open', () => {
        if (!finished) geminiWs.send(JSON.stringify(buildSetup()));
      });
      geminiWs.on('error', () => fail('Gemini WebSocket connection error (credentials are not logged).'));
      geminiWs.on('close', (code, reason) => {
        let detail = String(reason || 'No provider reason supplied.');
        if (apiKey) detail = detail.split(apiKey).join('[REDACTED]');
        detail = detail.replace(/key=[^\s&]+/gi, 'key=[REDACTED]').slice(0, 500);
        if (!finished) fail(`Gemini closed with code ${code}: ${detail} No fallback used.`);
      });
      geminiWs.on('message', raw => {
        if (finished) return;
        try {
          const message = parseSocketMessage(raw);
          if (message.error) return fail('Gemini rejected the test configuration. Inspect model/tool support; no fallback used.');
          if (message.setupComplete) {
            clearTimeout(setupTimer);
            ready = true;
            console.log('[Lexi 3.8 Test] Gemini setup accepted.');
            for (const pcm of inputQueue.splice(0)) sendAudio(pcm);
            queuedPcmBytes = 0;
          }
          const content = message.serverContent;
          if (content?.interrupted) {
            pendingPcm = Buffer.alloc(0);
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid }));
          }
          for (const part of content?.modelTurn?.parts || []) {
            if (!part.inlineData?.data) continue;
            if (!/^audio\/pcm(?:;rate=24000)?$/.test(part.inlineData.mimeType || '')) {
              return fail('Unexpected Gemini output audio format.');
            }
            pendingPcm = Buffer.concat([pendingPcm, Buffer.from(part.inlineData.data, 'base64')]);
            const completeBytes = pendingPcm.length - (pendingPcm.length % 6);
            if (completeBytes) {
              const audio = pcm24ToTwilio(pendingPcm.subarray(0, completeBytes));
              pendingPcm = pendingPcm.subarray(completeBytes);
              twilioWs.send(JSON.stringify({
                event: 'media', streamSid, media: { payload: audio.toString('base64') },
              }));
            }
          }
          if (content?.turnComplete) pendingPcm = Buffer.alloc(0);
          if (message.toolCall?.functionCalls) {
            geminiWs.send(JSON.stringify({
              toolResponse: {
                functionResponses: message.toolCall.functionCalls.map(call => ({
                  id: call.id, name: call.name, response: invokeTestTool(call.name, call.args),
                })),
              },
            }));
          }
        } catch { fail('Invalid Gemini message or audio payload.'); }
      });
    }

    twilioWs.on('message', raw => {
      if (finished) return;
      try {
        const message = parseSocketMessage(raw);
        if (message.event === 'connected') {
          console.log('[Lexi 3.8 Test] Twilio connected event received.');
        } else if (message.event === 'start') {
          if (streamSid) return fail('Duplicate Twilio start event.');
          streamSid = message.start?.streamSid || message.streamSid;
          const format = message.start?.mediaFormat;
          if (typeof streamSid !== 'string' || !streamSid
            || message.start?.accountSid !== twilioAccountSid
            || message.start?.callSid !== permit.callSid
            || format?.encoding !== 'audio/x-mulaw' || Number(format?.sampleRate) !== 8000
            || Number(format?.channels) !== 1) return fail('Twilio start rejected: stream/call/account or mono mu-law 8 kHz format mismatch.');
          clearTimeout(startTimer);
          console.log('[Lexi 3.8 Test] Twilio start validated; opening Gemini Live session.');
          startGemini();
        } else if (message.event === 'media') {
          const pcm = decodeTwilioMedia(message, streamSid);
          if (!pcm) return;
          if (!loggedMedia) {
            console.log('[Lexi 3.8 Test] First inbound Twilio audio decoded successfully.');
            loggedMedia = true;
          }
          if (ready && geminiWs.readyState === WebSocket.OPEN) sendAudio(pcm);
          else {
            // Buffer through the complete setup deadline, not just 100 packets.
            // Bound memory and retain recent audio rather than ending a call.
            while (inputQueue.length && queuedPcmBytes + pcm.length > MAX_QUEUED_PCM_BYTES) {
              queuedPcmBytes -= inputQueue.shift().length;
            }
            if (pcm.length > MAX_QUEUED_PCM_BYTES) return fail('Twilio audio frame exceeds setup buffer size.');
            inputQueue.push(pcm);
            queuedPcmBytes += pcm.length;
          }
        } else if (message.event === 'stop') {
          console.log('[Lexi 3.8 Test] Twilio stop received; closing test session.');
          cleanup();
          twilioWs.close(1000);
        }
      } catch (error) {
        // Do not log raw JSON/audio, call metadata, or JSON.parse source excerpts.
        fail(error instanceof SyntaxError ? 'Twilio frame contains invalid JSON.'
          : 'Twilio frame decoding/handling failed.');
      }
    });
    twilioWs.on('error', () => {
      console.error('[Lexi 3.8 Test] Twilio WebSocket transport error.');
      cleanup();
    });
    twilioWs.on('close', code => {
      console.log(`[Lexi 3.8 Test] Twilio WebSocket closed with code ${code}.`);
      cleanup();
    });
  });

  return { server, wss };
}

async function bridgeSelfTest() {
  const origin = 'https://isolated-voice-test.example';
  const account = 'AC_TEST_FIXTURE';
  const auth = 'isolated-fixture-not-a-real-secret';
  const mockHttp = http.createServer();
  const mock = new WebSocketServer({ server: mockHttp });
  let client;
  let bridge;
  let audioCount = 0;
  let sawMedia = false;
  let sawClear = false;
  let sentFollowup = false;
  let complete;
  let rejectComplete;
  const completion = new Promise((resolve, reject) => {
    complete = resolve;
    rejectComplete = reject;
  });
  // Attach a handler immediately so an early network error is not unhandled.
  completion.catch(() => {});
  const timeout = setTimeout(() => rejectComplete(new Error('Media regression test timed out.')), 6000);
  mock.on('connection', ws => {
    ws.on('message', raw => {
      try {
        const message = parseSocketMessage(raw);
        if (message.setup) {
          // Force >100 packets to queue while setup is pending. Previously this
          // killed a real caller after only two seconds of 20-ms audio packets.
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ setupComplete: {} }));
          }, 250);
        }
        if (message.realtimeInput?.audio) {
          assert.equal(message.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
          const pcm = Buffer.from(message.realtimeInput.audio.data, 'base64');
          assert.equal(pcm.length, 640);
          assert.ok(pcm.every(byte => byte === 0));
          audioCount++;
          if (audioCount === 120) {
            ws.send(JSON.stringify({ serverContent: { modelTurn: { parts: [{
              inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(960).toString('base64') },
            }] } } }));
            ws.send(JSON.stringify({ serverContent: { interrupted: true, turnComplete: true } }));
          }
          if (audioCount === 121) {
            ws.send(JSON.stringify({ toolCall: { functionCalls: [{
              id: 'regression-math', name: 'calculate_roof_supplement',
              args: { old_sq: 20, new_sq: 25 },
            }] } }));
          }
        }
        if (message.toolResponse) {
          assert.equal(message.toolResponse.functionResponses[0].response.supplement_amount_formatted, '$1,623.45');
          complete();
        }
      } catch (error) { rejectComplete(error); }
    });
  });
  try {
    await new Promise(resolve => mockHttp.listen(0, '127.0.0.1', resolve));
    bridge = createTestServer({
      apiKey: '', twilioAccountSid: account, twilioAuthToken: auth, publicUrl: origin,
      connectGemini: () => new WebSocket(`ws://127.0.0.1:${mockHttp.address().port}`),
    });
    await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${bridge.server.address().port}`;
    const params = { AccountSid: account, CallSid: 'CA_TEST_FIXTURE' };
    const response = await fetch(`${base}/twilio/voice`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': require('twilio').getExpectedTwilioSignature(auth, `${origin}/twilio/voice`, params),
      },
      body: new URLSearchParams(params),
    });
    assert.equal(response.status, 200);
    const path = new URL((await response.text()).match(/url="([^"]+)"/)[1]).pathname;
    client = new WebSocket(`${base.replace('http:', 'ws:')}${path}`);
    client.on('error', rejectComplete);
    await new Promise((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    const streamSid = 'MZ_TEST_FIXTURE';
    const media = JSON.stringify({
      event: 'media', streamSid, sequenceNumber: '3',
      media: { track: 'inbound', chunk: '1', timestamp: '0', payload: Buffer.alloc(160, 255).toString('base64') },
    });
    client.on('message', raw => {
      try {
        const message = parseSocketMessage(raw);
        assert.ok(['media', 'clear'].includes(message.event), 'Only Twilio-supported frames may be sent.');
        assert.equal(message.streamSid, streamSid);
        if (message.event === 'media') {
          assert.equal(Buffer.from(message.media.payload, 'base64').length, 160);
          sawMedia = true;
        }
        if (message.event === 'clear') sawClear = true;
        if (sawMedia && sawClear && !sentFollowup) {
          sentFollowup = true;
          client.send(media);
        }
      } catch (error) { rejectComplete(error); }
    });
    client.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
    const start = JSON.stringify({
      event: 'start', sequenceNumber: '1', streamSid,
      start: { accountSid: account, callSid: params.CallSid, streamSid, tracks: ['inbound'],
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: '8000', channels: '1' } },
    });
    client.send(start.slice(0, 30), { fin: false });
    client.send(start.slice(30), { fin: true });
    for (let i = 0; i < 120; i++) client.send(Buffer.from(media), { binary: false });
    await completion;
    assert.equal(client.readyState, WebSocket.OPEN);
    assert.equal(audioCount, 121);
    const closed = new Promise(resolve => client.once('close', resolve));
    client.send(JSON.stringify({ event: 'stop', streamSid, stop: params }));
    assert.equal(await closed, 1000);
    assert.equal((await (await fetch(`${base}/health`)).json()).active_session, false);
    console.log('Twilio media regression passed: fragmented start, 120 queued frames, two-way audio, interruption, follow-up audio and tool response.');
  } finally {
    clearTimeout(timeout);
    client?.terminate();
    for (const ws of bridge?.wss.clients || []) ws.terminate();
    for (const ws of mock.clients) ws.terminate();
    bridge?.wss.close();
    mock.close();
    if (bridge?.server.listening) await new Promise(resolve => bridge.server.close(resolve));
    if (mockHttp.listening) await new Promise(resolve => mockHttp.close(resolve));
  }
}

async function selfTest() {
  assert.equal(buildSetup().setup.model, MODEL);
  assert.ok(!JSON.stringify(buildSetup()).includes('code_execution'));
  assert.ok(!JSON.stringify(buildSetup()).includes('codeExecution'));
  assert.equal(buildSetup().setup.tools[0].functionDeclarations[0].name, 'generate_exterior_mockup');
  assert.equal(buildSetup().setup.tools[0].functionDeclarations[1].name, 'calculate_roof_supplement');
  assert.equal(generate_exterior_mockup('blue', 'limestone', 'gray').generated, false);
  assert.ok(invokeTestTool('unknown', {}).error);
  assert.ok(invokeTestTool('generate_exterior_mockup', {}).error);
  assert.equal(calculate_roof_supplement(20, 25).supplement_sq, 5);
  assert.equal(calculate_roof_supplement(20, 25).supplement_sqft, 500);
  assert.equal(calculate_roof_supplement(20, 25).supplement_amount_formatted, '$1,623.45');
  assert.equal(calculate_roof_supplement(20, 20.5).supplement_amount_formatted, '$162.35');
  assert.equal(calculate_roof_supplement(20.5, 20).supplement_amount_formatted, '-$162.35');
  assert.equal(calculate_roof_supplement(0.1, 0.3).supplement_amount_formatted, '$64.94');
  assert.equal(calculate_roof_supplement(20, 20).supplement_amount_formatted, '$0.00');
  assert.equal(calculate_roof_supplement(0.1, 0.3).supplement_sq, 0.2);
  assert.equal(calculate_roof_supplement(25, 20).supplement_sq, -5);
  assert.equal(calculate_roof_supplement(20, 20).supplement_sq, 0);
  for (const value of [undefined, '20', null, NaN, Infinity, -1]) {
    assert.ok(invokeTestTool('calculate_roof_supplement', { old_sq: value, new_sq: 25 }).error);
    assert.ok(invokeTestTool('calculate_roof_supplement', { old_sq: 20, new_sq: value }).error);
  }
  const silence = Buffer.alloc(160, 255).toString('base64');
  assert.equal(twilioToPcm16(silence).length, 640);
  assert.ok(twilioToPcm16(silence).every(byte => byte === 0));
  assert.ok(pcm24ToTwilio(Buffer.alloc(960)).every(byte => byte === 255));
  for (const sample of [-20000, -1000, 0, 1000, 20000]) {
    assert.ok(Math.abs(decodeMuLaw(encodeMuLaw(sample)) - sample) <= Math.max(32, Math.abs(sample) * 0.04));
  }
  const text = '{"event":"connected"}';
  const bytes = Buffer.from(text);
  for (const raw of [text, bytes, new Uint8Array(bytes), Uint8Array.from(bytes).buffer,
    [bytes.subarray(0, 5), bytes.subarray(5)], { data: bytes }]) {
    assert.equal(parseSocketMessage(raw).event, 'connected');
  }
  assert.throws(() => parseSocketMessage('null'));
  assert.throws(() => parseSocketMessage('{broken'));
  assert.throws(() => decodeTwilioMedia({ media: { payload: 'not base64' } }, 'MZ_TEST'));
  assert.equal(decodeTwilioMedia({ media: { track: 'outbound' } }, 'MZ_TEST'), null);
  await bridgeSelfTest();
  console.log('Lexi 3.8 isolated self-tests passed (no API calls).');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    selfTest().catch(error => { console.error(error); process.exitCode = 1; });
  } else {
    const { server, wss } = createTestServer();
    server.listen(PORT, HOST, () => {
      console.log(`[Lexi 3.8 Test] http://${HOST}:${PORT}/health`);
      console.log(`[Lexi 3.8 Test] POST http://${HOST}:${PORT}/twilio/voice`);
      console.log(`[Lexi 3.8 Test] POST http://${HOST}:${PORT}/vapi/webhook`);
      console.log('[Lexi 3.8 Test] Public bind; signed Twilio voice access. No production routing or environment changes.');
    });
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    const stop = () => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  }
}

module.exports = {
  buildSetup, createTestServer, generate_exterior_mockup, calculate_roof_supplement,
  twilioToPcm16, pcm24ToTwilio,
  parseSocketMessage, decodeTwilioMedia,
};