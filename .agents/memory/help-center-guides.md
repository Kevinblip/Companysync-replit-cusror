---
name: Help Center built-in guides
description: Where in-app how-to docs live and why they are baked into code, not a per-company KB
---

# Help Center built-in product guides

The Help Center widget (`src/components/help/HelpWidget.jsx`) surfaces how-to
docs from a **built-in, in-code catalog** (`src/data/productGuides.js`), merged
on top of each company's own `KnowledgeBaseArticle` entities.

**Rule:** To add/change app how-to docs, edit `productGuides.js` — do NOT create
per-company KnowledgeBase articles for product features.

**Why:** The owner explicitly does NOT want to hand-write/maintain a separate
knowledge base article per feature. Baking guides into the app means every
company gets them automatically, always in sync with the product, zero upkeep.
The per-company KB is reserved for *their own* material (pricing sheets, SOPs).

**How to apply / gotchas:**
- Each guide's optional `route` must be a valid page key from `src/pages.config.js`
  (routes are `/{PageName}`). The "Open this page" button navigates to `/{route}`.
  An invalid route = dead link.
- Search/suggestions/AI-answer all score across the guide `keywords[]` arrays and
  the merged list (`[...PRODUCT_GUIDES, ...companyArticles]`). Page-aware
  suggestions put guides whose `route` matches the current pathname first.
- Pure **frontend** change — no dev/prod handler parity needed (guides ship in the bundle).
- ArticleView renders content via `dangerouslySetInnerHTML`; company KB content is
  user-controlled, so content is HTML-escaped first (`renderArticleHtml`) before the
  lightweight markdown pass. Keep that escaping if you touch the renderer.

## Training videos are seeded data, not a generated feature

Training videos shown in the Help Center are `TrainingVideo` rows in
`generic_entities` (slide-deck style: `data.slides[]` each with `imageUrl`,
`caption`, `narration`, `audioUrl`) — there is no in-app "record/generate video"
feature. They're authored offline via a screenshot(Puppeteer) + TTS(Gemini) +
object-storage-upload + direct-SQL-insert pipeline, with the working scripts
kept in `.local/video/` (gitignored, not discoverable by future code search).

**Why:** the owner wanted narrated walkthroughs without building real video
recording/editing infra; slides+audio played in sync is a cheap stand-in for
an actual video and reuses existing TTS/object-storage capabilities.

**How to apply:** to add a new training video, recreate the pipeline (capture
screenshots of the target pages with a logged-in session cookie, write
narration text, TTS it, upload both to object storage, insert a
`TrainingVideo` generic_entities row with a `slides[]` array) — don't expect
to find a reusable script already checked into git.
