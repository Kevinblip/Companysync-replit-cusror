---
name: Gemini Live voice-call resilience (Sarah/Alex)
description: How the Twilio↔Gemini Live voice bridge survives transient drops without false human-handoffs or leaked sockets; dev/prod lockstep rules.
---

# Gemini Live voice-call resilience

The AI receptionist voice bridge connects Twilio Media Streams ↔ Gemini Live (speech-to-speech).
It exists twice and MUST stay in lockstep: dev `vite-twilio-ws-plugin.js`, prod `prod-server.cjs`
(plus a separate Lexi browser path). Diagnosing/fixing one without the other reintroduces bugs.

## The core lesson: 1007 is transient, fix with resilience not payload changes
- Gemini close code **1007 "audio content type not supported"** is almost always a TRANSIENT
  server-side disconnect, NOT a real audio-format problem. Do not start reformatting PCM/mime types.
- **Why:** the same audio config works for most of the call; the drop is mid-stream and recovers on
  reconnect. Treating it as a payload bug wastes effort and changes a working format.
- **How to apply:** on an unexpected Gemini close, RECONNECT (bounded) instead of immediately telling
  the caller "I'm having a technical glitch, a human will call you back." Only hand off after the
  bounded retries are exhausted (`MAX_GEMINI_RECONNECTS = 3`, counter NOT reset → prevents flap loops).

## setupComplete must reset on every (re)connect
- Set `setupComplete = false` immediately before `geminiWs = new WebSocket(...)`.
- **Why:** the Twilio 'media' handler forwards caller audio only when
  `setupComplete && geminiWs.readyState === OPEN`. On reconnect `setupComplete` is still `true` from
  the dead socket, so audio gets sent to a new socket that hasn't finished setup → another 1007.
- **How to apply:** reset it at connect time; it's set back to `true` only by the NEW socket's own
  `setupComplete` event.

## connectGemini does async work before opening the socket — guard the await window twice
- `connectGemini()` loads settings/CRM (await) BEFORE creating the socket. The caller can hang up
  during that await; Twilio 'stop'/'close' already ran (set `callTerminated=true`, closed the old
  socket), but the resumed function would still open a NEW socket + keepalive with no call attached.
- **Two guards required (both files):**
  1. After the awaits, before `new WebSocket`: `if (callTerminated || twilioWs.readyState !== OPEN) { saveCallToBase44(); return; }`
  2. At the top of the `setupComplete` message handler, before starting the keepalive: same check, but
     also `geminiWs.close()` (caller can hang up DURING the handshake).
- **Why:** without these you leak an orphan Gemini socket + 5s keepalive interval per dropped call.

## Normal hangup must never trigger the human-handoff message or a false alert
- The Gemini 'close' handler must early-return (save + return, no reconnect, no handoff) when
  `callTerminated || twilioWs not OPEN || !callSid`. Twilio 'stop' and 'close' both set
  `callTerminated=true`, close `geminiWs`, and clear the keepalive.
- `saveCallToBase44()` is idempotent via a `callLogSaved` flag, so the multiple call sites are safe.

## gracefulHandoff: caller-message and staff-notify are independent
- Play the calm caller message in its OWN try (needs Twilio creds + open line); file the staff
  follow-up in a SEPARATE block gated only on `callCompanyId`.
- **Why:** if creds/line are gone the caller message can't play, but an unrecoverable drop must NEVER
  be silent — staff still get a follow-up. (prod writes a `Notification` generic_entity; dev calls
  `callBase44API('createAlert')`.)
- Prod hand-off resolves the subscriber's **BYO-Twilio** creds via
  `getCachedSubscriber(calledTwilioNumber)` with env fallback — matching dev's `twilioSid || env`.
  Env-only would 404 the `Calls/{sid}.json` REST update for subscribers on their own Twilio account.

## Self-talk / hallucinated caller speech = VAD false-triggering, tune realtime_input_config
- Symptom: assistant speaks unprompted, invents what the silent caller "said" (it picks the FIRST
  triage item in the prompt, e.g. "leak"), asks and answers its own questions.
- **Why:** the phone setup message sent no `realtime_input_config`, so Gemini used default
  high-sensitivity automatic activity detection — PSTN line noise + echo of the assistant's own
  outbound audio was treated as caller speech, opening hallucinated turns. (The browser Lexi bridge
  intentionally keeps HIGH sensitivity — browser echo cancellation makes that safe; do NOT copy the
  phone tuning there.)
- **How to apply:** phone setup (dev `vite-twilio-ws-plugin.js` + prod `prod-server.cjs` phone block)
  now sends `automatic_activity_detection` with `START_SENSITIVITY_LOW`, `END_SENSITIVITY_LOW`,
  `prefix_padding_ms: 100`, `silence_duration_ms: 800`. Pair with VOICE RULES prompt guardrails:
  never assume the caller's issue, ask ONE question then stop, never guess on silence/noise.
- Tradeoff: very quiet callers may need to speak up and barge-in needs clearer speech. If callers
  report being missed, relax start sensitivity to default while keeping the prompt guardrails.
- The 5s keepalive (all-zero PCM) is digital silence and can't trigger VAD at any sensitivity.

## Model is env-configurable
- Native-audio model = `process.env.GEMINI_NATIVE_AUDIO_MODEL || "models/gemini-3.1-flash-live-preview"` (default bumped July 2026; see voice-call-latency-pipeline.md).
- **Why:** the default is a dated PREVIEW model that will be deprecated; the env override lets you
  swap it without a code change when Google rotates the preview.

## Browser Lexi sessions use server-owned idle teardown
- Browser voice sessions are continuous in both standard and Drive modes; only the server's 15-minute
  meaningful-activity cap may end an abandoned session.
- **Why:** a 10-second browser silence watchdog closed normal pauses between turns, then made the
  resulting browser-first close resemble a Gemini failure in backend logs.
- **How to apply:** never add a short client-side silence close. Keep close telemetry in both browser
  bridges: close code/reason, mode, duration, upstream state, setup state, and reconnect attempt.
