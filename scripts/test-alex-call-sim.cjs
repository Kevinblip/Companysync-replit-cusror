#!/usr/bin/env node
/**
 * Alex voice-call simulator.
 *
 * Drives the REAL Twilio media-stream bridge (/ws/twilio) exactly the way
 * Twilio does: `connected` -> `start` -> N x `media` (8kHz mu-law) -> `stop`.
 * Caller speech is synthesized with OpenAI TTS and transcoded to mu-law by
 * ffmpeg, so Gemini's VAD and transcription see genuine audio.
 *
 * What it proves that a unit test cannot:
 *   - Alex actually answers and greets
 *   - her turn-taking works against real barge-in/VAD timing
 *   - which TOOLS she really invokes, with which arguments
 *   - what side effects land in the database
 *
 * Usage:
 *   node scripts/test-alex-call-sim.cjs                  # run all scenarios
 *   node scripts/test-alex-call-sim.cjs inspection       # run one
 *   node scripts/test-alex-call-sim.cjs --list
 *
 * Env:
 *   BASE_WS       default ws://127.0.0.1:5000
 *   TEST_COMPANY  default companysync_master_001  (owner of +1 216-777-7154)
 *   CALLER_PHONE  default +12165550137
 */

const WebSocket = require('ws');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPool } = require('./lib/db-pool.cjs');

const BASE_WS = process.env.BASE_WS || 'ws://127.0.0.1:5000';
const COMPANY_ID = process.env.TEST_COMPANY || 'companysync_master_001';
const CALLER_PHONE = process.env.CALLER_PHONE || '+12165550137';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Alex is done talking once she stops emitting media frames for this long.
const SILENCE_END_MS = 1500;
// Hard ceiling on any single Alex turn, so a runaway monologue can't hang us.
const MAX_TURN_MS = 30000;
// How long to wait for her opening greeting before giving up on the call.
const GREETING_TIMEOUT_MS = 25000;

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'alexsim-'));

// ── caller speech synthesis ───────────────────────────────────────────────────

const ttsCache = new Map();

async function synthMulaw(text) {
  if (ttsCache.has(text)) return ttsCache.get(text);
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY required to synthesize caller speech');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      voice: 'onyx',
      input: text,
      response_format: 'wav',
      speed: 1.0,
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const wavPath = path.join(TMP, `t${ttsCache.size}.wav`);
  const ulawPath = path.join(TMP, `t${ttsCache.size}.ulaw`);
  fs.writeFileSync(wavPath, Buffer.from(await res.arrayBuffer()));
  // Twilio media streams are 8 kHz mono G.711 mu-law.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath,
    '-ar', '8000', '-ac', '1', '-f', 'mulaw', ulawPath]);

  const buf = fs.readFileSync(ulawPath);
  ttsCache.set(text, buf);
  return buf;
}

// ── the simulated call ────────────────────────────────────────────────────────

function runCall(scenario) {
  return new Promise(async (resolve) => {
    const streamSid = 'MZ' + Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);
    const callSid = 'CA' + Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);

    const result = {
      scenario: scenario.name,
      callSid,
      alexTurns: 0,
      callerTurns: 0,
      answered: false,
      errors: [],
      closeCode: null,
      transcript: null,
      tools: null,
    };

    let ws;
    try {
      ws = new WebSocket(`${BASE_WS}/ws/twilio`);
    } catch (e) {
      result.errors.push(`connect: ${e.message}`);
      return resolve(result);
    }

    let lastAudioAt = 0;
    let sawAudio = false;
    let seq = 1;
    let finished = false;
    // A real phone line never goes silent: Twilio streams 20ms frames for the
    // whole call. We mimic that with a continuous pump so Gemini's VAD sees an
    // unbroken stream — a gap is not a realistic test condition.
    let pump = null;
    let pending = Buffer.alloc(0);

    const finish = (why) => {
      if (finished) return;
      finished = true;
      if (pump) clearInterval(pump);
      if (why) result.errors.push(why);
      try { ws.send(JSON.stringify({ event: 'stop', streamSid, sequenceNumber: String(++seq) })); } catch (_) {}
      // Give the bridge a moment to flush its call log before we hang up.
      setTimeout(() => { try { ws.close(); } catch (_) {} }, 1500);
      setTimeout(() => resolve(result), 3000);
    };

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      if (msg.event === 'media' && msg.media?.payload) {
        lastAudioAt = Date.now();
        if (!sawAudio) { sawAudio = true; result.answered = true; }
      }
    });

    ws.on('error', (e) => { result.errors.push(`ws: ${e.message}`); });
    ws.on('close', (code) => { result.closeCode = code; if (!finished) { finished = true; resolve(result); } });

    const FRAME = 160; // 20 ms @ 8 kHz mu-law
    const SILENCE = Buffer.alloc(FRAME, 0xff);

    // Continuous outbound pump: speech when we have it, comfort silence when we
    // don't. Started at `start` and never stopped until the call ends.
    const startPump = () => {
      pump = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        let chunk;
        if (pending.length >= FRAME) {
          chunk = pending.subarray(0, FRAME);
          pending = pending.subarray(FRAME);
        } else if (pending.length > 0) {
          chunk = Buffer.concat([pending, SILENCE.subarray(0, FRAME - pending.length)]);
          pending = Buffer.alloc(0);
        } else {
          chunk = SILENCE;
        }
        ws.send(JSON.stringify({
          event: 'media',
          sequenceNumber: String(++seq),
          streamSid,
          media: { track: 'inbound', chunk: String(seq), timestamp: String(seq * 20), payload: chunk.toString('base64') },
        }));
      }, 20);
    };

    // Wait for Alex to actually START talking, then for her to finish.
    const waitForAlexTurn = (timeoutMs) => new Promise((res) => {
      const started = Date.now();
      const iv = setInterval(() => {
        const now = Date.now();
        const spokeThisTurn = lastAudioAt > started;
        if (spokeThisTurn && now - lastAudioAt > SILENCE_END_MS) { clearInterval(iv); return res(true); }
        if (now - started > timeoutMs) { clearInterval(iv); return res(false); }
      }, 100);
    });

    // Queue an utterance and wait until it has been fully streamed out.
    const speak = async (text) => {
      const audio = await synthMulaw(text);
      pending = Buffer.concat([pending, audio]);
      while (pending.length > 0 && ws.readyState === WebSocket.OPEN) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return ws.readyState === WebSocket.OPEN;
    };

    ws.on('open', async () => {
      try {
        ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
        ws.send(JSON.stringify({
          event: 'start',
          sequenceNumber: String(seq),
          streamSid,
          start: {
            streamSid,
            callSid,
            accountSid: process.env.TWILIO_ACCOUNT_SID || 'ACtest',
            from: CALLER_PHONE,
            to: '+12167777154',
            tracks: ['inbound'],
            customParameters: {
              companyId: COMPANY_ID,
              callerPhone: CALLER_PHONE,
              calledNumber: '+12167777154',
              callRoutingMode: scenario.routingMode || 'sarah_answers',
              maxCallDuration: '300',
              ...(scenario.customParams || {}),
            },
          },
        }));

        // Keep an unbroken 20ms inbound stream for the whole call, exactly as
        // Twilio does. Without this the line "goes dead" between turns and
        // Gemini's VAD never re-arms.
        startPump();

        // 1) Her greeting.
        const greeted = await waitForAlexTurn(GREETING_TIMEOUT_MS);
        if (!greeted) return finish('Alex never spoke a greeting');
        result.alexTurns++;

        // 2) Walk the scripted caller turns.
        for (const line of scenario.turns) {
          if (ws.readyState !== WebSocket.OPEN) break;
          const ok = await speak(line);
          if (!ok) break;
          result.callerTurns++;
          const replied = await waitForAlexTurn(MAX_TURN_MS);
          if (replied) result.alexTurns++;
          else result.errors.push(`no reply after: "${line.slice(0, 50)}"`);
        }

        finish(null);
      } catch (e) {
        finish(`driver: ${e.message}`);
      }
    });
  });
}

// ── scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'inspection',
    title: 'Storm-damage caller wants a roof inspection scheduled',
    expectTools: ['schedule_inspection', 'save_lead_details', 'check_availability', 'book_appointment'],
    turns: [
      "Hi, my roof got hit pretty hard in the storm last week and I think I need someone to come look at it.",
      "My name is Daniel Reyes, and the address is 4820 Bridgeview Road, Cleveland Ohio.",
      "Thursday afternoon would work great for me. My number is two one six, five five five, zero one three seven.",
    ],
  },
  {
    name: 'transfer',
    title: 'Caller insists on speaking to a human right now',
    expectTools: ['transfer_call', 'save_lead_details', 'notify_rep'],
    turns: [
      "I don't want to talk to a robot. Can you put me through to an actual person please?",
      "This is Marcus Webb, my callback number is two one six, five five five, zero one three seven.",
      "It's about a bill I was charged twice for. I need to speak to somebody in the office.",
    ],
  },
  {
    name: 'appointment',
    title: 'Caller asks what times are open and books one',
    expectTools: ['check_availability', 'book_appointment'],
    turns: [
      "Hi there, I'd like to set up an estimate appointment. What do you have open this week?",
      "That works. Let's do it. My name is Angela Foster.",
      "My email is angela dot foster at example dot com.",
    ],
  },
  {
    name: 'urgent_leak',
    title: 'Active leak — should escalate, not just take a message',
    expectTools: ['send_alert', 'notify_rep', 'save_lead_details'],
    turns: [
      "I have water pouring through my ceiling right now, this is an emergency!",
      "It's Tom Bradley at 1190 Elmwood Avenue. Water is coming into the living room.",
      "How fast can somebody actually get out here?",
    ],
  },
  {
    name: 'price_shopper',
    title: 'General pricing question from a tire-kicker',
    expectTools: ['save_lead_details'],
    turns: [
      "How much do you guys usually charge for a full roof replacement?",
      "It's a pretty normal two story house, maybe two thousand square feet.",
      "Okay, I'm just gathering quotes right now. Thanks.",
    ],
  },
  {
    name: 'message',
    title: 'Caller wants to leave a message for a specific rep',
    expectTools: ['save_lead_details', 'notify_rep'],
    turns: [
      "Is Kevin available? I've been trying to reach him.",
      "Can you just take a message then? Tell him Rachel Lindt called about the Maple Street job.",
      "He can reach me at two one six, five five five, zero one three seven. Thanks.",
    ],
  },
];

// ── post-call inspection ──────────────────────────────────────────────────────

async function readCallRecord(pool, callSid) {
  const { rows } = await pool.query(
    `SELECT duration_minutes, status, data
       FROM communications
      WHERE data->>'call_sid' = $1
      ORDER BY created_at DESC LIMIT 1`,
    [callSid]
  );
  if (!rows.length) return null;
  const d = rows[0].data || {};
  return {
    status: rows[0].status,
    durationMin: rows[0].duration_minutes,
    transcript: d.transcript || d.transcription || '',
    tools: d.tool_calls_made || [],
  };
}

(async () => {
  const arg = process.argv[2];
  if (arg === '--list') {
    for (const s of SCENARIOS) console.log(`${s.name.padEnd(14)} ${s.title}`);
    process.exit(0);
  }
  const chosen = arg ? SCENARIOS.filter((s) => s.name === arg) : SCENARIOS;
  if (!chosen.length) {
    console.error(`Unknown scenario "${arg}". Use --list.`);
    process.exit(1);
  }

  const pool = createPool({ connectionString: process.env.DATABASE_URL });
  const summary = [];

  for (const sc of chosen) {
    console.log(`\n${'='.repeat(78)}\n▶ ${sc.name} — ${sc.title}\n${'='.repeat(78)}`);
    let r;
    try {
      r = await runCall(sc);
    } catch (e) {
      console.log(`  DRIVER CRASH: ${e.message}`);
      summary.push({ name: sc.name, answered: false, tools: [], missing: sc.expectTools, errors: [e.message] });
      continue;
    }

    // Let the bridge finish persisting.
    await new Promise((r2) => setTimeout(r2, 2500));
    let rec = null;
    try { rec = await readCallRecord(pool, r.callSid); } catch (e) { r.errors.push(`db: ${e.message}`); }

    console.log(`  answered:      ${r.answered ? 'YES' : 'NO'}`);
    console.log(`  alex turns:    ${r.alexTurns}   caller turns: ${r.callerTurns}`);
    console.log(`  ws close code: ${r.closeCode}`);
    if (r.errors.length) console.log(`  errors:        ${r.errors.join(' | ')}`);

    const tools = rec?.tools || [];
    if (rec) {
      console.log(`  duration:      ${rec.durationMin} min   status: ${rec.status}`);
      console.log(`  tools fired:   ${tools.length ? tools.join(', ') : '(none)'}`);
      if (rec.transcript) {
        console.log('  --- transcript ---');
        for (const line of String(rec.transcript).split('\n')) {
          if (line.trim()) console.log(`    ${line}`);
        }
      }
    } else {
      console.log('  !! no communications row was written for this call');
    }

    const missing = sc.expectTools.filter((t) => !tools.includes(t));
    summary.push({ name: sc.name, answered: r.answered, tools, missing, errors: r.errors, hasRecord: !!rec });
  }

  console.log(`\n\n${'#'.repeat(78)}\n# SUMMARY\n${'#'.repeat(78)}`);
  for (const s of summary) {
    const flag = !s.answered ? 'DID NOT ANSWER'
      : !s.hasRecord ? 'NO CALL RECORD'
      : s.tools.length === 0 ? 'NO TOOLS FIRED'
      : 'ok';
    console.log(`${s.name.padEnd(14)} ${String(flag).padEnd(16)} fired=[${s.tools.join(',')}]`);
    if (s.errors?.length) console.log(`${''.padEnd(14)} errors: ${s.errors.join(' | ')}`);
  }

  await pool.end();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
})();
