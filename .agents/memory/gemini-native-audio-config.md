---
name: Gemini native-audio voice config
description: Config rules for the Gemini Live native-audio bridges (phone + Lexi) — token caps, persona rules placement, shared model env lever.
---

# Gemini native-audio voice config

## Never set max_output_tokens on native-audio Live sessions
**Why:** In native audio mode, output tokens are chunks of *sound*, not words. A text-minded cap like 100–150 tokens (~a few seconds of speech) hard-cuts the assistant mid-sentence. An external spec doc recommended this cap in July 2026; it was deliberately rejected.
**How to apply:** Enforce brevity via system-prompt rules ("1–2 short sentences") instead. If anyone asks to add a token cap to the voice setup message, push back with this reason.

## Persona/voice rules live as a universal suffix, not per-branch
The "VOICE & BEHAVIOR RULES" block (brevity, natural flow, one question at a time, handle interruptions, intent) is appended to the phone system prompt AFTER `buildSystemPrompt()` returns — so it covers default, forwarded, outbound, AND custom subscriber prompts.
**Why:** Editing each prompt branch separately drifts; custom subscriber prompts would silently miss the rules.
**How to apply:** Keep the block byte-identical in the dev bridge (vite-twilio-ws-plugin.js) and prod bridge (prod-server.cjs). New persona rules go in this suffix, not into individual branches.

## Production model experiments have intentionally limited scope
Do not automatically propagate production model or voice experiments to every
phone line or development bridge.
**Why:** On 2026-10-03 the user requested a specific inbound-line experiment,
then separately expanded it to the production web assistant while keeping Aoede.
This superseded the earlier decision to align every bridge behind one rollback lever.
**How to apply:** Inspect each handler before assuming a shared model environment
variable overrides it. Preserve unrequested lines and development behavior.
Verify new model/voice/tool payloads against the real Live API without CRM side effects.
