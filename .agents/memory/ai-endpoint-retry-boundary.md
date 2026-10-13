---
name: AI endpoint retry boundary
description: Why transient AI failures need a bounded retry at the browser-to-integration boundary even when provider fetches already retry.
---

Retry transient AI integration failures once at the browser API boundary. Do not retry authorization, validation, usage-limit responses, or a server-declared document timeout.

**Why:** provider-level retries only cover the outbound request from the server to the model. A transient failure elsewhere in the integration endpoint still returns a 5xx to the browser, producing the characteristic “first Analyze fails, second click succeeds” behavior. Conversely, long PDFs must have one sufficiently long model deadline; multiplying short 60-second deadlines turns one click into several minutes of duplicate work.

**How to apply:** keep the browser retry bounded to one extra attempt and restrict it to network errors, malformed/empty gateway responses, and retryable HTTP 5xx. Preserve 4xx responses such as usage caps so retries cannot double-charge or bypass enforcement. For requests with uploaded documents, use one longer server-side deadline and set an explicit non-retryable timeout response.