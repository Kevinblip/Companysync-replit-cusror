import { describe, expect, it } from 'vitest';
import { nextInvoiceNumberFrom } from '../utils/invoiceNumbering.js';

describe('nextInvoiceNumberFrom', () => {
  it('continues the short sequence and ignores a long timestamp-style suffix', () => {
    const invoices = [
      { invoice_number: 'INV-2026-2026260354243' },
      { invoice_number: 'INV-2026-0042' },
      { invoice_number: 'INV-2025-9999' },
    ];

    expect(nextInvoiceNumberFrom(invoices, 2026)).toBe('INV-2026-0043');
  });

  it('starts a short sequence when existing invoices only have long suffixes', () => {
    const invoices = [
      { invoice_number: 'INV-2026-2026260354243' },
      { invoice_number: 'INV-2026-2026260354244' },
    ];

    expect(nextInvoiceNumberFrom(invoices, 2026)).toBe('INV-2026-0001');
  });

  it('preserves the high-water mark from short legacy invoice numbers', () => {
    expect(nextInvoiceNumberFrom([{ invoice_number: 'INV-0087' }], 2026))
      .toBe('INV-2026-0088');
  });
});
