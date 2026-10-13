---
name: AI call transcript capture & display
description: Why AI-answered (Gemini Live speech-to-speech) calls can save a BLANK transcript and show "Call (missed)" — the correct Gemini transcription field names and the dashboard field mapping.
---

# AI call transcript capture (Gemini Live native-audio)

## Capturing the transcript (server WS handler)
Gemini Live (native-audio model) delivers the spoken conversation as TRANSCRIPTION
events on `serverContent`, with this exact shape:
- caller speech → `serverContent.inputTranscription.text`
- assistant speech → `serverContent.outputTranscription.text`

**Gotcha:** the assistant's voice reply arrives as `serverContent.modelTurn.parts[].inlineData`
(raw audio), NOT as `part.text`. So for a voice call the transcription events are the
ONLY source of the conversation text — if you read the wrong field, `conversationLog`
stays empty and the saved transcript is blank even though the call went fine.

**Wrong field names that silently produce empty transcripts:**
`serverContent.outputTranscript` / `serverContent.inputTranscript` (plain strings) do
NOT exist on Gemini Live responses. Use the `*Transcription.text` form above.

**Lockstep:** there are multiple Gemini message handlers in the same server
(inbound/answering-service voice AND the Lexi assistant voice). They must all use the
same correct field names. The bug was that one handler used `*Transcript` while the
proven one used `*Transcription.text`. Keep them identical.

**Why:** the setup enables `input_audio_transcription`/`output_audio_transcription`, but
that only makes Gemini SEND the events — the handler still has to read the right field.

## Displaying the transcript (Live Call Dashboard)
Call records are read through the universal entity filter, which spreads the row's `data`
JSONB onto the entity and maps `created_at`→`created_date`. So whatever you save in
`data` becomes a top-level field on the dashboard object.

Field-name mismatches that make an answered call render as "Call (missed)":
- transcript is stored at **`data.transcription`** (field name "transcription") — the
  frontend must read `transcription`, not `transcript`.
- duration is the **`duration_minutes`** column — the frontend must read
  `duration_minutes`, not `duration_seconds`.

**How to apply:** when an AI call shows blank/"missed", check BOTH ends: the server WS
handler field names (capture) AND the dashboard field names (display). Pre-fix calls
can't recover a lost transcript; only the duration fallback helps them.
