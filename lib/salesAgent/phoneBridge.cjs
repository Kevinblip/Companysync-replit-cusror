'use strict';

const { WebSocket } = require('ws');
const { geminiLiveModel } = require('../geminiLiveModel.cjs');
const { buildSalesSystemPrompt, agentVoice, agentName, RECORDING_LINE } = require('./prompt.cjs');
const { PHONE_TOOL_DECLARATIONS, handleTool, phoneBookingCloseSay } = require('./tools.cjs');
const { update, id, readState } = require('./salesStore.cjs');
const callGate = require('./callGate.cjs');
const { createRecorder, geminiSynopsis } = require('./recording.cjs');
const { markJoined } = require('./booking.cjs');
const { twilioToGemini, geminiToTwilio, mulawFrames, mulawRms } = require('./audio.cjs');
const { phoneAllowed, last10, publicBase } = require('./phonePolicy.cjs');

const MAX_SESSION_MS = 20 * 60 * 1000;
// A booking used to be treated as the goodbye. Hold agent hangup for a few
// seconds after that tool result, and until Cole's closing audio has played out.
const BOOKING_HANGUP_HOLD_MS = 8000;
const HANGUP_AUDIO_GRACE_MS = 4000;

// Road and cabin noise was crossing Gemini's high-sensitivity VAD and cutting
// Cole off mid-sentence. Low start/end sensitivity needs clearer speech, and the
// prefix/silence windows ignore short bursts. Each value is overridable.
const DEFAULT_VAD = {
  start: 'START_SENSITIVITY_LOW',
  end: 'END_SENSITIVITY_LOW',
  prefixPaddingMs: 400,
  silenceDurationMs: 800,
  energyThreshold: 400,
  gateHangoverMs: 200,
};

function parseRate(mime) {
  const match = /rate=(\d+)/.exec(String(mime || ''));
  return match ? Number(match[1]) : 24000;
}

function envInt(env, name, fallback) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.round(value);
}

function sensitivity(env, name, edge) {
  const fallback = edge === 'start' ? DEFAULT_VAD.start : DEFAULT_VAD.end;
  const prefix = edge === 'start' ? 'START_SENSITIVITY_' : 'END_SENSITIVITY_';
  const raw = String(env[name] || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!raw) return fallback;
  if (raw === 'LOW' || raw === 'HIGH') return `${prefix}${raw}`;
  if (raw === `${prefix}LOW` || raw === `${prefix}HIGH`) return raw;
  return fallback;
}

function activityDetection(env = process.env) {
  return {
    disabled: false,
    start_of_speech_sensitivity: sensitivity(env, 'SALES_AGENT_VAD_START_SENSITIVITY', 'start'),
    end_of_speech_sensitivity: sensitivity(env, 'SALES_AGENT_VAD_END_SENSITIVITY', 'end'),
    prefix_padding_ms: envInt(env, 'SALES_AGENT_VAD_PREFIX_PADDING_MS', DEFAULT_VAD.prefixPaddingMs),
    silence_duration_ms: envInt(env, 'SALES_AGENT_VAD_SILENCE_DURATION_MS', DEFAULT_VAD.silenceDurationMs),
  };
}

function buildGeminiSetup(prompt, env = process.env) {
  return {
    setup: {
      model: geminiLiveModel(undefined, env),
      generation_config: {
        response_modalities: ['AUDIO'],
        speech_config: {
          voice_config: { prebuilt_voice_config: { voice_name: agentVoice(env) } },
        },
      },
      input_audio_transcription: {},
      output_audio_transcription: {},
      realtime_input_config: {
        automatic_activity_detection: activityDetection(env),
      },
      system_instruction: { parts: [{ text: prompt }] },
      tools: [{ function_declarations: PHONE_TOOL_DECLARATIONS }],
    },
  };
}

function createInboundGate(env = process.env) {
  const threshold = envInt(env, 'SALES_AGENT_VAD_ENERGY_THRESHOLD', DEFAULT_VAD.energyThreshold);
  const hangoverMs = envInt(env, 'SALES_AGENT_VAD_GATE_HANGOVER_MS', DEFAULT_VAD.gateHangoverMs);
  let playbackUntil = 0;
  let forwardUntil = 0;

  return {
    threshold,
    hangoverMs,
    noteOutbound(mulawB64, now = Date.now()) {
      const bytes = Buffer.from(String(mulawB64 || ''), 'base64').length;
      if (!bytes) return;
      playbackUntil = Math.max(playbackUntil, now) + (bytes / 8);
    },
    interrupt(now = Date.now()) {
      playbackUntil = now;
      forwardUntil = now;
    },
    speaking(now = Date.now()) {
      return now < playbackUntil;
    },
    playbackEndsAt() {
      return playbackUntil;
    },
    shouldForward(mulawB64, now = Date.now()) {
      if (threshold <= 0 || now >= playbackUntil) return true;
      if (mulawRms(mulawB64) >= threshold) {
        forwardUntil = now + hangoverMs;
        return true;
      }
      return now < forwardUntil;
    },
  };
}

function evaluateHangupGuard({
  now = Date.now(),
  bookedAt = 0,
  playbackEndsAt = 0,
  hangupRequestedAt = 0,
  holdMs = BOOKING_HANGUP_HOLD_MS,
  audioGraceMs = HANGUP_AUDIO_GRACE_MS,
} = {}) {
  const bookingWait = bookedAt > 0 ? Math.max(0, bookedAt + holdMs - now) : 0;
  const audioWait = playbackEndsAt > now ? playbackEndsAt - now : 0;
  // Closing audio often arrives in the websocket message after end_call.
  // Wait briefly for it to start, then until it finishes playing.
  let graceWait = 0;
  if (hangupRequestedAt > 0 && audioWait === 0 && playbackEndsAt <= hangupRequestedAt) {
    graceWait = Math.max(0, hangupRequestedAt + audioGraceMs - now);
  }
  const waitMs = Math.max(bookingWait, audioWait, graceWait);
  return {
    allowTool: bookingWait === 0,
    close: waitMs === 0,
    waitMs,
    bookingWait,
    audioWait,
    graceWait,
  };
}

function attachSalesPhoneClient(twilioWs, req) {
  let streamSid = '';
  let callSid = '';
  let from = '';
  let to = '';
  let geminiWs = null;
  let setupComplete = false;
  let closed = false;
  const started = Date.now();
  let callId = id('call');
  const recorder = createRecorder(callId);
  let agentSpoke = false;
  const transcript = [];
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || '';
  const cap = setTimeout(() => finish('time_limit'), MAX_SESSION_MS);
  const hostBase = publicBase(req || { headers: {} });
  const gate = createInboundGate();
  const bookingHoldMs = envInt(process.env, 'SALES_AGENT_BOOKING_HANGUP_HOLD_MS', BOOKING_HANGUP_HOLD_MS);
  const hangupAudioGraceMs = envInt(process.env, 'SALES_AGENT_HANGUP_AUDIO_GRACE_MS', HANGUP_AUDIO_GRACE_MS);
  let bookedAt = 0;
  let lastCloseSay = '';
  let hangupRequestedAt = 0;
  let hangupReason = '';
  let hangupTimer = null;

  function sendTwilio(message) {
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(message));
  }

  function finish(reason) {
    if (closed) return;
    closed = true;
    clearTimeout(cap);
    if (hangupTimer) clearTimeout(hangupTimer);
    hangupTimer = null;
    let files = {};
    try { files = recorder.flush(); } catch (err) {
      console.error('[sales-phone] recording flush failed:', err.message);
    }
    const durationSec = Math.round((Date.now() - started) / 1000);
    geminiSynopsis(transcript, apiKey).then((synopsis) => update((state) => {
      const call = state.calls.find((row) => (callSid && row.callSid === callSid) || row.id === callId);
      if (!call) return;
      call.endedAt = new Date().toISOString();
      call.durationSec = durationSec;
      call.transcript = transcript;
      call.synopsis = call.synopsis || synopsis;
      call.recordingIn = files.in || '';
      call.recordingOut = files.out || '';
      if (!call.outcome) call.outcome = reason || 'ended';
    })).catch(() => {});
    try { geminiWs && geminiWs.close(); } catch (_) {}
    try { twilioWs.close(1000, reason || 'done'); } catch (_) {}
  }

  function guardNow() {
    return evaluateHangupGuard({
      now: Date.now(),
      bookedAt,
      playbackEndsAt: gate.playbackEndsAt(),
      hangupRequestedAt,
      holdMs: bookingHoldMs,
      audioGraceMs: hangupAudioGraceMs,
    });
  }

  function armAgentHangup(reason) {
    if (closed) return;
    hangupReason = reason || hangupReason || 'ended';
    const decision = guardNow();
    if (hangupTimer) clearTimeout(hangupTimer);
    hangupTimer = null;
    if (decision.bookingWait > 0) {
      console.log('[sales-phone] hangup held after booking', { callSid, waitMs: decision.waitMs });
      hangupReason = '';
      hangupRequestedAt = 0;
      return;
    }
    if (!decision.close) {
      hangupTimer = setTimeout(() => armAgentHangup(hangupReason), decision.waitMs);
      if (hangupTimer.unref) hangupTimer.unref();
      return;
    }
    finish(hangupReason);
  }

  function noteBookingResult(result) {
    bookedAt = Date.now();
    if (result && result.say) lastCloseSay = result.say;
  }

  function toolContext(extra) {
    return {
      callId,
      callerPhone: from,
      channel: 'phone',
      appBase: hostBase,
      apiKey,
      onPlayClip: () => {},
      ...extra,
    };
  }

  function openGemini() {
    if (!apiKey) {
      console.error('[sales-phone] voice is not configured');
      finish('no_key');
      return;
    }
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    const vad = activityDetection();
    console.log('[sales-phone] opening Gemini', {
      voice: agentVoice(),
      model: geminiLiveModel(),
      vad,
      energyThreshold: gate.threshold,
    });
    geminiWs = new WebSocket(geminiUrl);
    geminiWs.on('open', () => {
      const prompt = buildSalesSystemPrompt({ channel: 'phone' });
      geminiWs.send(JSON.stringify(buildGeminiSetup(prompt)));
    });
    geminiWs.on('message', async (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch (_) { return; }
      if (data.setupComplete) {
        setupComplete = true;
        geminiWs.send(JSON.stringify({
          client_content: {
            turns: [{
              role: 'user',
              parts: [{ text: `The caller just connected on the phone. Twilio already played: "${RECORDING_LINE}" Do not repeat that sentence. Introduce yourself as ${agentName()} and ask what kind of roofing work they do.` }],
            }],
            turn_complete: true,
          },
        }));
      }
      if (data.serverContent && data.serverContent.interrupted) {
        gate.interrupt();
        if (hangupReason) {
          // The caller spoke over the goodbye. Give Cole time to answer
          // before the line drops, instead of treating the cleared audio as finished.
          hangupRequestedAt = Date.now();
          armAgentHangup(hangupReason);
        }
        if (streamSid) sendTwilio({ event: 'clear', streamSid });
      }
      if (data.serverContent && data.serverContent.inputTranscription && data.serverContent.inputTranscription.text) {
        transcript.push({ role: 'prospect', text: data.serverContent.inputTranscription.text, at: new Date().toISOString() });
      }
      if (data.serverContent && data.serverContent.outputTranscription && data.serverContent.outputTranscription.text) {
        transcript.push({ role: 'agent', text: data.serverContent.outputTranscription.text, at: new Date().toISOString() });
      }
      const parts = data.serverContent && data.serverContent.modelTurn && data.serverContent.modelTurn.parts;
      if (parts) {
        for (const part of parts) {
          if (!part.inlineData || !part.inlineData.data) continue;
          if (!agentSpoke) {
            agentSpoke = true;
            callGate.markSpoke(callSid);
            update((state) => {
              const call = state.calls.find((row) => (callSid && row.callSid === callSid) || row.id === callId);
              if (call) call.agentSpoke = true;
            }).catch(() => {});
          }
          recorder.pushOutbound(part.inlineData.data, parseRate(part.inlineData.mimeType));
          if (!streamSid) continue;
          const mulaw = geminiToTwilio(part.inlineData.data);
          gate.noteOutbound(mulaw);
          if (hangupReason) armAgentHangup(hangupReason);
          for (const frame of mulawFrames(mulaw)) {
            sendTwilio({ event: 'media', streamSid, media: { payload: frame } });
          }
        }
      }
      if (data.toolCall) {
        const calls = data.toolCall.functionCalls || [];
        const responses = new Array(calls.length);
        const deferredEnds = [];
        for (let i = 0; i < calls.length; i += 1) {
          const call = calls[i];
          // Run booking before end_call, even when Gemini batches them together.
          // finish() used to run inside this loop and drop the stream on "perfect".
          if (call.name === 'end_call') {
            deferredEnds.push({ index: i, call });
            continue;
          }
          const toolArgs = typeof call.args === 'string' ? JSON.parse(call.args || '{}') : (call.args || {});
          const result = await handleTool(call.name, toolArgs, toolContext());
          if (result && result.ok && (call.name === 'book_appointment' || call.name === 'book_demo' || call.name === 'handoff_to_rep')) {
            noteBookingResult(result);
          }
          responses[i] = { id: call.id, name: call.name, response: result };
        }
        let hangupArmed = false;
        for (const item of deferredEnds) {
          const decision = guardNow();
          if (!decision.allowTool) {
            console.log('[sales-phone] end_call blocked after booking', { callSid, waitMs: decision.waitMs });
            responses[item.index] = {
              id: item.call.id,
              name: item.call.name,
              response: {
                ok: false,
                hangupBlocked: true,
                error: 'The demo is already booked. Do not hang up yet.',
                say: lastCloseSay || `The demo is already booked. Do not hang up yet. ${phoneBookingCloseSay()}`,
              },
            };
            continue;
          }
          const toolArgs = typeof item.call.args === 'string' ? JSON.parse(item.call.args || '{}') : (item.call.args || {});
          const result = await handleTool(item.call.name, toolArgs, toolContext({
            onEnd: () => { hangupArmed = true; },
          }));
          responses[item.index] = { id: item.call.id, name: item.call.name, response: result };
        }
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));
        }
        if (hangupArmed) {
          hangupRequestedAt = Date.now();
          armAgentHangup('ended');
        }
      }
    });
    geminiWs.on('error', (err) => {
      console.error('[sales-phone] gemini error:', err.message);
    });
    geminiWs.on('close', () => {
      if (!closed) finish('gemini_closed');
    });
  }

  twilioWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg.event === 'start') {
      streamSid = (msg.start && msg.start.streamSid) || msg.streamSid || '';
      const custom = (msg.start && msg.start.customParameters) || {};
      callSid = (msg.start && msg.start.callSid) || custom.callSid || custom.CallSid || '';
      from = custom.from || custom.From || '';
      to = custom.to || custom.To || '';
      if (from && !phoneAllowed(from)) {
        console.error('[sales-phone] caller is not allowlisted');
        finish('allowlist');
        return;
      }
      callGate.markStarted(callSid);
      const existing = callSid && readState().calls.find((row) => row.callSid === callSid);
      if (existing) callId = existing.id;
      update((state) => {
        const needle = last10(from);
        const lead = state.leads.find((row) => last10(row.phone) === needle);
        const booking = lead && state.bookings.find((row) => row.leadId === lead.id && row.status === 'booked');
        let call = state.calls.find((row) => (callSid && row.callSid === callSid) || row.id === callId);
        if (!call) {
          call = {
            id: callId,
            channel: 'phone',
            callSid,
            transcript: [],
            clips: [],
            objections: [],
            outcome: '',
            synopsis: '',
            durationSec: 0,
          };
          state.calls.push(call);
        }
        call.channel = 'phone';
        call.callSid = call.callSid || callSid;
        call.from = from || call.from || '';
        call.to = to || call.to || '';
        call.leadId = call.leadId || (lead ? lead.id : null);
        call.bookingId = call.bookingId || (booking ? booking.id : null);
        call.startedAt = call.startedAt || new Date(started).toISOString();
        call.status = 'in-progress';
        call.streamStarted = true;
        call.noticePlayed = true;
        return booking ? booking.id : '';
      }).then((bookingId) => {
        if (bookingId) return markJoined(bookingId);
        return null;
      }).then(() => {
        if (!closed) openGemini();
      }).catch((err) => {
        console.error('[sales-phone] setup failed:', err.message);
        finish('setup_failed');
      });
    }
    if (msg.event === 'media' && msg.media && msg.media.payload) {
      const pcm = twilioToGemini(msg.media.payload);
      recorder.pushInbound(pcm, 16000);
      if (setupComplete && geminiWs && geminiWs.readyState === WebSocket.OPEN && gate.shouldForward(msg.media.payload)) {
        geminiWs.send(JSON.stringify({
          realtime_input: { audio: { data: pcm, mimeType: 'audio/pcm;rate=16000' } },
        }));
      }
    }
    if (msg.event === 'stop') finish('twilio_stop');
  });

  twilioWs.on('close', () => finish('twilio_closed'));
  twilioWs.on('error', () => finish('twilio_error'));
}

module.exports = {
  attachSalesPhoneClient,
  MAX_SESSION_MS,
  BOOKING_HANGUP_HOLD_MS,
  HANGUP_AUDIO_GRACE_MS,
  DEFAULT_VAD,
  activityDetection,
  buildGeminiSetup,
  createInboundGate,
  evaluateHangupGuard,
};
