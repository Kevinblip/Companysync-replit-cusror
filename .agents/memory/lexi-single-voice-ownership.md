---
name: Lexi single voice ownership
description: Browser Lexi voice channels use one takeover coordinator so native and legacy audio cannot answer the same turn.
---

Native Gemini voice and legacy browser voice must acquire the same browser-scoped ownership token. Starting either channel takes over, and the losing channel must stop recognition, microphone/socket work, queued audio, speech synthesis, and late callbacks. Keep Sarah/Twilio phone sessions outside this browser lock because they are independent server-side calls.

**Why:** Two Lexi UI voice implementations can be mounted on the same page, so independent local toggles can otherwise produce duplicate requests or overlapping speech.

**How to apply:** Any new browser Lexi voice surface must use the coordinator before opening audio or submitting voice transcripts; reconnects retain the owner token and phone-call code should not acquire it.

## Native voice barge-in must reopen the microphone path immediately
When the browser detects speech over assistant playback, cancel the playback
tail gate immediately, flush the short buffered speech pre-roll, and invalidate
callbacks from the stopped audio source. Suppress stale assistant audio until
Gemini acknowledges the new user turn.
**Why:** The server previously blocked incoming audio for 1.2 seconds after an
interruption, discarding short commands like “stop”; a delayed source-ended
callback could also re-arm that same gate.
**How to apply:** Keep the longer post-playback echo gate for natural playback
completion only. Mirror barge-in handling in both development and production.