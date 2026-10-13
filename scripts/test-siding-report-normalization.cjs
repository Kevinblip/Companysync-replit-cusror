#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const {
    classifySidingDocumentImport,
    hasSidingReportEvidence,
    normalizeSidingReportForEstimate,
    resolveBillableSidingAreaSqft,
  } = await import('../src/utils/sidingReportNormalization.js');

  const hoverFacadeOnly = normalizeSidingReportForEstimate({
    report_provider: 'HOVER',
    facade_area_sqft: 1003,
    gross_siding_facade_area_sqft: 1003,
    // An extraction mistake must not make the Facades figure billable.
    wall_area_sqft: 1003,
    wall_area_sq: 10.03,
  });
  assert.equal(hoverFacadeOnly.wall_area_sqft, null);
  assert.equal(hoverFacadeOnly.wall_area_sq, null);
  assert.equal(resolveBillableSidingAreaSqft(hoverFacadeOnly), 0);
  assert.equal(hasSidingReportEvidence(hoverFacadeOnly), true);

  const brandedHoverFacadeOnly = normalizeSidingReportForEstimate({
    report_provider: 'HOVER Complete Measurements',
    facade_area_sqft: 1003,
    wall_area_sqft: 1003,
    wall_area_sq: 10.03,
  });
  assert.equal(brandedHoverFacadeOnly.wall_area_sqft, null);
  assert.equal(resolveBillableSidingAreaSqft(brandedHoverFacadeOnly), 0);

  const hoverWithPrintedNet = normalizeSidingReportForEstimate({
    report_provider: 'HOVER',
    facade_area_sqft: 1003,
    net_siding_area_sqft: 725,
  });
  assert.equal(hoverWithPrintedNet.wall_area_sqft, 725);
  assert.equal(hoverWithPrintedNet.wall_area_sq, 7.25);
  assert.equal(resolveBillableSidingAreaSqft(hoverWithPrintedNet), 725);

  const genericFacadeReport = normalizeSidingReportForEstimate({
    report_provider: 'Other provider',
    facade_area_sqft: 900,
  });
  assert.equal(genericFacadeReport.wall_area_sqft, 900);
  assert.equal(resolveBillableSidingAreaSqft(genericFacadeReport), 900);

  assert.equal(
    classifySidingDocumentImport({
      document_type: 'hover_measurement',
      has_siding_measurements: true,
    }),
    'siding_measurement',
    'HOVER Complete Measurements reports with siding tables use the guarded siding route',
  );
  assert.equal(
    classifySidingDocumentImport({ document_type: 'hover_measurement' }),
    'hover_measurement',
    'roof-only HOVER reports stay on the roof route',
  );

  const source = fs.readFileSync('src/pages/AIEstimator.jsx', 'utf8');
  assert.equal(
    (source.match(/normalizeSidingReportForEstimate\(extractedSidingResponse\)/g) || []).length,
    3,
    'every siding document-import flow normalizes HOVER quantities before conversion',
  );
  assert.equal(
    (source.match(/resolveBillableSidingAreaSqft\(measurements\)/g) || []).length,
    2,
    'both siding converters use the same fail-closed billable-area resolver',
  );
  assert.match(
    source,
    /IMPORTANT: A HOVER Complete Measurements report with any siding table is "siding_measurement"/,
    'the legacy merge classifier explicitly routes HOVER Complete siding reports to the guarded path',
  );
  assert.match(
    source,
    /const docType = classifySidingDocumentImport\(typeCheck\)/,
    'the legacy merge classifier uses the shared route decision',
  );
  assert.equal(
    (source.match(/SIDING_DOCUMENT_CLASSIFICATION_PROMPT/g) || []).length,
    4,
    'all three document-import routes share the HOVER Complete siding classifier',
  );
  assert.equal(
    (source.match(/classifySidingDocumentImport\(/g) || []).length,
    3,
    'all three document-import routes make the shared classification decision',
  );

  console.log('PASS: HOVER Facades remains benchmark evidence, not a net siding line-item quantity');
  console.log('PASS: explicit HOVER post-opening net siding remains billable');
  console.log('PASS: every siding import route and converter use the fail-closed normalization');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});