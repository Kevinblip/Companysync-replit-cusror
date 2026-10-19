'use strict';

const { WebSocket } = require('ws');
const { geminiLiveModel } = require('../geminiLiveModel.cjs');
const { buildSalesSystemPrompt, agentVoice, agentName, RECORDING_LINE } = require('./prompt.cjs');
const { PHONE_TOOL_DECLARATIONS, handleTool } = require('./tools.cjs');
const { update, id, readState } = require('./salesStore.cjs');
const callGate = require('./callGate.cjs');
const { createRecorder, geminiSynopsis } = require('./recording.cjs');
const { markJoined } = require('./booking.cjs');
const { twilioToGemini, geminiToTwilio, mulawFrames } = require('./audio.cjs');
const { phoneAllowed, last10, publicBase } = require('./phonePolicy.cjs');

const MAX_SESSION_MS = 20 * 60 * 1000;

function parseRate(mime) {
  const match = /rate=(\d+)/.exec(String(mime || ''));
  return match ? Number(match[1]) : 24000;
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

  function sendTwilio(message) {
    if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(message));
  }

  function finish(reason) {
    if (closed) return;
    closed = true;
    clearTimeout(cap);
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

  function openGemini() {
    if (!apiKey) {
      console.error('[sales-phone] voice is not configured');
      finish('no_key');
      return;
    }
    const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    console.log('[sales-phone] opening Gemini', { voice: agentVoice(), model: geminiLiveModel() });
    geminiWs = new WebSocket(geminiUrl);
    geminiWs.on('open', () => {
      const prompt = buildSalesSystemPrompt({ channel: 'phone' });
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
          tools: [{ function_declarations: PHONE_TOOL_DECLARATIONS }],
        },
      }));
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
      if (data.serverContent && data.serverContent.interrupted && streamSid) {
        sendTwilio({ event: 'clear', streamSid });
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
          for (const frame of mulawFrames(mulaw)) {
            sendTwilio({ event: 'media', streamSid, media: { payload: frame } });
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
            callerPhone: from,
            channel: 'phone',
            appBase: hostBase,
            apiKey,
            onPlayClip: () => {},
            onEnd: () => finish('ended'),
          });
          responses.push({ id: call.id, name: call.name, response: result });
        }
        if (geminiWs.readyState === WebSocket.OPEN) {
          geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));
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
      if (setupComplete && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
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

module.exports = { attachSalesPhoneClient, MAX_SESSION_MS };
