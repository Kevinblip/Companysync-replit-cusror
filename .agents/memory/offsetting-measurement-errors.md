---
name: Offsetting siding measurement errors
description: Why a plausible-looking siding total can hide two large opposing errors, and the rules for diagnosing/fixing measurement accuracy against a competitor benchmark.
---

# Offsetting measurement errors hide each other

A siding total that looks "roughly right" is not evidence the components are
right — and a component that looks badly wrong may just be compared against the
wrong line of the benchmark. Waste was suspected first; waste was innocent.

The headline area was +21% vs the industry benchmark, and the perimeter was
initially read as **-33%**. That perimeter reading was wrong, and the mistake is
the more valuable lesson. The benchmark's 294 ft figure is its *roof drip edge*
(eaves + rakes). Its wall perimeter is a different line on the same report — the
level starter, 216 ft. Our 197 ft was ~9% low, not 33%.

The tell was available the whole time: our gross wall area was within 3% of the
benchmark's, which is impossible if the perimeter is a third too short.

**Rule: before calling a component "wrong", confirm you are comparing it to the
same physical quantity.** Competitor reports carry several perimeter-shaped
numbers — wall perimeter, roof drip edge, eave fascia, rake fascia, starter — and
on a gabled house they differ by 30-50%. Cross-check with a product: perimeter x
wall height should reproduce their gross wall area. If the product agrees, the
factors agree and the component is not the problem.

Once the comparison was corrected the diagnosis inverted: the masonry deduction
**alone** landed within 1% of the benchmark, and the perimeter "fix" would have
inflated the quote instead of correcting it.

**Why:** the original conclusion — "these two fixes are coupled and must ship
together or each alone makes things worse" — was purely an artifact of the bad
comparison, and it had already been reported to the owner as fact. Coupled-fix
reasoning is only ever as good as the benchmark alignment underneath it.

**How to apply:** before changing money math, compute what each candidate fix does
*alone* and *together*, and independently verify that every benchmark constant is
the quantity you think it is. If a partial fix looks worse than the status quo,
re-check the benchmark before concluding the fixes are coupled.

## Benchmark fixtures must be calibrated against our own shipped output first

When validating against a competitor's numbers, it is very easy to build a fixture
whose assumptions differ from what the pipeline actually did, then "prove" a fix
with a formula that was never the live formula. This happened twice in one session:
a hand-rolled `gross - masonry - allOpenings` model, and a wrong wall-height guess.

**Rule:** drive the real graph module, and gate the benchmark behind a fidelity
check that reproduces the number we ACTUALLY shipped for that address before any
claim about the fix is made. The reproduction step is what caught a wall-height
assumption that was off by 25%.

**Why:** a source-regex test plus a toy formula can pass 27 checks and still
validate nothing about shipped behaviour.

## Non-obvious mechanics worth knowing

- Masonry is expressed per wall FACE as a *percentage* (`non_siding_pct`), not as a
  per-storey concept. Brick-below/siding-above is representable only because the
  percentage happens to approximate it (~50% on a 2-storey wall). There is no
  vertical split in the model, so openings cannot be attributed to a specific
  storey — an opening on a 50%-masonry face is charged 50/50 by area share.
- Openings below a minimum square footage are NOT deducted at all (they are
  absorbed into waste) unless the caller opts in. A fixture that deducts every
  window will not match the graph.
- Fascia and soffit in the photo path are derived from bounding-box dimensions
  **independently of the siding perimeter**. Fixing the perimeter does not fix
  them; they must be pointed at the traced outline separately. This is why fascia
  can be ~30% low while the siding perimeter is correct.
- Deriving a drip edge from bbox spans is *rotation-dependent* and over-quotes any
  building not aligned to north; true polygon edge perimeter is rotation-invariant
  and correct. Offsetting a closed rectilinear plan outward by `d` adds `8d`.
