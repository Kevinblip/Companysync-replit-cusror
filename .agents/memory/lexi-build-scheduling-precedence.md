---
name: Lexi build scheduling precedence
description: Prevents build and installation requests from being misrouted into ordinary calendar meetings.
---

Build/install scheduling must always use the dedicated build-schedule tool, even when the user says “schedule,” “calendar,” or supplies a time. Generic calendar routing applies only to non-build meetings, calls, appointments, and reminders. Lexi may confirm a build only after the tool reports success with a real build identifier.

**Why:** Broad “schedule anything on the calendar” instructions can outrank a more specific build instruction in model routing. The result looks successful to the user but creates only a meeting and leaves Scheduled Builds empty.

**A prompt rule is not enforcement.** The same misroute recurred after the prompt already forbade it, so the refusal must live in the tool handlers: reject a build-looking event in the generic calendar tool *and* in the generic CRUD tool, return nothing written, and tell the model not to claim success. Any override the model can simply assert is not an override — bind it to a server-signed value it can only obtain by first being refused, and bind that value to the whole event (title, description, type, time) with an expiry, or the retry smuggles the build through an unbound field.

**How to apply:** In every text and voice prompt, state that build routing takes precedence over generic scheduling. Regression checks should reject broad calendar rules that include builds and require durable tool success before confirmation. Resolve customers only within the caller's tenant and assignment scope; if matching is ambiguous, ask rather than choose. A build mutation and its linked calendar change form one outcome: verify both before reporting success and compensate both on a post-write failure. Legacy BuildSchedule rows may have no calendar_event_id; an update must create and verify the missing event rather than treating the absent link as a successful no-op.