---
name: Mobile settings panels
description: Reliable menu-to-panel handoffs and intrinsic-width overflow in narrow settings dialogs.
---

Use a modal dialog for multi-control phone settings opened from the profile menu; retain an anchored popover for the same settings opened directly from the wide toolbar.

**Why:** Opening an anchored popover from the closing profile dropdown failed to leave a visible panel during a signed-in browser check. A modal handled that focus handoff reliably.

**How to apply:** Verify that selecting the menu item opens a panel that stays open, not merely that its state changes. Coordinate the dropdown closing and modal opening rather than anchoring to a hidden toolbar trigger.

Check the settings content's horizontal overflow separately from the outer dialog bounds. Grid children need `min-width: 0`; native time fields and adjacent buttons may need to stack on narrow screens.

**Why:** A dialog fit within the viewport while its intrinsic-width work-hours row expanded the grid content and clipped controls to the right.

**How to apply:** Test both the outer bounding box and content `scrollWidth` versus `clientWidth`. Keep vertical scrolling available, shrink text-input flex children, and stack time fields/actions when needed.
