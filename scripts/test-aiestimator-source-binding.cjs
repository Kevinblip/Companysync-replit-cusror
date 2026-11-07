#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    createEstimateSourceContext,
    uploadedFilesMatchEstimateContext,
  } = await import('../src/utils/estimateSourceContext.js');
  const {
    getEstimateDocumentIdentityMismatch,
    getEstimateDocumentBatchIdentityMismatch,
    customerAddressFieldsFromDocument,
  } = await import('../src/utils/estimateDocumentIdentity.js');

  let passed = 0;
  const ok = (condition, label) => {
    assert.ok(condition, label);
    passed += 1;
    console.log(`  ✓ ${label}`);
  };

  const joyceContext = createEstimateSourceContext({
    customerId: 'joyce-1',
    inspectionJobId: 'job-joyce',
    propertyAddress: ' 100 Main Street ',
  });
  const josephContext = createEstimateSourceContext({
    customerId: 'joseph-1',
    inspectionJobId: 'job-joseph',
    propertyAddress: '15309 Ramage Ave',
  });

  ok(
    joyceContext === createEstimateSourceContext({
      customerId: 'JOYCE-1',
      inspectionJobId: 'JOB-JOYCE',
      propertyAddress: '100   main street',
    }),
    'the same customer, job, and address produce a stable upload context',
  );
  ok(
    !uploadedFilesMatchEstimateContext(
      [{ name: 'carrier.pdf', estimateContextKey: joyceContext }],
      josephContext,
    ),
    'a document staged for one customer/job cannot be analyzed in another context',
  );
  ok(
    uploadedFilesMatchEstimateContext(
      [{ name: 'carrier.pdf', estimateContextKey: joyceContext }],
      joyceContext,
    ),
    'a document remains usable in the exact customer/job context where it was staged',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 N. Main St., Apt. #5, Highland Heights, OH',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 North Main Street Apartment 5, Highland Heights OH',
      hasSelectedContact: true,
    }) === null,
    'punctuation, directions, street suffixes, and unit notation do not block the same property',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main St',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main Street, Highland Heights, OH 44143',
      hasSelectedContact: true,
    }) === null,
    'a street-only address matches a full address when the street is the same',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 St Johns Rd',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 St Johns Road Cleveland OH',
      hasSelectedContact: true,
    }) === null,
    'St in a street name is not mistaken for the street suffix',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 N.E. Main St.',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Northeast Main Street',
      hasSelectedContact: true,
    }) === null,
    'dotted compass directions match their spelled-out equivalents',
  );
  const propertyMismatch = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'Linda Hall',
    documentAddress: '100 Main Street, Highland Heights, OH',
    currentCustomer: 'Linda Hall',
    currentAddress: '101 Main St, Highland Heights, OH',
    hasSelectedContact: true,
  });
  ok(
    propertyMismatch?.propertyMismatch && !propertyMismatch.customerMismatch
      && propertyMismatch.message.includes('property address')
      && propertyMismatch.message.includes('100 Main Street')
      && propertyMismatch.message.includes('101 Main St')
      && propertyMismatch.message.includes('Import blocked'),
    'a different street number blocks the import and identifies both properties',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main St',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main St Annex',
      hasSelectedContact: true,
    })?.propertyMismatch,
    'a longer street name cannot bypass the block by sharing a prefix',
  );
  const cityOnly = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'Linda Hall',
    documentAddress: '100 Main St, Highland Heights, OH',
    currentCustomer: 'Linda Hall',
    currentAddress: '100 Main St, Cleveland, OH',
    hasSelectedContact: true,
  });
  ok(
    cityOnly?.addressWarning && cityOnly.severity === 'warn' && !cityOnly.propertyMismatch
      && cityOnly.message.includes('Address warning')
      && !cityOnly.message.includes('Import blocked')
      && cityOnly.message.includes('Highland Heights')
      && cityOnly.message.includes('Cleveland'),
    'a different city with the same street warns instead of blocking',
  );
  const cityPrefix = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'Linda Hall',
    documentAddress: '100 Main St, Cleveland',
    currentCustomer: 'Linda Hall',
    currentAddress: '100 Main St, Cleveland Heights, OH',
    hasSelectedContact: true,
  });
  ok(
    cityPrefix?.addressWarning && cityPrefix.severity === 'warn'
      && !cityPrefix.message.includes('Import blocked'),
    'a shorter city name warns instead of masquerading as the same property or blocking',
  );
  const glendale = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'Linda Hall',
    documentAddress: '16413 Glendale Ave Cleveland, OH 44128-1315',
    currentCustomer: 'Linda Hall',
    currentAddress: '16413 Glendale Ave, Cleveland Heights, OH, 44118',
    hasSelectedContact: true,
  });
  ok(
    glendale?.addressWarning && glendale.severity === 'warn' && !glendale.propertyMismatch
      && glendale.message.includes('16413 Glendale Ave Cleveland, OH 44128-1315')
      && glendale.message.includes('16413 Glendale Ave, Cleveland Heights, OH, 44118')
      && glendale.message.includes('Import anyway')
      && !glendale.message.includes('Import blocked'),
    'Glendale city and ZIP differences warn and offer import anyway',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main St, Cleveland, OH 44118',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main St, Cleveland, OH 44128',
      hasSelectedContact: true,
    })?.severity === 'warn',
    'the same house and street with a different ZIP warns instead of blocking',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '16413 Glendale Ave, Cleveland, OH 44128-1315',
      currentCustomer: 'Linda Hall',
      currentAddress: '16413 Glendale Ave, Cleveland, OH 44128',
      hasSelectedContact: true,
    }) === null,
    'a ZIP+4 suffix does not count as a different ZIP',
  );
  const glendaleFields = customerAddressFieldsFromDocument('16413 Glendale Ave Cleveland, OH 44128-1315');
  ok(
    glendaleFields.street === '16413 Glendale Ave'
      && glendaleFields.city === 'Cleveland'
      && glendaleFields.state === 'OH'
      && glendaleFields.zip === '44128',
    'a document address splits into street, city, state, and ZIP for the customer update',
  );
  const heightsFields = customerAddressFieldsFromDocument('16413 Glendale Ave, Cleveland Heights, OH, 44118');
  ok(
    heightsFields.street === '16413 Glendale Ave'
      && heightsFields.city === 'Cleveland Heights'
      && heightsFields.state === 'OH'
      && heightsFields.zip === '44118',
    'a comma-separated customer address keeps the full city name',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main St, Cleveland',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main St, Cleveland, OH 44143',
      hasSelectedContact: true,
    }) === null,
    'missing state and ZIP do not turn the same city into a conflict',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main St Apt 5',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main St Apt 6',
      hasSelectedContact: true,
    })?.propertyMismatch,
    'a different unit at the same street address stays blocked',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main Street',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main St',
      hasSelectedContact: true,
    }) === null,
    'the same property remains importable when street suffixes differ',
  );
  const postalCity = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'DUCKWORTH, LETRICE',
    documentAddress: '13700 MARTIN DR CLEVELAND, OH 44125-5272',
    currentCustomer: 'LeTrice Duckworth',
    currentAddress: '13700 Martin Dr, Garfield, OH, 44125',
    hasSelectedContact: true,
  });
  ok(
    postalCity?.addressWarning && postalCity.severity === 'warn' && !postalCity.customerMismatch
      && !postalCity.message.includes('Import blocked'),
    'the same customer, house, and ZIP with a different city label warns instead of blocking',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'DUCKWORTH, LETRICE',
      documentAddress: '13701 MARTIN DR CLEVELAND, OH 44125-5272',
      currentCustomer: 'LeTrice Duckworth',
      currentAddress: '13700 Martin Dr, Garfield, OH, 44125',
      hasSelectedContact: true,
    })?.propertyMismatch,
    'matching customer and ZIP do not authorize a different house number',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'DUCKWORTH, LETRICE',
      documentAddress: '13700 MARTIN DR CLEVELAND, PA 44125-5272',
      currentCustomer: 'LeTrice Duckworth',
      currentAddress: '13700 Martin Dr, Garfield, OH, 44125',
      hasSelectedContact: true,
    })?.propertyMismatch
      && getEstimateDocumentIdentityMismatch({
        documentCustomer: 'DUCKWORTH, LETRICE',
        documentAddress: '13700 MARTIN DR CLEVELAND, PA 44125-5272',
        currentCustomer: 'LeTrice Duckworth',
        currentAddress: '13700 Martin Dr, Garfield, OH, 44125',
        hasSelectedContact: true,
      })?.severity === 'block',
    'a matching ZIP does not override a conflicting state',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Hall',
      documentAddress: '100 Main St, Cleveland Heights, OH',
      currentCustomer: 'Another Customer',
      currentAddress: '100 Main St, Cleveland, OH',
      hasSelectedContact: true,
    })?.severity === 'block',
    'a different customer still blocks even when the address differs only by city',
  );
  const customerMismatch = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'Linda Hall',
    documentAddress: '100 Main Street',
    currentCustomer: 'Another Customer',
    currentAddress: '100 Main St',
    hasSelectedContact: true,
  });
  ok(
    customerMismatch?.customerMismatch && !customerMismatch.propertyMismatch
      && customerMismatch.message.includes('Linda Hall')
      && customerMismatch.message.includes('Another Customer'),
    'a different selected customer blocks the import and shows both names',
  );
  const bothMismatch = getEstimateDocumentIdentityMismatch({
    documentCustomer: 'Linda Hall',
    documentAddress: '100 Main St',
    currentCustomer: 'Another Customer',
    currentAddress: '101 Main St',
    hasSelectedContact: true,
  });
  ok(
    bothMismatch?.customerMismatch && bothMismatch.propertyMismatch
      && bothMismatch.message.includes('customer name')
      && bothMismatch.message.includes('property address')
      && bothMismatch.message.includes('Linda Hall')
      && bothMismatch.message.includes('Another Customer')
      && bothMismatch.message.includes('100 Main St')
      && bothMismatch.message.includes('101 Main St'),
    'a double mismatch lists both conflicting fields and all compared values',
  );
  ok(
    getEstimateDocumentIdentityMismatch({
      documentCustomer: 'Linda Halligan',
      documentAddress: '100 Main St',
      currentCustomer: 'Linda Hall',
      currentAddress: '100 Main St',
      hasSelectedContact: true,
    })?.customerMismatch,
    'a customer whose name merely contains another name stays blocked',
  );
  const matchingDocuments = [
    { fileName: 'roof.pdf', customer_info: { customer_name: 'Linda Hall', property_address: '100 N Main St, Cleveland OH' } },
    { fileName: 'carrier.pdf', customer_info: { customer_name: 'Linda Hall', property_address: '100 North Main Street, Cleveland, OH' } },
  ];
  ok(
    getEstimateDocumentBatchIdentityMismatch({
      documents: matchingDocuments,
      currentCustomer: 'Linda Hall',
      currentAddress: '100 N Main Street, Cleveland OH',
      hasSelectedContact: true,
    }) === null,
    'two documents for the same property can be combined despite address formatting',
  );
  const postalCityBatch = getEstimateDocumentBatchIdentityMismatch({
    documents: [
      { fileName: 'carrier.pdf', customer_info: { customer_name: 'DUCKWORTH, LETRICE', property_address: '13700 MARTIN DR CLEVELAND, OH 44125-5272' } },
      { fileName: 'supplement.pdf', customer_info: { customer_name: 'LeTrice Duckworth', property_address: '13700 Martin Dr, Garfield, OH 44125' } },
    ],
    currentCustomer: 'LeTrice Duckworth',
    currentAddress: '13700 Martin Dr, Garfield, OH 44125',
    hasSelectedContact: true,
  });
  ok(
    postalCityBatch?.addressWarning && postalCityBatch.severity === 'warn'
      && !postalCityBatch.message.includes('Import blocked'),
    'multiple estimates that differ only by city label warn instead of blocking',
  );
  ok(
    getEstimateDocumentBatchIdentityMismatch({
      documents: [
        { fileName: 'carrier.pdf', customer_info: { customer_name: 'Linda Hall', property_address: '16413 Glendale Ave, Cleveland, OH 44128' } },
        { fileName: 'other-street.pdf', customer_info: { customer_name: 'Linda Hall', property_address: '101 Glendale Ave, Cleveland Heights, OH 44118' } },
      ],
      currentCustomer: 'Linda Hall',
      currentAddress: '16413 Glendale Ave, Cleveland Heights, OH 44118',
      hasSelectedContact: true,
    })?.severity === 'block',
    'a later document with a different house number still blocks after a city warning',
  );
  const otherPropertyDocument = {
    fileName: 'other-property.pdf',
    customer_info: { customer_name: 'Linda Hall', property_address: '101 N Main St, Cleveland OH' },
  };
  const crossPropertyMismatch = getEstimateDocumentBatchIdentityMismatch({
    documents: [matchingDocuments[0], otherPropertyDocument],
    hasSelectedContact: false,
  });
  ok(
    crossPropertyMismatch?.propertyMismatch
      && crossPropertyMismatch.message.includes('roof.pdf')
      && crossPropertyMismatch.message.includes('other-property.pdf')
      && crossPropertyMismatch.message.includes('100 N Main St')
      && crossPropertyMismatch.message.includes('101 N Main St'),
    'a second PDF for a different property is rejected even without a selected contact',
  );
  ok(
    getEstimateDocumentBatchIdentityMismatch({
      documents: [matchingDocuments[0], otherPropertyDocument],
      currentCustomer: 'Linda Hall',
      currentAddress: '100 N Main St, Cleveland OH',
      hasSelectedContact: true,
    })?.propertyMismatch,
    'each PDF is compared against the open estimate as well as other PDFs',
  );
  ok(
    getEstimateDocumentBatchIdentityMismatch({
      documents: [
        matchingDocuments[0],
        { fileName: 'other-homeowner.pdf', customer_info: { customer_name: 'Linda Halligan', property_address: '100 N Main St, Cleveland OH' } },
      ],
      hasSelectedContact: false,
    })?.customerMismatch,
    'different homeowners cannot be merged into one multi-document estimate',
  );

  const source = fs.readFileSync(path.join(__dirname, '../src/pages/AIEstimator.jsx'), 'utf8');
  ok(
    source.includes('uploadedFilesMatchEstimateContext(uploadedFiles, estimateSourceContext)'),
    'all document import entry points verify the staged document context',
  );
  ok(
    source.includes('related_inspection_job_id: linkedInspectionJobId || null'),
    'new estimates save the currently selected inspection job, not a separate URL value',
  );
  ok(
    source.includes('This estimate belongs to a different customer. Open a new estimate instead of changing its customer here.'),
    'editing an estimate fails closed when the selected customer does not match its owner',
  );
  ok(
    source.includes('getEstimateDocumentIdentityMismatch({'),
    'an imported carrier estimate is checked against the open customer and property',
  );
  const importBody = source.slice(
    source.indexOf('const rejectOrConfirmDocumentIdentity ='),
    source.indexOf('const items = sectionMerge ? sectionMerge.lineItems : (extractedData.line_items || []);', source.indexOf('const _generateAndSetEstimate =')),
  );
  ok(
    importBody.includes("error.code = 'ESTIMATE_IDENTITY_MISMATCH';")
      && importBody.includes('await rejectOrConfirmDocumentIdentity(identityMismatch);')
      && importBody.includes('confirmAddressLocalityWarning(mismatch)')
      && importBody.includes("mismatch.severity !== 'warn'")
      && !importBody.includes('window.confirm(')
      && importBody.indexOf('throw error;') < importBody.indexOf('saveToHistory();')
      && importBody.indexOf('await rejectOrConfirmDocumentIdentity(identityMismatch);') < importBody.indexOf('saveToHistory();'),
    'street conflicts block before history changes, and city or ZIP warnings wait for a choice',
  );
  ok(
    source.includes("if (fallbackError.code === 'ESTIMATE_IDENTITY_MISMATCH' || fallbackError.code === 'ESTIMATE_ADDRESS_WARNING_DECLINED') throw fallbackError;")
      && source.includes('alert(identityConflict ? error.message')
      && source.includes('data-testid="button-import-anyway"')
      && source.includes('data-testid="checkbox-update-customer-address"')
      && source.includes("Update the customer's address to the document address")
      && source.includes('await base44.entities.Customer.update(selectedContactId,'),
    'the warning dialog can import anyway or update the customer address, and a hard block still explains why',
  );
  const multiStart = source.indexOf('if (fileUrls.length > 1) {', source.indexOf('const _processEstimateRequest ='));
  const multiEnd = source.indexOf('// ── ESX / XML AERIAL MEASUREMENT FAST PATH', multiStart);
  const multiSource = source.slice(multiStart, multiEnd);
  const beforeCommit = multiSource.slice(0, multiSource.indexOf('// Commit only after every document'));
  ok(
    (multiSource.match(/verifyMultiDocumentIdentity\(/g) || []).length === 3
      && multiSource.includes('getEstimateDocumentBatchIdentityMismatch({')
      && beforeCommit.includes('verifyMultiDocumentIdentity(response?.customer_info, docName);')
      && !/\bset(?:LineItems|CurrentEstimate|CustomerInfo|ReportMeasurements|MeasurementsBySource|CalibrationResult|SidingBenchmarkReport)\s*\(/.test(beforeCommit),
    'every document is checked before any merged estimate or measurement state is committed',
  );

  console.log(`\n${passed} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});