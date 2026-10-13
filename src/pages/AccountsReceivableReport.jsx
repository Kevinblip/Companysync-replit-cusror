import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, DollarSign, Clock, AlertTriangle, AlertOctagon, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { getEffectiveDueDate, getDaysOverdue, getInvoiceBalance } from "@/utils/invoiceFinance";

function getAgingBucket(daysOverdue) {
  if (daysOverdue === 0) return { label: "Current", color: "bg-green-100 text-green-700", bucket: 0 };
  if (daysOverdue <= 30) return { label: "1–30 days", color: "bg-yellow-100 text-yellow-700", bucket: 1 };
  if (daysOverdue <= 60) return { label: "31–60 days", color: "bg-orange-100 text-orange-700", bucket: 2 };
  if (daysOverdue <= 90) return { label: "61–90 days", color: "bg-red-100 text-red-700", bucket: 3 };
  return { label: "90+ days", color: "bg-red-200 text-red-900 font-semibold", bucket: 4 };
}

export default function AccountsReceivableReport() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [agingFilter, setAgingFilter] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["ar-invoices", myCompany?.id],
    queryFn: () =>
      myCompany
        ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-issue_date", 1000)
        : [],
    enabled: !!myCompany,
  });

  const outstandingInvoices = invoices
    // Exclude only cancelled; the balance filter below is the real gate, so a
    // mis-flagged "paid" invoice that still owes money is still counted.
    .filter(inv => inv.status !== "cancelled")
    .map(inv => ({
      ...inv,
      _balance: getInvoiceBalance(inv),
      _daysOverdue: getDaysOverdue(inv),
      _effectiveDue: getEffectiveDueDate(inv),
    }))
    // Drop fully-settled invoices (incl. legacy $0-total imports, e.g. all
    // pre-2026 records) so they no longer count as money owed.
    .filter(inv => inv._balance > 0)
    .sort((a, b) => b._daysOverdue - a._daysOverdue);

  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + i._balance, 0);

  const bucketTotals = {
    current:  { count: 0, total: 0 },
    b1_30:    { count: 0, total: 0 },
    b31_60:   { count: 0, total: 0 },
    b61_90:   { count: 0, total: 0 },
    b90plus:  { count: 0, total: 0 },
  };
  for (const inv of outstandingInvoices) {
    const d = inv._daysOverdue;
    if (d === 0)      { bucketTotals.current.count++; bucketTotals.current.total += inv._balance; }
    else if (d <= 30) { bucketTotals.b1_30.count++;   bucketTotals.b1_30.total   += inv._balance; }
    else if (d <= 60) { bucketTotals.b31_60.count++;  bucketTotals.b31_60.total  += inv._balance; }
    else if (d <= 90) { bucketTotals.b61_90.count++;  bucketTotals.b61_90.total  += inv._balance; }
    else              { bucketTotals.b90plus.count++;  bucketTotals.b90plus.total  += inv._balance; }
  }

  const displayedInvoices = agingFilter === null
    ? outstandingInvoices
    : outstandingInvoices.filter(inv => {
        const d = inv._daysOverdue;
        if (agingFilter === 0) return d === 0;
        if (agingFilter === 1) return d >= 1  && d <= 30;
        if (agingFilter === 2) return d >= 31 && d <= 60;
        if (agingFilter === 3) return d >= 61 && d <= 90;
        if (agingFilter === 4) return d > 90;
        return true;
      });

  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case "sent": return "secondary";
      case "partially_paid": return "default";
      case "overdue": return "destructive";
      default: return "outline";
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading accounts receivable...</p>
        </div>
      </div>
    );
  }

  const bucketCards = [
    {
      key: null,
      label: "Total Outstanding",
      count: outstandingInvoices.length,
      total: totalOutstanding,
      icon: <DollarSign className="h-5 w-5 text-green-600" />,
      cardCls: "bg-gradient-to-br from-green-50 to-emerald-50 border-green-200",
      textCls: "text-green-700",
      subCls: "text-green-600",
    },
    {
      key: 0,
      label: "Current (not yet due)",
      count: bucketTotals.current.count,
      total: bucketTotals.current.total,
      icon: <Clock className="h-5 w-5 text-blue-500" />,
      cardCls: "border-blue-100",
      textCls: "text-blue-700",
      subCls: "text-blue-500",
    },
    {
      key: 1,
      label: "1–30 Days Overdue",
      count: bucketTotals.b1_30.count,
      total: bucketTotals.b1_30.total,
      icon: <Clock className="h-5 w-5 text-yellow-500" />,
      cardCls: "border-yellow-100",
      textCls: "text-yellow-700",
      subCls: "text-yellow-600",
    },
    {
      key: 2,
      label: "31–60 Days Overdue",
      count: bucketTotals.b31_60.count,
      total: bucketTotals.b31_60.total,
      icon: <AlertTriangle className="h-5 w-5 text-orange-500" />,
      cardCls: "border-orange-100",
      textCls: "text-orange-700",
      subCls: "text-orange-600",
    },
    {
      key: 3,
      label: "61–90 Days Overdue",
      count: bucketTotals.b61_90.count,
      total: bucketTotals.b61_90.total,
      icon: <AlertOctagon className="h-5 w-5 text-red-500" />,
      cardCls: "border-red-100",
      textCls: "text-red-700",
      subCls: "text-red-600",
    },
    {
      key: 4,
      label: "90+ Days Overdue",
      count: bucketTotals.b90plus.count,
      total: bucketTotals.b90plus.total,
      icon: <AlertOctagon className="h-5 w-5 text-red-800" />,
      cardCls: "border-red-200 bg-red-50",
      textCls: "text-red-900",
      subCls: "text-red-700",
    },
  ];

  const exportARtoCSV = () => {
    const dateStr = new Date().toLocaleDateString('en-US').replace(/\//g, '-');
    const rows = [];

    rows.push([`AR Aging Report — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`]);
    if (agingFilter !== null) {
      const label = bucketCards.find(b => b.key === agingFilter)?.label;
      if (label) rows.push([`Filter: ${label}`]);
    }
    rows.push([]);

    rows.push(['Outstanding by Age']);
    rows.push(['Bucket', 'Invoices', 'Total Outstanding']);
    for (const b of bucketCards.slice(1)) {
      rows.push([b.label, b.count, b.total.toFixed(2)]);
    }
    rows.push(['TOTAL', outstandingInvoices.length, totalOutstanding.toFixed(2)]);
    rows.push([]);

    rows.push(['Invoice Detail']);
    rows.push(['Invoice #', 'Customer', 'Issue Date', 'Due Date', 'Age (days)', 'Aging Bucket', 'Invoice Total', 'Paid', 'Balance Due', 'Status']);
    for (const inv of displayedInvoices) {
      const aging = getAgingBucket(inv._daysOverdue);
      rows.push([
        inv.invoice_number || '',
        inv.customer_name || '',
        inv.issue_date ? format(parseISO(inv.issue_date), 'MM/dd/yyyy') : '',
        inv._effectiveDue ? format(inv._effectiveDue, 'MM/dd/yyyy') : '',
        inv._daysOverdue,
        aging.label,
        Number(inv.total_amount || inv.amount || 0).toFixed(2),
        Number(inv.amount_paid || 0).toFixed(2),
        inv._balance.toFixed(2),
        (inv.status || '').replace(/_/g, ' '),
      ]);
    }

    const csv = rows.map(row =>
      row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AR-Aging-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate(createPageUrl("Dashboard"))}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Accounts Receivable</h1>
            {agingFilter !== null && (
              <p className="text-sm text-blue-600 mt-0.5">
                Filtered: {bucketCards.find(b => b.key === agingFilter)?.label}
                <button className="ml-2 underline text-gray-500 hover:text-gray-800" onClick={() => setAgingFilter(null)}>
                  Clear filter
                </button>
              </p>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={exportARtoCSV}
          data-testid="button-export-ar-report-csv"
          className="flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {bucketCards.map((b) => (
          <Card
            key={String(b.key)}
            className={`cursor-pointer transition-all ${b.cardCls} ${agingFilter === b.key ? "ring-2 ring-blue-500 shadow-md" : "hover:shadow-sm"}`}
            onClick={() => setAgingFilter(agingFilter === b.key ? null : b.key)}
            data-testid={`ar-bucket-${b.key}`}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium text-gray-600 leading-tight">{b.label}</CardTitle>
              {b.icon}
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className={`text-xl font-bold ${b.textCls}`}>
                ${b.total.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
              <p className={`text-xs mt-0.5 ${b.subCls}`}>{b.count} invoice{b.count !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Outstanding Invoices</span>
            <span className="text-sm font-normal text-gray-500">
              {displayedInvoices.length} of {outstandingInvoices.length} shown
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayedInvoices.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-lg font-medium">No outstanding invoices</p>
              <p className="text-sm">All invoices are paid or drafted</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Aging</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedInvoices.map((invoice) => {
                    const aging = getAgingBucket(invoice._daysOverdue);
                    return (
                      <TableRow key={invoice.id}>
                        <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                        <TableCell>{invoice.customer_name}</TableCell>
                        <TableCell>
                          {invoice.issue_date
                            ? format(parseISO(invoice.issue_date), "MMM d, yyyy")
                            : "N/A"}
                        </TableCell>
                        <TableCell>
                          {invoice._effectiveDue
                            ? format(invoice._effectiveDue, "MMM d, yyyy")
                            : "N/A"}
                          {!invoice.due_date && invoice._effectiveDue && (
                            <span className="block text-xs text-gray-400">net-30</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={`${aging.color} border-0`}>
                            {invoice._daysOverdue === 0 ? "Current" : `${invoice._daysOverdue}d`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          ${Number(invoice.total_amount || invoice.amount || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          ${Number(invoice.amount_paid || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-orange-600">
                          ${invoice._balance.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(invoice.status)}>
                            {invoice.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`btn-view-ar-${invoice.id}`}
                            onClick={() =>
                              navigate(createPageUrl("invoice-details") + `?id=${invoice.id}`)
                            }
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
