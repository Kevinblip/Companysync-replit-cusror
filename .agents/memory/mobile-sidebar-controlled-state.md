---
name: Mobile sidebar controlled state
description: Controlled drawer state and reliable dismissal of mobile navigation overlays
---

## The Rule
When the mobile sidebar is controlled by a parent, the Sheet must consume the direct controlled open value, and both that value and its dismissal handler must be exposed through the sidebar context.

**Why:** A direct state fix can still cause a runtime recovery screen if the provider-local values are referenced by the consumer without being included in context.

**How to apply:** Update the provider, context value, and mobile Sheet consumer together; include a regression check for both synchronous close behavior and context exposure.

## Navigation overlay dismissal

Mobile navigation panels must stop intercepting input as soon as a destination is chosen, including when the chosen destination is the current page. Prefer immediate teardown over a closing animation for navigation-only overlays.

**Why:** On phones, retained animated panels can leave the destination visibly dimmed or block the next tap. React can also defer a batched dismissal when the same click navigates to a lazy page that suspends, leaving a portal visible over the loading screen. Navigation must not depend on an animation or destination load completing.

**How to apply:** Keep entrance animation if desired, but verify that closing commits removal of both the drawer and backdrop before initiating navigation and restores the previous scroll-lock state. Include a cold lazy destination in the check. If exit animation is retained elsewhere, interaction must be disabled immediately, not at the animation's end.

## Verification scope

Reproduce mobile navigation and clipping reports inside the real application layout, including the destination page. A passing isolated menu test is not enough. When a published-site report persists after a fix, compare the served JavaScript with the current source before attributing it to a new bug or browser caching.

**Why:** An isolated component check passed while the user's live site still served the older animated-overlay implementation. Page-level width constraints and ancestor styles are also absent from isolated menu tests.

**How to apply:** Test phone and unfolded layouts with long destination content, inspect drawer bounds and document width, and confirm the destination accepts input after dismissal. Fixed navigation should not depend on a page's intrinsic width or scrolling/containing-block styles.