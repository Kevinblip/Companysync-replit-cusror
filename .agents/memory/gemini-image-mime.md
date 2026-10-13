---
name: Gemini image MIME from bytes
description: Why AI photo analysis must sniff image bytes instead of trusting the served Content-Type
---

# Gemini image analysis: detect MIME from bytes, not the served header

Gemini's generateContent **rejects `application/octet-stream`** with HTTP 400
"Unsupported MIME type". That 400 propagates out of the photo-analysis handlers
as a generic **HTTP 500** to the user ("AI analysis failed: Request failed with
status 500").

**Root cause of the CrewCam 500:** uploaded photos are served by a handler that
derives Content-Type from the file **extension**, falling back to
`application/octet-stream` for any stored file whose name has no/unknown
extension (camera blobs, annotated canvas blobs, generated IDs). The analyzers
then passed that header straight to Gemini.

**Rule:** any code path that fetches an image URL and sends it to Gemini must
**sniff the actual magic bytes** (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP
`RIFF…WEBP`, HEIC `ftyp` + hei*/hev*/mif1/msf1, GIF `47 49 46`) and use a
Gemini-supported MIME (jpeg/png/webp/heic/heif/gif). Never trust the served
Content-Type. If bytes are unrecognized AND the header isn't a supported image
type, fail with a clear message ("not a valid image") rather than defaulting —
otherwise an HTML error page gets sent to Gemini and 500s confusingly.

**Why:** Gemini accepts the real image even when served as octet-stream — the
only thing wrong is the label. Sniffing fixes it regardless of how storage
labels the file. Verified: image/jpeg→200, application/octet-stream→400,
image/heic→200.

**How to apply:** shared helpers `detectImageMime(buf, headerMime)` and
`fetchImageAsBase64(url)` live near `callGeminiMultiImage` in
`vite-functions-plugin.js`. Production uses these same handlers via the dynamic
import in `db/prod-integrations.cjs` `handleFunctionInvoke`, so fixing the vite
plugin fixes both dev and prod for function-invoke handlers. Other Gemini image
paths (e.g. `fetchFileAsBase64`/`callGeminiWithSchema` in prod-integrations, and
scattered `headers.get('content-type')||'image/jpeg'` sites) still have the old
pattern — reuse the byte-sniff if they start failing the same way.
