---
name: AI call recording & transcript pipeline
description: How AI-answered call recordings + transcripts are captured; shared lib/callRecording.cjs; trust model of the recording webhook; live-transcript protection.
---

# AI call recording & transcript pipeline

Shared module: `lib/callRecording.cjs` (`startCallRecording`, `handleRecordingWebhook`,
`transcribeRecording`) — required by BOTH dev vite plugins and `prod-server.cjs` (fix once,
don't mirror; only the thin HTTP routes are mirrored per dev/prod endpoint parity).

Durable rules:

- **Twilio `<Connect><Stream>` never records on its own.** AI-answered calls must fire an
  explicit Twilio REST recording-start (dual-channel) on the stream `'start'` event, in both
  dev and prod WS handlers. Fire-and-forget: recording failures must never affect the call.
  Gated on company settings `enable_recording !== false`; company creds first, platform
  creds fallback (call may live on either account).

- **Cred fallback must dedupe on the sid+token PAIR, not SID alone.** A company
  TwilioSettings row can carry the platform account SID with a stale/wrong token; keying
  the platform-fallback skip on `envSid !== coSid` made that 401 unrecoverable (no
  recording, and the media download for transcription also failed). Applies to BOTH
  `startCallRecording` and `transcribeRecording`'s auth candidates, and to post-call SMS:
  a successful platform recording does not prove the tenant token is valid for its alert.
  **Why:** a live AI call recorded and transcribed successfully via platform fallback,
  while its immediate post-call SMS retried only the stale tenant token and failed 401.
  **How to apply:** any adjacent Twilio REST action must try distinct SID+token pairs,
  not reuse the first configured account blindly.

- **Post-call synopsis must use a currently supported text model.** Keep its model aligned
  with the project's other Gemini text calls and probe it when investigating missing
  overviews. **Why:** call recording and transcription can succeed while an obsolete
  synopsis model returns 404, leaving only the overview absent. **How to apply:** treat
  recording, transcription, synopsis, and alert delivery as separate stages in evidence
  and logs; never infer one from another.

- **Post-call email must WAIT for the recording webhook.** The recording URL + full
  recording-based transcript land in the communications row seconds AFTER hang-up; an
  email sent at hang-up only ever carries the partial live transcript and no listen link.
  In-app/SMS alerts stay immediate; the email polls the row (bounded: ~25s bail if no
  recording_url ever appears, 90s hard cap) and prefers `transcription_source==='recording'`.

- **Recording webhook (`/api/functions/recordingWebhook`) trust model:** derive a
  `trustedCompanyId` from the signature verification's `matchedToken`
  (see twilio-webhook-signature-verification.md) and scope ALL row lookups/patches and the
  fallback insert to it. Without scoping, a BYO tenant self-signing a payload with a stolen
  CallSid can overwrite another tenant's call rows.

- **Recording transcript is the source of truth; live is a partial fallback.** The live
  Gemini transcript misses utterance events, so the webhook ALWAYS transcribes the recording
  (when `enable_transcription !== false`) and promotes it to `transcription`/`transcript`,
  preserving the prior live text as `live_transcription`. Guards: an empty recording result
  or a failed download/Gemini call never clobbers existing live text, and a
  `transcription_source === 'recording'` row is not re-transcribed (Twilio retries the
  callback; a second Gemini pass would burn quota). Also remember the webhook + hang-up
  save race: dev/prod saveCallLog UPSERTs merge `data || EXCLUDED.data` so the recording
  patch survives whichever lands second.

- **Call rows live in the dedicated `communications` table.** The UI (Communication.jsx,
  SarahWorkspace.jsx) reads via the entity API which maps Communication to that table —
  rows written to `generic_entities` are invisible. Write BOTH `transcription` and
  `transcript` keys, and BOTH `call_sid` and `twilio_sid` (different readers use each).

- **Gemini Live transcript fields are `serverContent.outputTranscription.text` /
  `inputTranscription.text`** — the dev plugin read wrong keys for months and every dev
  transcript was silently empty while prod worked.

- **`retryTranscription` is served to prod via the functionHandlers fallthrough** (do NOT
  mirror in db/prod-integrations.cjs). Because it's reachable in prod, it self-authorizes:
  session caller must be super admin, have matching `users.company_id`, or hold a
  staff_profiles row in the target company (multi-location owners).

- Verify the prod deployment secret `TWILIO_REQUIRE_SIGNATURE=1` is set before relying on
  enforce-mode guarantees there (dev env has it; deployment secrets are separate).
