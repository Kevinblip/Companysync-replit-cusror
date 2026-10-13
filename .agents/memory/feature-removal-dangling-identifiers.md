---
name: Feature removal leaves runtime-only dangling identifiers
description: Why a clean production build does not prove a deleted feature is fully removed from this app.
---

# Feature removal leaves runtime-only dangling identifiers

After deleting a feature's state/handlers from a large page component, a passing `vite build` does NOT prove the removal is complete. A reference to a deleted local (for example a leftover `setX([])` inside a surviving `useEffect`) is treated as a possible global by the bundler, so it builds fine and then throws `X is not defined` at render — the user sees the app's error boundary ("System Recovering"), not a build error.

**Why:** The estimator's eight-photo capture removal built and deployed-clean while one orphaned reset effect still called a deleted setter, taking the whole page down.

**How to apply:**
- After removing a feature, grep for every deleted identifier *and its setter* across `src/`, not just the feature's own block.
- Deleted React state has two names (`x` and `setX`); searching only the value name misses the crash site.
- Also sweep sibling components for now-unused props of the removed feature — they are dead branches that quietly preserve the deleted behavior.
- Treat build success as necessary, not sufficient; load the affected page (or a puppeteer crawl) before calling the removal done.
