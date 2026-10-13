---
name: Z Fold mobile breakpoint
description: Historical foldable breakpoint guidance, now superseded by the current responsive layout.
---

The old guidance was to use 600px instead of 768px so a ~760px unfolded Fold would show the desktop sidebar. This is superseded: the current application deliberately uses a 1024px mobile breakpoint in both the shared mobile hook and the main layout.

**Why:** Retaining the old 600px rule without noting the newer layout makes future responsive changes regress the current behavior.

**How to apply:** Check the current responsive components and product expectation before changing the breakpoint; do not restore the old Fold-specific threshold merely because an old note recommended it.

The user said the unfolded Fold header already looks fine and asked to reduce clutter only on the narrow phone screen.

**Why:** Applying phone-header simplification to every mobile-sized viewport would also change the unfolded layout the user wanted preserved.

**How to apply:** Treat compact header behavior as a separate narrow-screen adjustment; preserve the existing overall sidebar/bottom-navigation breakpoint.