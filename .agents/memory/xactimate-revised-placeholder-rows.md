---
name: Xactimate "REVISED" placeholder rows inflate AI-extracted totals
description: Revised Xactimate/insurance PDFs can contain stale, unpriced duplicate line items that an AI extractor will re-price from the local list, inflating the estimate total above the document's true total.
---

# Xactimate "REVISED" placeholder rows

When a Xactimate (or similar) insurance estimate goes through a revision, the
PDF sometimes keeps the ORIGINAL pre-revision line item printed with the word
"REVISED" where Rate/Tax/RCV/Dep/ACV numbers would be — a real
quantity/description but zero dollar data. A later row further down the
document, with the same or very similar description, carries the real
Rate/RCV/ACV values and supersedes it.

**Why:** an AI line-item extractor has no built-in notion of "this row was
superseded." If it extracts both rows, the blank stale row's missing rate gets
silently re-priced from the local price list (since rate/rcv look "empty"
rather than "duplicate"), which inflates the generated estimate's total above
the document's actual total — the mismatch is not obvious from the row itself,
only by cross-checking the final sum against the source PDF.

**How to apply:** the extraction prompt in `AIEstimator.jsx` explicitly
instructs the model to skip a row that has a real quantity/unit but
blank/"REVISED" Rate/Tax/RCV/Dep/ACV when a same/similar-description row with
real pricing exists elsewhere in the document. This is a prompt-level
mitigation only (probabilistic, not a hard guarantee) — if a totals mismatch
recurs on a revised estimate, verify with `pdftotext -layout` whether stale
REVISED rows are still being extracted before assuming the pricing/tax/O&P
math itself is wrong.
