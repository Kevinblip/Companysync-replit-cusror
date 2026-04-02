import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Download, ChevronDown, ChevronRight, AlertCircle, Search, FileSpreadsheet, FileText, Share2, TrendingUp } from "lucide-react";
import { format, eachMonthOfInterval, startOfYear, endOfYear, subYears } from "date-fns";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";

export default function Reports() {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState('sales');
  const [selectedReport, setSelectedReport] = useState('invoices');
  const [periodFilter, setPeriodFilter] = useState('this_month');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [compareYear, setCompareYear] = useState((new Date().getFullYear() - 1).toString());
  const [showComparison, setShowComparison] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [saleAgentFilter, setSaleAgentFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState('25');
  const [currentPage, setCurrentPage] = useState(1);
  const [excludeBillable, setExcludeBillable] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany,
    filterCustomers,
    filterInvoices,
    filterEstimates,
    filterProposals,
    filterPayments,
    filterLeads,
    hasPermission,
    isAdmin
  } = useRoleBasedData();

  // Fetch data - filtered by company_id
  const { data: allInvoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allEstimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allProposals = [] } = useQuery({
    queryKey: ['proposals', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Proposal.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: items = [] } = useQuery({
    queryKey: ['items', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Item.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const { data: allFamilyMembers = [] } = useQuery({
    queryKey: ['family-members', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.FamilyMember.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allFamilyCommissions = [] } = useQuery({
    queryKey: ['family-commission-records', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.FamilyCommissionRecord.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: deductions = [] } = useQuery({
    queryKey: ['commission-deductions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionDeduction.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: commissionPayments = [] } = useQuery({
    queryKey: ['commission-payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CommissionPayment.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompany,
  });

  // 🔐 Filter data based on role permissions using the hook
  const customers = React.useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const invoices = React.useMemo(() => filterInvoices(allInvoices, customers), [allInvoices, customers, filterInvoices]);
  const estimates = React.useMemo(() => filterEstimates(allEstimates, customers), [allEstimates, customers, filterEstimates]);
  const proposals = React.useMemo(() => filterProposals(allProposals, customers), [allProposals, customers, filterProposals]);
  const payments = React.useMemo(() => filterPayments(allPayments, customers), [allPayments, customers, filterPayments]);
  const leads = React.useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);

  // NEW: Date range calculation based on period filter
  const getDateRange = () => {
    const now = new Date();
    let start, end;

    switch (periodFilter) {
      case 'all_time':
        return { start: null, end: null };
      case 'this_month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last_month':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'this_year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
        break;
      case 'last_year':
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31);
        break;
      case 'last_3_months':
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1); // Start of 3 months ago
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of current month
        break;
      case 'last_6_months':
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1); // Start of 6 months ago
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of current month
        break;
      case 'last_12_months':
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1); // Start of 12 months ago
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of current month
        break;
      case 'custom':
        if (customStartDate && customEndDate) {
          start = new Date(customStartDate);
          end = new Date(customEndDate);
          // Set end date to end of the day for inclusive filtering
          end.setHours(23, 59, 59, 999); 
        } else {
          return { start: null, end: null };
        }
        break;
      default:
        return { start: null, end: null };
    }

    return { start, end };
  };

  const filterByDateRange = (items, dateField = 'created_date') => {
    const { start, end } = getDateRange();
    if (!start || !end) return items;

    return items.filter(item => {
      if (!item[dateField]) return false;
      const itemDate = new Date(item[dateField]);
      return itemDate >= start && itemDate <= end;
    });
  };

  // Filter active invoices (exclude cancelled)
  const activeInvoices = invoices.filter(inv => inv.status !== 'cancelled');
  const activeEstimates = estimates.filter(est => est.status !== 'declined');

  // Report categories
  const reportCategories = {
    sales: {
      label: t.reports.salesReports,
      reports: [
        { id: 'invoices', label: t.invoices.title + ' ' + t.common.report || 'Invoices Report' },
        { id: 'items', label: t.common.items || 'Items Report' },
        { id: 'payments', label: t.invoices.paymentHistory || 'Payments Received' },
        { id: 'credit_notes', label: 'Credit Notes Report' },
        { id: 'proposals', label: t.sidebar.proposals + ' ' + t.common.report || 'Proposals Report' },
        { id: 'estimates', label: t.estimates.title + ' ' + t.common.report || 'Estimates Report' },
        { id: 'customers', label: t.customers.title + ' ' + t.common.report || 'Customers Report' },
      ]
    },
    charts: {
      label: 'Charts Based Report',
      reports: [
        { id: 'total_income', label: 'Total Income' },
        { id: 'payment_modes', label: 'Payment Modes (Transactions)' },
        { id: 'customer_groups', label: 'Total Value By Customer Groups' },
        { id: 'yoy_comparison', label: 'Year-over-Year Comparison' },
        { id: 'mom_comparison', label: 'Month-over-Month Comparison' },
      ]
    },
    expenses: {
      label: t.accounting.expensesLabel || 'Expenses',
      reports: [
        { id: 'expenses_overview', label: 'Expenses Overview' },
      ]
    },
    expenses_vs_income: {
      label: 'Expenses vs Income',
      reports: [
        { id: 'income_expense_comparison', label: 'Income vs Expenses' },
      ]
    },
    leads: {
      label: t.leads.title || 'Leads',
      reports: [
        { id: 'leads_overview', label: 'Leads Overview' },
        { id: 'leads_conversions', label: 'Leads Conversions' },
        { id: 'sources_conversion', label: 'Sources Conversion' },
      ]
    },
    commissions: {
      label: t.sidebar.commissionTracker || 'Commissions',
      reports: [
        { id: 'sales_rep_commissions', label: 'Sales Rep Commissions' },
        { id: 'family_commissions', label: t.sidebar.familyCommissions + ' ' + t.common.report || 'Family Commissions Report' },
      ]
    },
  };

  // Year-over-Year Comparison Data
  const getYoYComparisonData = () => {
    const currentYear = parseInt(selectedYear);
    const previousYear = parseInt(compareYear);

    const months = eachMonthOfInterval({
      start: startOfYear(new Date(currentYear, 0, 1)),
      end: endOfYear(new Date(currentYear, 11, 31))
    });

    return months.map(month => {
      const currentYearPayments = payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === currentYear && 
               paymentDate.getMonth() === month.getMonth() &&
               p.status === 'received';
      });

      const previousYearPayments = payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === previousYear && 
               paymentDate.getMonth() === month.getMonth() &&
               p.status === 'received';
      });

      const currentRevenue = currentYearPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const previousRevenue = previousYearPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const growth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : 0;

      return {
        month: format(month, 'MMM'),
        [currentYear]: currentRevenue,
        [previousYear]: previousRevenue,
        growth: parseFloat(growth)
      };
    });
  };

  // Month-over-Month Comparison Data
  const getMoMComparisonData = () => {
    const year = parseInt(selectedYear);
    const months = eachMonthOfInterval({
      start: startOfYear(new Date(year, 0, 1)),
      end: endOfYear(new Date(year, 11, 31))
    });

    return months.map((month, index) => {
      const currentMonthPayments = payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === year && 
               paymentDate.getMonth() === month.getMonth() &&
               p.status === 'received';
      });

      const previousMonth = index > 0 ? months[index - 1] : null;
      const previousMonthPayments = previousMonth ? payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === year && 
               paymentDate.getMonth() === previousMonth.getMonth() &&
               p.status === 'received';
      }) : [];

      const currentRevenue = currentMonthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const previousRevenue = previousMonthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const growth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100).toFixed(1) : 0;

      return {
        month: format(month, 'MMM yyyy'),
        revenue: currentRevenue,
        previousMonth: previousRevenue,
        growth: parseFloat(growth)
      };
    });
  };

  // Chart data functions
  const getMonthlyIncomeData = () => {
    const year = parseInt(selectedYear);
    const months = eachMonthOfInterval({
      start: startOfYear(new Date(year, 0, 1)),
      end: endOfYear(new Date(year, 11, 31))
    });

    return months.map(month => {
      const monthPayments = payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === year && 
               paymentDate.getMonth() === month.getMonth() &&
               p.status === 'received';
      });

      return {
        month: format(month, 'MMMM - yyyy'),
        income: monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      };
    });
  };

  const getPaymentModesData = () => {
    const year = parseInt(selectedYear);
    const months = eachMonthOfInterval({
      start: startOfYear(new Date(year, 0, 1)),
      end: endOfYear(new Date(year, 11, 31))
    });

    return months.map(month => {
      const monthPayments = payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === year && 
               paymentDate.getMonth() === month.getMonth() &&
               p.status === 'received';
      });

      const result = { month: format(month, 'MMM yyyy') };
      monthPayments.forEach(p => {
        const mode = p.payment_method || 'other';
        result[mode] = (result[mode] || 0) + (p.amount || 0);
      });
      
      return result;
    });
  };

  const getCustomerGroupsData = () => {
    const customerRevenue = {};
    
    customers.forEach(customer => {
      const customerPayments = payments.filter(p => 
        p.customer_name === customer.name && p.status === 'received'
      );
      const total = customerPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      
      if (total > 0) {
        customerRevenue[customer.name] = total;
      }
    });

    return Object.keys(customerRevenue).map(name => ({
      customer: name,
      value: customerRevenue[name]
    }));
  };

  const getLeadsConversionData = () => {
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const convertedLeads = leads.filter(l => l.status === 'converted' || l.status === 'won');
    return daysOfWeek.map(day => ({
      day,
      conversions: convertedLeads.filter(l => {
        const d = new Date(l.created_date || l.created_at);
        return dayNames[d.getDay()] === day;
      }).length
    }));
  };

  const getSourcesConversionData = () => {
    const sources = ['Advertising', 'Anvyl List', 'CRM', 'Google', 'External Lead Provider', 'Website', 'Referral', 'Incoming Voicemail', 'Incoming SMS', 'other'];
    return sources.map(source => ({
      source,
      count: leads.filter(l => l.source === source).length
    }));
  };

  const getExpensesData = () => {
    return [];
  };

  const getIncomeExpenseComparisonData = () => {
    const year = parseInt(selectedYear);
    const months = eachMonthOfInterval({
      start: startOfYear(new Date(year, 0, 1)),
      end: endOfYear(new Date(year, 11, 31))
    });

    return months.map(month => {
      const monthPayments = payments.filter(p => {
        if (!p.payment_date) return false;
        const paymentDate = new Date(p.payment_date);
        return paymentDate.getFullYear() === year && 
               paymentDate.getMonth() === month.getMonth() &&
               p.status === 'received';
      });

      const income = monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      
      return {
        month: format(month, 'MMM yyyy'),
        income: income,
        expenses: 0
      };
    });
  };

  // Export to Excel with formulas
  const exportToExcel = () => {
    const data = getReportData();
    const columns = getReportColumns();

    let csv = columns.map(col => col.label).join(',') + '\n';
    
    data.forEach((row, index) => {
      csv += columns.map(col => {
        let value = row[col.key];
        if (col.format) {
          value = col.format(value);
        }
        return `"${value || ''}"`;
      }).join(',') + '\n';
    });

    // Add totals row with Excel formulas
    if (selectedReport === 'invoices' || selectedReport === 'payments') {
      const totalRowIndex = data.length + 2;
      const amountColLetter = 'E'; // Adjust based on actual column
      csv += `"TOTAL",,,,"=SUM(${amountColLetter}2:${amountColLetter}${totalRowIndex - 1})"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedReport}_${selectedYear}.csv`;
    a.click();
  };

  // Export to PDF with charts
  const exportToPDF = async () => {
    alert('📄 Generating PDF with charts...');
    
    try {
      const response = await base44.functions.invoke('generateReportPDF', {
        reportType: selectedReport,
        reportData: getReportData(),
        reportName: reportCategories[selectedCategory].reports.find(r => r.id === selectedReport)?.label || 'Report',
        year: selectedYear
      });

      if (response.data) {
        const blob = new Blob([response.data], { type: 'application/pdf' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedReport}_${selectedYear}.pdf`;
        a.click();
      }
    } catch (error) {
      console.error('PDF generation error:', error);
      alert('❌ Error generating PDF: ' + error.message);
    }
  };

  // Sync to Google Sheets
  const syncToGoogleSheets = async () => {
    alert('📊 Syncing to Google Sheets...\n\nThis will:\n1. Create a new Google Sheet\n2. Export your data\n3. Auto-update daily\n\n(Feature coming soon!)');
    
    // TODO: Implement Google Sheets API integration
    // const data = getReportData();
    // const response = await base44.functions.invoke('syncToGoogleSheets', {
    //   reportType: selectedReport,
    //   data: data,
    //   sheetName: `${selectedReport}_${selectedYear}`
    // });
  };

  const getReportData = () => {
    switch(selectedReport) {
      case 'invoices':
        return getInvoicesReportData();
      case 'payments':
        return getPaymentsReportData();
      case 'items':
        return getItemsReportData();
      case 'estimates':
        return getEstimatesReportData();
      case 'proposals':
        return getProposalsReportData();
      case 'customers':
        return getCustomersReportData();
      case 'family_commissions':
        return getFamilyCommissionsReportData();
      case 'sales_rep_commissions':
        return getSalesRepCommissionsReportData();
      default:
        return [];
    }
  };

  const getReportColumns = () => {
    switch(selectedReport) {
      case 'invoices':
        return [
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'issue_date', label: 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
          { key: 'due_date', label: 'Due Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
          { key: 'amount', label: 'Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
          { key: 'status', label: 'Status' }
        ];
      case 'payments':
        return [
          { key: 'payment_number', label: 'Payment #' },
          { key: 'payment_date', label: 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'amount', label: 'Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
          { key: 'payment_method', label: 'Payment Mode' },
          { key: 'reference_number', label: 'Transaction ID' },
          { key: 'notes', label: 'Note' }
        ];
      case 'family_commissions':
        return [
          { key: 'created_date', label: 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
          { key: 'family_member_name', label: 'Family Member' },
          { key: 'customer_name', label: 'Customer' },
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'payment_id', label: 'Payment ID', format: (val) => val ? val.substring(0, 8) + '...' : '-' },
          { key: 'sale_amount', label: 'Sale Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
          { key: 'commission_percentage', label: 'Commission %', format: (val) => `${val || 0}%` },
          { key: 'commission_amount', label: 'Commission', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
          { key: 'status', label: 'Status' }
        ];
      default:
        return [];
    }
  };

  // UPDATED: Table data functions with date filtering
  const getInvoicesReportData = () => {
    let filtered = filterByDateRange(activeInvoices, 'issue_date');
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter(inv => inv.status === statusFilter);
    }
    
    if (searchTerm) {
      filtered = filtered.filter(inv => 
        inv.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  const getPaymentsReportData = () => {
    let filtered = filterByDateRange(payments.filter(p => p.status === 'received'), 'payment_date');
    
    if (searchTerm) {
      filtered = filtered.filter(p => 
        p.payment_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  const getItemsReportData = () => {
    const filteredInvoices = filterByDateRange(activeInvoices.filter(inv => inv.status === 'paid'), 'issue_date');
    const itemsSold = {};
    
    filteredInvoices.forEach(invoice => {
      invoice.items?.forEach(item => {
        if (!itemsSold[item.description]) {
          itemsSold[item.description] = {
            name: item.description,
            quantity: 0,
            totalAmount: 0,
            count: 0
          };
        }
        
        itemsSold[item.description].quantity += item.quantity || 0;
        itemsSold[item.description].totalAmount += item.amount || 0;
        itemsSold[item.description].count += 1;
      });
    });

    return Object.values(itemsSold).map(item => ({
      ...item,
      averagePrice: item.count > 0 ? item.totalAmount / item.quantity : 0
    }));
  };

  const getEstimatesReportData = () => {
    let filtered = filterByDateRange(activeEstimates, 'created_date');
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter(est => est.status === statusFilter);
    }
    
    if (searchTerm) {
      filtered = filtered.filter(est => 
        est.estimate_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        est.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  const getProposalsReportData = () => {
    let filtered = filterByDateRange(proposals, 'created_date');
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter(prop => prop.status === statusFilter);
    }
    
    if (searchTerm) {
      filtered = filtered.filter(prop => 
        prop.proposal_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prop.customer_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  const getCustomersReportData = () => {
    // For customer report, we will filter the payments/invoices linked to them by the period filter
    const { start, end } = getDateRange();
    
    return customers.map(customer => {
      const customerPayments = payments.filter(p => 
        p.customer_name === customer.name && 
        p.status === 'received' &&
        (start === null || new Date(p.payment_date) >= start) &&
        (end === null || new Date(p.payment_date) <= end)
      );
      const totalRevenue = customerPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      
      const customerInvoices = activeInvoices.filter(inv => 
        inv.customer_name === customer.name &&
        (start === null || new Date(inv.issue_date) >= start) &&
        (end === null || new Date(inv.issue_date) <= end)
      );
      
      return {
        ...customer,
        totalRevenue,
        invoiceCount: customerInvoices.length
      };
    });
  };

  const getFamilyCommissionsReportData = () => {
    let filtered = myCompany ? allFamilyCommissions.filter(c => c.company_id === myCompany.id) : [];
    filtered = filterByDateRange(filtered, 'created_date');
    
    if (searchTerm) {
      filtered = filtered.filter(c => 
        c.family_member_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return filtered;
  };

  const getSalesRepCommissionsReportData = () => {
    const results = [];
    const staffWithCommissions = allStaffProfiles.filter(s => 
      myCompany ? s.company_id === myCompany.id && s.commission_rate > 0 : false
    );

    staffWithCommissions.forEach(staff => {
      if (saleAgentFilter !== 'all' && staff.user_email !== saleAgentFilter) return;

      const repInvoices = invoices.filter(inv => 
        inv.company_id === myCompany?.id &&
        (inv.sale_agent === staff.user_email || 
         inv.commission_splits?.some(split => split.user_email === staff.user_email))
      );

      const filteredInvoices = filterByDateRange(repInvoices, 'created_date');
      
      filteredInvoices.forEach(invoice => {
        // Match by invoice_number OR invoice_id
        const invoicePayments = payments.filter(p => 
          (p.invoice_id === invoice.id || p.invoice_number === invoice.invoice_number) && 
          p.status === 'received'
        );

        invoicePayments.forEach(payment => {
          const paymentDate = new Date(payment.payment_date);
          const { start, end } = getDateRange();
          if (start && end && (paymentDate < start || paymentDate > end)) return;

          let commissionRate = staff.commission_rate || 0;
          let splitPercentage = 100;
          let splitWith = 'None';

          const split = invoice.commission_splits?.find(s => s.user_email === staff.user_email);
          if (split) {
            splitPercentage = split.split_percentage || 100;
            splitWith = invoice.commission_splits?.filter(s => s.user_email !== staff.user_email).map(s => s.user_name).join(', ') || 'None';
          }

          const grossCommission = (payment.amount * (commissionRate / 100) * (splitPercentage / 100));

          let ladderAssistDeduction = 0;
          const invoiceDeductions = deductions.filter(d => 
            d.invoice_number === invoice.invoice_number &&
            d.staff_email === staff.user_email &&
            d.deduction_type === 'ladder_assist'
          );

          if (invoiceDeductions.length > 0) {
            const totalSplits = invoice.commission_splits?.length || 1;
            ladderAssistDeduction = invoiceDeductions.reduce((sum, d) => sum + Number(d.amount || 0), 0) / totalSplits;
          }

          const netCommission = grossCommission - ladderAssistDeduction;

          results.push({
            staff_name: staff.full_name,
            staff_email: staff.user_email,
            customer_name: invoice.customer_name,
            invoice_number: invoice.invoice_number,
            sale_date: payment.payment_date,
            sale_amount: payment.amount,
            commission_rate: commissionRate,
            split_percentage: splitPercentage,
            split_with: splitWith,
            gross_commission: grossCommission,
            ladder_assist_deduction: ladderAssistDeduction,
            net_commission: netCommission,
          });
        });
      });

      // ✅ ADD: Show deductions even if no sales (advances, chargebacks, etc.)
      const staffDeductions = deductions.filter(d => 
        d.sales_rep_email === staff.user_email || d.staff_email === staff.user_email
      );

      const filteredDeductions = filterByDateRange(staffDeductions, 'deduction_date');

      filteredDeductions.forEach(deduction => {
        const deductionDate = new Date(deduction.deduction_date);
        const { start, end } = getDateRange();
        if (start && end && (deductionDate < start || deductionDate > end)) return;

        // Check if this deduction is already included in invoice payment rows
        const alreadyIncluded = results.some(r => 
          r.invoice_number === deduction.invoice_number && 
          r.staff_email === staff.user_email &&
          deduction.deduction_type === 'ladder_assist'
        );

        if (!alreadyIncluded) {
          results.push({
            staff_name: staff.full_name,
            staff_email: staff.user_email,
            customer_name: deduction.customer_name || 'N/A',
            invoice_number: deduction.invoice_number || 'N/A',
            sale_date: deduction.deduction_date,
            sale_amount: 0,
            commission_rate: 0,
            split_percentage: 0,
            split_with: 'N/A',
            gross_commission: 0,
            ladder_assist_deduction: deduction.amount || 0,
            net_commission: -(deduction.amount || 0),
            description: deduction.description || deduction.deduction_type || 'Deduction'
          });
        }
      });

      // ✅ ADD: Show advance payments (CommissionPayment records)
      const staffAdvances = commissionPayments.filter(cp => 
        cp.staff_email === staff.user_email
      );

      const filteredAdvances = filterByDateRange(staffAdvances, 'payment_date');

      filteredAdvances.forEach(advance => {
        const advanceDate = new Date(advance.payment_date);
        const { start, end } = getDateRange();
        if (start && end && (advanceDate < start || advanceDate > end)) return;

        results.push({
          staff_name: staff.full_name,
          staff_email: staff.user_email,
          customer_name: 'Advance Payment',
          invoice_number: 'N/A',
          sale_date: advance.payment_date,
          sale_amount: 0,
          commission_rate: 0,
          split_percentage: 0,
          split_with: 'N/A',
          gross_commission: 0,
          ladder_assist_deduction: advance.amount || 0,
          net_commission: -(advance.amount || 0),
          description: advance.notes || 'Commission Advance'
        });
      });
    });

    if (searchTerm) {
      return results.filter(r => 
        r.staff_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return results.sort((a, b) => new Date(b.sale_date) - new Date(a.sale_date));
  };

  const handleExport = () => {
    exportToExcel();
  };

  const runAccountingScan = async () => {
    setScanning(true);
    try {
      const resp = await base44.functions.invoke('diagnoseAccounting', {});
      setScanResult(resp.data || resp);
    } catch (e) {
      alert('Scan failed: ' + (e?.message || 'unknown error'));
    } finally {
      setScanning(false);
    }
  };

  const renderReportContent = () => {
    // Year-over-Year Comparison
    if (selectedReport === 'yoy_comparison') {
      const data = getYoYComparisonData();
      const currentYearTotal = data.reduce((sum, d) => sum + Number(d[selectedYear] || 0), 0);
      const previousYearTotal = data.reduce((sum, d) => sum + Number(d[compareYear] || 0), 0);
      const overallGrowth = previousYearTotal > 0 ? ((currentYearTotal - previousYearTotal) / previousYearTotal * 100).toFixed(1) : 0;

      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-gray-600 mb-1">{selectedYear} {t.common.total || 'Total'}</div>
                <div className="text-2xl font-bold text-blue-600">${currentYearTotal.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-gray-600 mb-1">{compareYear} {t.common.total || 'Total'}</div>
                <div className="text-2xl font-bold text-gray-600">${previousYearTotal.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-gray-600 mb-1">{t.reports.growth || 'Growth'}</div>
                <div className={`text-2xl font-bold flex items-center gap-2 ${overallGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <TrendingUp className="w-5 h-5" />
                  {overallGrowth}%
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="bg-gray-50 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold">{t.reports.performance || 'Year-over-Year Revenue Comparison'}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToPDF} className="hover-elevate">
                    <FileText className="w-4 h-4 mr-2" />
                    {t.reports.export || 'PDF'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportToExcel} className="hover-elevate">
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    {t.common.export || 'Excel'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets} className="hover-elevate">
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey={selectedYear} fill="#3b82f6" name={`${selectedYear} ${t.accounting.revenue || 'Revenue'}`} />
                  <Bar dataKey={compareYear} fill="#94a3b8" name={`${compareYear} ${t.accounting.revenue || 'Revenue'}`} />
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-6">
                <h4 className="font-semibold mb-3">{t.reports.growth || 'Monthly Growth Rates'}</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.map((month) => (
                    <div key={month.month} className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">{month.month}</div>
                      <div className={`text-lg font-bold ${month.growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {month.growth}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Month-over-Month Comparison
    if (selectedReport === 'mom_comparison') {
      const data = getMoMComparisonData();
      const avgGrowth = (data.reduce((sum, d) => sum + d.growth, 0) / data.length).toFixed(1);
      const bestMonth = data.reduce((max, d) => d.revenue > max.revenue ? d : max, data[0]);
      const worstMonth = data.reduce((min, d) => d.revenue < min.revenue ? d : min, data[0]);

      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-gray-600 mb-1">{t.common.average || 'Avg'} {t.reports.growth || 'Growth'}</div>
                <div className={`text-2xl font-bold ${avgGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {avgGrowth}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-gray-600 mb-1">Best Month</div>
                <div className="text-2xl font-bold text-blue-600">{bestMonth.month}</div>
                <div className="text-sm text-gray-500">${bestMonth.revenue.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-gray-600 mb-1">Lowest Month</div>
                <div className="text-2xl font-bold text-gray-600">{worstMonth.month}</div>
                <div className="text-sm text-gray-500">${worstMonth.revenue.toLocaleString()}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Month-over-Month {t.accounting.revenue || 'Revenue'} Trend</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToPDF}>
                    <FileText className="w-4 h-4 mr-2" />
                    {t.reports.export || 'PDF'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportToExcel}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    {t.common.export || 'Excel'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} name={t.accounting.revenue || "Revenue"} />
                  <Line type="monotone" dataKey="previousMonth" stroke="#94a3b8" strokeDasharray="5 5" name="Previous Month" />
                </LineChart>
              </ResponsiveContainer>

              <div className="mt-6">
                <h4 className="font-semibold mb-3">Monthly {t.reports.growth || 'Growth'} Analysis</h4>
                <div className="space-y-2">
                  {data.map((month, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <span className="font-medium">{month.month}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-gray-600">${month.revenue.toLocaleString()}</span>
                        <Badge variant="outline" className={month.growth >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}>
                          {month.growth >= 0 ? '+' : ''}{month.growth}%
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Chart reports
    if (selectedReport === 'total_income') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{t.common.cancelled || 'Cancelled'} {t.invoices.title || 'invoices'} are excluded from the report</span>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t.reports.revenue || 'Total Income'} - {selectedYear}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToPDF}>
                    <FileText className="w-4 h-4 mr-2" />
                    {t.reports.export || 'PDF'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportToExcel}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    {t.common.export || 'Excel'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={getMonthlyIncomeData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" angle={-45} textAnchor="end" height={100} />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Bar dataKey="income" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'payment_modes') {
      const paymentModes = ['bank', 'check', 'credit_card', 'cash', 'paypal', 'stripe'];
      const colors = ['#06b6d4', '#0ea5e9', '#ec4899', '#6b7280', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];
      
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{t.common.cancelled || 'Cancelled'} {t.invoices.title || 'invoices'} are excluded from the report</span>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Payment Modes Distribution - {selectedYear}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToPDF}>
                    <FileText className="w-4 h-4 mr-2" />
                    {t.reports.export || 'PDF'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={getPaymentModesData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Legend />
                  {paymentModes.map((mode, index) => (
                    <Bar key={mode} dataKey={mode} fill={colors[index]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'customer_groups') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{t.common.cancelled || 'Cancelled'} {t.invoices.title || 'invoices'} are excluded from the report</span>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t.reports.revenue || 'Revenue'} by {t.customers.title || 'Customer'}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToPDF}>
                    <FileText className="w-4 h-4 mr-2" />
                    {t.reports.export || 'PDF'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={getCustomerGroupsData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="customer" angle={-45} textAnchor="end" height={120} />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Line type="monotone" dataKey="value" stroke="#a855f7" fill="#a855f7" fillOpacity={0.3} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'expenses_overview') {
      const expensesData = getExpensesData();
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
      
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <Checkbox 
              id="exclude-billable" 
              checked={excludeBillable}
              onCheckedChange={setExcludeBillable}
            />
            <Label htmlFor="exclude-billable" className="text-sm cursor-pointer">
              Exclude Billable {t.accounting.expensesLabel || 'Expenses'}
            </Label>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t.accounting.expensesLabel || 'Expenses'} Overview - {selectedYear}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToExcel}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {expensesData.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-lg font-medium">No expense data available</p>
                  <p className="text-sm mt-1">Expense tracking will appear here once expense records are added.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="border px-4 py-2 text-left text-sm font-semibold">Category</th>
                        {months.map(month => (
                          <th key={month} className="border px-4 py-2 text-left text-sm font-semibold">{month}</th>
                        ))}
                        <th className="border px-4 py-2 text-left text-sm font-semibold">Year ({selectedYear})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expensesData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="border px-4 py-2 text-sm">{row.category}</td>
                          {months.map(month => (
                            <td key={month} className="border px-4 py-2 text-sm">${row[month].toFixed(2)}</td>
                          ))}
                          <td className="border px-4 py-2 text-sm font-semibold">${row[`Year (${selectedYear})`].toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'income_expense_comparison') {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">Amount is displayed in your base currency - Only use this report if you are using 1 currency for payments and expenses.</span>
          </div>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Income vs Expenses - {selectedYear}</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportToPDF}>
                    <FileText className="w-4 h-4 mr-2" />
                    {t.reports.export || 'PDF'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                    <Share2 className="w-4 h-4 mr-2" />
                    Google Sheets
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={getIncomeExpenseComparisonData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="income" fill="#10b981" name={t.reports.revenue || "Total Income"} />
                  <Bar dataKey="expenses" fill="#ef4444" name={t.accounting.expensesLabel || "Expenses"} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'leads_conversions') {
      return (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t.reports.leadsConversions || 'This Week Leads Conversions'}</CardTitle>
                <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                  <Share2 className="w-4 h-4 mr-2" />
                  Google Sheets
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={getLeadsConversionData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="conversions" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'sources_conversion') {
      return (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{t.reports.sourcesConversion || 'Sources Conversion'}</CardTitle>
                <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                  <Share2 className="w-4 h-4 mr-2" />
                  Google Sheets
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={getSourcesConversionData()}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="source" angle={-45} textAnchor="end" height={120} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (selectedReport === 'leads_overview') {
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4">{t.reports.leadsConversions || 'This Week Leads Conversions'}</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={getLeadsConversionData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="conversions" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold mb-4">{t.reports.sourcesConversion || 'Sources Conversion'}</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={getSourcesConversionData()}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="source" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    // Table reports
    const renderTable = () => {
      let data = [];
      let columns = [];
      let totals = {};

      switch(selectedReport) {
        case 'invoices':
          data = getInvoicesReportData();
          columns = [
            { key: 'invoice_number', label: t.invoices.invoiceNumber || 'Invoice #' },
            { key: 'customer_name', label: t.common.customer || 'Customer' },
            { key: 'issue_date', label: t.common.date || 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'due_date', label: t.common.dueDate || 'Due Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'amount', label: t.common.amount || 'Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'status', label: t.common.status || 'Status' }
          ];
          totals = { amount: data.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
          break;

        case 'payments':
          data = getPaymentsReportData();
          columns = [
            { key: 'payment_number', label: 'Payment #' },
            { key: 'payment_date', label: t.common.date || 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'invoice_number', label: t.invoices.invoiceNumber || 'Invoice #' },
            { key: 'customer_name', label: t.common.customer || 'Customer' },
            { key: 'amount', label: t.common.amount || 'Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'payment_method', label: 'Payment Mode' },
            { key: 'reference_number', label: 'Transaction ID' },
            { key: 'notes', label: t.common.notes || 'Note' }
          ];
          totals = { amount: data.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
          break;

        case 'items':
          data = getItemsReportData();
          columns = [
            { key: 'name', label: t.common.item || 'Item' },
            { key: 'quantity', label: t.common.quantity || 'Quantity Sold' },
            { key: 'totalAmount', label: t.common.total || 'Total Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'averagePrice', label: t.common.average || 'Average Price', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` }
          ];
          totals = { 
            quantity: data.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
            totalAmount: data.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0)
          };
          break;

        case 'estimates':
          data = getEstimatesReportData();
          columns = [
            { key: 'estimate_number', label: t.estimates.estimateNumber || 'Estimate #' },
            { key: 'customer_name', label: t.common.customer || 'Customer' },
            { key: 'created_date', label: t.common.date || 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'valid_until', label: t.estimates.validUntil || 'Expiry Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'amount', label: t.common.amount || 'Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'status', label: t.common.status || 'Status' }
          ];
          totals = { amount: data.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
          break;

        case 'proposals':
          data = getProposalsReportData();
          columns = [
            { key: 'proposal_number', label: 'Proposal #' },
            { key: 'customer_name', label: t.common.customer || 'Customer' },
            { key: 'title', label: t.common.name || 'Title' },
            { key: 'created_date', label: t.common.date || 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'amount', label: t.common.amount || 'Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'status', label: t.common.status || 'Status' }
          ];
          totals = { amount: data.reduce((sum, item) => sum + Number(item.amount || 0), 0) };
          break;

        case 'customers':
          data = getCustomersReportData();
          columns = [
            { key: 'name', label: t.common.customer || 'Customer' },
            { key: 'email', label: t.common.email || 'Email' },
            { key: 'phone', label: t.common.phone || 'Phone' },
            { key: 'company', label: t.common.companyName || 'Company' },
            { key: 'invoiceCount', label: t.invoices.title || 'Invoices' },
            { key: 'totalRevenue', label: t.reports.revenue || 'Total Revenue', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` }
          ];
          totals = { totalRevenue: data.reduce((sum, item) => sum + Number(item.totalRevenue || 0), 0) };
          break;

        case 'family_commissions':
          data = getFamilyCommissionsReportData();
          columns = [
            { key: 'created_date', label: t.common.date || 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'family_member_name', label: 'Family Member' },
            { key: 'customer_name', label: t.common.customer || 'Customer' },
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'payment_id', label: 'Payment ID', format: (val) => val ? val.substring(0, 8) + '...' : '-' },
            { key: 'sale_amount', label: 'Sale Amount', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'commission_percentage', label: 'Commission %', format: (val) => `${val || 0}%` },
            { key: 'commission_amount', label: 'Commission', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'status', label: 'Status' }
          ];
          totals = { 
            sale_amount: data.reduce((sum, item) => sum + Number(item.sale_amount || 0), 0),
            commission_amount: data.reduce((sum, item) => sum + Number(item.commission_amount || 0), 0)
          };
          break;

        case 'sales_rep_commissions':
          data = getSalesRepCommissionsReportData();
          columns = [
            { key: 'sale_date', label: 'Date', format: (val) => val ? format(new Date(val), 'yyyy-MM-dd') : '-' },
            { key: 'staff_name', label: 'Sales Rep' },
            { key: 'customer_name', label: 'Customer/Deal' },
            { key: 'invoice_number', label: 'Invoice #' },
            { key: 'description', label: 'Description' },
            { key: 'sale_amount', label: 'Payment', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'commission_rate', label: 'Rate %', format: (val) => val > 0 ? `${val}%` : '-' },
            { key: 'split_percentage', label: 'Split %', format: (val) => val > 0 ? `${val}%` : '-' },
            { key: 'split_with', label: 'Split With' },
            { key: 'gross_commission', label: 'Gross Comm.', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` },
            { key: 'ladder_assist_deduction', label: 'Deductions', format: (val) => val > 0 ? `$${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-' },
            { key: 'net_commission', label: 'Net Comm.', format: (val) => `$${(val || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, isNet: true },
          ];
          totals = { 
            sale_amount: data.reduce((sum, item) => sum + Number(item.sale_amount || 0), 0),
            gross_commission: data.reduce((sum, item) => sum + Number(item.gross_commission || 0), 0),
            ladder_assist_deduction: data.reduce((sum, item) => sum + Number(item.ladder_assist_deduction || 0), 0),
            net_commission: data.reduce((sum, item) => sum + Number(item.net_commission || 0), 0)
          };
          break;

        default:
          return null;
      }

      const perPage = parseInt(itemsPerPage);
      const startIndex = (currentPage - 1) * perPage;
      const endIndex = startIndex + perPage;
      const paginatedData = data.slice(startIndex, endIndex);
      const totalPages = Math.ceil(data.length / perPage);

      return (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white border-b">
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} className="text-left p-3 text-sm font-semibold text-gray-700">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, index) => (
                  <tr key={index} className="border-b hover:bg-gray-50">
                    {columns.map((col) => {
                      const value = col.format ? col.format(row[col.key]) : (row[col.key] || '-');
                      const netValue = row[col.key];
                      
                      return (
                        <td 
                          key={col.key} 
                          className={`p-3 text-sm ${
                            col.isNet && netValue !== undefined 
                              ? (netValue >= 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold')
                              : 'text-gray-900'
                          }`}
                        >
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="bg-gray-50 font-semibold">
                  <td className="p-3 text-sm" colSpan={columns.findIndex(c => Object.keys(totals).includes(c.key))}>
                    Total (Per Page)
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className="p-3 text-sm">
                      {Object.keys(totals).includes(col.key)
                        ? (col.format ? col.format(totals[col.key]) : totals[col.key])
                        : ''}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 px-3 text-sm text-gray-600">
            <span>Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} entries</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled>
                {currentPage}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">Cancelled invoices are excluded from the report</span>
        </div>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold mb-4">Generated Report</h3>
            
            {selectedReport === 'items' && (
              <div className="mb-4 text-sm text-blue-600 bg-blue-50 p-3 rounded">
                Items report is generated only from paid invoices before discounts and taxes.
              </div>
            )}

            <div className="flex gap-4 mb-4 flex-wrap">
              {/* NEW: Period Filter */}
              <div>
                <Label className="text-sm text-gray-600">Period</Label>
                <Select value={periodFilter} onValueChange={setPeriodFilter}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={t.common.select || "Select Period"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_time">{t.common.all || 'All Time'}</SelectItem>
                    <SelectItem value="this_month">{t.common.thisMonth || 'This Month'}</SelectItem>
                    <SelectItem value="last_month">{t.common.lastMonth || 'Last Month'}</SelectItem>
                    <SelectItem value="this_year">{t.common.thisYear || 'This Year'}</SelectItem>
                    <SelectItem value="last_year">{t.common.lastYear || 'Last Year'}</SelectItem>
                    <SelectItem value="last_3_months">
                      {t.common.last3Months || 'Last 3 months'}
                    </SelectItem>
                    <SelectItem value="last_6_months">
                      {t.common.last6Months || 'Last 6 months'}
                    </SelectItem>
                    <SelectItem value="last_12_months">
                      {t.common.last12Months || 'Last 12 months'}
                    </SelectItem>
                    <SelectItem value="custom">{t.common.custom || 'Custom Period'}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {periodFilter === 'custom' && (
                <>
                  <div>
                    <Label className="text-sm text-gray-600">Start Date</Label>
                    <Input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <div>
                    <Label className="text-sm text-gray-600">End Date</Label>
                    <Input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-40"
                    />
                  </div>
                </>
              )}

              {!['items', 'customers', 'expenses_overview', 'income_expense_comparison', 'leads_overview', 'leads_conversions', 'sources_conversion', 'credit_notes', 'family_commissions'].includes(selectedReport) && (
                <div>
                  <Label className="text-sm text-gray-600">Status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.common.all || 'All'}</SelectItem>
                      <SelectItem value="draft">{t.common.draft || 'Draft'}</SelectItem>
                      <SelectItem value="sent">{t.common.sent || 'Sent'}</SelectItem>
                      <SelectItem value="paid">{t.common.paid || 'Paid'}</SelectItem>
                      <SelectItem value="overdue">{t.common.overdue || 'Overdue'}</SelectItem>
                      {selectedReport === 'estimates' && (
                        <>
                          <SelectItem value="declined">{t.common.declined || 'Declined'}</SelectItem>
                          <SelectItem value="accepted">{t.common.accepted || 'Accepted'}</SelectItem>
                          <SelectItem value="expired">{t.common.expired || 'Expired'}</SelectItem>
                        </>
                      )}
                      {selectedReport === 'proposals' && (
                        <>
                          <SelectItem value="declined">{t.common.declined || 'Declined'}</SelectItem>
                          <SelectItem value="accepted">{t.common.accepted || 'Accepted'}</SelectItem>
                          <SelectItem value="open">{t.common.open || 'Open'}</SelectItem>
                          <SelectItem value="sent">{t.common.sent || 'Sent'}</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(selectedReport === 'invoices' || selectedReport === 'estimates' || selectedReport === 'proposals' || selectedReport === 'sales_rep_commissions') && (
                <div>
                  <Label className="text-sm text-gray-600">Sale Agent</Label>
                  <Select value={saleAgentFilter} onValueChange={setSaleAgentFilter}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t.common.all || 'All'}</SelectItem>
                      {selectedReport === 'sales_rep_commissions' ? (
                        allStaffProfiles.filter(s => myCompany ? s.company_id === myCompany.id && s.commission_rate > 0 : false).map(staff => (
                          <SelectItem key={staff.user_email} value={staff.user_email}>{staff.full_name}</SelectItem>
                        ))
                      ) : (
                        users.map(user => (
                          <SelectItem key={user.id} value={user.email}>{user.full_name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-end gap-2">
                <Select value={itemsPerPage} onValueChange={setItemsPerPage}>
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={exportToExcel}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  {t.common.export || 'Excel'}
                </Button>
                <Button variant="outline" size="sm" onClick={exportToPDF}>
                  <FileText className="w-4 h-4 mr-2" />
                  {t.reports.export || 'PDF'}
                </Button>
                <Button variant="outline" size="sm" onClick={syncToGoogleSheets}>
                  <Share2 className="w-4 h-4 mr-2" />
                  {t.reports.sheets || 'Sheets'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </Button>
              </div>

              <div className="relative ml-auto">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder={`${t.common.search || 'Search'}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
            </div>

            {renderTable()}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r overflow-y-auto">
        <div className="p-4 space-y-2">
          <div className="mb-4">
            <h2 className="text-xl font-bold px-3 py-2">{t.reports.title}</h2>
          </div>
          {Object.entries(reportCategories).map(([categoryId, category]) => (
            <Collapsible key={categoryId}>
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors text-left">
                <span className="font-semibold text-gray-700">{category.label}</span>
                <ChevronDown className="w-4 h-4 text-gray-500" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1 ml-3 space-y-1">
                {category.reports.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => {
                      setSelectedCategory(categoryId);
                      setSelectedReport(report.id);
                      setCurrentPage(1);
                      setSearchTerm('');
                      setStatusFilter('all');
                      setPeriodFilter('this_month'); // Reset period filter on report change
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                      selectedReport === report.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <ChevronRight className="w-3 h-3 inline mr-2" />
                    {report.label}
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {reportCategories[selectedCategory]?.label || t.reports.title}
              </h1>
              <p className="text-gray-500 mt-1">{t.reports.analytics}</p>
            </div>

            <div className="flex gap-4">
              {(['total_income', 'payment_modes', 'customer_groups', 'income_expense_comparison', 'expenses_overview', 'yoy_comparison', 'mom_comparison'].includes(selectedReport)) && (
                <>
                  <div>
                    <Label className="text-sm text-gray-600">{t.common.date || 'Year'}</Label>
                    <Select value={selectedYear} onValueChange={setSelectedYear}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[2025, 2024, 2023, 2022].map(year => (
                          <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedReport === 'yoy_comparison' && (
                    <div>
                      <Label className="text-sm text-gray-600">{t.common.compare || 'Compare to'}</Label>
                      <Select value={compareYear} onValueChange={setCompareYear}>
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[2024, 2023, 2022, 2021].map(year => (
                            <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

              <div className="flex items-center gap-2">
                <Button onClick={runAccountingScan} variant="outline" size="sm" disabled={scanning}>
                  {scanning ? t.common.loading : 'Scan Accounting'}
                </Button>
              </div>
            </div>
          </div>

          {scanResult && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Accounting Scan Results</CardTitle>
              </CardHeader>
              <CardContent>
                {(scanResult.success === false || scanResult.error) ? (
                  <div className="text-red-600 text-sm">{scanResult.error || 'Scan error'}</div>
                ) : (
                  <div className="space-y-3 text-sm">
                    {(scanResult.companies || []).map((c, idx) => (
                      <div key={idx} className="border rounded p-3">
                        <div className="font-semibold mb-2">{c.company?.name || 'Company'}</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
                          <div>Invoices: <span className="font-medium">{c.metrics.invoices_count}</span></div>
                          <div>Payments: <span className="font-medium">{c.metrics.payments_count}</span></div>
                          <div>YTD Revenue: <span className="font-medium">${'{'}c.metrics.ytd_revenue.toLocaleString(){'}'}</span></div>
                        </div>
                        <ul className="list-disc ml-5 space-y-1">
                          <li>Unlinked payments: <strong>{c.issues.unlinked_payments.count}</strong></li>
                          <li>Invoice-payment mismatches: <strong>{c.issues.invoice_payment_mismatches.count}</strong></li>
                          <li>Payments on cancelled invoices: <strong>{c.issues.cancelled_invoice_payments.count}</strong></li>
                          <li>Missing dates — payments: <strong>{c.issues.missing_dates.payments_missing_date}</strong>, expenses: <strong>{c.issues.missing_dates.expenses_missing_date}</strong></li>
                          <li>A/R reconciliation: {c.issues.accounts_receivable_reconciliation.ok ? 'OK' : `diff $${'{'}Math.abs((c.issues.accounts_receivable_reconciliation.difference || 0)).toLocaleString(){'}'}`}</li>
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {renderReportContent()}
        </div>
      </div>
    </div>
  );
}