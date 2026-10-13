---
name: ESX / Symbility export schema
description: Confirmed target XML schemas for Xactimate ESX and Symbility exports; shared generator location; what Kevin's uploaded sample was.
---

# ESX / Symbility Export Schema

## What Kevin's uploaded "real .esx" file actually was
The file `Pasted--xml-version-1-0-encoding-UTF-8-XactimateExport...txt` had `<SourceSystem>CompanySync</SourceSystem>` — it was Kevin's own manually-created XML sample showing the **target schema**, not a binary .esx exported from Xactimate software. A real Xactimate software export is a ZIP (PK magic bytes); this file confirmed the XML structure we should produce.

## Confirmed target schema: Xactimate ESX (`<XactimateExport version="1.0">`)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<XactimateExport version="1.0">
  <Header>
    <ExportDate>YYYY-MM-DD</ExportDate>
    <SourceSystem>CompanySync</SourceSystem>
    <Carrier>…</Carrier>
  </Header>
  <ClaimInformation>
    <ClaimNumber/> <PolicyNumber/> <DateOfLoss/> <TypeOfLoss/>
    <Insured><Name/> <PropertyAddress/> <Phone/></Insured>
    <Contractor><CompanyName/> <ContactName/></Contractor>
  </ClaimInformation>
  <LineItems>
    <LineItem itemNumber="1">
      <Category>RFG</Category>      <!-- short trade code, NOT full name -->
      <Selector>300</Selector>      <!-- Xactimate selector = item.code/sku -->
      <Description/>
      <Quantity/> <Unit/> <UnitPrice/> <Total/>
      <Notes/>                      <!-- optional, omit if empty -->
    </LineItem>
  </LineItems>
  <Totals>
    <Subtotal/> <OverheadPercentage/> <ProfitPercentage/>
    <OverheadAndProfit/> <GrandTotal/>
  </Totals>
</XactimateExport>
```

## Symbility ACV rule (critical)
- Per-item `<ACV>` MUST equal `<RCV>` (no per-line depreciation)
- Only `<Totals><ACV>` = totalRCV − totalDepreciation

## Shared generator location
`src/utils/esxExport.js` exports:
- `generateEsxXml(estimate, lineItems, company)` → XML string
- `generateSymbilityXml(estimate, lineItems, company)` → XML string
- `triggerXmlDownload(xmlString, filename)` → triggers browser download

## Call sites (ALL must use the shared generator)
- `src/pages/EstimateEditor.jsx` — `handleExportToXactimate`
- `src/components/estimates/XactimateEstimateView.jsx` — `exportToXactimate` + `exportToSymbility`

**Why:** Three separate generators had three different incompatible schemas. Consolidation ensures schema consistency across all export paths. These carrier formats are parsed programmatically, so a file that merely looks correct can be silently rejected or misread downstream by an adjuster system.

## Trade code mapping
`esxExport.js` maps lowercase category names → Xactimate 2-4 letter codes (RFG, GTR, SDG, INT, etc.). Unknown categories pass through uppercased and truncated to 4 chars.

## O&P defaults
Overhead 10%, Profit 10% (Xactimate standard). Reads from `estimate.overhead_pct / profit_pct` if set.
