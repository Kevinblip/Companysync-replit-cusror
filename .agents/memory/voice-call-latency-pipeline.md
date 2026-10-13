---
name: Voice call latency pipeline (Alex/Sarah Twilio bridge)
description: Decisions and levers behind the phone-call latency work — parallel call-start, VAD-by-speed, conditional filler/nudge, model pinning.
---

# Voice call latency pipeline

Full implementation notes live in `docs/ai-capabilities.md` ("Phone Voice Call Latency Pipeline"). Durable decisions:

- **Call-start is parallel, not serial.** `connectGemini` starts settings load, caller-history lookup (`historyPromise`), and the Gemini WS handshake concurrently; the `open` handler awaits settings. Greeting gives history a 250ms race window, then greets generically and injects context late via a silent `turn_complete:false` `[System context — do not read aloud ...]` message.
  **Why:** every serial step was dead air; a fast generic greeting beats a slow personalized one.
  **How to apply:** never add another awaited step between stream `start` and the greeting send — fold it into one of the parallel promises or inject it late.
- **VAD follows `AssistantSettings.response_speed`** via `VAD_BY_SPEED` (fast: END_HIGH/400ms, normal: LOW/900ms, relaxed: LOW/1400ms). START sensitivity stays LOW always (phone-line noise/echo makes Gemini hear phantom speech). `silence_duration_ms` is the single biggest perceived-lag lever.
- **Filler and nudge are conditional, not unconditional.** "One sec…" filler only if tools still run after 600ms; post-tool "now respond" nudge is a 1500ms watchdog cancelled on first audio. Unconditional versions cost an extra spoken turn each and can double-trigger responses.
- **Tools in one toolCall message run via `Promise.all`** (5s per-tool timeout). They're independent CRM ops; serial awaits stacked timeouts.
- **Model default pinned to `gemini-3.1-flash-live-preview`** (July 2026 — supersedes the 2.5 native-audio line; goes straight to audio with no thinking preamble, noticeably faster first response), env `GEMINI_NATIVE_AUDIO_MODEL` overrides for instant rollback. Verify against live ListModels AND a real WS setup handshake before changing (wrong remembered names 404; ListModels alone doesn't prove the Live setup payload is accepted).
- **VAD silence (July 2026): normal=900ms, relaxed=1400ms** (was 500/800). 500ms fired on natural mid-sentence pauses over phone audio — Alex asked a follow-up before the caller could answer, then answered her own question. Fast stays 400ms/END_HIGH for users who explicitly choose speed over patience.
- **`markLatency()` milestones** make slow calls diagnosable from logs alone (`[LATENCY][callSid]` lines). Keep dev/prod label sets identical so log tooling works on both.
- Dev (`vite-twilio-ws-plugin.js`) and prod (`prod-server.cjs` Twilio WS section) must stay in lockstep; the Lexi browser bridge (vite-lexi-native-plugin.js + prod-server Lexi section) now shares the same 3.1 default.
