'use strict';

// Render real PDFs through the same handler registry used by preview, email,
// download and public links. No company/database rows or messages are created.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const { functionHandlers } = await import(path.resolve(__dirname, '../vite-functions-plugin.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'customer-pdf-'));
  const company = { company_name: 'Example Roofing', brand_primary_color: '#245188', pdf_footer_text: 'Questions? Contact our office.' };
  const makeItems = count => Array.from({ length: count }, (_, i) => ({
    description: i === 0 ? 'Courtesy adjustment' : `Install roofing material on section ${i}, including preparation and cleanup`,
    quantity: 1, rate: i === 0 ? 300 : 45, amount: i === 0 ? 0 : 45, rcv: i === 0 ? 0 : 45,
    unit: 'EA', category: i < 2 ? 'Preparation' : 'Roofing',
  }));
  try {
    for (const [style, count] of [['estimate', 2], ['estimate', 70], ['professional_proposal', 2], ['professional_proposal', 70], ['invoice', 2], ['invoice', 70]]) {
      const items = makeItems(count);
      const params = style === 'invoice'
        ? { invoice: { invoice_number: 'SAMPLE-1', customer_name: 'Sample Customer', items, status: 'draft' }, customer: {} }
        : {
          estimate: { estimate_number: 'SAMPLE-1', line_items: items },
          customerInfo: { customer_name: 'Sample Customer' },
          trusted_company: company,
          pdf_style: style === 'professional_proposal' ? style : undefined,
          returnBase64: true,
        };
      const result = await functionHandlers[style === 'invoice' ? 'generateInvoicePDF' : 'generateEstimatePDF'](params, null, {});
      assert.ok(result.base64, `${style} returned PDF bytes`);
      const filename = path.join(dir, `${style}-${count}.pdf`);
      fs.writeFileSync(filename, Buffer.from(result.base64, 'base64'));
      const text = execFileSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8' });
      const pageCount = Number(execFileSync('pdfinfo', [filename], { encoding: 'utf8' }).match(/^Pages:\s+(\d+)/m)?.[1]);
      assert.ok(pageCount >= (count === 70 ? 2 : 1), `${style} ${count} pagination`);
      assert.match(text, /Sample Customer/);
      assert.match(text, /Courtesy adjustment/);
      assert.match(text, /\$0\.00/, `${style} preserves saved zero amount`);
      assert.match(text, new RegExp(`1\\s*/\\s*${pageCount}`), `${style} first-page numbering`);
      assert.match(text, new RegExp(`${pageCount}\\s*/\\s*${pageCount}`), `${style} last-page numbering`);
      if (count === 70) {
        const tableHeading = style === 'invoice' ? /\bItem\s+Qty\s+Rate\s+Amount/g
          : style === 'estimate' ? /Description\s+Qty\s+Unit\s+Rate/g
          : /Description\s+Qty\s+Unit\s+Rate/g;
        assert.ok((text.match(tableHeading) || []).length >= 2, `${style} repeats item headings`);
      }
      console.log(`${style} (${count} rows): ${pageCount} pages, saved $0 retained`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });