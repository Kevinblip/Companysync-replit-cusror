#!/usr/bin/env node
'use strict';
/**
 * Unit test for lib/geminiLiveProbe.cjs
 *
 * Tests the three key paths using a mock WebSocket factory — no live
 * server or real Gemini API key required:
 *
 *  A) Audio-send failure (synchronous throw) → probe returns ok:false,
 *     does NOT start the quiet-window timer.
 *
 *  B) Server closes the socket during the quiet window (e.g. 1007 on
 *     MIME rejection) → probe returns ok:false with the close code.
 *
 *  C) Quiet window passes without any error → probe returns ok:true.
 *
 * Usage:  node scripts/test-gemini-live-probe.cjs
 * Exit 0 = all tests passed; exit 1 = at least one failure.
 */

const { EventEmitter } = require('events');
const { probeGeminiLiveApi, normalizeRecipientEmails } = require('../lib/geminiLiveProbe.cjs');

let passed = 0;
let failed = 0;

function ok(name, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${extra !== undefined ? ` (got ${JSON.stringify(extra)})` : ''}`);
    failed++;
  }
}

// ── Mock WebSocket factory ────────────────────────────────────────────────
//
// Each test supplies a `behaviour` callback that receives the mock WS
// instance after construction and can drive it (fire 'open', deliver
// messages, emit 'close'/'error').
//
// The factory also exposes a static OPEN constant so the probe's
// "is the socket still open?" guard works correctly.

function makeMockWsClass(behaviour) {
  class MockWs extends EventEmitter {
    constructor(_url) {
      super();
      this.readyState = MockWs.OPEN;
      this._sent = [];
      // Drive the mock asynchronously so the probe's constructor can finish
      setImmediate(() => behaviour(this));
    }
    send(data) {
      if (this._throwOnSend) throw new Error(this._throwOnSend);
      this._sent.push(data);
    }
    close() {
      this.readyState = MockWs.CLOSED;
    }
  }
  MockWs.OPEN   = 1;
  MockWs.CLOSED = 3;
  return MockWs;
}

// ── Test A: synchronous audio-send failure ────────────────────────────────
async function testAudioSendFailure() {
  console.log('\nA) Audio-send synchronous failure → ok:false, no quiet-window timer');

  const WsClass = makeMockWsClass((ws) => {
    // Install the send override BEFORE emitting any events so it intercepts
    // all calls from the start (events are emitted synchronously below).
    let sendCount = 0;
    const origSend = ws.send.bind(ws);
    ws.send = (data) => {
      sendCount++;
      if (sendCount === 1) { origSend(data); return; }  // 1st call = setup msg — allow
      throw new Error('simulated audio-send error');     // 2nd call = audio frame — reject
    };
    // Fire 'open' → probe sends setup message (send call #1)
    ws.emit('open');
    // Deliver setupComplete → probe tries to send audio frame (send call #2, throws)
    ws.emit('message', Buffer.from(JSON.stringify({ setupComplete: true })));
  });

  // Timeout guard: probe should resolve quickly (no 4-second quiet window)
  const result = await Promise.race([
    probeGeminiLiveApi({ apiKey: 'fake-key', model: 'models/test', WebSocketClass: WsClass }),
    new Promise(r => setTimeout(() => r({ ok: 'TIMED_OUT' }), 2000)),
  ]);

  ok('result.ok is false',          result.ok === false, result.ok);
  ok('errorReason mentions send',   typeof result.errorReason === 'string' && result.errorReason.includes('send'), result.errorReason);
  ok('resolved before quiet window', result.ok !== 'TIMED_OUT');
}

// ── Test B: server closes during quiet window (1007 MIME rejection) ───────
async function testCloseInQuietWindow() {
  console.log('\nB) Server closes socket (1007) during quiet window → ok:false with code');

  const WsClass = makeMockWsClass((ws) => {
    ws.emit('open');
    // Deliver setupComplete so the probe sends the audio frame and starts timer
    ws.emit('message', Buffer.from(JSON.stringify({ setupComplete: true })));
    // Shortly after the probe starts the quiet window, server closes (1007)
    setTimeout(() => {
      ws.readyState = WsClass.CLOSED;
      ws.emit('close', 1007, Buffer.from('Unsupported Data'));
    }, 200);
  });

  const result = await probeGeminiLiveApi({ apiKey: 'fake-key', model: 'models/test', WebSocketClass: WsClass });

  ok('result.ok is false',           result.ok === false, result.ok);
  ok('closeCode is 1007',            result.closeCode === 1007, result.closeCode);
  ok('errorReason mentions close',   typeof result.errorReason === 'string' && result.errorReason.includes('1007'), result.errorReason);
}

// ── Test C: successful quiet-window completion ────────────────────────────
async function testSuccessfulProbe() {
  console.log('\nC) Quiet window passes without error → ok:true');

  const WsClass = makeMockWsClass((ws) => {
    ws.emit('open');
    // Deliver setupComplete; server then stays silent through the quiet window
    ws.emit('message', Buffer.from(JSON.stringify({ setupComplete: true })));
    // (No close or error emitted — server accepts the audio frame silently)
  });

  // The quiet window in tests should be short; override it via the same env
  // var the production probe uses — but since we can't shrink QUIET_WINDOW_MS
  // from outside, we just accept the ~4s wait for this path.
  const result = await probeGeminiLiveApi({ apiKey: 'fake-key', model: 'models/test', WebSocketClass: WsClass });

  ok('result.ok is true',            result.ok === true, result.ok);
  ok('no errorReason',               result.errorReason === null, result.errorReason);
  ok('latencyMs is positive number', typeof result.latencyMs === 'number' && result.latencyMs > 0, result.latencyMs);
}

// ── D: normalizeRecipientEmails helper ───────────────────────────────────
function testNormalizeRecipientEmails() {
  console.log('\nD) normalizeRecipientEmails — recipient selection edge cases');

  // More than 10 admins — all must be included (no LIMIT 10 cap)
  const manyRows = Array.from({ length: 15 }, (_, i) => ({
    user_email: `admin${i + 1}@example.com`,
    email: `backup${i + 1}@example.com`,
  }));
  const manyResult = normalizeRecipientEmails(manyRows);
  ok('>10 admins: all 15 included', manyResult.length === 15, manyResult.length);

  // Empty user_email should fall back to email column
  const emptyUserEmail = [{ user_email: '', email: 'fallback@example.com' }];
  const emptyResult = normalizeRecipientEmails(emptyUserEmail);
  ok('empty user_email falls back to email', emptyResult[0] === 'fallback@example.com', emptyResult[0]);

  // Whitespace-only user_email also falls back
  const wsUserEmail = [{ user_email: '   ', email: 'ws-fallback@example.com' }];
  const wsResult = normalizeRecipientEmails(wsUserEmail);
  ok('whitespace user_email falls back to email', wsResult[0] === 'ws-fallback@example.com', wsResult[0]);

  // Duplicates are removed
  const dupeRows = [
    { user_email: 'dup@example.com', email: '' },
    { user_email: 'dup@example.com', email: '' },
    { user_email: '', email: 'dup@example.com' },
  ];
  const dupeResult = normalizeRecipientEmails(dupeRows);
  ok('duplicates deduplicated', dupeResult.length === 1, dupeResult.length);

  // Both columns empty — row is excluded
  const bothEmpty = [{ user_email: '', email: '' }, { user_email: 'good@example.com', email: '' }];
  const bothResult = normalizeRecipientEmails(bothEmpty);
  ok('rows with both columns empty are excluded', bothResult.length === 1, bothResult.length);
}

// ── Run all tests ─────────────────────────────────────────────────────────
(async () => {
  console.log('[gemini-live-probe] Running probe unit tests...');
  try {
    await testAudioSendFailure();
    await testCloseInQuietWindow();
    await testSuccessfulProbe();
    testNormalizeRecipientEmails();
  } catch (e) {
    console.error('[gemini-live-probe] Unexpected test harness error:', e.message);
    process.exit(1);
  }

  console.log(`\n[gemini-live-probe] Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
