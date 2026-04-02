import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

function sum(arr) { return arr.reduce((s, n) => s + (Number(n) || 0), 0); }
function toMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const companies = await base44.entities.Company.list('-created_date', 1000);
    const myCompanies = companies.filter(c => c.created_by === user.email);

    // Also include company from StaffProfile if applicable
    const myProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email }, '-created_date', 100);
    const profileCompanyIds = Array.from(new Set(myProfiles.map(p => p.company_id).filter(Boolean)));
    const companyMap = new Map();
    myCompanies.forEach(c => companyMap.set(c.id, c));
    profileCompanyIds.forEach(id => {
      const found = companies.find(c => c.id === id);
      if (found) companyMap.set(found.id, found);
    });

    const companiesToScan = Array.from(companyMap.values());
    if (companiesToScan.length === 0) {
      return Response.json({ success: true, companies: [], summary: 'No companies found for this user.' });
    }

    const results = [];

    for (const company of companiesToScan) {
      const [invoices, payments, expenses, chart] = await Promise.all([
        base44.entities.Invoice.filter({ company_id: company.id }, '-created_date', 100000),
        base44.entities.Payment.filter({ company_id: company.id }, '-payment_date', 100000),
        base44.entities.Expense ? base44.entities.Expense.filter({ company_id: company.id }, '-expense_date', 100000) : [],
        base44.entities.ChartOfAccounts ? base44.entities.ChartOfAccounts.filter({ company_id: company.id }, '-created_date', 100000) : [],
      ]);

      const invoiceById = new Map(invoices.map(inv => [inv.id, inv]));
      const invoiceByNumber = new Map(invoices.map(inv => [inv.invoice_number, inv]));

      const receivedPayments = payments.filter(p => p.status === 'received');

      // 1) Payments not linked to any invoice
      const unlinkedPayments = receivedPayments.filter(p => {
        const invById = p.invoice_id ? invoiceById.get(p.invoice_id) : null;
        const invByNum = p.invoice_number ? invoiceByNumber.get(p.invoice_number) : null;
        return !invById && !invByNum;
      });

      // 2) Invoices where amount_paid != sum(received payments)
      const invoicePaymentMismatches = [];
      for (const inv of invoices) {
        if (inv.status === 'cancelled') continue;
        const related = receivedPayments.filter(p => (p.invoice_id === inv.id) || (p.invoice_number && p.invoice_number === inv.invoice_number));
        const paidSum = toMoney(sum(related.map(p => p.amount)));
        const recordedPaid = toMoney(inv.amount_paid || 0);
        if (Math.abs(paidSum - recordedPaid) > 0.01) {
          invoicePaymentMismatches.push({
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            customer_name: inv.customer_name,
            recorded_amount_paid: recordedPaid,
            computed_amount_paid: paidSum,
            difference: toMoney(paidSum - recordedPaid),
          });
        }
      }

      // 3) Payments applied to cancelled invoices
      const cancelledInvoicePayments = [];
      for (const p of receivedPayments) {
        const inv = p.invoice_id ? invoiceById.get(p.invoice_id) : (p.invoice_number ? invoiceByNumber.get(p.invoice_number) : null);
        if (inv && inv.status === 'cancelled' && (p.amount || 0) > 0) {
          cancelledInvoicePayments.push({
            payment_id: p.id,
            amount: toMoney(p.amount || 0),
            invoice_number: inv.invoice_number,
            customer_name: inv.customer_name,
          });
        }
      }

      // 4) Missing dates
      const paymentsMissingDate = payments.filter(p => !p.payment_date);
      const expensesMissingDate = expenses.filter(e => !e.expense_date);

      // 5) Accounts Receivable reconciliation
      const openInvoices = invoices.filter(inv => inv.status !== 'cancelled');
      const arExpected = toMoney(sum(openInvoices.map(inv => (inv.amount || 0) - (inv.amount_paid || 0))));
      const arAccounts = chart.filter(a => (a.account_name || '').toLowerCase().includes('receivable'));
      const arAccountBalance = toMoney(sum(arAccounts.map(a => a.balance || 0)));
      const arMismatch = Math.abs(arExpected - arAccountBalance) > 0.01 ? {
        expected_from_invoices: arExpected,
        chart_of_accounts_total: arAccountBalance,
        difference: toMoney(arAccountBalance - arExpected)
      } : null;

      // 6) Cash sanity vs payments-expenses (quick check, not a ledger)
      const cashAccounts = chart.filter(a => (a.account_name || '').toLowerCase().includes('cash'));
      const cashBalance = toMoney(sum(cashAccounts.map(a => a.balance || 0)));
      const cashFlowApprox = toMoney(sum(receivedPayments.map(p => p.amount || 0)) - sum(expenses.map(e => e.amount || 0)));
      const cashNote = { chart_cash_accounts_total: cashBalance, approx_payments_minus_expenses: cashFlowApprox, difference: toMoney(cashBalance - cashFlowApprox) };

      // 7) Year-to-date vs last 12 months (for visibility)
      const now = new Date();
      const yStart = new Date(now.getFullYear(), 0, 1);
      const yEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      const ytdPayments = receivedPayments.filter(p => p.payment_date && new Date(p.payment_date) >= yStart && new Date(p.payment_date) <= yEnd);
      const ytdRevenue = toMoney(sum(ytdPayments.map(p => p.amount || 0)));

      results.push({
        company: { id: company.id, name: company.company_name },
        metrics: {
          invoices_count: invoices.length,
          payments_count: payments.length,
          received_payments_count: receivedPayments.length,
          expenses_count: expenses.length,
          chart_accounts: chart.length,
          ytd_revenue: ytdRevenue,
        },
        issues: {
          unlinked_payments: { count: unlinkedPayments.length, samples: unlinkedPayments.slice(0, 25).map(p => ({ id: p.id, amount: toMoney(p.amount || 0), payment_date: p.payment_date, invoice_number: p.invoice_number || null })) },
          invoice_payment_mismatches: { count: invoicePaymentMismatches.length, samples: invoicePaymentMismatches.slice(0, 25) },
          cancelled_invoice_payments: { count: cancelledInvoicePayments.length, samples: cancelledInvoicePayments.slice(0, 25) },
          missing_dates: { payments_missing_date: paymentsMissingDate.length, expenses_missing_date: expensesMissingDate.length },
          accounts_receivable_reconciliation: arMismatch || { ok: true, expected_from_invoices: arExpected, chart_of_accounts_total: arAccountBalance },
          cash_sanity_check: cashNote,
        }
      });
    }

    return Response.json({ success: true, companies: results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});