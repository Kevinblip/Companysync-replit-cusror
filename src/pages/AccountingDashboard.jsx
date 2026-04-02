import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import useTranslation from "@/hooks/useTranslation";
import {
  DollarSign, TrendingUp, TrendingDown, PieChart, Plus,
  FileText, Receipt, CreditCard, Wallet, ArrowUpRight,
  ArrowDownRight, Calendar, Download, Bot
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns';
import { BarChart, Bar, LineChart, Line, PieChart as RechartsPieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function AccountingDashboard() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('this_month');
  const navigate = useNavigate();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Expense.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: payouts = [] } = useQuery({
    queryKey: ['payouts', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payout.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const getDateRange = () => {
    const now = new Date();
    
    switch(selectedPeriod) {
      case 'this_month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'last_month':
        const lastMonth = subMonths(now, 1);
        return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      case 'this_year':
        return { start: startOfYear(now), end: endOfYear(now) };
      case 'last_3_months':
        return { start: subMonths(now, 3), end: now };
      case 'last_6_months':
        return { start: subMonths(now, 6), end: now };
      default:
        return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  };

  const { start, end } = getDateRange();

  // Calculate metrics
  const periodPayments = payments.filter(p => {
    if (!p.payment_date) return false;
    const date = new Date(p.payment_date);
    return date >= start && date <= end;
  });

  const periodExpenses = expenses.filter(e => {
    if (!e.expense_date) return false;
    const date = new Date(e.expense_date);
    return date >= start && date <= end;
  });

  const periodPayouts = payouts.filter(p => {
    if (!p.payment_date || p.status !== 'completed') return false;
    const date = new Date(p.payment_date);
    return date >= start && date <= end;
  });

  const totalRevenue = periodPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalExpenses = periodExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalPayouts = periodPayouts.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const totalCOGS = periodExpenses.filter(e => e.category === 'cogs').reduce((sum, e) => sum + Number(e.amount || 0), 0);
  
  const netProfit = totalRevenue - totalExpenses - totalPayouts;
  const grossProfit = totalRevenue - totalCOGS;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;

  // Accounts Receivable (unpaid invoices)
  const unpaidInvoices = invoices.filter(inv => 
    inv.status !== 'paid' && inv.status !== 'cancelled'
  );
  const accountsReceivable = unpaidInvoices.reduce((sum, inv) => sum + (Number(inv.amount || 0) - Number(inv.amount_paid || 0)), 0);

  // Accounts Payable (pending payouts)
  const accountsPayable = payouts.filter(p => p.status === 'pending').reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // Expense breakdown by category
  const expensesByCategory = periodExpenses.reduce((acc, exp) => {
    const cat = exp.category || 'other';
    acc[cat] = (acc[cat] || 0) + exp.amount;
    return acc;
  }, {});

  const expenseCategoryData = Object.entries(expensesByCategory).map(([name, value]) => ({
    name: name.replace(/_/g, ' ').toUpperCase(),
    value,
    percentage: ((value / totalExpenses) * 100).toFixed(1)
  })).sort((a, b) => b.value - a.value);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

  // Cash flow over time (last 6 months)
  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const date = subMonths(new Date(), 5 - i);
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    
    const revenue = payments.filter(p => {
      if (!p.payment_date) return false;
      const pDate = new Date(p.payment_date);
      return pDate >= monthStart && pDate <= monthEnd;
    }).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    
    const expenses = [...periodExpenses, ...periodPayouts].filter(e => {
      const dateField = e.expense_date || e.payment_date;
      if (!dateField) return false;
      const eDate = new Date(dateField);
      return eDate >= monthStart && eDate <= monthEnd;
    }).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    
    return {
      month: format(date, 'MMM'),
      revenue,
      expenses,
      profit: revenue - expenses
    };
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.accounting.title} {t.accounting.dashboard}</h1>
          <p className="text-gray-500 mt-1">Financial overview and expense tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(createPageUrl('Expenses'))}>
            <Receipt className="w-4 h-4 mr-2" />
            {t.common.view} {t.accounting.expensesLabel}
          </Button>
          <Button onClick={() => navigate(createPageUrl('AIAccountant'))} className="bg-purple-600 hover:bg-purple-700">
            <Bot className="w-4 h-4 mr-2" />
            AI Accountant
          </Button>
        </div>
      </div>

      <div className="flex gap-4 items-center">
        <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_month">{t.dashboard.thisMonth}</SelectItem>
            <SelectItem value="last_month">{t.dashboard.lastMonth}</SelectItem>
            <SelectItem value="last_3_months">Last 3 Months</SelectItem>
            <SelectItem value="last_6_months">Last 6 Months</SelectItem>
            <SelectItem value="this_year">This Year</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-gray-500">
          {format(start, 'MMM d, yyyy')} - {format(end, 'MMM d, yyyy')}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <ArrowDownRight className="w-4 h-4 text-green-600" />
              {t.accounting.revenue}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">${totalRevenue.toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">{periodPayments.length} {t.accounting.transactions.toLowerCase()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-red-600" />
              {t.accounting.expensesLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-600">${(totalExpenses + totalPayouts).toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">{periodExpenses.length + periodPayouts.length} {t.accounting.transactions.toLowerCase()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-blue-600" />
              {t.accounting.netIncome}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
              ${netProfit.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500 mt-1">{profitMargin}% margin</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-600" />
              Accounts Receivable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-600">${accountsReceivable.toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">{unpaidInvoices.length} unpaid {t.sidebar.invoices.toLowerCase()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <Wallet className="w-4 h-4 text-purple-600" />
              {t.accounting.bills}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-600">${accountsPayable.toFixed(2)}</div>
            <p className="text-xs text-gray-500 mt-1">{payouts.filter(p => p.status === 'pending').length} {t.common.pending.toLowerCase()} {t.accounting.payouts.toLowerCase()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t.accounting.cashFlow} (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={last6Months}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
                <Bar dataKey="revenue" fill="#10b981" name={t.accounting.revenue} />
                <Bar dataKey="expenses" fill="#ef4444" name={t.accounting.expensesLabel} />
                <Bar dataKey="profit" fill="#3b82f6" name={t.reports.profit} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.accounting.expensesLabel} by {t.accounting.category}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPieChart>
                <Pie
                  data={expenseCategoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percentage }) => `${name} (${percentage}%)`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {expenseCategoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              </RechartsPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* P&L Statement */}
      <Card>
        <CardHeader>
          <CardTitle>{t.accounting.profitLoss} Statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b">
              <span className="font-semibold text-lg">{t.accounting.revenue}</span>
              <span className="text-lg font-bold text-green-600">${totalRevenue.toFixed(2)}</span>
            </div>
            
            <div className="pl-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Cost of Goods Sold (COGS)</span>
                <span className="text-red-600">-${totalCOGS.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-between items-center py-2 bg-gray-50 px-4">
              <span className="font-semibold">Gross Profit</span>
              <span className="font-bold text-blue-600">${grossProfit.toFixed(2)}</span>
            </div>

            <div className="pl-4 space-y-2">
              <p className="font-semibold text-sm mb-2">Operating {t.accounting.expensesLabel}:</p>
              {expenseCategoryData.filter(cat => cat.name !== 'COGS').map(cat => (
                <div key={cat.name} className="flex justify-between text-sm">
                  <span className="text-gray-600">{cat.name}</span>
                  <span className="text-red-600">-${cat.value.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Contractor {t.accounting.payouts}</span>
                <span className="text-red-600">-${totalPayouts.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex justify-between items-center py-3 border-t-2 border-gray-300 mt-4">
              <span className="font-bold text-xl">{t.accounting.netIncome}</span>
              <span className={`text-xl font-bold ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${netProfit.toFixed(2)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent {t.accounting.transactions}</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="expenses" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="expenses">{t.accounting.expensesLabel} ({periodExpenses.length})</TabsTrigger>
              <TabsTrigger value="payouts">{t.accounting.payouts} ({periodPayouts.length})</TabsTrigger>
              <TabsTrigger value="payments">{t.sidebar.payments} ({periodPayments.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="expenses" className="space-y-2 mt-4">
              {periodExpenses.slice(0, 10).map(exp => (
                <div key={exp.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{exp.vendor_name}</p>
                    <p className="text-sm text-gray-600">{exp.description}</p>
                    <p className="text-xs text-gray-500">{format(new Date(exp.expense_date), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-red-600">-${parseFloat(exp.amount || 0).toFixed(2)}</p>
                    <Badge variant="outline" className="text-xs">{exp.category}</Badge>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="payouts" className="space-y-2 mt-4">
              {periodPayouts.slice(0, 10).map(payout => (
                <div key={payout.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{payout.recipient_name}</p>
                    <p className="text-sm text-gray-600">{payout.description}</p>
                    <p className="text-xs text-gray-500">{format(new Date(payout.payment_date), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-red-600">-${parseFloat(payout.amount || 0).toFixed(2)}</p>
                    <Badge variant="outline" className="text-xs">{payout.payout_type}</Badge>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="payments" className="space-y-2 mt-4">
              {periodPayments.slice(0, 10).map(payment => (
                <div key={payment.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium">{payment.customer_name}</p>
                    <p className="text-sm text-gray-600">{t.sidebar.invoices} #{payment.invoice_number}</p>
                    <p className="text-xs text-gray-500">{format(new Date(payment.payment_date), 'MMM d, yyyy')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-600">+${parseFloat(payment.amount || 0).toFixed(2)}</p>
                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700">{payment.payment_method}</Badge>
                  </div>
                </div>
              ))}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}