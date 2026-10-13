# AI Capabilities

- **CrewCam AI Photo Analysis**: Uses Gemini 2.5 Flash for material identification and damage detection.
- **AI Roof Measurement**: Employs Google Solar API for geometry-based roof type classification and calculates linear features and waste factors.
- **AI Estimator Calibration Memory**: Compares AI estimates with external reports (EagleView/Hover/GAF) to learn and apply correction ratios for future estimates, stored as `AIMemory` entities.
- **Report Extraction**: Uses GPT-4o/Gemini for extracting detailed information from roofing reports.
- **Satellite Vision Analysis**: Gemini vision prompt detects roof type, complexity, linear features, structural features, and building footprint ratios from satellite imagery.
- **AI Voice Bridge (Lexi/Sarah)**: Provides AI-powered voice interaction for call agents and CRM, integrating with Gemini 2.5 speech-to-speech. Lexi supports CRUD operations on key entities (Leads, Customers, Estimates, Invoices, Tasks, Projects, Notes) and other actions like storm alert queries and staff member creation.

## Phone Voice Call Latency Pipeline (Alex/Sarah — Twilio bridge)

The Twilio voice bridge lives in `vite-twilio-ws-plugin.js` (dev) and `prod-server.cjs` (prod, Twilio WS section ~8400–9460) — the two MUST stay in lockstep. The Lexi browser bridge (`connectGemini` at ~9520 in prod) is a separate, untouched path.

**Call-start (dead-air elimination):** On stream `start`, `connectGemini` runs three things in parallel instead of serially: (1) the CRM settings load (`getSettings`, itself parallelized — all 6 `localGetSettings` queries run via `Promise.all`), (2) the caller-history lookup (`lookupCallerByCrmPhone` + last-communication query, started as `historyPromise`), and (3) the Gemini WebSocket TLS handshake. The `open` handler awaits settings before sending setup (guarded by a captured `thisWs` so reconnects can't cross wires). At greeting time the history gets a 250 ms `Promise.race` window — if it hasn't landed, the assistant greets generically immediately and the context is injected later as a silent `turn_complete: false` message wrapped in `[System context — do not read aloud ...]`.

**Turn-taking speed:** `AssistantSettings.response_speed` (`fast`/`normal`/`relaxed`) drives Gemini VAD via `VAD_BY_SPEED`: fast = END_SENSITIVITY_HIGH + 400 ms silence, normal = LOW + 900 ms, relaxed = LOW + 1400 ms (normal/relaxed raised July 2026 — 500 ms fired on natural mid-sentence pauses, making Alex ask follow-ups before the caller could answer). START sensitivity stays LOW in all modes (phone-line noise/echo). `silence_duration_ms` is the biggest lever on perceived lag.

**Tool calls:** All function calls in one `toolCall` message run in parallel (`Promise.all`, 5 s per-tool timeout, per-tool `[LATENCY]` log). The spoken "one sec…" filler is only requested if tools are still running after 600 ms. The post-tool "now respond" nudge is a 1500 ms watchdog (`postToolNudgeTimer`) that is cancelled as soon as audio arrives — it only fires if the model stays silent.

**Model:** default is `models/gemini-3.1-flash-live-preview` (verified against live ListModels + a real setup handshake; supersedes the 2.5 native-audio line with better turn-taking/latency), overridable via `GEMINI_NATIVE_AUDIO_MODEL` for instant rollback.

**Instrumentation:** `markLatency(label)` logs `[LATENCY][callSid]` milestones — `twilio_stream_start`, `gemini_ws_open`, `settings_ready`, `gemini_setup_sent`, `gemini_setup_complete`, `greeting_request_sent`, `first_audio_from_gemini` — plus per-turn `caller_speech_to_first_audio` (set on input transcription, cleared on first audio back) and per-tool durations. Slow calls can be diagnosed from logs alone.

**Prompt hygiene:** `buildSystemPrompt` caps the knowledge block at 6000 chars (`MAX_KNOWLEDGE_CHARS`) and includes an explicit rule that `[System: ...]` / `[System context: ...]` messages are internal and must never be read aloud.

**Prod-only bug fixed in passing:** the prod greeting-time caller lookup and the transfer availability check referenced a bare `pool` that didn't exist in scope — both always threw (swallowed by try/catch), so prod never recognized returning callers and never enforced availability via DB. Both now use `prodDb.getPool()`.
