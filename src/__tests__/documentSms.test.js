import {
  buildEstimateSmsMessage,
  buildInvoiceSmsMessage,
  estimateSmsTotal,
  firstNameOf,
  formatSmsMoney,
  invoiceSmsBalance,
  resolveSmsPhone,
} from '@/utils/documentSms';

describe('resolveSmsPhone', () => {
  it('normalizes US numbers to E.164', () => {
    expect(resolveSmsPhone('(216) 555-0000')).toBe('+12165550000');
    expect(resolveSmsPhone('2165550000')).toBe('+12165550000');
    expect(resolveSmsPhone('1-216-555-0000')).toBe('+12165550000');
  });

  it('falls through candidates in order and skips blanks', () => {
    expect(resolveSmsPhone(null, '', '   ', '2165550000')).toBe('+12165550000');
    expect(resolveSmsPhone('2165550000', '4405551111')).toBe('+12165550000');
  });

  it('keeps already-international numbers', () => {
    expect(resolveSmsPhone('+44 20 7946 0000')).toBe('+442079460000');
  });

  it('returns null when nothing is dialable', () => {
    expect(resolveSmsPhone()).toBeNull();
    expect(resolveSmsPhone(null, undefined, '')).toBeNull();
    expect(resolveSmsPhone('123')).toBeNull();
    expect(resolveSmsPhone('not a phone')).toBeNull();
  });
});

describe('money helpers', () => {
  it('formats money with thousands separators', () => {
    expect(formatSmsMoney(18459.207)).toBe('$18,459.21');
    expect(formatSmsMoney('1234.5')).toBe('$1,234.50');
    expect(formatSmsMoney(undefined)).toBe('$0.00');
  });

  it('prefers total_rcv for estimates, falls back to amount', () => {
    expect(estimateSmsTotal({ total_rcv: 100, amount: 999 })).toBe(100);
    expect(estimateSmsTotal({ amount: 999 })).toBe(999);
    expect(estimateSmsTotal({ total_rcv: 0, amount: 999 })).toBe(0);
    expect(estimateSmsTotal(null)).toBe(0);
  });

  it('computes invoice balance from total_amount minus amount_paid', () => {
    expect(invoiceSmsBalance({ total_amount: 1000, amount_paid: 250 })).toBe(750);
    expect(invoiceSmsBalance({ total_amount: 1000 })).toBe(1000);
  });

  it('never quotes the stale legacy invoice.amount field', () => {
    // `amount` is frozen legacy data and is often wrong; balance must ignore it.
    expect(invoiceSmsBalance({ amount: 87147.71, total_amount: 500, amount_paid: 100 })).toBe(400);
  });

  it('never reports a negative balance on an overpaid invoice', () => {
    expect(invoiceSmsBalance({ total_amount: 100, amount_paid: 175 })).toBe(0);
  });
});

describe('firstNameOf', () => {
  it('uses only the first name and degrades safely', () => {
    expect(firstNameOf('Sorrell Eaddy')).toBe('Sorrell');
    expect(firstNameOf('  Jennifer   Park ')).toBe('Jennifer');
    expect(firstNameOf('')).toBe('there');
    expect(firstNameOf(null)).toBe('there');
  });
});

describe('buildEstimateSmsMessage', () => {
  const estimate = {
    customer_name: 'Sorrell Eaddy',
    estimate_number: 'EST-2015',
    total_rcv: 12500,
  };

  it('includes the name, number, total and link', () => {
    const msg = buildEstimateSmsMessage({
      estimate,
      companyName: 'CompanySync Roofing',
      shareUrl: 'https://example.com/ViewEstimate?id=1&t=abc',
    });
    expect(msg).toContain('Hi Sorrell!');
    expect(msg).toContain('EST-2015');
    expect(msg).toContain('$12,500.00');
    expect(msg).toContain('https://example.com/ViewEstimate?id=1&t=abc');
    expect(msg).toContain('CompanySync Roofing');
  });

  it('omits the link line when no share URL could be signed', () => {
    const msg = buildEstimateSmsMessage({ estimate, companyName: 'Acme' });
    expect(msg).not.toContain('View the full estimate');
    expect(msg).toContain('$12,500.00');
  });

  it('does not crash on an empty estimate', () => {
    expect(() => buildEstimateSmsMessage({})).not.toThrow();
    expect(buildEstimateSmsMessage({})).toContain('Hi there!');
  });
});

describe('buildInvoiceSmsMessage', () => {
  const invoice = {
    customer_name: 'Jennifer Park',
    invoice_number: 'INV-2026-0376',
    total_amount: 2000,
    amount_paid: 500,
  };

  it('texts the remaining balance and pay link', () => {
    const msg = buildInvoiceSmsMessage({
      invoice,
      companyName: 'CompanySync Roofing',
      payUrl: 'https://pay.stripe.com/x',
    });
    expect(msg).toContain('Hi Jennifer!');
    expect(msg).toContain('INV-2026-0376');
    expect(msg).toContain('$1,500.00');
    expect(msg).toContain('https://pay.stripe.com/x');
  });

  it('offers a phone fallback when no pay link exists', () => {
    const msg = buildInvoiceSmsMessage({ invoice, companyName: 'Acme', companyPhone: '216-555-0000' });
    expect(msg).not.toContain('Pay securely here');
    expect(msg).toContain('216-555-0000');
  });

  it('does not crash on an empty invoice', () => {
    expect(() => buildInvoiceSmsMessage({})).not.toThrow();
    expect(buildInvoiceSmsMessage({})).toContain('$0.00');
  });
});
