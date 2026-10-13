---
name: Lexi build-change confirmation
description: Confirmation contract for new builds and build date/customer changes.
---

New build scheduling and changes to a build's customer, date, or job type must pause before writing and ask the user to confirm the exact resolved customer name and date. Approval must be bound to those exact details; a corrected or misheard name or date requires a new confirmation.

**Why:** Voice transcription can resolve a different customer name than the user intended. A conversational instruction alone did not prevent Lexi from scheduling the misheard customer immediately.

**How to apply:** Enforce the pause in every build tool handler, not only in prompts. The first call returns a confirmation token and writes nothing. Accept the token only for the same tenant, user, record/action, customer, date, and job types. A “no” or correction discards the pending approval.

The token itself is not proof that a separate user turn occurred. Text handlers must stop after returning the proposal and only pass the pending token on a later explicit affirmative message; voice handlers must reject a token replay until a new user reply is transcribed as affirmative.

**Why:** A model can receive a confirmation tool result and immediately call the same tool again in the same generation, effectively approving its own action.

**How to apply:** Keep the separate-turn boundary at the orchestration layer as well as in each tool guard. Preserve the token/details in the UI or live-session state, but do not expose the token to the user.