---
name: pages.config.js is hand-maintained
description: src/pages.config.js claims to be auto-generated but is not; new pages need manual registration
---

`src/pages.config.js` carries a comment implying it is auto-generated, but there is no generator script anywhere in the repo that produces it. It is actually hand-maintained.

**Why:** Trusting the comment and skipping manual registration means a new page component renders fine in isolation but its route 404s in the app, because nothing wired it into the router/page registry. This has bitten more than one new page (e.g. GoHighLevelSettings, JobNimbusSettings) before the pattern was recognized.

**How to apply:** Whenever adding a new page under `src/pages/`, manually add both the import statement and the corresponding `PAGES` entry to `src/pages.config.js` — do not assume it will be picked up automatically.
