const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { generateEstimateHTML } = await import(
    path.resolve(process.cwd(), 'src/utils/generateEstimateHTML.js'),
  );

  const retailHtml = generateEstimateHTML({
    lineItems: [
      { description: 'Architectural shingles', quantity: 10, unit: 'SQ', rate: 350, amount: 3500, rcv: 3500, acv: 2800 },
      { description: 'Ridge cap', quantity: 120, unit: 'LF', rate: 5, amount: 600, rcv: 600, acv: 480 },
    ],
    customerInfo: { customer_name: 'Retail Customer' },
    companyName: 'Example Roofing',
    estimateNumber: 'RETAIL-001',
  });

  assert.match(retailHtml, />Amount</);
  assert.match(retailHtml, />Total:/);
  assert.match(retailHtml, /\$4100\.00/);
  assert.doesNotMatch(retailHtml, /\b(?:RCV|ACV|Depreciation|Replacement Cost Value|Actual Cash Value)\b/i);

  const pdfSource = fs.readFileSync('functions/generateEstimatePDF.ts', 'utf8');
  const localHandlerSource = fs.readFileSync('vite-functions-plugin.js', 'utf8');
  const publicViewSource = fs.readFileSync('src/pages/ViewEstimate.jsx', 'utf8');

  // Only a format that explicitly requests it may get an insurance layout.
  assert.match(pdfSource, /format\?\.show_rcv_acv === true/);
  assert.match(localHandlerSource, /format\?\.show_rcv_acv === true/);
  assert.match(pdfSource, /const disclaimerText = showRcvAcv/);
  assert.match(localHandlerSource, /showRcvAcv \? 'TOTAL \(RCV\):' : 'TOTAL:'/);

  // The public estimate page must not expose depreciation for retail estimates.
  assert.match(publicViewSource, /isInsuranceEstimate && totalAcv > 0 && totalAcv < totalRcv/);

  console.log('Retail estimate format checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});