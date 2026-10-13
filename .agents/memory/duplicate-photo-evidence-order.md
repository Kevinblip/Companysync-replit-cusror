---
name: Duplicate photo evidence order
description: Duplicate observations must be excluded before every siding aggregate, not only from the final coverage graph.
---

Run source-level duplicate classification before dimensions, materials, masonry, openings, story/pitch votes, and confidence are aggregated. Keep all observations in the final evidence graph and photo breakdown for audit, but only accepted observations may vote.

**Why:** Excluding a duplicate only from the final graph correctly marks a face missing, yet the same copied image can still boost earlier measurements and confidence before that graph is built.

**How to apply:** Any new siding-photo aggregate should consume the accepted evidence set. Audit/UI outputs should continue using the complete input set so both duplicate labels remain visible.