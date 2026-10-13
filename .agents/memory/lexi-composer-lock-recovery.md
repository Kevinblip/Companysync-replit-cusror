---
name: Lexi composer lock recovery
description: Prevents the in-app Lexi composer from becoming permanently blocked after cancelled or early-returned requests.
---

Every Lexi request path must release the submission lock, including confirmation prompts, cancellations, errors, and superseded responses. An interruption must invalidate its request ID before unlocking so a late response cannot overwrite newer UI state.

**Why:** The assistant input appeared available but silently rejected subsequent sends after a confirmation or interruption; creating a new conversation merely reset the stuck local state.

**How to apply:** Keep request cleanup in `finally`, and test both confirmation and interruption flows whenever changing the AIAssistant send lifecycle.