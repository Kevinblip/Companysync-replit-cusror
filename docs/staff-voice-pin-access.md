# Staff Voice PIN Access (phone CRM via Lexi)

Staff can call their company's AI phone number from their own cell phone and, after speaking a personal PIN, use Lexi's full CRM tool set by voice (look up leads, create tasks, check schedules, etc.).

## How it works

1. **Caller-ID candidate match** — on a plain inbound call, the Twilio bridge looks up the caller's number (last-10-digit match) against active `staff_profiles` rows for the answering company. A match only makes the caller a *candidate*: caller ID is spoofable, so nothing is unlocked yet. Matching requires the profile to be `is_active` AND have a voice PIN set.
2. **Lean staff prompt** — candidates get a data-free staff prompt (no customer names, no company knowledge base) plus the greeting "Hey <first name>! …PIN please". The customer-facing script is never used.
3. **Spoken PIN = the real auth factor** — the model calls the `verify_staff_pin` tool with the digits the caller speaks. The server checks a salted SHA-256 hash stored in `staff_profiles.data` (`voice_pin_salt` / `voice_pin_hash`). Until it verifies, **every other tool returns a LOCKED error server-side** — the gate cannot be bypassed by prompt injection.
4. **After verification** — tool calls run through the same handler the in-app Lexi assistant uses (`handleLocalToolCall` dev / `handleLexiToolCall` prod), attributed to the verified staff member's email and timezone.

## Guardrails

- **3 PIN attempts max per call** (in-memory), **5 failed attempts → 15-minute lockout** persisted in `staff_profiles.data` (`voice_pin_failed_count` / `voice_pin_locked_until`) so redialing doesn't reset it.
- **Digit redaction** — while unverified, runs of 3+ digits in both input and output transcriptions are replaced with `[PIN redacted]` before they reach `conversationLog` / live call records, so the spoken PIN never lands in stored transcripts.
- **Staff mode only on plain inbound calls** — never on outbound campaigns, forwarded-rep lines (`isForwardedCall`), or transfer returns.
- A DB/lookup failure fails open **to the customer flow** (never to staff mode).

## Where the code lives

| Piece | File |
|---|---|
| Shared auth logic (lookup, hash, verify, lockout, redaction, prompt, tool decl) | `lib/staffVoiceAuth.cjs` |
| Dev Twilio bridge wiring | `vite-twilio-ws-plugin.js` |
| Prod Twilio bridge wiring (mirrored) | `prod-server.cjs` (Sarah bridge only — NOT the Lexi browser WS) |
| Lexi tool set + dev tool handler (named exports) | `vite-lexi-native-plugin.js` (`LEXI_CRM_TOOLS`, `handleLocalToolCall`) |
| PIN setup UI (own profile only) | `src/pages/StaffProfilePage.jsx` — hashes client-side with the same `sha256("salt:pin")` hex format |
| Unit tests (pre-push check 15c) | `scripts/test-staff-voice-auth.cjs` |

## Setting a PIN

Staff Profile page → "Voice PIN" field (visible only when viewing your own profile). 4–6 digits; stored as salt + hash in `staff_profiles.data`; setting a new PIN resets the lockout counters. PIN keys are registered in `REP_OWNED_DATA_DEFAULTS` so an admin saving someone else's profile never clobbers them.

## Lockstep rule

The staff-mode blocks in `vite-twilio-ws-plugin.js` and `prod-server.cjs` are intentionally verbatim-identical except for the pool source (`getSharedPool()` vs `prodDb.getPool()`) and the tool-handler call signature. Change one, change both.
