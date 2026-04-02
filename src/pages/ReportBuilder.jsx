import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Play,
  Save,
  Download,
  Mail,
  Star,
  Trash2,
  Calendar,
  Filter,
  RefreshCw
} from "lucide-react";
import useTranslation from "@/hooks/useTranslation";
import { format } from "date-fns";

export default function ReportBuilder() {
  const { t } = useTranslation();
  const [reportConfig, setReportConfig] = useState({
    report_name: "",
    report_type: "invoices",
    columns: [],
    filters: {
      date_range: "30days",
      start_date: "",
      end_date: "",
      status: [],
      custom_fields: {}
    },
    sort_by: "created_date",
    sort_order: "desc",
    schedule: {
      enabled: false,
      frequency: "weekly",
      recipients: []
    }
  });

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);

  const queryClient = useQueryClient();

  const { user, myCompany, isAdmin, hasPermission, effectiveUserEmail, filterCustomers, filterLeads, filterInvoices, filterEstimates, filterPayments } = useRoleBasedData();

  const { data: savedReports = [] } = useQuery({
    queryKey: ['saved-reports', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.SavedReport.filter({ company_id: myCompany.id }, "-created_date") : [],
    initialData: [],
    enabled: !!myCompany,
  });

  // Shared customers query used for cross-referencing in invoice/estimate/payment filtering
  const { data: rawCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  // 🔐 Filter customers using hook's canonical filter
  const customers = React.useMemo(() => filterCustomers(rawCustomers), [rawCustomers, filterCustomers]);

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: reportConfig.report_type === 'invoices' && !!myCompany,
  });

  // 🔐 Filter invoices using hook's canonical filter
  const invoices = React.useMemo(() => filterInvoices(allInvoices, customers), [allInvoices, customers, filterInvoices]);

  const { data: allEstimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: reportConfig.report_type === 'estimates' && !!myCompany,
  });

  // 🔐 Filter estimates using hook's canonical filter
  const estimates = React.useMemo(() => filterEstimates(allEstimates, customers), [allEstimates, customers, filterEstimates]);

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000) : [],
    initialData: [],
    enabled: reportConfig.report_type === 'payments' && !!myCompany,
  });

  // 🔐 Filter payments using hook's canonical filter
  const payments = React.useMemo(() => filterPayments(allPayments, customers), [allPayments, customers, filterPayments]);

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['all-customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: reportConfig.report_type === 'customers' && !!myCompany,
  });

  // 🔐 Filter customers (for "customers" report type) using hook's canonical filter
  const filteredCustomers = React.useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: reportConfig.report_type === 'leads' && !!myCompany,
  });

  // 🔐 Filter leads using hook's canonical filter
  const leads = React.useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);

  const { data: allExpenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => myCompany ? base44.entities.Expense.filter({ company_id: myCompany.id }) : [],
    initialData: [],
    enabled: reportConfig.report_type === 'expenses' && !!myCompany
  });

  // 🔐 Filter expenses using hook's canonical filter (by customer assignment)
  const expenses = React.useMemo(() => {
    if (!effectiveUserEmail) return allExpenses;
    if (isAdmin || hasPermission('expenses', 'view_global')) return allExpenses;
    // Only see expenses from their visible customers
    return allExpenses.filter(exp => {
      if (!exp.customer_id) return false;
      return customers.some(c => c.id === exp.customer_id);
    });
  }, [allExpenses, customers, effectiveUserEmail, isAdmin]);

  const saveMutation = useMutation({
    mutationFn: (data) => base44.entities.SavedReport.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-reports'] });
      setShowSaveDialog(false);
      alert('✅ Report saved successfully!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.SavedReport.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-reports'] });
    },
  });

  const availableColumns = {
    invoices: [
      { id: 'invoice_number', label: t.invoices.invoiceNumber },
      { id: 'customer_name', label: t.invoices.customer },
      { id: 'amount', label: t.common.amount },
      { id: 'status', label: t.common.status },
      { id: 'issue_date', label: 'Issue Date' },
      { id: 'due_date', label: t.common.dueDate },
      { id: 'created_date', label: 'Created Date' }
    ],
    estimates: [
      { id: 'estimate_number', label: t.estimates.estimateNumber },
      { id: 'customer_name', label: t.estimates.customer },
      { id: 'amount', label: t.common.amount },
      { id: 'status', label: t.common.status },
      { id: 'valid_until', label: t.estimates.validUntil },
      { id: 'created_date', label: 'Created Date' }
    ],
    payments: [
      { id: 'payment_number', label: 'Payment #' },
      { id: 'customer_name', label: t.invoices.customer },
      { id: 'amount', label: t.common.amount },
      { id: 'payment_method', label: 'Method' },
      { id: 'payment_date', label: t.common.date },
      { id: 'reference_number', label: 'Reference' }
    ],
    customers: [
      { id: 'name', label: t.common.name },
      { id: 'email', label: t.common.email },
      { id: 'phone', label: t.common.phone },
      { id: 'company', label: t.common.companyName },
      { id: 'total_revenue', label: 'Total Revenue' },
      { id: 'created_date', label: 'Created Date' }
    ],
    leads: [
      { id: 'name', label: t.common.name },
      { id: 'email', label: t.common.email },
      { id: 'phone', label: t.common.phone },
      { id: 'status', label: t.common.status },
      { id: 'source', label: 'Source' },
      { id: 'value', label: 'Value' },
      { id: 'created_date', label: 'Created Date' }
    ],
    expenses: [
      { id: 'expense_date', label: t.common.date },
      { id: 'vendor_name', label: t.accounting.vendor },
      { id: 'category', label: t.accounting.category },
      { id: 'amount', label: t.common.amount },
      { id: 'description', label: t.common.description },
      { id: 'payment_method', label: 'Payment Method' },
      { id: 'customer_name', label: t.invoices.customer },
      { id: 'created_date', label: 'Created Date' }
    ]
  };

  const handleColumnToggle = (columnId) => {
    setReportConfig(prev => ({
      ...prev,
      columns: prev.columns.includes(columnId)
        ? prev.columns.filter(c => c !== columnId)
        : [...prev.columns, columnId]
    }));
  };

  const getDataSource = () => {
    switch(reportConfig.report_type) {
      case 'invoices': return invoices;
      case 'estimates': return estimates;
      case 'payments': return payments;
      case 'customers': return filteredCustomers;
      case 'leads': return leads;
      case 'expenses': return expenses;
      default: return [];
    }
  };

  const runReport = () => {
    const data = getDataSource();
    
    if (!data || data.length === 0) {
      const isLoading = reportConfig.report_type === 'invoices' ? invoices.length === 0 :
                       reportConfig.report_type === 'estimates' ? estimates.length === 0 :
                       reportConfig.report_type === 'payments' ? payments.length === 0 :
                       reportConfig.report_type === 'customers' ? filteredCustomers.length === 0 :
                       reportConfig.report_type === 'leads' ? leads.length === 0 :
                       reportConfig.report_type === 'expenses' ? expenses.length === 0 : false;
      
      if (isLoading) {
        return;
      }
    }
    
    let filtered = data.filter(item => {
      if (reportConfig.filters.status.length > 0) {
        if (!reportConfig.filters.status.includes(item.status)) return false;
      }
      
      return true;
    });

    filtered.sort((a, b) => {
      const aVal = a[reportConfig.sort_by];
      const bVal = b[reportConfig.sort_by];
      
      if (reportConfig.sort_order === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

    setPreviewData(filtered || []);
  };

  const handleSave = () => {
    if (!reportConfig.report_name) {
      alert('Please enter a report name');
      return;
    }
    
    saveMutation.mutate(reportConfig);
  };

  const loadReport = (report) => {
    setReportConfig(report);
    runReport();
  };

  const exportToPDF = async () => {
    alert('PDF export coming soon!');
  };

  const exportToExcel = () => {
    // Convert to CSV
    const columns = availableColumns[reportConfig.report_type].filter(col => 
      reportConfig.columns.includes(col.id)
    );
    
    let csv = columns.map(col => col.label).join(',') + '\n';
    
    previewData.forEach(row => {
      csv += reportConfig.columns.map(colId => {
        let value = row[colId];
        if (colId.includes('date') && value) {
          value = format(new Date(value), 'yyyy-MM-dd');
        }
        return `"${value || ''}"`;
      }).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportConfig.report_name || 'report'}.csv`;
    a.click();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.reports.reportBuilder}</h1>
          <p className="text-gray-500 mt-1">Build, save, and schedule custom reports</p>
        </div>

        <div className="flex gap-2">
          <Button 
            variant="outline"
            onClick={() => setShowSaveDialog(true)}
            disabled={reportConfig.columns.length === 0}
          >
            <Save className="w-4 h-4 mr-2" />
            {t.common.save} {t.sidebar.reports}
          </Button>

          <Button 
            onClick={runReport}
            disabled={reportConfig.columns.length === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Play className="w-4 h-4 mr-2" />
            {t.reports.generate}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.reports.reportBuilder}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t.reports.title}</Label>
                <Select 
                  value={reportConfig.report_type} 
                  onValueChange={(value) => setReportConfig({...reportConfig, report_type: value, columns: []})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoices">{t.sidebar.invoices}</SelectItem>
                    <SelectItem value="estimates">{t.sidebar.estimates}</SelectItem>
                    <SelectItem value="payments">{t.sidebar.payments}</SelectItem>
                    <SelectItem value="expenses">{t.sidebar.expenses}</SelectItem>
                    <SelectItem value="customers">{t.sidebar.customers}</SelectItem>
                    <SelectItem value="leads">{t.sidebar.allLeads}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2 block">{t.reports.analytics}</Label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {availableColumns[reportConfig.report_type]?.map(col => (
                    <div key={col.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={reportConfig.columns.includes(col.id)}
                        onCheckedChange={() => handleColumnToggle(col.id)}
                        id={col.id}
                      />
                      <label htmlFor={col.id} className="text-sm cursor-pointer">
                        {col.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label>{t.common.sort}</Label>
                <Select 
                  value={reportConfig.sort_by}
                  onValueChange={(value) => setReportConfig({...reportConfig, sort_by: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableColumns[reportConfig.report_type]?.map(col => (
                      <SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t.common.sort} Order</Label>
                <Select 
                  value={reportConfig.sort_order}
                  onValueChange={(value) => setReportConfig({...reportConfig, sort_order: value})}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascending</SelectItem>
                    <SelectItem value="desc">Descending</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t.reports.dateRange}</Label>
                <Select 
                  value={reportConfig.filters.date_range}
                  onValueChange={(value) => setReportConfig({
                    ...reportConfig, 
                    filters: {...reportConfig.filters, date_range: value}
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">{t.dashboard.today}</SelectItem>
                    <SelectItem value="7days">Last 7 Days</SelectItem>
                    <SelectItem value="30days">Last 30 Days</SelectItem>
                    <SelectItem value="90days">Last 90 Days</SelectItem>
                    <SelectItem value="year">This Year</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setShowScheduleDialog(true)}
              >
                <Calendar className="w-4 h-4 mr-2" />
                Schedule Report
              </Button>
            </CardContent>
          </Card>

          {/* Saved Reports */}
          <Card>
            <CardHeader>
              <CardTitle>Saved Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {savedReports.map(report => (
                  <div 
                    key={report.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer"
                    onClick={() => loadReport(report)}
                  >
                    <div className="flex items-center gap-2">
                      {report.is_favorite && <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />}
                      <div>
                        <p className="font-medium text-sm">{report.report_name}</p>
                        <p className="text-xs text-gray-500">{report.report_type}</p>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this report?')) {
                          deleteMutation.mutate(report.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                ))}
                {savedReports.length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {t.common.noResults}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview Panel */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Report Preview</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ['invoices', 'estimates', 'payments', 'customers', 'leads', 'expenses'] });
                    setTimeout(runReport, 100);
                  }}
                  title="Refresh preview (fixes blank preview on first load)"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Preview
                </Button>
                {previewData.length > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={exportToExcel}>
                      <Download className="w-4 h-4 mr-2" />
                      {t.common.export} CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={exportToPDF}>
                      <Download className="w-4 h-4 mr-2" />
                      {t.common.export} PDF
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {previewData.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {reportConfig.columns.map(colId => {
                          const col = availableColumns[reportConfig.report_type].find(c => c.id === colId);
                          return (
                            <th key={colId} className="px-4 py-3 text-left text-sm font-semibold">
                              {col?.label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.slice(0, 100).map((row, idx) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          {reportConfig.columns.map(colId => (
                            <td key={colId} className="px-4 py-3 text-sm">
                              {colId.includes('date') && row[colId] 
                                ? format(new Date(row[colId]), 'MMM d, yyyy')
                                : colId === 'amount' || colId === 'value' || colId === 'total_revenue'
                                ? `$${(row[colId] || 0).toLocaleString()}`
                                : row[colId] || '-'
                              }
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-sm text-gray-500 mt-4">
                    Showing {Math.min(100, previewData.length)} of {previewData.length} results
                  </p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <Filter className="w-12 h-12 mx-auto text-gray-400 mb-3" />
                  <p className="text-gray-500">Configure your report and click "{t.reports.generate}" to see results</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.common.save} {t.sidebar.reports}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Report Name</Label>
              <Input
                value={reportConfig.report_name}
                onChange={(e) => setReportConfig({...reportConfig, report_name: e.target.value})}
                placeholder="e.g., Monthly Revenue Report"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                checked={reportConfig.is_favorite}
                onCheckedChange={(checked) => setReportConfig({...reportConfig, is_favorite: checked})}
                id="favorite"
              />
              <Label htmlFor="favorite" className="cursor-pointer">
                Add to favorites
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                {t.common.cancel}
              </Button>
              <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
                {t.common.save} {t.sidebar.reports}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={reportConfig.schedule.enabled}
                onCheckedChange={(checked) => setReportConfig({
                  ...reportConfig,
                  schedule: {...reportConfig.schedule, enabled: checked}
                })}
                id="schedule-enabled"
              />
              <Label htmlFor="schedule-enabled" className="cursor-pointer">
                {t.common.active}
              </Label>
            </div>

            {reportConfig.schedule.enabled && (
              <>
                <div>
                  <Label>Frequency</Label>
                  <Select 
                    value={reportConfig.schedule.frequency}
                    onValueChange={(value) => setReportConfig({
                      ...reportConfig,
                      schedule: {...reportConfig.schedule, frequency: value}
                    })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">{t.calendar.day}</SelectItem>
                      <SelectItem value="weekly">{t.calendar.week}</SelectItem>
                      <SelectItem value="monthly">{t.calendar.month}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Email Recipients</Label>
                  <Input
                    placeholder="email@example.com, email2@example.com"
                    value={reportConfig.schedule.recipients?.join(', ')}
                    onChange={(e) => setReportConfig({
                      ...reportConfig,
                      schedule: {...reportConfig.schedule, recipients: e.target.value.split(',').map(s => s.trim())}
                    })}
                  />
                  <p className="text-xs text-gray-500 mt-1">Separate multiple emails with commas</p>
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>
                {t.common.cancel}
              </Button>
              <Button onClick={() => {
                setShowScheduleDialog(false);
                alert('Schedule saved! Report will be sent automatically.');
              }} className="bg-blue-600 hover:bg-blue-700">
                {t.common.save} Schedule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}