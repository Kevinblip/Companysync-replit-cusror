// Drive Mode regression test: continuous hands-free Lexi voice sessions.
//
// Drive Mode is one LOGICAL session from the driver's point of view: they start
// it once, put the phone in a mount, and cannot tap the screen again. Two things
// must therefore hold:
//   1. silence must never end the session (the old 10s idle auto-stop is gone
//      for hands-free), and
//   2. an upstream Gemini drop must be repaired underneath without the browser
//      session dying — bounded, so a hard failure still surfaces.
//
// PART A drives real WebSocket connections against the running dev server.
// PART B asserts the dev bridge (vite-lexi-native-plugin.js) and the prod bridge
// (prod-server.cjs) still agree. These two files are edited independently and
// have silently drifted before, so lockstep is checked explicitly rather than
// assumed.
//
// Test sessions are minted directly in the sessions table (same HMAC signing as
// db/local-auth.cjs) and cleaned up at the end.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createPool } = require('./lib/db-pool.cjs');
const WebSocket = require('ws');

const BASE = process.env.TEST_BASE_WS || 'ws://localhost:5000';
const EMAIL = process.env.TEST_USER_EMAIL || 'stonekevin866@gmail.com';
const OWN_COMPANY = process.env.TEST_COMPANY_ID || 'loc_mmdvp1h5_e8i9eb';

// How long to stay silent while asserting the session survives. Comfortably
// past the 10s idle auto-stop that used to kill hands-free sessions.
const SILENCE_HOLD_MS = Number(process.env.DRIVE_MODE_SILENCE_MS || 24000);
const READY_TIMEOUT_MS = 30000;

const results = [];
function check(pass, label, detail) {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${label}${detail ? ` (${detail})` : ''}`);
}

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

function driveUrl(companyId, handsFree) {
  return `${BASE}/ws/lexi-native?companyId=${encodeURIComponent(companyId)}`
    + `&userEmail=${encodeURIComponent('someone.else@example.com')}`
    + `&userName=Test&voice=Kore&hands_free=${handsFree ? '1' : '0'}`;
}

// Opens a Drive Mode session, waits for 'ready', then holds silent.
function runDriveSession(cookie, companyId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(driveUrl(companyId, true), { headers: { Cookie: cookie } });
    const out = {
      ready: false,
      readyCount: 0,
      disconnectedWhileSilent: false,
      closedWhileSilent: false,
      closeCode: null,
      errors: [],
      survivedSilence: false,
      closedAfterStop: false,
    };
    let silenceTimer = null;
    let phase = 'connecting';

    const finish = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      // Explicit stop: the driver tapping the stop button.
      phase = 'stopping';
      const closeSeen = new Promise((r) => {
        ws.once('close', () => r(true));
        setTimeout(() => r(false), 5000);
      });
      ws.close();
      closeSeen.then((ok) => {
        out.closedAfterStop = ok;
        try { ws.terminate(); } catch {}
        resolve(out);
      });
    };

    const readyTimeout = setTimeout(() => {
      if (!out.ready) {
        out.errors.push('never reached ready');
        finish();
      }
    }, READY_TIMEOUT_MS);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'status' && msg.status === 'ready') {
        out.ready = true;
        out.readyCount++;
        clearTimeout(readyTimeout);
        if (phase === 'connecting') {
          phase = 'silent';
          silenceTimer = setTimeout(() => {
            out.survivedSilence = ws.readyState === WebSocket.OPEN && !out.disconnectedWhileSilent;
            finish();
          }, SILENCE_HOLD_MS);
        }
      }
      if (msg.type === 'status' && msg.status === 'disconnected' && phase === 'silent') {
        out.disconnectedWhileSilent = true;
      }
      if (msg.type === 'error') out.errors.push(msg.message);
    });

    ws.on('close', (code) => {
      out.closeCode = code;
      if (phase === 'silent') {
        out.closedWhileSilent = true;
        if (silenceTimer) clearTimeout(silenceTimer);
        clearTimeout(readyTimeout);
        resolve(out);
      }
    });
    ws.on('error', () => {});
  });
}

function rejectsWithoutCookie(companyId) {
  return new Promise((resolve) => {
    const ws = new WebSocket(driveUrl(companyId, true));
    let policyClosed = false;
    ws.on('close', (code) => { if (code === 1008) policyClosed = true; });
    ws.on('error', () => {});
    setTimeout(() => { try { ws.terminate(); } catch {} resolve(policyClosed); }, 8000);
  });
}

// ── PART B: dev/prod lockstep on the Drive Mode session invariants ──
function checkBridgeInvariants() {
  const root = path.resolve(__dirname, '..');
  const bridges = [
    ['dev bridge (vite-lexi-native-plugin.js)', fs.readFileSync(path.join(root, 'vite-lexi-native-plugin.js'), 'utf8')],
    ['prod bridge (prod-server.cjs)', fs.readFileSync(path.join(root, 'prod-server.cjs'), 'utf8')],
  ];

  for (const [label, src] of bridges) {
    // Gemini deprecated realtime_input.media_chunks; the camelCase audio form
    // is the only accepted shape and a regression here kills all voice input.
    check(/realtime_input:\s*\{\s*audio:/.test(src), `${label}: relays mic audio as realtime_input.audio`);
    check(!/media_chunks/.test(src), `${label}: no deprecated media_chunks payload`);
    check(/mimeType:\s*"audio\/pcm;rate=16000"/.test(src), `${label}: sends camelCase mimeType at 16kHz`);

    // Bounded reconnect keeps Drive Mode continuous without looping forever.
    check(/MAX_GEMINI_RECONNECTS/.test(src), `${label}: has a bounded Gemini reconnect cap`);
    check(/geminiReconnects\s*<\s*MAX_GEMINI_RECONNECTS/.test(src), `${label}: reconnect respects the cap`);
    check(/status:\s*'reconnecting'/.test(src), `${label}: tells the browser it is reconnecting`);

    // A stale setupComplete would relay audio into a half-open socket (1007).
    check(/setupComplete = false;/.test(src), `${label}: resets setupComplete around reconnect`);

    // An intentional browser hangup must not trigger a reconnect, and the
    // session must be billed/saved exactly once.
    check(/clientClosed = true;/.test(src), `${label}: marks intentional client close`);
    check(/if \(clientClosed/.test(src), `${label}: suppresses reconnect after client close`);
    check(/sessionSaved/.test(src), `${label}: saves/bills the session only once`);

    // A superseded socket must not tear down the live one, and an awaited tool
    // call must not deliver its response into the socket that replaced it.
    check(/geminiWs !== thisWs\) return;/.test(src), `${label}: ignores superseded Gemini sockets`);
    check(/discarding stale tool response/.test(src), `${label}: drops tool responses from a superseded socket`);
    // prod-server also has a separate phone bridge that legitimately uses its
    // own `geminiWs` variable. Assert the Lexi bridge's explicit socket binding
    // instead of treating an unrelated bridge as a Lexi regression.
    check(/thisWs\.send\(JSON\.stringify\(\{\s*tool_response/.test(src), `${label}: Lexi tool response is bound to its own socket`);

    // A stalled handshake must consume an attempt instead of hanging forever.
    check(/SETUP_TIMEOUT_MS/.test(src), `${label}: has a per-attempt setup watchdog`);
    check(/geminiWs !== thisWs \|\| setupComplete\) return;/.test(src), `${label}: watchdog is bound to its own socket`);

    // Exhausted reconnects must hand teardown back to the browser, and an
    // abandoned hands-free tab must not bill AI minutes forever.
    check(/clientWs\.close\(4001/.test(src), `${label}: closes the browser socket once reconnects are exhausted`);
    check(/MAX_IDLE_MS/.test(src), `${label}: caps a fully idle session`);
    check(/clientWs\.close\(4002/.test(src), `${label}: ends an abandoned session with the idle code`);
    check(/clearInterval\(idleTimer\)/.test(src), `${label}: clears the idle timer on client close`);
  }

  // The server's 15-minute cap, not the browser, owns idle teardown. A short
  // browser silence timer cuts off normal conversations and disguises the
  // resulting client close as an upstream Gemini failure.
  const client = fs.readFileSync(path.join(root, 'src/components/ai/GeminiLiveNativeClient.jsx'), 'utf8');
  check(!/Auto-stopping desktop session/.test(client), 'client: no short desktop silence auto-stop');
  check(!/lastActivityRef\.current > 10000/.test(client), 'client: no 10-second close threshold');
  check(/acquireWakeLock/.test(client), 'client: keeps the screen awake in Drive Mode');
  check(/driveMode/.test(client), 'client: exposes a forced Drive Mode entry point');
  check(/wakeLockPendingRef/.test(client), 'client: guards against concurrent wake-lock requests');
  check(/e\.code === 4002/.test(client), 'client: treats a server idle-close as a clean stop');
  check(/MAX_TOTAL_RECONNECTS/.test(client), 'client: has an absolute reconnect cap that ready does not reset');
  check(/window\.addEventListener\('offline'/.test(client), 'client: detects temporary network loss');
  check(/window\.addEventListener\('online'/.test(client), 'client: resumes after Wi-Fi/cellular recovery');
  check(/sessionRequestedRef/.test(client), 'client: tracks an explicitly requested voice session');
  check(/if \(!sessionRequestedRef\.current\) return;/.test(client), 'client: ignores offline events while idle');
  check(/sessionRequestedRef\.current && !intentionalStopRef\.current && !wsRef\.current/.test(client), 'client: only reconnects online for an active requested session');
  check(/e\.code === 4002\) \{\s*sessionRequestedRef\.current = false;/.test(client), 'client: prevents recovery after server idle teardown');
  check(/msg\.status === 'disconnected'[\s\S]{0,500}sessionRequestedRef\.current = false;/.test(client), 'client: clears recovery intent when the server announces terminal disconnect');
  check(/if \(e\.code === 4002\) \{\s*sessionRequestedRef\.current = false;[\s\S]{0,1000}replacementWs/.test(client), 'client: honors a late idle close after offline retirement');
  check(/scheduleReconnect/.test(client), 'client: centralizes bounded browser reconnect scheduling');
  check(/const staleWs = wsRef\.current/.test(client), 'client: retires a stranded socket when the network drops');
  check(/wsRef\.current !== ws \|\| sessionGeneration !== sessionGenerationRef\.current/.test(client), 'client: ignores stale socket terminal events');
  check(/handsFreeModeRef\.current && wsRef\.current && !intentionalStopRef\.current/.test(client), 'client: only restores wake lock for an active session');
  check(/MAX_AUDIO_QUEUE_CHUNKS/.test(client), 'client: bounds Bluetooth playback backlog');
  check(/Dropped stale playback chunk/.test(client), 'client: discards stale audio rather than adding drive-time latency');
  check(/sessionGenerationRef/.test(client), 'client: ignores audio from a superseded browser session');
  check(/const isCurrentSession/.test(client), 'client: treats async startup as cancellable');
  check(/if \(!isCurrentSession\(\)\) \{ abandonStartup\(\); return; \}/.test(client), 'client: abandons a stale startup after async work');
  check(/const captureStarted = await startAudioCapture/.test(client), 'client: verifies microphone startup belongs to the live socket');
  check(/await ensureAudioContextRunning\(\);\s*if \(sessionGeneration !== sessionGenerationRef\.current/.test(client), 'client: rechecks session identity after audio resume');
  check(/await new Promise\(resolve => setTimeout\(resolve, 150\)\);\s*if \(!isCurrentSession\(\)\)/.test(client), 'client: cancels a stale startup after audio unlock');
  check(/await base44\.entities\.StaffProfile\.filter\(\{ user_email: currentUser\.email \}\);\s*if \(!isCurrentSession\(\)\)/.test(client), 'client: cancels a stale startup after staff lookup');
  check(/aria-live="polite"/.test(client), 'client: announces microphone state changes accessibly');
  check(/driveMode \? 'w-24 h-24'/.test(client), 'client: uses a large Drive Mode microphone target');
}

async function main() {
  console.log('── PART B: dev/prod bridge lockstep ──');
  checkBridgeInvariants();

  console.log('\n── PART A: live Drive Mode session ──');
  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  const sid = 'testsid_' + crypto.randomBytes(12).toString('hex');
  const sess = { cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/' }, passport: { user: { claims: { email: EMAIL } } } };
  await pool.query(`INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`, [sid, JSON.stringify(sess)]);
  const cookie = 'connect.sid=' + encodeURIComponent(signSessionId(sid, process.env.SESSION_SECRET));

  try {
    check(await rejectsWithoutCookie(OWN_COMPANY), 'drive session with no login cookie is rejected (1008)');

    const s = await runDriveSession(cookie, OWN_COMPANY);
    check(s.ready, 'drive session reaches ready', s.errors.join('; ') || undefined);

    if (s.ready) {
      check(
        !s.closedWhileSilent && !s.disconnectedWhileSilent && s.survivedSilence,
        `session survives ${Math.round(SILENCE_HOLD_MS / 1000)}s of silence`,
        s.closedWhileSilent ? `closed with code ${s.closeCode}` : (s.disconnectedWhileSilent ? 'server sent disconnected' : undefined)
      );
      // A reconnect must not restart the session; exactly one ready per session.
      check(s.readyCount === 1, 'exactly one session established (no duplicate ready)', `readyCount=${s.readyCount}`);
      check(s.closedAfterStop, 'explicit stop closes the session');
    }
  } finally {
    await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]);
    await pool.end();
  }

  const failed = results.filter(r => !r).length;
  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`} (${results.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
