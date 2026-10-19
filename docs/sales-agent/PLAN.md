# AI Sales Rep MVP: build plan (staging only)

## What exists already (reuse)
- **Voice engine:** Gemini Live native audio (`models/gemini-3.1-flash-live-preview`, override `GEMINI_NATIVE_AUDIO_MODEL`). Voices `VALID_GEMINI_VOICES = Aoede, Charon, Fenrir, Kore, Leda, Orus, Puck, Zephyr`. Phone path: Twilio `<Connect><Stream>` → `/ws/twilio` (prod-server.cjs ~11265, dev `vite-twilio-ws-plugin.js`). Browser path: Lexi `/ws/lexi-native` (voice Aoede, staff-auth via `lib/lexiWsAuth.cjs`). No Twilio ConversationRelay in use.
- **Existing sales scenario:** `buildSystemPrompt(..., scenario='saas_demo')` fires when the CompanySync demo number (216) 777-7154 resolves to `companysync_master_001`. Its prompt is stale ("$99/month flat").
- **Recording/transcripts:** `lib/callRecording.cjs` (REST dual-channel recording on stream start, recording webhook, Gemini transcription, `communications` table rows).
- **Staging guard:** `lib/stagingSideEffects.cjs`. With `STAGING_READ_ONLY_SIDE_EFFECTS=1`: Twilio SMS/calls, Postmark/SES/Gmail sends are faked and logged, `armInterval/armTimeout` schedulers don't start. **Staging is pointed at the live production database**, so any DB write from staging is a live write.
- Workflow engine `functions/processWorkflowQueue.ts`, daily reports `sendScheduledDailyReports.ts`, Google Calendar sync, `sendEmail()` in prod-server.

## Decisions
1. **Male voice:** Gemini Live `Fenrir` by default (Alex's default is `Puck`, so the two sound different), configurable `SALES_AGENT_VOICE` (Charon, Orus, and Puck are the other male options). Persona name in config `SALES_AGENT_NAME` (placeholder "Cole"; "Marcus" is taken by the AI marketing teammate). Kevin picks the name.
2. **Sounds like a hired rep, but honest:** natural, short turns, no scripts read aloud. If asked, it says exactly "Yes, I'm an AI assistant." (the repo's rule and what the product promises for Alex in clip 20; also the legal-safe choice for recorded and AI-voice calls). It opens with a recording notice: "This call is recorded so our team can follow up."
3. **Channel for v1 = web call on staging** (a `/SalesDemo` page: big "Talk to a rep" button, mic via WebSocket, video panel). Only a web call can *play clips on screen*. No Twilio number needed, so nothing to buy. Phone (7154 / a new number) is phase 2 and owned by the YICN Admin Bot. The 7154 webhook points at live, so don't touch it.
4. **Clips:** the 33 public training videos, played at key-moment timestamps (`demo-clips.json`) via a Gemini tool call `play_clip({id, start, end})`. The agent stops talking while a clip plays, and the clip pauses when the prospect speaks (barge-in). Staging 404s on `/videos/*`, so use absolute `https://getcompanysync.com/videos/<id>.mp4` URLs. The 27 male-narrated tour clips show real YICN customer data, so they're excluded until blurred.
5. **Data writes:** a `salesStore` adapter. On staging (`STAGING_READ_ONLY_SIDE_EFFECTS=1`, or `SALES_AGENT_DRY_RUN=1`) it writes to a local JSON/SQLite file on the container, with **zero writes to the shared prod DB**. A DB adapter (Lead + Communication + CalendarEvent rows under `companysync_master_001`) ships behind a flag that stays off until Kevin approves.
6. **Pricing:** loaded from `config/salesPricing.json` (Basic $99, Business $199, Enterprise $399/mo + 14-day no-card trial, decided by Kevin). The agent can't say any other number. App pricing/checkout ($59/$149/$299) alignment is a separate flagged PR item.

## Scope (Kevin-approved full flow)
1. **Booking:** `book_demo` tool + public booking widget. Slots come from the master company calendar (read-only), with a fallback to configured hours. Instant confirmation by SMS and email with an `.ics` invite (METHOD:REQUEST) and a preview clip matched to the lead's trade.
2. **Reminders:** 24 h and 1 h, each with a signed one-tap reschedule link (`/SalesDemo/reschedule?t=<HMAC token>`). No-show detector: if the web call hasn't joined 10 minutes after start, send the rebook message.
3. **Live demo:** discovery → trade-tailored clip path (KB §3) → rebuttals for price, switching, "already use JobNimbus", "need to think" (KB §5) → close on the call: send the trial link (`/PublicPricing` → OnboardingWizard) or the subscription link. The agent never starts trials, takes payments, or discounts.
4. **Handoff:** `handoff_to_rep` tool books a rep slot, writes the call summary (template in copy §5), notifies the rep in-app and by email, and sends the prospect confirmation. On a live call (phase 2) it uses the existing `transfer_call` path.
5. **Follow-ups:** a 14-day non-buyer sequence (day 0 recap, day 2 objection email, day 5 check-in call or SMS, day 9 trial nudge, day 14 breakup) and trial check-ins on days 1, 3 and 7. Stops on reply, trial, purchase, STOP or rep takeover. Implemented as rows in a `SalesSequenceStep` queue plus one scheduler registered via `armInterval` (inert on staging). An admin "Simulate next 14 days" button renders every message that *would* go out.
6. **Record, transcribe, log:** web call: the server writes both audio legs to WAV/Opus (object storage on prod, container disk on staging), uses Gemini Live input/output transcription plus the post-call Gemini synopsis (reuse the `callRecording.cjs` synopsis). Pipeline stages: `New → Demo Booked → Demo Held / No-Show → Handoff → Trial Started → Subscribed / Lost`. Daily summary for Kevin (copy §8) at 7:00 AM America/New_York through the existing daily-report path (suppressed on staging, previewable).
7. **Admin page** `/SalesAgentAdmin` (super-admin only): calls, recordings, transcripts, pipeline board, message previews, the outbound log (suppressed sends), config (name, voice, pricing JSON, clip map).

## Safety rails in code
- Every send goes through the existing `sendEmail` / Twilio fetch paths so the staging guard catches it. Tests assert `[staging] suppressed` for every message type.
- Public WS endpoint `/ws/sales-demo`: no staff auth, so limit it with a per-IP rate limit, max 20-minute session, origin check, and a short-lived signed session token from `/api/sales-demo/session`.
- No new npm deps that need a paid service. Node v20.12.2. Dev (vite plugins) and prod (prod-server.cjs) stay in lockstep per repo memory.
- Existing `saas_demo` prompt: switch it to the shared KB prompt builder and remove the "$99 flat" line (phone path only, for when phase 2 goes live).

## Monthly cost estimate (production, after launch)
Assumes 100 demo calls/month × ~15 min = 1,500 min. Prices checked Oct 18, 2026.
| Item | Rate | Monthly |
|---|---|---|
| Gemini Live audio (in $0.005/min, out $0.018/min, plus context re-billing on long calls) | ~$0.04–0.10/min effective | $60–150 |
| Post-call synopsis + summaries (Gemini Flash text) | ~$0.001/call | <$1 |
| Web call transport | own server | $0 |
| Recording storage (Opus ~0.1 MB/min) | object storage | <$1 |
| Email (existing Postmark) | ~15 emails/lead | within the existing plan |
| SMS (~10/lead, 1,000 segments) | ~$0.0083 + carrier fees | ~$10–15 |
| **Phase 2 phone:** inbound $0.0085 + Media Streams $0.0044 + recording $0.0025 | ~$0.0154/min | ~$23 |
| Phase 2 outbound day-5 check-in calls (100 × 2 min) | $0.014/min + streams | ~$4 |
| Phone number | reuse 7154 / $1.15 new | $0–1.15 |
| **Total** | | **~$75–170/mo (web only) · ~$100–195/mo with phone** |
Staging testing: a few dollars of Gemini usage on the existing key. Nothing to buy. Twilio ConversationRelay ($0.07/min) isn't needed because the Gemini Live bridge already exists.

## Phases
- **MVP (this PR, staging):** web call + clips + KB prompt + booking/ICS + reminders/no-show + handoff + sequences (preview-only) + recording/transcripts + pipeline + daily summary + admin page, dry-run store.
- **Phase 2 (needs Kevin + YICN Admin Bot):** phone path on 7154 or a new number, outbound check-in calls, DB adapter on, real sends on live after publish.
- **Phase 3:** fully live screen-driven demo on a seeded demo tenant (instead of recorded clips).

## Open questions for Kevin
1. ~~Prices~~ DECIDED: $99/$199/$399.
2. Agent name (placeholder "Cole") and voice (Charon / Orus / Puck)?
3. Which human rep(s) get handoffs, and whose calendar has the slots?
4. Is free migration a promise we can make? (Right now only "data migration assistance" on Enterprise.)
5. Are Hearth/GreenSky/Wisetack and ABC Supply live integrations the agent may name?

