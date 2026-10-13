---
name: Lexi tool-result fallback
description: Prevents typed Lexi from discarding a successful tool result when the model returns no natural-language follow-up.
---

After a successful tool call, an empty or whitespace-only model response must fall back to a concise, factual rendering of that tool's result—not a generic greeting.

**Why:** A generic greeting makes a completed lookup look like the assistant lost the conversation, even though the data was retrieved. It also hides whether the result was empty versus a backend failure.

**How to apply:** Keep the fallback shared across the development and deployed typed-chat handlers. For area searches, state both the requested area and whether matches were found; retain a neutral failure message for real tool errors.