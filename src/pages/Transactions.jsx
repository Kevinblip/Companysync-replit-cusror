import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, Tag, Settings2, CalendarDays } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear, subMonths, subYears } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useRoleBasedData } from '@/components/hooks/useRoleBasedData';

function getDateRange(key) {
  const now = new Date();
  switch (key) {
    case 'this_month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last_month': {
      const lm = subMonths(now, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm) };
    }
    case 'this_year':
      return { start: startOfYear(now), end: endOfYear(now) };
    case 'last_year': {
      const ly = subYears(now, 1);
      return { start: startOfYear(ly), end: endOfYear(ly) };
    }
    case 'last_3_months':
      return { start: subMonths(now, 3), end: now };
    case 'last_6_months':
      return { start: subMonths(now, 6), end: now };
    case 'last_12_months':
      return { start: subMonths(now, 12), end: now };
    default:
      return null;
  }
}

export default function Transactions() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDateRange, setFilterDateRange] = useState('all');
  const navigate = useNavigate();

  const { myCompany, isAdmin, hasPermission, isPermissionsReady } = useRoleBasedData();

  const { data: allPayments = [], isLoading } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, '-payment_date', 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const payments = React.useMemo(() => {
    if (!isPermissionsReady) return allPayments;
    if (isAdmin || hasPermission('payments', 'view_global')) return allPayments;
    return [];
  }, [allPayments, isAdmin, hasPermission, isPermissionsReady]);

  const paymentMethods = React.useMemo(() => {
    const methods = [...new Set(allPayments.map(p => p.payment_method).filter(Boolean))];
    return methods.sort();
  }, [allPayments]);

  const categories = React.useMemo(() => {
    const cats = [...new Set(allPayments.map(p => p.category).filter(Boolean))];
    return cats.sort();
  }, [allPayments]);

  const uncategorizedCount = React.useMemo(() =>
    payments.filter(p => !p.category).length,
    [payments]
  );

  const dateRange = React.useMemo(() => getDateRange(filterDateRange), [filterDateRange]);

  const filtered = payments.filter(p => {
    const matchesSearch = !searchTerm ||
      p.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.reference_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = filterStatus === 'all' || p.status === filterStatus;
    const matchesMethod = filterMethod === 'all' || p.payment_method === filterMethod;
    const matchesCategory =
      filterCategory === 'all' ||
      (filterCategory === '__none__' ? !p.category : p.category === filterCategory);

    let matchesDate = true;
    if (dateRange) {
      const d = new Date(p.payment_date || p.created_at);
      matchesDate = d >= dateRange.start && d <= dateRange.end;
    }

    return matchesSearch && matchesStatus && matchesMethod && matchesCategory && matchesDate;
  }).sort((a, b) => new Date(b.payment_date || b.created_at) - new Date(a.payment_date || a.created_at));

  const totalReceived = filtered
    .filter(p => p.status === 'received' || p.status === 'completed' || !p.status)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const totalAll = filtered.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const formatCurrency = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const statusColor = (status) => {
    if (status === 'received' || status === 'completed') return 'bg-green-100 text-green-800';
    if (status === 'pending') return 'bg-yellow-100 text-yellow-800';
    if (status === 'failed' || status === 'cancelled') return 'bg-red-100 text-red-800';
    return 'bg-gray-100 text-gray-700';
  };

  const categoryColor = (cat) => {
    if (!cat) return 'bg-gray-100 text-gray-400';
    return 'bg-blue-50 text-blue-700 border border-blue-200';
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Transactions</h1>
          <p className="text-gray-500 mt-1">
            View all payment transactions — {filtered.length} of {payments.length} total
            {uncategorizedCount > 0 && (
              <span className="ml-2 text-orange-500 font-medium">
                ({uncategorizedCount} uncategorized)
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(createPageUrl('MappingRules'))}
            data-testid="button-manage-mapping-rules"
          >
            <Settings2 className="w-4 h-4 mr-2" />
            Mapping Rules
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Payments Received</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600" data-testid="text-total-received">
              {formatCurrency(totalReceived)}
            </div>
            <p className="text-xs text-gray-400 mt-1">{filtered.filter(p => p.status === 'received' || p.status === 'completed' || !p.status).length} transactions</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total (All Statuses)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600" data-testid="text-total-all">
              {formatCurrency(totalAll)}
            </div>
            <p className="text-xs text-gray-400 mt-1">{filtered.length} transactions</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search by customer, reference, invoice, notes…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                data-testid="input-search-transactions"
              />
            </div>
            <Select value={filterDateRange} onValueChange={setFilterDateRange}>
              <SelectTrigger className="w-44" data-testid="select-filter-date">
                <CalendarDays className="w-3.5 h-3.5 mr-1.5 text-gray-400 flex-shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="this_month">This Month</SelectItem>
                <SelectItem value="last_month">Last Month</SelectItem>
                <SelectItem value="this_year">This Year</SelectItem>
                <SelectItem value="last_year">Last Year</SelectItem>
                <SelectItem value="last_3_months">Last 3 Months</SelectItem>
                <SelectItem value="last_6_months">Last 6 Months</SelectItem>
                <SelectItem value="last_12_months">Last 12 Months</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-40" data-testid="select-filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterMethod} onValueChange={setFilterMethod}>
              <SelectTrigger className="w-40" data-testid="select-filter-method">
                <SelectValue placeholder="All Methods" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Methods</SelectItem>
                {paymentMethods.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-48" data-testid="select-filter-category">
                <Tag className="w-3.5 h-3.5 mr-1.5 text-gray-400 flex-shrink-0" />
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="__none__">Uncategorized</SelectItem>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center text-gray-400 py-12">Loading transactions…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold">Date</th>
                    <th className="text-left p-2 font-semibold">Customer</th>
                    <th className="text-left p-2 font-semibold">Invoice #</th>
                    <th className="text-left p-2 font-semibold">Ref #</th>
                    <th className="text-left p-2 font-semibold">Method</th>
                    <th className="text-left p-2 font-semibold">Category</th>
                    <th className="text-left p-2 font-semibold">Status</th>
                    <th className="text-right p-2 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id} className="border-b hover:bg-gray-50" data-testid={`row-transaction-${p.id}`}>
                      <td className="p-2 text-sm">
                        {p.payment_date ? format(new Date(p.payment_date), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className="p-2 text-sm font-medium">
                        {p.customer_id ? (
                          <button
                            className="text-blue-600 hover:underline text-left"
                            onClick={() => navigate(createPageUrl('CustomerProfile') + `?id=${p.customer_id}`)}
                          >
                            {p.customer_name || p.customer_id}
                          </button>
                        ) : p.customer_name ? (
                          <button
                            className="text-blue-600 hover:underline text-left"
                            onClick={() => navigate(createPageUrl('CustomerProfile') + `?name=${encodeURIComponent(p.customer_name)}`)}
                          >
                            {p.customer_name}
                          </button>
                        ) : '—'}
                      </td>
                      <td className="p-2 text-sm text-gray-500">{p.invoice_number || '—'}</td>
                      <td className="p-2 text-sm text-gray-500">{p.reference_number || '—'}</td>
                      <td className="p-2 text-sm">{p.payment_method || '—'}</td>
                      <td className="p-2">
                        {p.category ? (
                          <Badge className={`text-xs ${categoryColor(p.category)}`} data-testid={`badge-category-${p.id}`}>
                            {p.category}
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Badge className={`text-xs capitalize ${statusColor(p.status)}`}>
                          {p.status || 'received'}
                        </Badge>
                      </td>
                      <td className="p-2 text-right font-semibold text-green-700">
                        {formatCurrency(p.amount)}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !isLoading && (
                    <tr>
                      <td colSpan="8" className="p-12 text-center text-gray-500">
                        No transactions found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
