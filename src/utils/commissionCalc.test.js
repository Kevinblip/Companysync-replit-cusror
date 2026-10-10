import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommissionLines,
  calculateRepCommissions,
  commissionRecipients,
  existingPayout,
  invoiceMoney,
  parseCommissionDate,
  payPeriodKey,
  resolveCommissionRate,
  resolveCommissionSplits,
  roundCents,
  unpaidBalance,
} from './commissionCalc.js';

const COMPANY = 'yicn';
const OTHER = 'other-tenant';

function rep(email, rate, extra = {}) {
  return {
    id: `staff-${email}`,
    company_id: COMPANY,
    user_email: email,
    full_name: extra.full_name || email,
    commission_rate: rate,
    ...extra,
  };
}

function invoice(overrides = {}) {
  return {
    id: 'inv-1',
    company_id: COMPANY,
    invoice_number: 'INV-1',
    customer_name: 'Ada Roof',
    customer_id: 'cust-1',
    amount: 10000,
    sale_agent: 'rep@yicn.com',
    status: 'partially_paid',
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: 'pay-1',
    company_id: COMPANY,
    invoice_id: 'inv-1',
    invoice_number: 'INV-1',
    customer_name: 'Ada Roof',
    customer_id: 'cust-1',
    amount: 1000,
    payment_date: '2026-10-15',
    status: 'received',
    ...overrides,
  };
}

const OCTOBER = {
  start: new Date(2026, 9, 1, 0, 0, 0, 0),
  end: new Date(2026, 9, 31, 23, 59, 59, 999),
};

function octoberFor(staff, extras = {}) {
  return calculateRepCommissions({
    companyId: COMPANY,
    staffProfiles: staff,
    start: OCTOBER.start,
    end: OCTOBER.end,
    periodKey: '2026-10',
    ...extras,
  });
}

describe('calendar dates stay on the selected day', () => {
  it('treats a date-only string and midnight UTC as the calendar day', () => {
    for (const value of ['2026-10-01', '2026-10-01T00:00:00.000Z', new Date('2026-10-01T00:00:00.000Z')]) {
      const parsed = parseCommissionDate(value);
      assert.equal(parsed.getFullYear(), 2026);
      assert.equal(parsed.getMonth(), 9);
      assert.equal(parsed.getDate(), 1);
    }
  });

  it('keeps the first of the month inside that month', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [payment({ payment_date: '2026-10-01T00:00:00.000Z', amount: 200 })],
    });
    assert.equal(rows[0].grossCommission, 20);
    assert.equal(rows[0].paymentCount, 1);
  });

  it('does not pull the previous month into this month', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [payment({ payment_date: '2026-09-30', amount: 200 })],
    });
    assert.equal(rows[0].grossCommission, 0);
  });
});

describe('commission is a percent of what was collected', () => {
  it('pays the sale agent their rate on a partial payment', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice({ amount: 10000 })],
      payments: [payment({ amount: 2500 })],
    });
    assert.equal(rows[0].grossCommission, 250);
    assert.equal(rows[0].totalSales, 2500);
    assert.equal(rows[0].netCommission, 250);
  });

  it('sums partial payments and rounds each one to the cent', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [
        payment({ id: 'p1', amount: 33.33 }),
        payment({ id: 'p2', amount: 33.33, payment_date: '2026-10-16' }),
      ],
    });
    assert.equal(roundCents(33.33 * 0.1), 3.33);
    assert.equal(rows[0].grossCommission, 6.66);
  });

  it('uses total_amount when the legacy amount field is missing', () => {
    assert.equal(invoiceMoney({ total_amount: 4200, amount: 0 }), 4200);
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice({ amount: 0, total_amount: 4200 })],
      payments: [payment({ amount: 4200 })],
    });
    assert.equal(rows[0].grossCommission, 420);
  });

  it('does not invent a 5% or 10% rate when the rep has none', () => {
    const rows = octoberFor([rep('rep@yicn.com', 0), rep('office@yicn.com', null)], {
      invoices: [invoice()],
      payments: [payment({ amount: 1000 })],
    });
    assert.equal(rows.length, 0);
  });

  it('reads a rate stored only on the legacy data json', () => {
    assert.equal(resolveCommissionRate({ commission_rate: 0, data: { commission_rate: 8 } }), 8);
    const rows = octoberFor([rep('rep@yicn.com', 0, { data: { commission_rate: 8 } })], {
      invoices: [invoice()],
      payments: [payment({ amount: 1000 })],
    });
    assert.equal(rows[0].commissionRate, 8);
    assert.equal(rows[0].grossCommission, 80);
  });
});

describe('splits and attribution', () => {
  it('pays each split their own rate on their share and nobody else', () => {
    const splits = [
      { user_email: 'closer@yicn.com', user_name: 'Closer', split_percentage: 60, role: 'Sales' },
      { user_email: 'manager@yicn.com', user_name: 'Manager', split_percentage: 40, role: 'Manager' },
    ];
    const rows = octoberFor(
      [rep('closer@yicn.com', 10, { full_name: 'Closer' }), rep('manager@yicn.com', 5, { full_name: 'Manager' }), rep('other@yicn.com', 10)],
      {
        invoices: [invoice({ sale_agent: 'other@yicn.com', commission_splits: splits })],
        payments: [payment({ amount: 1000 })],
        customers: [{ id: 'cust-1', company_id: COMPANY, name: 'Ada Roof', assigned_to_users: ['other@yicn.com'] }],
      },
    );
    const closer = rows.find((row) => row.email === 'closer@yicn.com');
    const manager = rows.find((row) => row.email === 'manager@yicn.com');
    const other = rows.find((row) => row.email === 'other@yicn.com');
    assert.equal(closer.grossCommission, 60);
    assert.equal(closer.totalSales, 600);
    assert.equal(manager.grossCommission, 20);
    assert.equal(other.grossCommission, 0);
  });

  it('uses splits saved only on the legacy data json', () => {
    assert.equal(resolveCommissionSplits({ commission_splits: [], data: { commission_splits: [{ user_email: 'rep@yicn.com', split_percentage: 50 }] } }).length, 1);
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice({
        commission_splits: [],
        data: { commission_splits: [{ user_email: 'rep@yicn.com', user_name: 'Rep', split_percentage: 50 }] },
      })],
      payments: [payment({ amount: 1000 })],
    });
    assert.equal(rows[0].grossCommission, 50);
  });

  it('does not match a payment to a different invoice for the same customer', () => {
    const rows = octoberFor(
      [rep('a@yicn.com', 10), rep('b@yicn.com', 10)],
      {
        invoices: [
          invoice({ id: 'inv-a', invoice_number: 'A', sale_agent: 'a@yicn.com', customer_name: 'Ada Roof' }),
          invoice({ id: 'inv-b', invoice_number: 'B', sale_agent: 'b@yicn.com', customer_name: 'Ada Roof' }),
        ],
        payments: [payment({ invoice_id: 'inv-b', invoice_number: 'B', amount: 1000, customer_name: 'Ada Roof' })],
      },
    );
    assert.equal(rows.find((row) => row.email === 'a@yicn.com').grossCommission, 0);
    assert.equal(rows.find((row) => row.email === 'b@yicn.com').grossCommission, 100);
  });

  it('credits the sale agent, not every customer assignee', () => {
    const recipients = commissionRecipients(
      invoice({ sale_agent: 'a@yicn.com', commission_splits: [] }),
      { assigned_to: 'b@yicn.com', assigned_to_users: ['b@yicn.com', 'c@yicn.com'] },
    );
    assert.deepEqual(recipients.map((r) => r.email), ['a@yicn.com']);
  });

  it('uses the primary assignee only when the invoice has no sale agent', () => {
    const recipients = commissionRecipients(
      invoice({ sale_agent: '', commission_splits: [] }),
      { assigned_to: 'b@yicn.com', assigned_to_users: ['b@yicn.com', 'c@yicn.com'] },
    );
    assert.deepEqual(recipients.map((r) => r.email), ['b@yicn.com']);
  });

  it('pays nobody when several people are assigned and there is no sale agent or split', () => {
    const recipients = commissionRecipients(
      invoice({ sale_agent: null, commission_splits: [] }),
      { assigned_to_users: ['b@yicn.com', 'c@yicn.com'] },
    );
    assert.equal(recipients.length, 0);
  });

  it('follows the current sale agent when the rep changes', () => {
    const rows = octoberFor([rep('old@yicn.com', 10), rep('new@yicn.com', 10)], {
      invoices: [invoice({ sale_agent: 'new@yicn.com' })],
      payments: [payment({ amount: 100 })],
    });
    assert.equal(rows.find((row) => row.email === 'old@yicn.com').grossCommission, 0);
    assert.equal(rows.find((row) => row.email === 'new@yicn.com').grossCommission, 10);
  });

  it('matches sale agent email case-insensitively', () => {
    const rows = octoberFor([rep('Rep@YICN.com', 10)], {
      invoices: [invoice({ sale_agent: 'rep@yicn.com' })],
      payments: [payment({ amount: 100 })],
    });
    assert.equal(rows[0].grossCommission, 10);
  });
});

describe('refunds, voids, and zero invoices', () => {
  it('ignores failed, refunded, and voided payments', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [
        payment({ id: 'ok', amount: 100, status: 'completed' }),
        payment({ id: 'bad', amount: 500, status: 'refunded' }),
        payment({ id: 'void', amount: 500, status: 'void' }),
        payment({ id: 'fail', amount: 500, status: 'failed' }),
      ],
    });
    assert.equal(rows[0].grossCommission, 10);
    assert.equal(rows[0].paymentCount, 1);
  });

  it('reduces commission when a refund is a negative payment', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [
        payment({ id: 'in', amount: 1000 }),
        payment({ id: 'out', amount: -200, payment_date: '2026-10-20', status: 'received' }),
      ],
    });
    assert.equal(rows[0].grossCommission, 80);
  });

  it('records nothing when an imported invoice is $0', () => {
    assert.equal(unpaidBalance(invoice({ amount: 0, total_amount: 0 }), []), 0);
  });
});

describe('marking an invoice paid records the unpaid balance once', () => {
  it('records the full balance when nothing has been collected', () => {
    assert.equal(unpaidBalance(invoice({ amount: 1000, amount_paid: 0 }), []), 1000);
  });

  it('records only the remainder after a partial payment', () => {
    assert.equal(unpaidBalance(invoice({ amount: 1000 }), [payment({ amount: 400 })]), 600);
  });

  it('does not record a second payment when the invoice is already collected', () => {
    const first = payment({ amount: 1000 });
    assert.equal(unpaidBalance(invoice({ amount: 1000, amount_paid: 1000 }), [first]), 0);
  });

  it('ignores a collected payment that belongs to another company', () => {
    assert.equal(
      unpaidBalance(invoice({ amount: 1000 }), [payment({ amount: 1000, company_id: OTHER })]),
      1000,
    );
  });
});

describe('deductions, payouts, and duplicates', () => {
  it('subtracts ladder assist and other deductions in the period', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [payment({ amount: 1000 })],
      deductions: [
        { company_id: COMPANY, sales_rep_email: 'rep@yicn.com', amount: 25, deduction_type: 'ladder_assist', deduction_date: '2026-10-18' },
        { company_id: COMPANY, staff_email: 'rep@yicn.com', amount: 10, deduction_type: 'advance', deduction_date: '2026-10-19' },
        { company_id: COMPANY, sales_rep_email: 'rep@yicn.com', amount: 99, deduction_type: 'chargeback', deduction_date: '2026-09-01' },
      ],
    });
    assert.equal(rows[0].totalLadderAssist, 25);
    assert.equal(rows[0].totalDeductions, 35);
    assert.equal(rows[0].netCommission, 65);
  });

  it('marks a period paid once and ignores a second payout for that period', () => {
    const payout = {
      id: 'cp-1',
      company_id: COMPANY,
      sales_rep_email: 'rep@yicn.com',
      pay_period: '2026-10',
      status: 'paid',
      gross_commission: 100,
      payment_date: '2026-10-28',
      notes: 'check 100',
    };
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      invoices: [invoice()],
      payments: [payment({ amount: 1000 })],
      commissionPayments: [payout, { ...payout, id: 'cp-2' }],
    });
    assert.equal(rows[0].isPaid, true);
    assert.equal(rows[0].grossCommission, 100);
    assert.equal(existingPayout([payout], { companyId: COMPANY, email: 'rep@yicn.com', periodKey: '2026-10' })?.id, 'cp-1');
  });

  it('does not turn a payout record into earnings when nothing was collected', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      commissionPayments: [{
        company_id: COMPANY,
        sales_rep_email: 'rep@yicn.com',
        pay_period: '2026-10',
        status: 'paid',
        gross_commission: 100,
        payment_date: '2026-10-28',
        notes: 'check 100',
      }],
    });
    assert.equal(rows[0].grossCommission, 0);
    assert.equal(rows[0].isPaid, true);
  });

  it('keeps a manual commission when the rep has no collected payments', () => {
    const rows = octoberFor([rep('rep@yicn.com', 10)], {
      commissionPayments: [{
        company_id: COMPANY,
        sales_rep_email: 'rep@yicn.com',
        pay_period: '2026-10',
        status: 'paid',
        gross_commission: 75,
        total_deductions: 0,
        payment_date: '2026-10-05',
        notes: 'Manual commission entry',
      }],
    });
    assert.equal(rows[0].grossCommission, 75);
    assert.equal(rows[0].isPaid, true);
  });

  it('stores a year payout under the year, not the current month', () => {
    assert.equal(payPeriodKey('this_year', new Date(2026, 9, 10)), '2026');
    assert.equal(payPeriodKey('last_month', new Date(2026, 9, 10)), '2026-09');
    assert.notEqual(payPeriodKey('this_year', new Date(2026, 9, 10)), '2026-10');
  });
});

describe('tenant isolation', () => {
  it('does not pay a rep from another company for this company payment', () => {
    const lines = buildCommissionLines({
      companyId: COMPANY,
      staffProfiles: [
        rep('rep@yicn.com', 10),
        rep('rep@yicn.com', 50, { company_id: OTHER, id: 'other-staff' }),
      ],
      invoices: [invoice(), invoice({ id: 'inv-x', company_id: OTHER, invoice_number: 'X', sale_agent: 'rep@yicn.com' })],
      payments: [
        payment({ amount: 100 }),
        payment({ id: 'foreign', company_id: OTHER, invoice_id: 'inv-x', invoice_number: 'X', amount: 9000 }),
      ],
      start: OCTOBER.start,
      end: OCTOBER.end,
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].gross_commission, 10);
    assert.equal(lines[0].staff.company_id, COMPANY);
  });
});
