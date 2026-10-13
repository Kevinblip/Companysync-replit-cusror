---
name: AIEstimator manual-estimate gating
description: Why the AIEstimator line-item editor + Exports menu (incl. Xactimate PDF) stay hidden until an estimate exists, and how to reveal them.
---

# AIEstimator manual-estimate gating

The line-item editor and the "Exports" menu (which hosts the Xactimate PDF
export) only render once an estimate is loaded — they are hidden on the empty
initial view, which is a different card. Seeding line items alone will NOT reveal
them.

**Why:** the editor/Exports card is gated on there being a current estimate,
while the empty state is a separate upload-mode card. Without an estimate object
the whole controls block is absent from the DOM.

**How to apply:** any "start a blank / manual estimate" entry point, or any e2e
test that needs the editor or Exports menu, must (1) set a minimal current
estimate object AND (2) seed at least one line item, and the entry-point button
must live in the *visible* empty-state card — not inside the estimate-gated card,
or it could never be clicked when empty. To unit-test the export flow itself
without this gating, render the extracted `XactimateExportDialog` component
directly (see `src/__tests__/xactimateExportDialog.test.jsx`).