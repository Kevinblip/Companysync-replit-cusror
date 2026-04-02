import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { FileText, Download, DollarSign } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import useTranslation from "@/hooks/useTranslation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear } from 'date-fns';

export default function AccountingReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [periodType, setPeriodType] = useState('this_month');

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: chartOfAccounts = [] } = useQuery({
    queryKey: ['chart-of-accounts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ChartOfAccounts.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Transaction.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Expense.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const getDateRange = () => {
    const now = new Date();
    if (periodType === 'this_month') return { start: startOfMonth(now), end: endOfMonth(now) };
    if (periodType === 'this_year') return { start: startOfYear(now), end: endOfYear(now) };
    return { start: new Date('2000-01-01'), end: new Date('2099-12-31') };
  };

  const { start, end } = getDateRange();

  // Balance Sheet Data
  const assets = chartOfAccounts.filter(a => a.account_type === 'asset');
  const liabilities = chartOfAccounts.filter(a => a.account_type === 'liability');
  const equity = chartOfAccounts.filter(a => a.account_type === 'equity');
  
  const totalAssets = assets.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const totalLiabilities = liabilities.reduce((sum, a) => sum + Number(a.balance || 0), 0);
  const totalEquity = equity.reduce((sum, a) => sum + Number(a.balance || 0), 0);

  // P&L Data - Use invoice-based revenue (invoices are the source of truth for payments)
  // When invoices are marked paid, amount_paid is set on the invoice itself, not always in a Payment entity
  const getInvoiceRevenue = (inv) => {
    if (inv.status === 'paid') return Number(inv.amount || 0);
    if (inv.status === 'partially_paid') return Number(inv.amount_paid || 0);
    return 0;
  };

  const getInvoiceDate = (inv) => {
    // Try multiple date field options; if all fail, use today (better than excluding revenue)
    const dateStr = inv.issue_date || inv.created_date || inv.created_at || inv.date;
    if (dateStr && !isNaN(new Date(dateStr).getTime())) {
      return new Date(dateStr);
    }
    // Fallback: if invoice is paid/partially paid and has no date, assume it was paid today
    // This prevents paid invoices with missing dates from being excluded entirely
    if (inv.status === 'paid' || inv.status === 'partially_paid') {
      return new Date();
    }
    return null;
  };

  const periodRevenueInvoices = invoices.filter(inv => {
    if (inv.status !== 'paid' && inv.status !== 'partially_paid') return false;
    const date = getInvoiceDate(inv);
    if (!date || isNaN(date.getTime())) return false;
    return date >= start && date <= end;
  });

  const periodExpenses = expenses.filter(e => {
    if (!e.expense_date) return false;
    const date = new Date(e.expense_date);
    return date >= start && date <= end;
  });

  const totalRevenue = periodRevenueInvoices.reduce((sum, inv) => sum + getInvoiceRevenue(inv), 0);
  const totalExpenses = periodExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const cogs = periodExpenses.filter(e => e.category === 'cogs').reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const grossProfit = totalRevenue - cogs;
  const operatingExpenses = totalExpenses - cogs;
  const netIncome = totalRevenue - totalExpenses;

  // Dynamic monthly columns: show up to 3 most recent months within the period
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const getDisplayMonths = () => {
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    if (periodType === 'this_month') return [{ month: currentMonth, year: currentYear }];
    if (periodType === 'this_year') {
      const months = [];
      for (let i = Math.max(0, currentMonth - 2); i <= currentMonth; i++) {
        months.push({ month: i, year: currentYear });
      }
      return months;
    }
    // All time: last 3 calendar months
    const months = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      months.push({ month: d.getMonth(), year: d.getFullYear() });
    }
    return months;
  };
  const displayMonths = getDisplayMonths();

  const getRevenueForMonth = (month, year) =>
    periodRevenueInvoices.filter(inv => {
      const d = getInvoiceDate(inv);
      return d && d.getMonth() === month && d.getFullYear() === year;
    }).reduce((s, inv) => s + getInvoiceRevenue(inv), 0);

  const getExpensesForMonth = (month, year, categoryFilter, excludeCategory) =>
    periodExpenses.filter(e => {
      const d = new Date(e.expense_date);
      return d.getMonth() === month && d.getFullYear() === year &&
        (categoryFilter ? e.category === categoryFilter : true) &&
        (excludeCategory ? e.category !== excludeCategory : true);
    }).reduce((s, e) => s + Number(e.amount || 0), 0);

  // Trial Balance - Proper accounting rules with abnormal balance handling
  const trialBalance = chartOfAccounts.map(acc => {
    const balance = Number(acc.balance || 0);
    const isDebitNormal = ['asset', 'expense', 'cogs'].includes(acc.account_type);
    
    let debit = 0;
    let credit = 0;
    
    if (isDebitNormal) {
      // Asset/Expense accounts: positive = debit, negative = credit
      if (balance >= 0) {
        debit = balance;
      } else {
        credit = Math.abs(balance);
      }
    } else {
      // Liability/Equity/Revenue: positive = credit, negative = debit
      if (balance >= 0) {
        credit = balance;
      } else {
        debit = Math.abs(balance);
      }
    }
    
    return {
      account_number: acc.account_number,
      account_name: acc.account_name,
      account_type: acc.account_type,
      debit,
      credit
    };
  });

  const totalDebits = trialBalance.reduce((sum, a) => sum + a.debit, 0);
  const totalCredits = trialBalance.reduce((sum, a) => sum + a.credit, 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.accounting.reports}</h1>
          <p className="text-gray-500 mt-1">Financial statements and reports</p>
        </div>
        <div className="flex gap-3 items-center">
          <Button 
            onClick={() => navigate(createPageUrl('AccountsReceivableReport'))}
            variant="outline"
            className="flex items-center gap-2"
          >
            <DollarSign className="w-4 h-4" />
            Accounts Receivable
          </Button>
          <Select value={periodType} onValueChange={setPeriodType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="this_month">{t.dashboard.thisMonth}</SelectItem>
              <SelectItem value="this_year">{t.dashboard.thisMonth.replace('Month', 'Year')}</SelectItem>
              <SelectItem value="all_time">{t.common.all}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="balance-sheet" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="balance-sheet">{t.accounting.balanceSheet}</TabsTrigger>
          <TabsTrigger value="profit-loss">{t.accounting.profitLoss}</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
          <TabsTrigger value="cash-flow">{t.accounting.cashFlow}</TabsTrigger>
        </TabsList>

        <TabsContent value="balance-sheet">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{t.accounting.balanceSheet}</CardTitle>
                <p className="text-sm text-gray-600">
                  As of {format(new Date(), 'MMMM d, yyyy')}
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="font-bold text-lg mb-3 text-blue-700">ASSETS</h3>
                  {assets.map(asset => (
                    <div key={asset.id} className="flex justify-between py-2 border-b">
                      <span className="text-sm">{asset.account_number} - {asset.account_name}</span>
                      <span className="font-semibold">${Number(asset.balance || 0).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 font-bold bg-blue-50 mt-2 px-2">
                    <span>{t.accounting.totalAssets}</span>
                    <span>${Number(totalAssets || 0).toFixed(2)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-lg mb-3 text-red-700">LIABILITIES</h3>
                  {liabilities.map(liability => (
                    <div key={liability.id} className="flex justify-between py-2 border-b">
                      <span className="text-sm">{liability.account_number} - {liability.account_name}</span>
                      <span className="font-semibold">${Number(liability.balance || 0).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 font-bold bg-red-50 mt-2 px-2">
                    <span>{t.accounting.totalLiabilities}</span>
                    <span>${Number(totalLiabilities || 0).toFixed(2)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-lg mb-3 text-purple-700">{t.accounting.equity.toUpperCase()}</h3>
                  {equity.map(eq => (
                    <div key={eq.id} className="flex justify-between py-2 border-b">
                      <span className="text-sm">{eq.account_number} - {eq.account_name}</span>
                      <span className="font-semibold">${Number(eq.balance || 0).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 font-bold bg-purple-50 mt-2 px-2">
                    <span>Total {t.accounting.equity}</span>
                    <span>${Number(totalEquity || 0).toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex justify-between py-3 font-bold text-lg bg-gray-100 px-2 rounded">
                  <span>TOTAL LIABILITIES + {t.accounting.equity.toUpperCase()}</span>
                  <span>${(totalLiabilities + totalEquity).toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profit-loss">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{t.accounting.profitLoss} Statement</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Excel
                  </Button>
                  <Button variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2">
                      <th className="text-left p-2 font-semibold">{t.accounting.category}</th>
                      {displayMonths.map(({ month, year }) => (
                        <th key={`${year}-${month}`} className="text-right p-2 font-semibold w-32">
                          {MONTH_NAMES[month]}
                        </th>
                      ))}
                      <th className="text-right p-2 font-semibold w-32 bg-gray-50">
                        {periodType === 'this_month' ? MONTH_NAMES[now.getMonth()] : periodType === 'this_year' ? `Year (${now.getFullYear()})` : 'All Time'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-green-50 font-bold">
                      <td className="p-2">{t.accounting.revenue.toUpperCase()}</td>
                      {displayMonths.map(({ month, year }) => (
                        <td key={`rev-${year}-${month}`} className="text-right p-2">
                          ${getRevenueForMonth(month, year).toFixed(2)}
                        </td>
                      ))}
                      <td className="text-right p-2 bg-gray-50">${totalRevenue.toFixed(2)}</td>
                    </tr>
                    
                    <tr className="bg-orange-50 font-semibold">
                      <td className="p-2">COST OF GOODS SOLD</td>
                      {displayMonths.map(({ month, year }) => (
                        <td key={`cogs-${year}-${month}`} className="text-right p-2">
                          ${getExpensesForMonth(month, year, 'cogs').toFixed(2)}
                        </td>
                      ))}
                      <td className="text-right p-2 bg-gray-50">${cogs.toFixed(2)}</td>
                    </tr>

                    <tr className="bg-blue-50 font-bold">
                      <td className="p-2">GROSS PROFIT</td>
                      {displayMonths.map(({ month, year }) => (
                        <td key={`gp-${year}-${month}`} className="text-right p-2">
                          ${(getRevenueForMonth(month, year) - getExpensesForMonth(month, year, 'cogs')).toFixed(2)}
                        </td>
                      ))}
                      <td className="text-right p-2 bg-gray-50">${grossProfit.toFixed(2)}</td>
                    </tr>

                    <tr className="h-4"><td colSpan={displayMonths.length + 2}></td></tr>
                    
                    <tr className="font-semibold bg-red-50">
                      <td className="p-2">{t.accounting.expensesLabel.toUpperCase()}</td>
                      {displayMonths.map(({ month, year }) => (
                        <td key={`exp-hdr-${year}-${month}`} className="text-right p-2"></td>
                      ))}
                      <td className="text-right p-2 bg-gray-50"></td>
                    </tr>

                    {['labor', 'materials', 'subcontractor', 'rent', 'utilities', 'insurance', 'marketing', 'office_supplies', 'fuel', 'equipment', 'software', 'professional_fees', 'taxes', 'meals', 'travel', 'other'].map(category => {
                      const yearTotal = periodExpenses.filter(e => e.category === category).reduce((s, e) => s + Number(e.amount || 0), 0);
                      if (yearTotal === 0) return null;
                      return (
                        <tr key={category} className="border-b hover:bg-gray-50">
                          <td className="p-2 pl-6 text-sm">{category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</td>
                          {displayMonths.map(({ month, year }) => (
                            <td key={`cat-${category}-${year}-${month}`} className="text-right p-2">
                              ${getExpensesForMonth(month, year, category).toFixed(2)}
                            </td>
                          ))}
                          <td className="text-right p-2 bg-gray-50">${yearTotal.toFixed(2)}</td>
                        </tr>
                      );
                    })}

                    <tr className="border-t-2 font-bold bg-red-100">
                      <td className="p-2">Total Operating Expenses</td>
                      {displayMonths.map(({ month, year }) => (
                        <td key={`totexp-${year}-${month}`} className="text-right p-2">
                          ${getExpensesForMonth(month, year, null, 'cogs').toFixed(2)}
                        </td>
                      ))}
                      <td className="text-right p-2 bg-gray-50">${operatingExpenses.toFixed(2)}</td>
                    </tr>

                    <tr className="h-4"><td colSpan={displayMonths.length + 2}></td></tr>

                    <tr className={`font-bold text-lg ${netIncome >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      <td className="p-3">{t.accounting.netIncome.toUpperCase()}</td>
                      {displayMonths.map(({ month, year }) => (
                        <td key={`ni-${year}-${month}`} className="text-right p-3">
                          ${(getRevenueForMonth(month, year) - getExpensesForMonth(month, year, null, null)).toFixed(2)}
                        </td>
                      ))}
                      <td className="text-right p-3 bg-gray-50">${netIncome.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>

                {periodExpenses.filter(e => e.category !== 'cogs').length === 0 && (
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded text-center">
                    <p className="text-blue-800">
                      📊 {t.common.noResults}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trial-balance">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Trial Balance</CardTitle>
                <p className="text-sm text-gray-600">
                  As of {format(new Date(), 'MMMM d, yyyy')}
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2">
                      <th className="text-left p-2 font-semibold">Account #</th>
                      <th className="text-left p-2 font-semibold">{t.accounting.account} Name</th>
                      <th className="text-right p-2 font-semibold">{t.accounting.debit}</th>
                      <th className="text-right p-2 font-semibold">{t.accounting.credit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.map((acc, idx) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="p-2 font-mono">{acc.account_number}</td>
                        <td className="p-2">{acc.account_name}</td>
                        <td className="p-2 text-right">{acc.debit > 0 ? `$${acc.debit.toFixed(2)}` : '-'}</td>
                        <td className="p-2 text-right">{acc.credit > 0 ? `$${acc.credit.toFixed(2)}` : '-'}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-bold bg-gray-100">
                      <td colSpan="2" className="p-2">TOTALS</td>
                      <td className="p-2 text-right">${totalDebits.toFixed(2)}</td>
                      <td className="p-2 text-right">${totalCredits.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
                {Math.abs(totalDebits - totalCredits) > 0.01 && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded">
                    <p className="text-red-800 font-semibold">
                      ⚠️ Trial Balance is out of balance by ${Math.abs(totalDebits - totalCredits).toFixed(2)}
                    </p>
                  </div>
                )}
                {Math.abs(totalDebits - totalCredits) < 0.01 && totalDebits > 0 && (
                  <div className="mt-4 p-4 bg-green-50 border border-green-300 rounded">
                    <p className="text-green-800 font-semibold">
                      ✓ Trial Balance is balanced
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cash-flow">
          <Card>
            <CardHeader>
              <CardTitle>{t.accounting.cashFlow} Statement</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="font-bold text-lg mb-3">OPERATING ACTIVITIES</h3>
                  <div className="flex justify-between py-2 border-b">
                    <span>{t.accounting.netIncome}</span>
                    <span className="font-semibold">${netIncome.toFixed(2)}</span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-lg mb-3">INVESTING ACTIVITIES</h3>
                  <div className="flex justify-between py-2 border-b">
                    <span>Equipment purchases</span>
                    <span className="font-semibold">
                      ${periodExpenses.filter(e => e.category === 'equipment').reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-lg mb-3">FINANCING ACTIVITIES</h3>
                  <div className="flex justify-between py-2 border-b">
                    <span>-</span>
                    <span className="font-semibold">$0.00</span>
                  </div>
                </div>

                <div className="flex justify-between py-3 font-bold text-lg bg-blue-100 px-2 rounded">
                  <span>NET CHANGE IN CASH</span>
                  <span>${(netIncome - periodExpenses.filter(e => e.category === 'equipment').reduce((sum, e) => sum + Number(e.amount || 0), 0)).toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}