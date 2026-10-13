---
name: Staff voice PIN access
description: Phone-CRM staff auth via caller-ID candidate + spoken PIN — gate placement, lockstep, and the residual cross-staff PIN-plant risk.
---

# Staff voice PIN access

Feature doc: `docs/staff-voice-pin-access.md`. Durable notes not obvious from code:

- **The gate is server-side, not prompt-side.** Until `verify_staff_pin` succeeds, every other tool dispatch returns a LOCKED error in the bridge itself. Never rely on the prompt to withhold tools — prompt injection over voice is trivial.
- **Why:** caller ID is spoofable; the PIN is the only real auth factor. Caller-ID match only selects a candidate and a lean, data-free prompt.
- **Shared-line shadowing:** `findStaffByCallerPhone` must `continue` (not return null) past phone-matched rows without a PIN — two staff can share the same last-10 digits (office line) and row ordering must not shadow the PIN-holder.
- **Residual risk (open):** PIN hash/salt/lockout live as ordinary `staff_profiles.data` keys writable via the entity API — a same-company coworker could plant a known PIN for a victim profile, then spoof that caller ID to act under the victim's email. Fold `voice_pin_*` keys into the cross-staff write guard when the "non-admin staff can't change other staff fields" follow-up is built.
- **Lockstep:** dev (`vite-twilio-ws-plugin.js`) and prod (`prod-server.cjs` Sarah bridge ONLY — not the Lexi browser WS copies) staff blocks are verbatim-identical except pool source and tool-handler signature. Change one, change both.
- **Client-side hashing parity:** StaffProfilePage hashes with `sha256("salt:pin")` hex via crypto.subtle — must stay byte-identical to `lib/staffVoiceAuth.cjs` `hashPin`.
- Transcript digit redaction (3+ digit runs while unverified) must run before `conversationLog` pushes — all sinks (synopsis, live Communication insert, final save) derive from that log.
