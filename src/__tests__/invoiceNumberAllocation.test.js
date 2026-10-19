import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { isPaymentCreateBlocked, isRecordPaymentBlocked } from '../utils/paymentGuards.js';

const nodeRequire = createRequire(import.meta.url);
const {
  chooseInvoiceNumber,
  nextInvoiceNumberFromNumbers,
  pickInvoiceRow,
} = nodeRequire('../../lib/invoiceNumbers.cjs');

describe('invoice number allocation', () => {
  it('follows the same high-water rules as the client preview', () => {
    expect(nextInvoiceNumberFromNumbers(
      ['INV-2026-2026260354243', 'INV-2026-0042', 'INV-2025-9999'],
      2026,
    )).toBe('INV-2026-0043');
    expect(nextInvoiceNumberFromNumbers(
      ['INV-2026-2026260354243', 'INV-2026-2026260354244'],
      2026,
    )).toBe('INV-2026-0001');
    expect(nextInvoiceNumberFromNumbers(['INV-0087'], 2026)).toBe('INV-2026-0088');
  });

  it('keeps a free requested number and mints the next one when that label is taken', () => {
    expect(chooseInvoiceNumber({
      numbers: ['INV-2026-0385'],
      requested: 'INV-2026-0385',
      year: 2026,
    }).invoiceNumber).toBe('INV-2026-0386');

    expect(chooseInvoiceNumber({
      numbers: ['INV-2026-0385'],
      requested: 'INV-2026-0100',
      year: 2026,
    }).invoiceNumber).toBe('INV-2026-0100');
  });

  it('keeps an existing label on sync instead of minting a new number every time', () => {
    const assigned = chooseInvoiceNumber({
      numbers: ['INV-2026-0385'],
      requested: 'INV-2026-0385',
      year: 2026,
      keepWhenTaken: 'INV-2026-0100',
    });
    expect(assigned.invoiceNumber).toBe('INV-2026-0100');
    expect(assigned.keptExisting).toBe(true);
  });

  it('picks Chad when the customer identifies him and refuses the shared number otherwise', () => {
    const rows = [
      {
        id: 'inv_1781649945868_w1midi5ea',
        customer_id: 'cust_chad',
        customer_name: 'Chad Sohl',
      },
      {
        id: 'inv_1782911040494_xaui6rds8',
        customer_id: 'cust_beverly',
        customer_name: 'Beverly Owens-Jackson',
      },
    ];
    expect(pickInvoiceRow(rows, { customerId: 'cust_chad' }).invoice.id).toBe('inv_1781649945868_w1midi5ea');
    expect(pickInvoiceRow(rows, {}).ambiguous).toBe(true);
  });
});

describe('record payment overpay guard', () => {
  it('blocks another payment once Beverly is already overpaid by the mislinked dollars', () => {
    const beverly = {
      invoice_number: 'INV-2026-0385',
      status: 'paid',
      total_amount: 13151.19,
      amount_paid: 13767.07,
    };
    expect(isPaymentCreateBlocked(beverly, '100')).toBe(true);
    expect(isRecordPaymentBlocked(13151.19, 13767.07)).toBe(true);
  });
});
