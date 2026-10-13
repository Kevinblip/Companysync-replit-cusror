---
name: Sequential per-item AI calls + swallowed fetch errors = silent zero-result UI
description: Multi-item AI analysis (e.g. per-photo Gemini calls) done sequentially can take minutes and trip a timeout; if the frontend's function-invoke wrapper swallows that failure into a fake success, the UI renders zeros/undefined instead of an error.
---

Symptom: a multi-photo (or multi-item) AI analysis feature returns a "successful" result where every numeric field is 0 and enum/string fields show literally "undefined" — but calling the same backend handler directly with one item works perfectly.

Two compounding bugs, both must be checked when this pattern appears:

1. **Sequential AI calls scale badly.** A `for (const item of items) { await callGemini(...) }` loop that takes ~15-30s per item is fine for 1-2 items but takes minutes for 6-8+, easily exceeding an upstream/proxy timeout. Fix: run per-item AI calls concurrently with `Promise.all` (collect logs/results per item, then flatten in original order afterward) — this is safe as long as the AI-call helper (e.g. `callGemini`/`fetchWithRetry`) is stateless per call.

2. **Silent error swallowing in the local function-invoke wrapper.** `invokeLocalFunction` (in `src/api/base44Client.js`) catches ALL failures (network error, timeout, non-JSON response) and *returns* `{ error: msg, data: {} }` instead of throwing. Callers that only check `data.success === false` never see `response.error`, so a hard failure renders as if the handler returned an empty-but-successful object. Any call site consuming this pattern must check `response?.error` first, and ideally also sanity-check that a required field actually exists in `data` before treating it as success.

**Why:** both bugs individually are subtle (one is a performance/timeout issue that only appears at higher item counts, the other is an error-handling contract mismatch that only misfires exactly when the first bug's timeout occurs), so they were very hard to diagnose from the reported symptom alone. Reproducing with a real multi-item request via curl at increasing item counts (1, 2, 4, 8) revealed the escalating latency and eventual timeout directly.

**How to apply:** when a batch/multi-photo/multi-item AI feature "returns success" but with empty/zero/undefined data, first time a single-item request to see if it's fast and correct, then time it at the real item count the user used. If it scales linearly and exceeds ~60-100s, parallelize. Separately, audit the frontend's response handling for whether it checks the wrapper's top-level `error` field, not just a `data.success` flag.
