/**
 * DOM / integration test for the Xactimate PDF export flow.
 *
 * Unlike xactimatePdfAdapter.test.js / xactimateDialogSeeding.test.js (which
 * exercise the pure helper functions), this test drives the REAL export dialog
 * through its DOM controls — the same component AIEstimator renders — to prove
 * the end-to-end wiring works:
 *   1. Open the dialog, flip O&P + depreciation, click "Generate PDF".
 *   2. window.open is mocked so we can assert the produced HTML actually
 *      contains the expected sections (O&P, Depreciation, ACV, Trade Summary)
 *      and totals computed from the seeded line item.
 *   3. Per-claim fields (claim #, insurer) re-seed from the CURRENT customer
 *      each time the dialog opens, so one customer's claim details never leak
 *      into another customer's export.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import XactimateExportDialog from '@/components/estimates/XactimateExportDialog';

const LINE_ITEMS = [
  { description: 'Architectural shingle - remove & replace', code: 'RFG240', quantity: 10, unit: 'SQ', rate: 100 },
];

const CUSTOMER_A = {
  customer_name: 'Alice Anderson',
  property_address: '100 A St, Austin, TX',
  claim_number: 'CLAIM-AAA',
  insurance_company: 'Acme Mutual',
};
const CUSTOMER_B = {
  customer_name: 'Bob Baker',
  property_address: '200 B Ave, Dallas, TX',
  claim_number: 'CLAIM-BBB',
  insurance_company: 'Beacon Insurance',
};
const MY_COMPANY = {
  company_name: 'YICN Roofing',
  address: '1 Roof Rd, Austin, TX',
  phone: '555-1234',
  contact_name: 'Kevin',
};

function mockWindowOpen() {
  const writes = [];
  const fakeWin = { document: { write: (h) => writes.push(h), close: vi.fn() } };
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin);
  return { openSpy, getHtml: () => writes.join('') };
}

beforeEach(() => {
  localStorage.clear();
  // Generate always proceeds past the validation-warning confirm dialog.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('XactimateExportDialog — export flow', () => {
  it('generates insurance-style HTML with O&P, depreciation and correct totals from the seeded line item', () => {
    const { openSpy, getHtml } = mockWindowOpen();
    const onSuccess = vi.fn();

    render(
      <XactimateExportDialog
        open
        onOpenChange={() => {}}
        lineItems={LINE_ITEMS}
        customerInfo={CUSTOMER_A}
        myCompany={MY_COMPANY}
        onSuccess={onSuccess}
      />
    );

    // Flip Overhead & Profit on, then set 10% / 10%.
    fireEvent.click(screen.getByTestId('switch-xactimate-op'));
    fireEvent.change(screen.getByTestId('input-xactimate-overhead'), { target: { value: '10' } });
    fireEvent.change(screen.getByTestId('input-xactimate-profit'), { target: { value: '10' } });

    // Flip Depreciation on (flat 20%).
    fireEvent.click(screen.getByTestId('switch-xactimate-dep'));
    fireEvent.change(screen.getByTestId('input-xactimate-dep-pct'), { target: { value: '20' } });

    // Generate.
    fireEvent.click(screen.getByTestId('button-xactimate-generate'));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    const html = getHtml();
    // Customer + claim identity flowed through.
    expect(html).toContain('Alice Anderson');
    expect(html).toContain('CLAIM-AAA');
    // Line item present.
    expect(html).toContain('Architectural shingle');
    // O&P section rendered (overhead 10% + profit 10% on $1,000 subtotal).
    expect(html).toContain('General Contractor Overhead');
    expect(html).toContain('General Contractor Profit');
    // Replacement Cost Value = 1,000 + 200 O&P = 1,200.00
    expect(html).toContain('Replacement Cost Value');
    expect(html).toContain('1,200.00');
    // Depreciation → ACV section rendered.
    expect(html).toContain('Less Depreciation');
    expect(html).toContain('Actual Cash Value');
    // Trade summary page on by default.
    expect(html).toContain('Trade Summary');
  });

  it('omits the depreciation section when depreciation is left off', () => {
    const { getHtml } = mockWindowOpen();

    render(
      <XactimateExportDialog
        open
        onOpenChange={() => {}}
        lineItems={LINE_ITEMS}
        customerInfo={CUSTOMER_A}
        myCompany={MY_COMPANY}
        onSuccess={() => {}}
      />
    );

    fireEvent.click(screen.getByTestId('button-xactimate-generate'));

    const html = getHtml();
    expect(html).toContain('Architectural shingle');
    // Depreciation toggle is off → no ACV/depreciation section.
    expect(html).not.toContain('Less Depreciation');
    expect(html).not.toContain('Actual Cash Value');
  });

  it('does not open a tab (and warns) when there are no line items', () => {
    const { openSpy } = mockWindowOpen();
    const onSuccess = vi.fn();

    render(
      <XactimateExportDialog
        open
        onOpenChange={() => {}}
        lineItems={[]}
        customerInfo={CUSTOMER_A}
        myCompany={MY_COMPANY}
        onSuccess={onSuccess}
      />
    );

    fireEvent.click(screen.getByTestId('button-xactimate-generate'));

    expect(openSpy).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalled();
  });
});

describe('XactimateExportDialog — per-claim re-seed (no cross-customer leak)', () => {
  it('seeds claim # and insurer from the current customer on open, and re-seeds on reopen for a different customer', () => {
    mockWindowOpen();

    const { rerender } = render(
      <XactimateExportDialog
        open
        onOpenChange={() => {}}
        lineItems={LINE_ITEMS}
        customerInfo={CUSTOMER_A}
        myCompany={MY_COMPANY}
        onSuccess={() => {}}
      />
    );

    // Opened for customer A → per-claim fields seeded from A.
    expect(screen.getByTestId('input-xactimate-claim')).toHaveValue('CLAIM-AAA');
    expect(screen.getByTestId('input-xactimate-insurer')).toHaveValue('Acme Mutual');

    // Operator manually overrides the claim number for A.
    fireEvent.change(screen.getByTestId('input-xactimate-claim'), { target: { value: 'MANUAL-OVERRIDE-A' } });
    expect(screen.getByTestId('input-xactimate-claim')).toHaveValue('MANUAL-OVERRIDE-A');

    // Close the dialog...
    rerender(
      <XactimateExportDialog
        open={false}
        onOpenChange={() => {}}
        lineItems={LINE_ITEMS}
        customerInfo={CUSTOMER_A}
        myCompany={MY_COMPANY}
        onSuccess={() => {}}
      />
    );

    // ...then reopen it for a DIFFERENT customer B.
    rerender(
      <XactimateExportDialog
        open
        onOpenChange={() => {}}
        lineItems={LINE_ITEMS}
        customerInfo={CUSTOMER_B}
        myCompany={MY_COMPANY}
        onSuccess={() => {}}
      />
    );

    // Per-claim fields must now reflect B — A's claim (and the manual override)
    // must NOT leak across.
    const claim = screen.getByTestId('input-xactimate-claim');
    expect(claim).toHaveValue('CLAIM-BBB');
    expect(claim).not.toHaveValue('CLAIM-AAA');
    expect(claim).not.toHaveValue('MANUAL-OVERRIDE-A');
    expect(screen.getByTestId('input-xactimate-insurer')).toHaveValue('Beacon Insurance');
  });

  it('never persists per-claim fields to localStorage on generate', () => {
    mockWindowOpen();

    render(
      <XactimateExportDialog
        open
        onOpenChange={() => {}}
        lineItems={LINE_ITEMS}
        customerInfo={CUSTOMER_A}
        myCompany={MY_COMPANY}
        onSuccess={() => {}}
      />
    );

    fireEvent.click(screen.getByTestId('button-xactimate-generate'));

    const saved = JSON.parse(localStorage.getItem('aiEstimatorXactimateOpts') || '{}');
    // Reusable prefs persist...
    expect(saved).toHaveProperty('includeTradeSummary');
    // ...but per-claim fields never do.
    for (const key of ['claimNumber', 'policyNumber', 'insuranceCompany', 'typeOfLoss', 'dateOfLoss', 'dateInspected', 'deductible']) {
      expect(saved).not.toHaveProperty(key);
    }
  });
});
