---
name: Xactimate native ESX import — format is proprietary-encrypted (BLOCKED without Verisk)
description: Findings from a real .esx sample; read before touching Xactimate ESX export code or promising native import.
---

# Xactimate native ESX — confirmed findings from a real sample

A real `.esx` (sample: `attached_assets/0_ESTHUB-EST10_EstimateHub_1785833423479.ESX`, from EstimateHub/ESX World, exported by real Xactimate) is:
- A plain ZIP (PK) containing attachment files (e.g. `NNNNNN.JPG`) + one `XACTDOC.ZIPXML`.
- `XACTDOC.ZIPXML` is NOT XML and NOT any standard compression (tested zlib all wbits/offsets, gzip, lzma, bz2; entropy 7.997, length % 8 == 0 → almost certainly an 8-byte block cipher, e.g. Blowfish). **We cannot produce or read it without Verisk's proprietary codec/key.**

**Why third parties succeed:** HOVER/EagleView/SketchMyRoof generate importable ESX as official Verisk partners via Verisk tooling — not by reverse-engineering. Open-source "PDF-to-ESX" projects explicitly admit they don't reproduce the ZIPXML packing (and their plain-XML zips are unverified for import).

**The likely-inner schema** is the `<XACTDOC>` XML (XactAnalysis EDI schema, see DanTutt/XML_Project ImportGuide.html) — but a plaintext version inside the zip is a guess Xactimate may reject; per xactimate-symbility-format.md, close-but-wrong formats fail silently at the adjuster's desk.

**How to apply:** Owner approved shipping a BEST-EFFORT beta: shared `buildXactdocXml`/`downloadEsxFile` in `src/utils/esxExport.js` builds a real ZIP with plaintext `XACTDOC.XML` (fixture-observed schema; GROUP/ITEMS SUMMARY_REF must match SUMITEM ids). All UI messaging must stay honest ("beta — test in Xactimate; Quick Entry is the reliable path", shared `ESX_BETA_NOTE` so wording can't drift). Import success is UNVERIFIED — owner has a Verisk login and is the tester; iterate on real Xactimate error messages. Long-term guaranteed route remains a Verisk partnership/API.
