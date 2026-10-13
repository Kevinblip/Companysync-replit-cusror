---
name: Siding opening allocation & masonry columns
description: Openings must be charged to the material of the wall they are cut into; caps must be dimensioned against the column they limit. Covers per-face masonry derivation and the rebuild/report consumers that must stay consistent.
---

# Openings belong to the material of their own wall

**Rule:** the wall prism splits into a siding column and a masonry column *first*;
each rough opening is then deducted from the column matching the material of the
face it sits in. Never deduct the whole-house opening total from siding.

**Why:** a mostly-brick house reported ~650 sqft of siding against a Hover-verified
~1,050. The engine's gross prism and its brick percentage were both close to
correct — the entire error was that every window and garage door on the house,
including the ones in brick walls, was subtracted from the small siding remainder.
On a 70 %-brick home that is roughly a 5x error, and it gets worse as the masonry
share rises. Two independent numbers being right does not make the difference
between them right.

**How to apply:** when a total is composed of separately-measured parts, deduct
each subtrahend from the part it actually belongs to. Watch for this anywhere a
"gross minus everything" identity is applied to a heterogeneous quantity.

# A cap must be dimensioned against the column it limits

The opening-deduction sanity cap was 25 % of *gross*. On a mostly-brick house that
ceiling exceeded the entire siding facade, so the cap could never bind — it
guaranteed the maximum possible subtraction instead of preventing an absurd one.
A cap expressed as a fraction of the wrong denominator is worse than no cap.

# Per-face masonry, not a photo-count mean

Masonry percentage must be a **median per elevation**, then **area-weighted** across
faces. A plain mean over photos lets duplicate or near-duplicate shots of one
elevation vote twice and then applies that reading to the whole house — and this
codebase does produce duplicate tiles (the same image can appear under two view
labels).

# Consumers that must stay consistent

Three places re-derive siding math and will silently drift back to the old
"gross − accent − all openings" identity if they are not kept aligned:

- the analysis handler that builds the graph,
- the edit/rebuild path — it must **re-pass the persisted per-face masonry map**,
  or an innocuous edit (changing a window count) reverts the house to the
  house-wide share and re-breaks the number,
- the printable report generator — it recomputes from raw opening geometry, so it
  must consume the graph totals instead.

The face map is persisted on the graph totals' provenance specifically so the
rebuild path can restore it.

# Confidence must react to the engine's own warnings

The sanity-ratio warning and the opening cap were diagnostic-only: a 5x-wrong
measurement still displayed a mid-70s confidence and a letter grade, because the
score was computed from photo count and satellite availability alone. Any signal
the engine raises about its own output must move the confidence it advertises,
otherwise the grade is decoration.
