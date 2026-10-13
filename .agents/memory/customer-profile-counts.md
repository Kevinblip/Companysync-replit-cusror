---
name: Customer profile section counts
description: Sidebar badges must use data that loads before the corresponding section is opened.
---

Customer profile badges must not depend on a query enabled only when that section
is active. Load the small source collection with the profile, or use a separate
always-enabled count query, and share the same cache key with the section view.

**Why:** A lazily enabled section query makes an existing record appear to have
zero items until the user opens that section, which makes the sidebar count
misleading.

**How to apply:** When adding a profile badge, verify its query is enabled on
profile load and that upload/create/delete mutations invalidate the badge's
query key.