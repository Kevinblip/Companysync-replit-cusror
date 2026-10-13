---
name: Estimate supplement chain links
description: Why a copy-forward must strip BOTH link directions, and why stripping top-level fields alone is not enough on dedicated tables.
---

# Estimate supplement / change-order chain links

A supplement (or change order) is a child estimate copied forward from its
parent. The chain is stored as two link directions on the estimate itself:
upward (`supplement_of*`) and downward (`has_supplement*`).

## Rule 1 — a copy-forward strips BOTH directions

The downward link belongs to the estimate being copied FROM. A brand-new child
has no children, so every downward field must be dropped from the copy. Keeping
one hands the child a pointer to its own sibling: the chain badge opens the
wrong record and lists render a supplement count on an estimate with no
supplements, getting worse the longer the chain grows.

**Why:** the skip set originally listed `has_supplement` but not
`has_supplement_id` / `has_supplement_number`, so the sibling pointer was
inherited by every child born from a parent that already had one.

**How to apply:** both creation paths (the estimates list and the estimate
editor) must build the copy through one shared helper in the change-orders lib,
never a locally spelled-out skip set. Two hand-maintained sets drift.

## Rule 2 — fields that are not real columns arrive twice

Chain and change-order fields are not columns on the dedicated `estimates`
table; they live in the `data` JSONB. A read flattens `data` onto the row and
ALSO returns the raw `data` object, and a create writes a supplied `data` key
straight into the column. So filtering only top-level keys leaves the stripped
value alive inside `data` and writes it straight back.

**How to apply:** any "copy this record forward with fields X removed" logic on
a dedicated table must filter the nested `data` object with the same skip set.

## Repair, not just prevention

A wrong downward link is detectable without guesswork: it is sound only when
the record it points at names the pointer's owner as its parent. Repair by
repointing at the newest real child, or clearing the link when there is none —
and clear the id/number keys rather than only flipping the boolean flag,
because the UI reads the id directly.
