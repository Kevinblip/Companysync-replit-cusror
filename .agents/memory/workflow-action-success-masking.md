---
name: Workflow action success masking
description: executeWorkflowAction's send_email/send_sms skip paths and error catches must return a signal, not swallow silently, or every caller logs a skipped/failed send as a success.
---

`executeWorkflowAction` (vite-functions-plugin.js) has multiple internal skip points (unresolved recipient token, no recipient email/phone) and a catch block around the actual send call. All of these used to either `return;` (bare) on skip or just `console.warn`/swallow in the catch — meaning the function always resolved "successfully" from the caller's point of view even when nothing was actually sent.

Every caller that cares about the outcome (the `processWorkflowQueue` cron for delayed/scheduled steps, and the manual "Test" button handler for a workflow) trusted a bare successful resolution as proof of delivery, so a misconfigured/missing recipient silently showed up as "sent" in cron logs and in the test-run UI.

**Why:** discovered because a customer-facing follow-up workflow appeared to run fine (no errors anywhere) but never actually emailed/texted anyone — the failure was invisible because nothing ever threw or returned a falsy/error signal.

**How to apply:** `executeWorkflowAction` now returns `{ success: false, reason: '...' }` from every skip point and from the send catch block instead of returning/swallowing silently. Any caller that needs to know whether a send really happened must read this return value (not just catch exceptions) and propagate `success`/`reason` into its own log/result object. Not all call sites check it yet (see the immediate on-mutation trigger path and the campaign sender) — if you touch those, apply the same pattern.

Failed delayed workflow sends must leave the execution in a terminal `failed` state. Never catch a provider rejection while leaving the same step `active`, because the minute scheduler will retry it indefinitely.

**Why:** Six separate executions for one contact repeatedly submitted the same invalid SMS to Twilio every minute because production logged the exception without changing execution state.

**How to apply:** Validate SMS destinations before provider calls, claim exact company+recipient+message delivery atomically for a rolling 24 hours, and retain the claim after provider rejection so parallel executions cannot repeat the same failed request. Provider success followed by audit-update failure must also retain the claim.
