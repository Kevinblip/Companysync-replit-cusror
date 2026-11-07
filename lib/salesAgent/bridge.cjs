'use strict';

const { WebSocket } = require('ws');
const { geminiLiveModel } = require('../geminiLiveModel.cjs');
const { verifyPayload } = require('./tokens.cjs');
const { buildSalesSystemPrompt, agentVoice, agentName, RECORDING_LINE } = require('./prompt.cjs');
const { TOOL_DECLARATIONS, handleTool } = require('./tools.cjs');
const { update, id } = require('./salesStore.cjs');
const { createRecorder, geminiSynopsis } = require('./recording.cjs');
const { markJoined } = require('./booking.cjs');
const { originAllowed } = require('./http.cjs');
const { checkRateLimit, getClientIp } = require('../rateLimit.cjs');

const MAX_SESSION_MS = 20 * 60 * 1000;

function parseRate(mime) {
  const match = /rate=(\d+)/.exec(String(mime || ''));
  return match ? Number(match[1]) : 24000;
}

function attachSalesDemoClient(clientWs, req) {
  const url = new URL(req.url, 'http://localhost');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const ip = getClientIp(req);
  if (!originAllowed(req.headers.origin, host)) {
    try { clientWs.close(1008, 'origin'); } catch (_) {}
    return;
  }
  const payload = verifyPayload(url.searchParams.get('token'));
  if (!payload || payload.kind !== 'session' || (payload.ip && payload.ip !== ip)) {
    try { clientWs.send(JSON.stringify({ type: 'error', message: 'Start again from the demo page.' })); } catch (_) {}
    try { clientWs.close(1008, 'session'); } catch (_) {}
    return;
  }
  const limit = checkRateLimit(`sales-ws:${ip}`, { max: 6, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) {
    try { clientWs.close(1008, 'rate'); } catch (_) {}
    return;
  }

  const callId = id('call');
  const bookingId = url.searchParams.get('booking') || '';
  const recorder = createRecorder(callId);
  const transcript = [];
  const started = Date.now();
  let geminiWs = null;
  let setupComplete = false;
  let closed = false;
  let clipPlaying = false;
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || '';
  const cap = setTimeout(() => finish('time_limit'), MAX_SESSION_MS);

  function sendClient(message) {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(message));
  }

  function finish(reason) {
    if (closed) return;
    closed = true;
    clearTimeout(cap);
    const files = recorder.flush();
    const durationSec = Math.round((Date.now() - started) / 1000);
    geminiSynopsis(transcript, apiKey).then((synopsis) => update((state) => {
      const call = state.calls.find((row) => row.id === callId);
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
    try { clientWs.close(1000, reason || 'done'); } catch (_) {}
  }

  update((state) => {
    state.calls.push({
      id: callId,
      leadId: null,
      bookingId: bookingId || null,
      startedAt: new Date(started).toISOString(),
      endedAt: null,
      transcript: [],
      clips: [],
      objections: [],
      outcome: '',
      synopsis: '',
      durationSec: 0,
    });
  }).then(() => (bookingId ? markJoined(bookingId) : null)).then(() => {
    if (closed) return;
    if (!apiKey) {
      sendClient({ type: 'error', message: 'Voice is not configured on this server yet.' });
      finish('no_key');
      return;
    }
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    geminiWs = new WebSocket(geminiUrl);

  geminiWs.on('open', () => {
    const prompt = buildSalesSystemPrompt({ channel: 'web' });
    geminiWs.send(JSON.stringify({
      setup: {
        model: geminiLiveModel(),
        generation_config: {
          response_modalities: ['AUDIO'],
          speech_config: {
            voice_config: { prebuilt_voice_config: { voice_name: agentVoice() } },
          },
        },
        input_audio_transcription: {},
        output_audio_transcription: {},
        realtime_input_config: {
          automatic_activity_detection: {
            disabled: false,
            start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
            end_of_speech_sensitivity: 'END_SENSITIVITY_HIGH',
            prefix_padding_ms: 300,
            silence_duration_ms: 800,
          },
        },
        system_instruction: { parts: [{ text: prompt }] },
        tools: [{ function_declarations: TOOL_DECLARATIONS }],
      },
    }));
  });

  geminiWs.on('message', async (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch (_) { return; }
    if (data.setupComplete) {
      setupComplete = true;
      sendClient({ type: 'status', status: 'ready', agentName: agentName(), recordingNotice: RECORDING_LINE });
      geminiWs.send(JSON.stringify({
        client_content: {
          turns: [{
            role: 'user',
            parts: [{ text: `The prospect just connected. Your first sentence must be exactly: "${RECORDING_LINE}" Then introduce yourself as ${agentName()} and ask what kind of roofing work they do.` }],
          }],
          turn_complete: true,
        },
      }));
    }
    if (data.serverContent?.inputTranscription?.text) {
      const text = data.serverContent.inputTranscription.text;
      transcript.push({ role: 'prospect', text, at: new Date().toISOString() });
      sendClient({ type: 'transcript', role: 'prospect', text });
      if (clipPlaying) {
        clipPlaying = false;
        sendClient({ type: 'pause_clip' });
      }
    }
    if (data.serverContent?.outputTranscription?.text) {
      const text = data.serverContent.outputTranscription.text;
      transcript.push({ role: 'agent', text, at: new Date().toISOString() });
      sendClient({ type: 'transcript', role: 'agent', text });
    }
    if (data.serverContent?.modelTurn?.parts) {
      for (const part of data.serverContent.modelTurn.parts) {
        if (part.inlineData && part.inlineData.data) {
          recorder.pushOutbound(part.inlineData.data, parseRate(part.inlineData.mimeType));
          if (!clipPlaying) {
            sendClient({ type: 'audio', data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000' });
          }
        }
      }
    }
    if (data.toolCall) {
      const calls = data.toolCall.functionCalls || [];
      const responses = [];
      for (const call of calls) {
        const toolArgs = typeof call.args === 'string' ? JSON.parse(call.args || '{}') : (call.args || {});
        const result = await handleTool(call.name, toolArgs, {
          callId,
          appBase: `${req.headers['x-forwarded-proto'] || 'https'}://${host}`,
          apiKey,
          onPlayClip: (clip) => {
            clipPlaying = true;
            sendClient({ type: 'play_clip', ...clip });
          },
          onEnd: () => finish('ended'),
        });
        responses.push({ id: call.id, name: call.name, response: result });
        sendClient({ type: 'tool', name: call.name, ok: !!result.ok });
      }
      if (geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));
      }
    }
  });

  geminiWs.on('error', () => {
    sendClient({ type: 'error', message: 'Voice connection failed.' });
  });

  geminiWs.on('close', () => {
    if (!closed) finish('gemini_closed');
  });
  }).catch((err) => {
    sendClient({ type: 'error', message: 'Could not start the call.' });
    console.error('[sales-demo] setup failed:', err.message);
    finish('setup_failed');
  });

  clientWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg.type === 'audio' && msg.data) {
      recorder.pushInbound(msg.data, 16000);
      if (clipPlaying && msg.speech) {
        clipPlaying = false;
        sendClient({ type: 'pause_clip' });
      }
      if (setupComplete && geminiWs && geminiWs.readyState === WebSocket.OPEN && !clipPlaying) {
        geminiWs.send(JSON.stringify({
          realtime_input: { audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' } },
        }));
      }
    }
    if (msg.type === 'barge_in' || msg.type === 'user_interrupted') {
      clipPlaying = false;
      sendClient({ type: 'pause_clip' });
    }
    if (msg.type === 'clip_ended') {
      clipPlaying = false;
      if (setupComplete && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(JSON.stringify({
          client_content: {
            turns: [{ role: 'user', parts: [{ text: '[System: The clip finished. Ask one short question about what they just saw. Do not recap the whole video.]' }] }],
            turn_complete: true,
          },
        }));
      }
    }
    if (msg.type === 'text' && setupComplete && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      transcript.push({ role: 'prospect', text: String(msg.text || ''), at: new Date().toISOString() });
      geminiWs.send(JSON.stringify({
        client_content: {
          turns: [{ role: 'user', parts: [{ text: String(msg.text || '') }] }],
          turn_complete: true,
        },
      }));
    }
    if (msg.type === 'stop') finish('client_stop');
  });

  clientWs.on('close', () => finish('client_closed'));
}

module.exports = { attachSalesDemoClient, MAX_SESSION_MS };
