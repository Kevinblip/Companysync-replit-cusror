import { describe, it, expect } from 'vitest';
import {
  normNum,
  money,
  cleanText,
  parseCSV,
  parseInvoiceTotals,
  verifyPayments,
} from '../utils/csvReconcile.js';

// Synthetic fixtures mirror the SHAPE of real CRM exports (same headers/quoting/
// currency formatting) but contain no real customer or financial data.

const INVOICES_CSV = [
  'Invoice #,Customer,Amount,Total Tax,Status,Issue Date,Due Date',
  '"INV-1001","Acme Co",1000.00,0,"sent","2026-02-23","-"',
  '"INV-1002","Beta LLC","$2,500.50",0,"paid","2026-02-09","2026-03-11"',
  '"INV-1003","Gamma Inc",0,0,"draft","2026-01-01","-"', // skipped: $0
  '"INV-1001","Acme Co",9999,0,"sent","2026-02-23","-"', // skipped: duplicate number
  '"","No Number",500,0,"sent","2026-01-01","-"',        // skipped: no number
].join('\n');

const PAYMENTS_CSV = [
  '"Payment #","Invoice #","Payment Mode","Transaction ID","Customer","Amount","Date"',
  '"1","Invoice -100","Bank","","Split Sam","$500.00","2024-01-01"', // split A
  '"2","Invoice -100","Bank","","Split Sam","$500.00","2024-02-01"', // split B (same amt, diff date)
  '"3","Invoice -200","Bank","","Dup Dan","$225.00","2024-12-05"',   // same-day dup A
  '"4","Invoice -200","Bank","","Dup Dan","$225.00","2024-12-05"',   // same-day dup B
  '"5","Invoice -300","Card","test","Tester","$100.00","2023-05-05"',// test row
  '"6","Invoice -400","Bank","","Zero Zed","$0.00","2022-03-03"',    // zero-dollar
  '"7","Invoice -500","Bank","","Reg Roger","$1,234.56","2021-06-06"',
].join('\n');

describe('csvReconcile — pure helpers', () => {
  it('normNum strips everything except lowercase alphanumerics', () => {
    expect(normNum('INV-2026 #354,219')).toBe('inv2026354219');
    expect(normNum('Invoice -10441')).toBe('invoice10441');
    expect(normNum(null)).toBe('');
    expect(normNum(undefined)).toBe('');
  });

  it('money parses currency strings, commas and zero-width chars', () => {
    expect(money('$9,999.99')).toBeCloseTo(9999.99, 2);
    expect(money('1,000.25')).toBeCloseTo(1000.25, 2);
    expect(money('\u200b$1,000\u00a0')).toBe(1000);
    expect(money('')).toBe(0);
    expect(money('not a number')).toBe(0);
    expect(money(null)).toBe(0);
  });

  it('cleanText trims and removes zero-width / non-breaking chars', () => {
    expect(cleanText('  Sample Name \u00a0')).toBe('Sample Name');
    expect(cleanText('a\u200bb')).toBe('a b');
  });

  it('parseCSV handles quoted fields, escaped quotes, CRLF and blank lines', () => {
    const rows = parseCSV('a,b,c\r\n"x,y","he said ""hi""",3\n\n"last",,z\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'he said "hi"', '3'],
      ['last', '', 'z'],
    ]);
  });
});

describe('parseInvoiceTotals — invoices export', () => {
  const { items, skipped, error } = parseInvoiceTotals(INVOICES_CSV);

  it('parses real totals and skips $0 / blank / duplicate rows', () => {
    expect(error).toBeUndefined();
    expect(items).toEqual([
      { number: 'INV-1001', total: 1000 },
      { number: 'INV-1002', total: 2500.5 },
    ]);
    expect(skipped).toBe(3);
  });

  it('parses comma/currency-formatted amounts correctly', () => {
    expect(items.find((i) => i.number === 'INV-1002').total).toBeCloseTo(2500.5, 2);
  });

  it('dedupes by normalized invoice number (first wins)', () => {
    const keys = items.map((i) => normNum(i.number));
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.find((i) => i.number === 'INV-1001').total).toBe(1000); // not the dup 9999
  });

  it('ignores the Total Tax column when locating Amount', () => {
    // "Total Tax" contains "tax" and must be excluded from amount detection.
    expect(items.every((i) => i.total > 0)).toBe(true);
  });

  it('reports a clear error when columns are missing', () => {
    const res = parseInvoiceTotals('foo,bar\n1,2\n');
    expect(res.items).toEqual([]);
    expect(res.error).toMatch(/Invoice/i);
  });
});

describe('verifyPayments — payments export (read-only checks)', () => {
  const res = verifyPayments(PAYMENTS_CSV);

  it('counts every row and sums the total', () => {
    expect(res.error).toBeUndefined();
    expect(res.count).toBe(7);
    expect(res.total).toBeCloseTo(2784.56, 2);
  });

  it('groups payments by year', () => {
    const byYear = Object.fromEntries(res.byYear.map((y) => [y.yr, y.num]));
    expect(byYear).toEqual({ 2024: 4, 2023: 1, 2022: 1, 2021: 1 });
  });

  it('flags same-day duplicates (same invoice + amount + SAME date)', () => {
    expect(res.exactDup).toHaveLength(1);
    expect(res.exactDup[0]).toMatchObject({ customer: 'Dup Dan', amount: 225, date: '2024-12-05', count: 2 });
  });

  it('does NOT flag legitimate split payments (same amount, DIFFERENT dates)', () => {
    const flaggedCustomers = res.exactDup.map((d) => d.customer);
    expect(flaggedCustomers).not.toContain('Split Sam');
  });

  it('flags test and zero-dollar payments', () => {
    expect(res.test).toHaveLength(1);
    expect(res.test[0].customer).toBe('Tester');
    expect(res.zero).toHaveLength(1);
    expect(res.zero[0].customer).toBe('Zero Zed');
  });

  it('reports a clear error when the amount column is missing', () => {
    const r = verifyPayments('foo,bar\n1,2\n');
    expect(r.error).toMatch(/Amount/i);
  });
});
