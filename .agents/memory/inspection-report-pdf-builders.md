---
name: Inspection report PDF builders
description: The inspection report PDF is built in three duplicated jsPDF builders that must stay in lockstep; shared page helpers are the safe pattern.
---

# Inspection report PDF builders (InspectionCapture)

The inspection/damage-assessment report PDF is generated client-side with jsPDF in **three duplicated builders** inside `src/pages/InspectionCapture.jsx`:

1. `handleExportReport` — download
2. `handleViewPDF` — in-app preview
3. `handleGenerateAndSendReport` — email send (frontend builds the PDF, passes `pdfBase64`/`pdfUrl` to the `sendInspectionReport` function handler; there is NO server-side builder)

**Why:** any report content change applied to only one builder silently diverges the downloaded vs previewed vs emailed report. `src/components/inspections/PDFGenerator.jsx` and `functions/generateFullInspectionReport.ts` are dead code (no callers) — do not "fix" those instead.

**How to apply:** add new report sections as a shared closure helper (e.g. `addScopeAndNotesToPdf(doc, {pageWidth,pageHeight,margin,contentWidth,primaryColor})`) and call it from all three builders. Download+preview builders have byte-identical cover-page code, so a `replace_all` edit can hit both at once — verify with a grep count (expect 3 call sites). Content pages should be skipped entirely when empty (no blank pages). Scope of work lives in `job.scope_of_work`, general report notes in `job.report_notes` (InspectionJob is generic_entities JSONB — no schema change needed).
