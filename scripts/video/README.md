# Training Video Generation Scripts

These scripts generate the 26 per-topic training videos served from `public/videos/`.

All commands run from the **project root** (or `scripts/video/` — paths below are root-relative).

---

## File map

| File | Purpose |
|------|---------|
| `capture-live.cjs` | Puppeteer script — navigates the live app and saves 9 screenshots per topic |
| `segments-long-live.cjs` | Beat→screenshot mapping for topics 1–6 (dashboard … invoices) |
| `segments-v2-live.cjs` | Beat→screenshot mapping for topics 7–16 |
| `segments-v3-live.cjs` | Beat→screenshot mapping for topics 17–26 |
| `assemble-long.cjs` | Builds Ken Burns MP4 clips per beat, then concatenates — topics 1–6 |
| `assemble-v2.cjs` | Same assembler for topics 7–16 |
| `assemble-v3.cjs` | Same assembler for topics 17–26 |
| `recapture-all.cjs` | One-shot orchestrator — re-captures + rebuilds all 26 topics (~10 min) |

Screenshot store (`scripts/video/shots-live/`) is **not** tracked by git and must be regenerated whenever the UI changes significantly.

---

## Topic → video mapping

| # | Topic key | Output file |
|---|-----------|-------------|
| 01 | `dashboard` | `clip01-dashboard.mp4` |
| 02 | `leads` | `clip02-leads.mp4` |
| 03 | `estimates` | `clip03-estimates.mp4` |
| 04 | `ai-estimator` | `clip04-ai-estimator.mp4` |
| 05 | `build-schedule` | `clip05-build-schedule.mp4` |
| 06 | `invoices` | `clip06-invoices.mp4` |
| 07 | `customers` | `clip07-customers.mp4` |
| 08 | `staff` | `clip08-staff.mp4` |
| 09 | `communications` | `clip09-communications.mp4` |
| 10 | `automations` | `clip10-automations.mp4` |
| 11 | `storm-tracking` | `clip11-storm-tracking.mp4` |
| 12 | `settings` | `clip12-settings.mp4` |
| 13 | `reports` | `clip13-reports.mp4` |
| 14 | `financing` | `clip14-financing.mp4` |
| 15 | `mobile` | `clip15-mobile.mp4` |
| 16 | `reviews` | `clip16-reviews.mp4` |
| 17 | `quickbooks` | `clip17-quickbooks.mp4` |
| 18 | `contracts` | `clip18-contracts.mp4` |
| 19 | `pricelist` | `clip19-pricelist.mp4` |
| 20 | `aivoice` | `clip20-aivoice.mp4` |
| 21 | `portal` | `clip21-portal.mp4` |
| 22 | `photos` | `clip22-photos.mp4` |
| 23 | `calendar` | `clip23-calendar.mp4` |
| 24 | `gohighlevel` | `clip24-gohighlevel.mp4` |
| 25 | `tasks` | `clip25-tasks.mp4` |
| 26 | `onboarding` | `clip26-onboarding.mp4` |

---

## When to re-capture

Re-run screenshots after **any** of:
- New pages added or removed from the nav
- Page URLs / route names changed
- Major layout redesigns (hero section, key widget, primary CTA)
- Renamed sections that appear in the narration captions

Minor styling tweaks (color, spacing, icon swaps) don't require a full re-capture.

---

## Step 0 — Get a valid session cookie

Screenshots are taken from an authenticated browser session.  **`COOKIE` is required** — the scripts will exit immediately with an error if it is missing.  The cookie lasts **~7 days** before it expires and must be refreshed each time.

1. Open the app in Chrome and log in as an admin.
2. Open DevTools → Application → Cookies.
3. Copy the **value** of `connect.sid` (the long URL-encoded string starting with `s%3A`).
4. Export it before running any capture command:

```bash
export COOKIE='s%3A<rest-of-value>'
```

The cookie must belong to an admin account that can see all pages.

> **Tip:** Store the refreshed value in a secure scratchpad between sessions so you don't need to log into DevTools every time.

---

## Step 1 — Start the dev server

```bash
npm run dev
# confirm it is listening on http://localhost:5000
```

---

## Step 2 — Capture screenshots

### Single topic (fastest for spot-fixes)

```bash
TOPIC=dashboard node scripts/video/capture-live.cjs
# or, with an explicit cookie:
COOKIE='s%3A...' TOPIC=leads node scripts/video/capture-live.cjs
```

### Several topics at once

```bash
TOPICS=dashboard,leads,estimates node scripts/video/capture-live.cjs
```

### All 26 topics (batched 3 at a time)

```bash
node scripts/video/recapture-all.cjs
# or via npm:
npm run video:recapture
```

`recapture-all.cjs` runs capture in three parallel batches of ~9 topics each, waits for all captures to finish, then drives each assembler automatically. Total runtime ≈ 10 minutes.

Output screenshots land in `scripts/video/shots-live/<topic>-NN.png`.

---

## Step 3 — Rebuild clips (if you only ran capture manually)

Skip this step if you used `recapture-all.cjs` — it handles assembly automatically.

### Topics 1–6  (`assemble-long.cjs`)

```bash
# Build all 54 per-beat clips (can batch: e.g. 0 18, 18 36, 36 54 in parallel)
FORCE=1 node scripts/video/assemble-long.cjs 0 54

# Concatenate into final MP4s for topics 1–6
node scripts/video/assemble-long.cjs concat
```

### Topics 7–16  (`assemble-v2.cjs`)

```bash
FORCE=1 node scripts/video/assemble-v2.cjs 0 90

# Concat each topic individually (topic-key + output number):
node scripts/video/assemble-v2.cjs concat customers      07
node scripts/video/assemble-v2.cjs concat staff          08
node scripts/video/assemble-v2.cjs concat communications 09
node scripts/video/assemble-v2.cjs concat automations    10
node scripts/video/assemble-v2.cjs concat storm-tracking 11
node scripts/video/assemble-v2.cjs concat settings       12
node scripts/video/assemble-v2.cjs concat reports        13
node scripts/video/assemble-v2.cjs concat financing      14
node scripts/video/assemble-v2.cjs concat mobile         15
node scripts/video/assemble-v2.cjs concat reviews        16
```

### Topics 17–26  (`assemble-v3.cjs`)

```bash
FORCE=1 node scripts/video/assemble-v3.cjs 0 90

node scripts/video/assemble-v3.cjs concat quickbooks   17
node scripts/video/assemble-v3.cjs concat contracts    18
node scripts/video/assemble-v3.cjs concat pricelist    19
node scripts/video/assemble-v3.cjs concat aivoice      20
node scripts/video/assemble-v3.cjs concat portal       21
node scripts/video/assemble-v3.cjs concat photos       22
node scripts/video/assemble-v3.cjs concat calendar     23
node scripts/video/assemble-v3.cjs concat gohighlevel  24
node scripts/video/assemble-v3.cjs concat tasks        25
node scripts/video/assemble-v3.cjs concat onboarding   26
```

Final videos land in `public/videos/clip01-dashboard.mp4` through `clip26-onboarding.mp4`.

---

## Batching clips in parallel (faster builds)

Each assembler accepts a beat-index range, so you can run three terminal windows simultaneously:

```bash
# Topics 1-6, split into three parallel batches:
FORCE=1 node scripts/video/assemble-long.cjs  0 18 &
FORCE=1 node scripts/video/assemble-long.cjs 18 36 &
FORCE=1 node scripts/video/assemble-long.cjs 36 54 &
wait
node scripts/video/assemble-long.cjs concat
```

The same 0/30/60–90 split works for `assemble-v2.cjs` and `assemble-v3.cjs`.

---

## Design notes

- Each topic has exactly **9 beats**; each beat uses one distinct screenshot.
- Ken Burns effect (zoom + pan to a different focal point per beat) creates motion from static images.
- Audio narration per beat comes from pre-recorded WAV files in `scripts/video/audio-long/`, `audio-v2/`, `audio-v3/`. WAV files do **not** need to be regenerated when screenshots change.
- `capture-live.cjs` never uses `page.goBack()` (unreliable in Puppeteer SPA navigation) — all navigation uses explicit `page.goto()`.
- `FORCE=1` on the assembler skips the "clip already exists" cache check and rebuilds every clip unconditionally.
