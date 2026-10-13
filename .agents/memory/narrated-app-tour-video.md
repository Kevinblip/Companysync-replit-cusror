---
name: Narrated app-tour / training video pipeline
description: How to produce a narrated training/onboarding video over REAL screenshots of an auth-gated app (capture + Gemini TTS + FFmpeg assembly).
---

# Narrated app-tour video pipeline

Reusable recipe for "make a training/onboarding video over real app screenshots".
The scripts lived in `.local/video/` (ephemeral) — this captures the non-obvious parts.

## Capturing auth-gated pages
- The app is auth-gated on client AND server, so you cannot screenshot pages by URL alone.
- Forge a signed session cookie: mint the same signed `connect.sid` the app's session
  layer produces (requires the `SESSION_SECRET` env var to be set), then set it via
  puppeteer `page.setCookie({ name:'connect.sid', value: <URL-encoded signed value>,
  domain:'localhost', path:'/', httpOnly:true })`. The value MUST be `encodeURIComponent`'d.
- Reference for cookie/session signing: `db/local-auth.cjs`.
- Seed a DEDICATED fictional demo company (safe fake data), never a real tenant — real
  tenant rows contain PII. Seeder must pass `id = crypto.randomUUID()` on every
  `generic_entities` insert (no DB default).
- Dismiss the onboarding tour popup by clicking its "No thanks" button in `page.evaluate`;
  do NOT climb parent nodes to remove overlays (nuked the page root once).
- Capture uses puppeteer-core + a Nix `chromium` (headless). Both are DEV-ONLY — uninstall
  them after producing the video so the production app's deps stay clean.

## Narration = Google Gemini TTS (NOT ElevenLabs)
- Model `gemini-2.5-flash-preview-tts`, voice `Kore`, auth via `GOOGLE_GEMINI_API_KEY`.
- generateContent with `generationConfig.responseModalities:['AUDIO']` +
  `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`.
- Returns **raw** `audio/L16` PCM (16-bit LE mono, 24000 Hz) as base64 with NO container —
  you must wrap it in a 44-byte WAV header yourself before FFmpeg will use it.
- A short style prefix ("Read this in a warm, upbeat, professional narration voice: …")
  steers tone.

## Assembly (FFmpeg 6.x, pre-installed)
- Per segment: still → Ken Burns via `zoompan` (scale image to ~2x first to reduce jitter,
  output 1920x1080@30) + `drawtext` caption pill (font
  `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf`) + that segment's WAV as audio,
  with `fade` in/out on both video and audio.
- Concatenate segment MP4s with the concat demuxer.
- Build per-clip IDEMPOTENTLY (skip clips that already exist): a full 7-9 segment 1080p
  encode exceeds the 120s shell timeout, so batch/resume instead of one long run.
- Capturing all pages in one puppeteer run also exceeds 120s — capture in batches
  (e.g. an `ONLY=06,07` env filter) or mint a fresh session per batch.

## Capture gotchas (learned the hard way)
- Scroll-to-section-by-text helpers MUST exclude the sidebar or they scroll the nav
  link instead of the page section. Do NOT exclude via `[class*="sidebar"]` — the
  shadcn layout wrapper puts sidebar-ish classes on the WHOLE page, which excludes
  everything. Use `!el.closest('nav,aside,[data-sidebar]')`.
- ALWAYS visually inspect every captured screenshot before assembly — capture doubles
  as a smoke test and has caught real page crashes (error-boundary screens) that
  would otherwise ship inside the video.
- When re-running capture in the background, verify output file mtimes afterward; a
  mis-quoted nohup/background chain can silently never start while an old log makes
  it look like it ran.
- Deep links to the Training Videos page use `?v=` as a 1-based INDEX into the CLIPS
  array — new clips must be APPENDED at the end, never inserted mid-array, or every
  later index shifts and links in already-sent onboarding emails break.
