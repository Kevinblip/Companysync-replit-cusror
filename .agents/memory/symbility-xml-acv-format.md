---
name: Symbility XML ACV format
description: Per-item ACV rule for Symbility Claims Connect XML import format
---

## Rule
In Symbility Claims Connect XML export/import, the `<ACV>` element inside each `<Item>` must equal the `<RCV>` value — **not** RCV minus depreciation.

Depreciation IS tracked per item in `<Depreciation>`, but it is only subtracted at the summary level:

```
<Totals>
  <ACV>= totalRCV - totalDepreciation</ACV>
</Totals>
```

## Why
Confirmed from real Symbility XML sample (EST-1888): every line item with
depreciation has `<ACV>` == `<RCV>`. The total ACV is 27421.29 − 3159.40 = 24261.89, which matches the `<Totals>` section. Exporting ACV = RCV − dep at the item level causes Symbility to reject the file with "Import errors for 1 estimate".

## How to apply
In `handleExportToSymbility` (EstimateEditor.jsx):
- Per-item XML: `<ACV>${rcv.toFixed(2)}</ACV>` (same value as `<RCV>`)
- Totals XML: `<ACV>${Math.max(0, totalRcv − totalDepreciation).toFixed(2)}</ACV>`
