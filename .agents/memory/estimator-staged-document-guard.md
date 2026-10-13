---
name: Uploaded documents vs generated estimates
description: Why an uploaded carrier estimate can be silently ignored and replaced by a measurement-derived estimate that looks plausible but is unrelated.
---

In the AI Estimator, uploading a file only **stages** it. Extraction runs from
the Analyze / send path. A separate "Generate Estimate" control builds from
stored measurements and the company price list, and originally had no
awareness of attachments at all.

**The failure it produced:** a user uploaded a carrier estimate PDF, clicked
Generate Estimate, and received a price-list estimate derived from that
property's stored measurements. Every row was exactly `qty * rate` with zero
depreciation. It was well-formed and roughly the right magnitude, so it read as
"the extractor misread my PDF" rather than "the PDF was never opened." The user
repeated it three times before reporting it.

**Rule:** a staged attachment must never be silently ignored by any path that
produces an estimate. The main estimate control must read an attached document
instead of offering a measurement-derived fallback.

**Why:** a wrong-but-plausible estimate is worse than a visible failure. The
shape of the output (line items, totals, an estimate screen) implies the
document was consumed, so nothing signals the mismatch.

**Document-type routing rule:** an insurance or contractor estimate can contain
a siding section, siding quantities, and siding tables. Its monetary columns,
claim information, and priced work items make it a **priced estimate**, not a
siding measurement report. Classification must prioritize insurance/contractor
over a generic `has_siding_measurements` signal.

**Why:** the old order routed carrier PDFs with siding content into the siding
measurement converter. It then generated the contractor's own `SID REM` /
`SID VS` price-list rows, zero depreciation, and a plausible but entirely
unrelated total — even after the file was correctly passed to Analyze.

**How to apply:** an explicit document import may re-read a staged attachment;
do not suppress it with an optimistic “already analyzed” marker. A failed
extraction must leave the document available to retry, rather than silently
allowing a measurement estimate in its place.

## Record-context isolation

An estimator screen has one customer, inspection job, property, and staged-document
context. Switching the selected customer or job must discard all unpersisted
measurements, line items, merge choices, presentation assets, and uploads. A staged
upload also carries its context from the moment the upload begins; a late upload
completion cannot become input for a newly selected record.

**Why:** the estimator can otherwise display one job while retaining another job's
measurements or uploaded carrier estimate. The result is a well-formed PDF for the
wrong homeowner, which is much worse than a failed import.

**How to apply:** validate the document's extracted homeowner/property against any
bound CRM context before creating line items, and fail closed on a mismatch. Use the
same selected job for media, report parsing, estimate persistence, and the reverse
job→estimate link. When editing, verify that the target estimate remains owned by
the selected customer/job instead of rebinding it implicitly.

**Related gotcha in these documents:** carrier PDFs contain several different
"totals" (line subtotal, RCV, net ACV, net after deductible). They also contain
rows where `qty * rate` deliberately does not equal the charged amount — a
minimum-charge line can show a large unit price and a much smaller actual
charge — and quantities printed as `53.20 (53.33)` where only the parenthetical
reproduces the stated total. Never recompute a line; trust the RC/RCV column.
Section headers may also claim more items than there are priced rows, because
they count sub-notes.
