---
name: Voice bridge silent tool failure
description: How a single undefined variable made every phone-assistant CRM tool fail while the call still sounded perfect.
---

The dev Twilio bridge referenced a `calledTwilioNumber` variable that was never
declared in that file (prod declared it; dev did not). Because the reference sat
inside the tool-dispatch `try`, **every** CRM tool call threw a `ReferenceError`,
and the broad `catch` converted it into `{error, status:'failed'}` — which the
model then narrated as a friendly "I'm having trouble pulling up the schedule."

Callers were told their inspection was booked. Nothing was ever written.

**Why this is easy to miss:** the transcript reads perfectly. Tool names still
appear in `tool_calls_made`, so a summary line saying "fired 3 tools" looks like
success. Only the DB rows — or the `Tool call X failed:` log line — reveal it.

**How to apply:**
- Never judge voice-assistant behavior from the transcript or a fired-tools
  list. Count the rows the call was supposed to create.
- A broad catch around tool dispatch must log loudly; a swallowed
  ReferenceError is indistinguishable from a handled business failure.
- Dev (`vite-twilio-ws-plugin.js`) and prod (`prod-server.cjs`) declare their
  call-scoped variables independently. Adding a context field to one bridge
  means declaring AND assigning it in the other.

Related: the "assistant name is hardcoded to Alex" decision had never reached
either voice bridge — dev defaulted to `'Sarah'` and prod's placeholder guard
only matched `{...}` templates, so a stale seeded DB value still won. Resolution
now lives in `lib/assistantName.cjs`, required by both.
