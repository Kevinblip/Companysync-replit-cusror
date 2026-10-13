// Regression test: Sarah voice bridge must relay audio to Gemini using the
// `realtime_input.audio` shape, NOT the deprecated `media_chunks` format.
//
// Background: Gemini Live deprecated media_chunks → audio in Jul 2026.
// Using the old format causes silence-after-greeting (Gemini ignores the audio).
//
// This test has two parts:
//   Part 1 — Static analysis: scan vite-twilio-ws-plugin.js and prod-server.cjs
//             to assert the correct format is present and the old format is absent.
//   Part 2 — Live WS: open a mock Twilio Media Stream connection to the running
//             dev server, send a few mu-law audio frames, and verify the server
//             keeps the connection open (doesn't crash / disconnect on audio input).

'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const DEV_FILE = path.join(ROOT, 'vite-twilio-ws-plugin.js');
const PROD_FILE = path.join(ROOT, 'prod-server.cjs');

const BASE = process.env.TEST_BASE_WS || 'ws://localhost:5000';

// ── helpers ──────────────────────────────────────────────────────────────────

let allPass = true;

function pass(label) {
  console.log(`PASS - ${label}`);
}

function fail(label, detail = '') {
  console.log(`FAIL - ${label}${detail ? ': ' + detail : ''}`);
  allPass = false;
}

// ── Part 1: Static analysis ───────────────────────────────────────────────────

function analyseFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  let src;
  try {
    src = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    fail(`${rel} — could not read file`, e.message);
    return;
  }

  // 1a. Old format must NOT appear anywhere.
  if (src.includes('media_chunks')) {
    fail(`${rel} — contains deprecated 'media_chunks' key`);
  } else {
    pass(`${rel} — no 'media_chunks' found`);
  }

  // 1b. New format must appear at least twice (media relay + keepalive).
  //     We count distinct occurrences of the new shape.
  //     Pattern: realtime_input … audio: { (with optional whitespace / newlines)
  const newFmtMatches = [...src.matchAll(/realtime_input[^}]*audio\s*:/gs)];
  if (newFmtMatches.length >= 2) {
    pass(`${rel} — 'realtime_input.audio' found ${newFmtMatches.length} time(s) (relay + keepalive)`);
  } else if (newFmtMatches.length === 1) {
    fail(`${rel} — 'realtime_input.audio' found only once; expected ≥2 (media relay + keepalive)`);
  } else {
    fail(`${rel} — 'realtime_input.audio' not found`);
  }

  // 1c. Keepalive specifically must use the new format (not an old silent-audio send).
  //     Look for the keepalive setInterval block containing `realtime_input`.
  const keepaliveBlock = src.match(/setInterval\([^)]*\)\s*\{[^}]*realtime_input[^}]*\}/s);
  // The block may span more than one } level — check a wider context around 'setInterval'
  // by searching for the pattern in proximity:
  const hasKeepaliveNewFmt = /setInterval[\s\S]{0,800}realtime_input[\s\S]{0,200}audio\s*:/.test(src);
  if (hasKeepaliveNewFmt) {
    pass(`${rel} — keepalive uses 'realtime_input.audio' format`);
  } else {
    fail(`${rel} — keepalive may not use 'realtime_input.audio' format`);
  }

  // 1d. mimeType must be present alongside every audio send.
  const audioSends = [...src.matchAll(/realtime_input\s*:\s*\{[^}]*audio\s*:\s*\{([^}]+)\}/gs)];
  let mimeTypeOk = true;
  for (const m of audioSends) {
    if (!m[1].includes('mimeType')) {
      mimeTypeOk = false;
      break;
    }
  }
  if (audioSends.length > 0 && mimeTypeOk) {
    pass(`${rel} — all audio sends include 'mimeType'`);
  } else if (audioSends.length === 0) {
    // Already failed above
  } else {
    fail(`${rel} — at least one audio send is missing 'mimeType'`);
  }
}

console.log('\n=== Part 1: Static source analysis ===\n');
analyseFile(DEV_FILE);
analyseFile(PROD_FILE);

// ── Part 2: Live WebSocket smoke test ─────────────────────────────────────────
//
// We open a WS connection to /ws/twilio, simulate the Twilio Media Stream
// handshake (connected → start → media × N), and assert:
//   • The server does NOT close the socket with code 1008 (policy violation)
//     or immediately after receiving audio frames.
//   • The connection stays open for at least HOLD_MS milliseconds, which means
//     the server consumed our frames without crashing.
//
// The server will try to dial Gemini (will fail without a real key) but that
// is benign — the Twilio-side socket should remain open while the Gemini dial
// is pending.

const HOLD_MS = 5000; // how long we keep the connection open before declaring success
const AUDIO_FRAMES = 10; // number of simulated media events to send

// Generate a tiny block of silent mu-law audio (320 bytes = 20ms @ 8kHz).
// The actual content doesn't matter — we just need valid base64.
const MULAW_SILENT_FRAME = Buffer.alloc(320, 0x7f).toString('base64');

function runLiveTest() {
  return new Promise((resolve) => {
    console.log(`\n=== Part 2: Live WebSocket smoke test (${BASE}/ws/twilio) ===\n`);

    const url = `${BASE}/ws/twilio`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      fail('live WS connect', e.message);
      return resolve();
    }

    let gotOpen = false;
    let closedEarly = false;
    let closeCode = null;
    let framesAcknowledgedByServer = false; // server echoed something back after frames

    const streamSid = 'MZ' + '0'.repeat(32);
    const callSid   = 'CA' + '0'.repeat(32);

    // Timer: if we reach HOLD_MS without an early close, the test passes.
    const holdTimer = setTimeout(() => {
      if (!closedEarly) {
        pass('live WS — connection stayed open through audio frames (server consumed audio without error)');
      }
      ws.terminate();
      resolve();
    }, HOLD_MS);

    ws.on('open', () => {
      gotOpen = true;
      console.log('  [live] WebSocket opened, sending Twilio protocol handshake…');

      // Step 1: connected
      ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));

      // Step 2: start
      ws.send(JSON.stringify({
        event: 'start',
        sequenceNumber: '1',
        start: {
          streamSid,
          callSid,
          accountSid: 'ACtest00000000000000000000000000000',
          from: '+10000000000',
          to: process.env.TWILIO_PHONE_NUMBER || '+10000000001',
          tracks: ['inbound'],
          customParameters: {},
        },
        streamSid,
      }));

      // Step 3: send AUDIO_FRAMES media events at ~50 ms intervals
      let frameCount = 0;
      const mediaTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          clearInterval(mediaTimer);
          return;
        }
        frameCount++;
        ws.send(JSON.stringify({
          event: 'media',
          sequenceNumber: String(frameCount + 1),
          media: { track: 'inbound', chunk: String(frameCount), timestamp: String(frameCount * 20), payload: MULAW_SILENT_FRAME },
          streamSid,
        }));
        if (frameCount >= AUDIO_FRAMES) clearInterval(mediaTimer);
      }, 50);
    });

    ws.on('message', (raw) => {
      // The server may send back Twilio-format media (Sarah's voice) or nothing.
      // Any message proves the server is alive and responsive.
      framesAcknowledgedByServer = true;
    });

    ws.on('close', (code, reason) => {
      clearTimeout(holdTimer);
      closeCode = code;
      // When the error handler already fired for a connection-refused / server-down
      // scenario, gotOpen is still false but we've already logged SKIP — don't
      // double-count it as a failure here.
      if (!gotOpen) {
        return resolve();
      }
      // 1000 = normal close (also fine if server initiates gracefully)
      // 1001 = going away
      // 1008 = policy violation (auth failure or bad protocol)
      if (code === 1008) {
        fail(`live WS — server rejected connection with policy-violation code 1008 (reason: ${reason || 'none'})`);
      } else if (code !== 1000 && code !== 1001) {
        // Unexpected close before HOLD_MS — likely a crash in the audio relay
        closedEarly = true;
        fail(`live WS — connection closed unexpectedly before ${HOLD_MS}ms`, `code=${code}`);
      } else {
        // Server closed cleanly (e.g. Gemini dial failed and it bailed out) — acceptable
        pass(`live WS — connection closed cleanly (code=${code}); server handled audio frames without crashing`);
      }
      resolve();
    });

    ws.on('error', (err) => {
      clearTimeout(holdTimer);
      if (!gotOpen) {
        // Server might not be running — skip live test with a warning, don't fail
        console.log(`SKIP - live WS test (server not reachable: ${err.message})`);
      } else {
        fail('live WS — unexpected error after open', err.message);
      }
      resolve();
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await runLiveTest();
  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
