---
name: Settings form dirty-flag revert
description: Toggles on settings pages silently revert if edits don't set the dirty flag before a refetch
---

Rule: on pages that load an entity into local form state behind an `isDirty` guard, EVERY edit handler must set `isDirty.current = true` — including inline Switch/Select `setSettings({...settings, x})` handlers, not just the "big" handlers.

**Why:** StormAlertSettings' nationwide toggle didn't mark dirty; a background react-query refetch re-ran the load effect and reset state to server values, so the user's "off" silently flipped back to "on" and was saved that way (storm emails kept coming despite being "disabled").

**How to apply:** use a single `updateSettings(patch)` helper that sets the dirty flag then merges the patch (see StormAlertSettings.jsx). When debugging "I turned it off but it's still happening", check the DB value first — the save may have persisted the reverted value.
