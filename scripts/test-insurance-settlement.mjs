// No live AI, customer records, payment records, mail, or database writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { sumRcv } from '../src/utils/estimateTotals.js';
import {
  normalizeInsuranceSettlement, getInsuranceSettlementSummary, settlementFromDocument,
  isInsuranceSettlementAdjustment, insuranceSettlementHtml,
} from '../lib/insuranceSettlement.js';
import { generateEstimateHTML } from '../src/utils/generateEstimateHTML.js';

const carrier = {
  basis: 'Limited roof surfacing settlement',
  roof_age_years: 21, roof_payout_percent: 37, roof_rcv: 12543.01,
  roof_schedule_reduction: 7902.08, roof_payable: 4640.93,
  payable_loss_amount: 6009.61, code_upgrade_allowance: 2731.44,
  deductible: 2500, reported_check_amount: 6241.05, recoverable_depreciation: 342.17,
  source_reference: 'Settlement statement, page 1; recap, page 3',
  conditions: ['Code allowance is paid when incurred. Paid documentation and permits may be required.'],
  warnings: ['The stated check includes the code allowance, while the recap shows it at zero ACV. Contents may not be contractor work.'],
};
const before = JSON.stringify(carrier);
const summary = getInsuranceSettlementSummary(carrier, 16723.12);
assert.equal(summary.rows.find(row => row.key === 'comparison_gap').value, 10482.07);
assert.equal(summary.rows.find(row => row.key === 'reported_check_amount').value, 6241.05);
assert.match(summary.rows.find(row => row.key === 'comparison_gap').label, /NOT amount due/);
assert.ok(summary.warnings.some(warning => /not ordinary recoverable depreciation/.test(warning)));
assert.ok(!summary.warnings.some(warning => /do not reconcile/.test(warning)));
assert.equal(JSON.stringify(carrier), before, 'No mutation of carrier facts');
assert.equal(normalizeInsuranceSettlement(null), null);
assert.equal(normalizeInsuranceSettlement({ deductible: null }), null);
assert.equal(normalizeInsuranceSettlement({ deductible: '', reported_check_amount: false }), null);
assert.equal(normalizeInsuranceSettlement({ reported_check_amount: [], deductible: {} }), null);
assert.equal(normalizeInsuranceSettlement({ reported_check_amount: 0 }).reported_check_amount, 0);
assert.equal(normalizeInsuranceSettlement({ roof_payout_percent: 101 }), null);
assert.equal(normalizeInsuranceSettlement({ deductible: '-2,500.00' }).deductible, 2500);
assert.ok(getInsuranceSettlementSummary({ basis: 'ACV' }, 100).warnings.some(warning => /No settlement payment/.test(warning)));
assert.ok(!getInsuranceSettlementSummary(carrier, null).rows.some(row => row.key === 'comparison_gap'));
assert.ok(getInsuranceSettlementSummary({ ...carrier, reported_check_amount: 6000 }, 16723.12).warnings.some(warning => /do not reconcile/.test(warning)));
assert.ok(getInsuranceSettlementSummary({ ...carrier, roof_payable: 3000 }, 16723.12).warnings.some(warning => /roof cost.*do not reconcile/.test(warning)));

const adjustments = [
  { description: 'Application of Roof Surfacing Payment Schedule', rcv: -5639.07 },
  { description: 'Application of Roof Surfacing Schedule', rcv: -2263.01 },
  { description: 'Less: Policy Deductible', rcv: -2500 },
];
assert.ok(adjustments.every(isInsuranceSettlementAdjustment));
assert.ok(!isInsuranceSettlementAdjustment({ description: 'Install laminated shingles' }));
assert.ok(!isInsuranceSettlementAdjustment({ description: 'Courtesy discount', rcv: -50 }));
assert.equal(settlementFromDocument(null, adjustments).roof_schedule_reduction, 7902.08);
assert.equal(settlementFromDocument(carrier, adjustments).roof_schedule_reduction, 7902.08, 'Never double the extracted schedule');
assert.equal(settlementFromDocument(carrier, adjustments).deductible, 2500);
assert.ok(!insuranceSettlementHtml(null, 100));
assert.ok(insuranceSettlementHtml({ ...carrier, basis: '<script>alert(1)</script>' }, 16723.12).includes('&lt;script&gt;'));

const items = [{ description: 'Approved repair scope', quantity: 1, unit: 'LS', rate: 16723.12, rcv: 16723.12, amount: 16723.12, acv: 16723.12 }];
const originalItems = JSON.stringify(items);
const html = generateEstimateHTML({ customerInfo: {}, lineItems: items, descriptions: {}, companyName: 'Fixture Contractor', insuranceSettlement: carrier });
assert.match(html, /Insurance Settlement/);
assert.match(html, /6,241\.05/);
assert.match(html, /16,723\.12|16723\.12/);
assert.match(html, /NOT amount due/);
assert.equal(JSON.stringify(items), originalItems);

const { functionHandlers } = await import('../vite-functions-plugin.js');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insurance-settlement-'));
try {
  for (const style of [undefined, 'professional_proposal']) {
    const result = await functionHandlers.generateEstimatePDF({
      estimate: { estimate_number: 'FIXTURE-SETTLEMENT', line_items: items, total_rcv: 16723.12, total_amount: 16723.12, insurance_settlement: carrier },
      customerInfo: { customer_name: 'Fixture Customer' },
      trusted_company: { company_name: 'Fixture Contractor' },
      pdf_style: style, returnBase64: true,
    }, null, {});
    const filename = path.join(directory, `${style || 'standard'}.pdf`);
    fs.writeFileSync(filename, Buffer.from(result.base64, 'base64'));
    const output = execFileSync('pdftotext', ['-layout', filename, '-'], { encoding: 'utf8' });
    assert.match(output, /Insurance Settlement/);
    assert.match(output, /6,241\.05/);
    assert.match(output, /7,902\.08/);
    assert.match(output, /2,500\.00/);
    assert.match(output, /16723\.12|16,723\.12/);
    assert.match(output, /NOT amount due/);
    assert.match(output, /paid when incurred/);
    assert.match(output, /not ordinary recoverable depreciation/);
    assert.match(output, /REVIEW:/);
    console.log(`PASS: ${style || 'standard'} PDF preserves repair total and shows policy settlement / review warnings`);
  }
  assert.equal(JSON.stringify(items), originalItems);
  assert.equal(JSON.stringify(carrier), before);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }

const source = fs.readFileSync(new URL('../src/pages/AIEstimator.jsx', import.meta.url), 'utf8');
assert.ok((source.match(/insurance_settlement: insuranceSettlementSchema/g) || []).length === 3, 'Single, fallback, and multi-document schemas all capture settlements');
assert.ok(source.includes('insurance_settlement: estimateData.insurance_settlement'), 'Update path preserves metadata');
assert.ok(source.includes('insurance_settlement: normalizeInsuranceSettlement(currentEstimate?.insurance_settlement)'), 'Save path includes metadata');
const viewer = fs.readFileSync(new URL('../src/pages/ViewEstimate.jsx', import.meta.url), 'utf8');
const subtotalExpression = viewer.match(/const subtotal = (.+);/)[1];
assert.equal(vm.runInNewContext(subtotalExpression, { estimate: { line_items: items }, sumRcv }), 16723.12);
assert.equal(vm.runInNewContext(subtotalExpression, { estimate: { items }, sumRcv }), 16723.12);
assert.equal(vm.runInNewContext(subtotalExpression, { estimate: { items: [{ quantity: 1, rate: 900, rcv: 0 }] }, sumRcv }), 0);
console.log('PASS: settlement arithmetic, unknown/zero handling, source conflicts, adjustment isolation, saved-state wiring, and print parity');
