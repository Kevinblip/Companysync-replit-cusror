---
name: Gemini Live audio input format migration
description: realtime_input.media_chunks is deprecated and causes 1007 disconnects; the required shape and every place it lives in this codebase.
---

# Gemini Live audio input format

## The rule
Send caller/mic audio to Gemini Live as:

```json
{ "realtime_input": { "audio": { "data": "<base64 PCM>", "mimeType": "audio/pcm;rate=16000" } } }
```

**Never** `realtime_input.media_chunks: [{ data, mime_type }]` — Google removed it (July 2026).
The old shape now closes the socket with **1007 "Request contains an invalid argument"** on the
FIRST audio send. Symptom on calls: greeting plays (greeting is a text/system trigger), then the
assistant goes silent the moment the caller speaks — looks like "the AI stopped listening".

**Why:** API deprecation, not a transient blip. Reconnect loops just die again at first audio send.
See gemini-live-call-resilience.md for how to tell this apart from genuinely transient 1007s.

## How to apply
- The send shape lives in MANY files — grep `realtime_input` (and historically `media_chunks`)
  across ALL of: `prod-server.cjs` (3 sites incl. the 5s silence KEEPALIVE), `vite-twilio-ws-plugin.js`
  (keepalive + media relay), `vite-lexi-native-plugin.js`, `functions/geminiLiveCallStream.ts`,
  `functions/sarahFastVoice.ts`, `functions/sarahVoiceBridge.ts`, `railway/server.js` (legacy),
  and the BROWSER clients `src/components/ai/GeminiLiveS2SClient.jsx`, `GeminiLiveClient.jsx`.
- Keepalives count: the all-zero silence buffer must use the new shape too.
- Note the case change: `mimeType` (camelCase) inside `audio`, vs the old `mime_type`.
- Response-side transcript field names are unchanged (see ai-call-transcript-capture.md).
