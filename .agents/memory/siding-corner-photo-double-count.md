---
name: Corner photos double-count siding openings
description: Why count-only Gemini responses and corner-shot labels defeat the siding measurement graph's dedupe, inflating window/door counts.
---

# Corner photos double-count openings

The siding measurement graph dedupes openings seen in overlapping photos. Two
independent things can switch that dedupe off completely, and when they do the
reported window/door counts are the **raw sum across every photo**.

## 1. Corner labels must resolve to a canonical face

The photo uploader labels corner slots with two-letter abbreviations — `FR Corner`,
`FL Corner`, `BL Corner`, `BR Corner`. None of those strings contain `front`,
`back`, `left` or `right`, so naive substring matching resolves them to the
`unknown` face. Dedupe is **disabled by design on `unknown`** (two unidentified
photos may genuinely be different walls), so every corner photo's openings are
admitted as brand new.

A corner shows two walls; attribute it to the **primary (first-letter) face** so
per-face reconciliation can engage. Symptom to watch for: all four elevation
drawings render "NOT PHOTOGRAPHED — ESTIMATED" even though several photos were
analyzed.

**Why:** the substring tests are easy to read and easy to trust, and the
abbreviation gap is invisible until you print the resolved face per opening.

**How to apply:** any code that maps a photo label to a wall face needs the
corner branch — there is more than one such mapper (the graph's `resolveWallFace`
and the plugin's `faceToZone`), and they must agree.

## 2. Count-only AI responses cannot be deduped by identity

When Gemini returns bare counts instead of per-opening geometry, the extractor
synthesizes one opening per counted item and mints each a unique
`synthetic_<type>_<photoIndex>_<i>` identity. The duplicate test short-circuits
on explicit identity: two non-null ids that differ means "not a duplicate", and
the geometry/zone fallbacks never run. Synthetic ids are per-photo unique *by
construction*, so they guarantee non-dedupe. Zone doesn't rescue it either —
synthetic openings carry zone `unknown`.

Counts of the same type on the same wall are not automatically additive, but
"same wall" splits into two cases that must be reconciled differently:

* **Flat slot photos add.** A wall can legitimately be captured in two frames,
  and collapsing them deletes real openings.
* **Corner shots overlap.** A corner may only RAISE a face to what it saw on its
  own; it never stacks on top of the flat photos.

So a face total is `max(sum of flat photos, largest single corner photo)`, and
unidentified faces stay additive.

Crucially, the overlap guarantee comes from the **uploader's slot contract** —
one slot per corner, each a whole-house oblique of the entire adjoining wall,
duplicates diverted to Detail slots — not from the word "corner" in a label. If
that capture UX ever allows two partial shots of one wall, this rule breaks and
starts under-counting.

**Why:** giving synthetic data a "stable identity" looks defensive but actively
defeats the dedupe path it appears to support.

**How to apply:** treat "does this observation carry real measured geometry?" as
the branch point. Identity-based dedupe is only meaningful for observations the
model actually located.

## Error direction matters financially

Over-counting openings over-deducts wall area, which **under-bills** the siding.
A double-count is not a cosmetic display bug — it silently shrinks the quote.

## Verifying a claim like this

Don't reason statically about which branch fires. The graph module is a pure
importable function: build the exact per-photo pattern from the customer's
screenshot, run it, and print the counts and the resolved face per opening. That
turns a hypothesis into a fact in one run, and the same script becomes the
regression test.
