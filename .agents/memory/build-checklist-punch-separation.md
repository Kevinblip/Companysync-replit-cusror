---
name: Build checklist punch-list separation
description: Why punch items in a build's scope_of_work checklist are held out of label matching and out of build progress math.
---

A build's checklist stores build scope and punch (close-out) items in the SAME
`scope_of_work` array, distinguished only by category. Two rules keep that from
going wrong, and both are easy to undo accidentally:

**1. Punch items must be held out of the regeneration label-match entirely.**
The merge that runs on "Refresh from estimate" dedupes by normalized label and
drops unmatched rows unless they're staff-entered or completed. Simply adding
punch to the keep-list is NOT enough: a generated template step can share a
punch item's label (e.g. "Final walkthrough with the homeowner"), and the
generated row then absorbs the punch row and inherits the generated category.
The punch item disappears from the punch list and — if incomplete — silently
becomes open build scope. Punch rows must be matched/deduped only against each
other and appended unconditionally.

**Why:** punch work is never produced by an estimate or a template, so it has no
legitimate reason to participate in generated-item matching at all.

**2. Build progress math must exclude punch items.**
The build's progress badge, the mark-all-done control, and the soft "some work
isn't checked off yet" gate on marking a build Completed all read the same
progress helper. Punch items are raised AFTER the crew finishes, so counting
them there makes finished build work look unfinished and nags on every save.

**How to apply:** any new consumer of the checklist should ask which of the two
counts it wants and use the matching helper, rather than filtering the raw array
inline — inline filters are how the two populations get conflated again.
