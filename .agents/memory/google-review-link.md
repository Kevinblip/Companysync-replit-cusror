---
name: Google review link
description: The customer-facing Google review destination confirmed by the project owner
---

Use `https://tiny.one/letsreview` as the default customer-facing Google review link.

**Why:** The owner confirmed this short link works, while the previous placeholder/search fallbacks did not reliably open the intended review destination.

**How to apply:** Preserve an explicitly configured company-specific review URL, but use this link whenever a review URL is missing and never fall back to the old `g.page/r/review` placeholder or a Google search page.