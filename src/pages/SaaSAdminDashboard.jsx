import React, { useState, useMemo, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useImpersonation } from "@/lib/ImpersonationContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Building2,
  Users,
  DollarSign,
  TrendingUp,
  Eye,
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  BarChart3,
  Calendar,
  Activity,
  Shield,
  Trash2,
  AlertTriangle,
  Ban,
  CreditCard,
  ExternalLink,
  RefreshCw,
  FileText,
  Zap,
  Radio,
  UserCheck,
  MonitorDot
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addDays, isToday, formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { PLATFORM_COMPANY_ID } from "@/lib/constants";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import SubscriptionLimitsAdmin from "@/components/SubscriptionLimitsAdmin";

export default function SaaSAdminDashboard() {
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [impersonateDialog, setImpersonateDialog] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [impersonationReason, setImpersonationReason] = useState("");
  const [viewCompanyDialog, setViewCompanyDialog] = useState(false);
  const [viewingCompany, setViewingCompany] = useState(null);
  const [editCompanyDialog, setEditCompanyDialog] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [diagnosticResult, setDiagnosticResult] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [usageMonth, setUsageMonth] = useState(new Date());
  const [auditResult, setAuditResult] = useState(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [showAuditDialog, setShowAuditDialog] = useState(false);
  const [isSeedingTemplates, setIsSeedingTemplates] = useState(false);
  const [orphanScanResults, setOrphanScanResults] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isRegistering, setIsRegistering] = useState(null);
  const navigate = useNavigate();

  const [authLoaded, setAuthLoaded] = useState(false);
  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setAuthLoaded(true);
    }).catch(() => {
      setAuthLoaded(true);
    });
  }, []);

  const { data: companies = [], isSuccess: companiesLoaded, isLoading: isLoadingCompanies, isError: companiesError } = useQuery({
    queryKey: ['all-companies'],
    queryFn: () => base44.entities.Company.list('-created_date', 1000),
    retry: 2,
  });
  const [showDeleted, setShowDeleted] = useState(false);

  // Fetch all users
  const { data: allStaffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles'],
    queryFn: () => base44.entities.StaffProfile.list('-created_date', 10000),
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['all-customers'],
    queryFn: () => base44.entities.Customer.list('-created_date', 10000),
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['all-leads'],
    queryFn: () => base44.entities.Lead.list('-created_date', 10000),
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['all-invoices'],
    queryFn: () => base44.entities.Invoice.list('-created_date', 10000),
  });

  const { data: allUsage = [] } = useQuery({
    queryKey: ['all-usage'],
    queryFn: () => base44.entities.SubscriptionUsage.list('-created_date', 10000),
  });

  const { data: stripeData = null, isLoading: stripeLoading, refetch: refetchStripe } = useQuery({
    queryKey: ['stripe-overview'],
    queryFn: async () => {
      const resp = await fetch('/api/stripe/overview', { credentials: 'include' });
      if (!resp.ok) return null;
      return resp.json();
    },
    staleTime: 60000,
  });

  const { startImpersonation: ctxStartImpersonation, isImpersonating: ctxIsImpersonating, stopImpersonation: ctxStopImpersonation, startViewAsUser: ctxStartViewAsUser } = useImpersonation();

  const [liveCompanyId, setLiveCompanyId] = useState('');
  const { data: liveUsers = [], refetch: refetchLive } = useQuery({
    queryKey: ['live-users', liveCompanyId],
    queryFn: async () => {
      if (!liveCompanyId) return [];
      const res = await fetch(`/api/local/presence?company_id=${liveCompanyId}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.users || [];
    },
    enabled: !!liveCompanyId,
    refetchInterval: 30000,
  });

  const startImpersonationMutation = useMutation({
    mutationFn: async ({ companyId, companyName, reason }) => {
      await ctxStartImpersonation({ companyId, companyName, adminEmail: user.email });
      return { companyId, companyName };
    },
    onSuccess: ({ companyName }) => {
      toast.success(`Now impersonating ${companyName}`);
      setImpersonateDialog(false);
      setImpersonationReason("");
      window.location.href = createPageUrl('Dashboard');
    },
  });

  const queryClient = useQueryClient();

  const deleteCompanyMutation = useMutation({
    mutationFn: async (companyId) => {
      console.log('🗑️ Deleting company:', companyId);
      const response = await base44.functions.invoke('platformDeleteCompany', { companyId });
      console.log('📥 Delete response:', response.data);
      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Delete failed');
      }
      return response.data;
    },
    onSuccess: async (data, companyId) => {
      console.log('✅ Company deleted:', data);
      
      if (ctxIsImpersonating) {
        await ctxStopImpersonation();
        toast.info("Stopped impersonating deleted company");
        return;
      }

      await queryClient.refetchQueries({ queryKey: ['all-companies'] });
      toast.success(`Company deleted: ${data.company || 'Success'}`);
    },
    onError: (error) => {
      console.error('❌ Delete error:', error);
      toast.error('Failed to delete: ' + error.message);
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (email) => {
      console.log('🗑️ Deleting user:', email);
      const response = await base44.functions.invoke('deleteUserAccount', { email });
      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Delete failed');
      }
      return response.data;
    },
    onSuccess: async (data, email) => {
      toast.success(`User deleted: ${email}`);
      await queryClient.refetchQueries({ queryKey: ['all-staff-profiles'] });
    },
    onError: (error) => {
      console.error('❌ Delete error:', error);
      toast.error('Failed to delete user: ' + error.message);
    }
  });

  const updateCompanyMutation = useMutation({
    mutationFn: async ({ companyId, updates }) => {
      return await base44.entities.Company.update(companyId, updates);
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['all-companies'] });
      toast.success('Company updated successfully');
      setEditCompanyDialog(false);
      setEditingCompany(null);
      setEditForm({});
    },
    onError: (error) => {
      toast.error('Failed to update: ' + error.message);
    }
  });

  const runDiagnosticsMutation = useMutation({
    mutationFn: async (companyId) => {
      setDiagnosticResult(null);
      const response = await base44.functions.invoke('diagnoseTenant', { companyId });
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: (data) => {
      setDiagnosticResult(data);
      toast.success('Diagnostics complete');
    },
    onError: (error) => {
      toast.error('Diagnostics failed: ' + error.message);
    }
  });

  const runPlatformAudit = async () => {
    setIsAuditing(true);
    setAuditResult(null);
    try {
      const response = await base44.functions.invoke('auditDataIsolation');
      if (response.data.success) {
        setAuditResult(response.data.report);
        setShowAuditDialog(true);
        toast.success('Platform audit complete');
      } else {
        toast.error('Audit failed: ' + (response.data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Audit error:', error);
      toast.error('Failed to run audit');
    } finally {
      setIsAuditing(false);
    }
  };

  const seedAllTemplates = async () => {
    setIsSeedingTemplates(true);
    try {
      const resp = await fetch('/api/local/admin/seed-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (data.success) {
        const total = data.results?.reduce((s, r) => s + r.seeded, 0) ?? data.seeded ?? 0;
        toast.success(`Seeded ${total} templates across ${data.total_companies || 1} companies`);
        queryClient.invalidateQueries({ queryKey: ['all-companies'] });
      } else {
        toast.error('Seed failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      toast.error('Failed to seed templates');
    } finally {
      setIsSeedingTemplates(false);
    }
  };


  const impersonatingId = ctxIsImpersonating ? 'yes' : null;
  
  const lastUsedCompanyId = typeof window !== 'undefined' ? localStorage.getItem('last_used_company_id') : null;
  const activeCompany = lastUsedCompanyId 
    ? companies.find(c => c.id === lastUsedCompanyId)
    : (companies.find(c => c.created_by === user?.email) || 
       companies.find(c => allStaffProfiles.some(s => s.user_email === user?.email && s.company_id === c.id && (s.is_super_admin || s.is_administrator))));

  const masterCompany = companies.find(c => c.id === 'companysync_master_001');
  const isPlatformOwner = !impersonatingId && (
    isPlatformAdminCheck(user, activeCompany, null) ||
    isPlatformAdminCheck(user, masterCompany, null) ||
    user?.platform_role === 'super_admin' ||
    user?.platform_role === 'admin'
  );

  // Calculate metrics - must be before early returns to avoid hooks error
  const metrics = useMemo(() => {
    // Filter out deleted companies for metrics
    const activeCompanies = companies.filter(c => !c.is_deleted);
    
    // Helper to identify active/unlimited subscribers (including internal accounts)
    const isEffectivelyActive = (c) => {
      if (c.subscription_status === 'active') return true;
      
      const plan = c.subscription_plan?.toLowerCase() || '';
      if (plan === 'legacy' || plan === 'lifetime' || plan === 'unlimited' || plan === 'enterprise') return true;
      
      // Special internal/partner accounts are always active
      // Normalize name by removing spaces to catch "Company Sync" vs "CompanySync"
      const name = (c.company_name || '').toLowerCase().replace(/\s+/g, '');
      return name.includes('companysync') || name.includes('yicn') || name.includes('insuranceclaimsnetwork');
    };

    const activeSubscriptions = activeCompanies.filter(isEffectivelyActive).length;
    // Only count as trial if NOT effectively active (prevents double counting internal accounts)
    const trialSubscriptions = activeCompanies.filter(c => c.subscription_status === 'trial' && !isEffectivelyActive(c)).length;
    const cancelledSubscriptions = activeCompanies.filter(c => c.subscription_status === 'cancelled').length;
    
    // Calculate MRR based on subscription plans
    const PLAN_PRICES = {
      'trial': 0,
      'basic': 99,
      'business': 199,
      'enterprise': 399,
      'legacy': 199,
    };
    const mrr = activeCompanies.reduce((total, company) => {
      return total + (PLAN_PRICES[company.subscription_plan] || 0);
    }, 0);

    const totalUsers = allStaffProfiles.length;
    const totalCustomers = allCustomers.length;
    const totalLeads = allLeads.length;

    // Revenue by company
    const revenueByCompany = activeCompanies.map(company => {
      const companyInvoices = allInvoices.filter(inv => inv.company_id === company.id && inv.status === 'paid');
      const totalRevenue = companyInvoices.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
      return { company, totalRevenue };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Growth data (last 6 months)
    const monthlyData = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStr = date.toLocaleString('default', { month: 'short' });
      
      const companiesUpToMonth = activeCompanies.filter(c => new Date(c.created_date) <= date).length;
      const customersUpToMonth = allCustomers.filter(c => new Date(c.created_date) <= date).length;
      
      monthlyData.push({
        month: monthStr,
        companies: companiesUpToMonth,
        customers: customersUpToMonth
      });
    }

    // Churn analysis
    const churnedCompanies = activeCompanies.filter(c => c.subscription_status === 'cancelled').length;
    const churnRate = activeCompanies.length > 0 ? (churnedCompanies / activeCompanies.length * 100).toFixed(1) : 0;

    // Calendar Events
    const calendarEvents = [];
    
    // Trials ending
    activeCompanies.forEach(c => {
      if (c.trial_ends_at && c.subscription_status === 'trial') {
        calendarEvents.push({
          date: new Date(c.trial_ends_at),
          title: `Trial Ends: ${c.company_name}`,
          type: 'trial',
          data: c
        });
      }
    });

    // Invoices due
    allInvoices.forEach(inv => {
      if (inv.due_date && inv.status !== 'paid' && inv.status !== 'cancelled') {
        calendarEvents.push({
          date: new Date(inv.due_date),
          title: `Due: $${inv.amount} (${inv.customer_name})`,
          type: 'invoice',
          data: inv
        });
      }
    });

    return {
      mrr,
      planPrices: PLAN_PRICES,
      totalCompanies: activeCompanies.length,
      activeSubscriptions,
      trialSubscriptions,
      cancelledSubscriptions,
      totalUsers,
      totalCustomers,
      totalLeads,
      revenueByCompany,
      monthlyData,
      churnRate,
      calendarEvents,
      activeCompanies,
    };
  }, [companies, allStaffProfiles, allCustomers, allLeads, allInvoices]);

  // Filter companies based on search and dropdowns
  const filteredCompanies = companies.filter(company => {
    const matchesSearch = 
      company.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.created_by?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesPlan = filterPlan === 'all' || company.subscription_plan === filterPlan;
    const matchesStatus = filterStatus === 'all' || company.subscription_status === filterStatus;
    const matchesDeleted = showDeleted ? true : !company.is_deleted;
    return matchesSearch && matchesPlan && matchesStatus && matchesDeleted;
    });

  useEffect(() => {
    if (authLoaded && user && companiesLoaded && !isPlatformOwner) {
      console.log("Not a platform owner, redirecting to dashboard");
      window.location.href = createPageUrl('Dashboard');
    }
  }, [authLoaded, user, companiesLoaded, isPlatformOwner]);

  if (companiesError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load data. Please refresh the page.</p>
          <Button onClick={() => window.location.reload()}>Refresh</Button>
        </div>
      </div>
    );
  }

  if (!authLoaded || !user || isLoadingCompanies || !companiesLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Clock className="w-16 h-16 mx-auto mb-4 text-blue-600 animate-spin" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isPlatformOwner) {
    return null;
  }

  const getStatusBadge = (status) => {
    const styles = {
      'active': 'bg-green-100 text-green-800',
      'trial': 'bg-blue-100 text-blue-800',
      'cancelled': 'bg-red-100 text-red-800',
      'expired': 'bg-gray-100 text-gray-800',
      'past_due': 'bg-orange-100 text-orange-800',
      'suspended': 'bg-red-200 text-red-900 border border-red-300'
    };
    return styles[status] || 'bg-gray-100 text-gray-800';
  };

  const getPlanBadge = (plan) => {
    const styles = {
      'starter': 'bg-blue-100 text-blue-800',
      'professional': 'bg-purple-100 text-purple-800',
      'enterprise': 'bg-yellow-100 text-yellow-800',
      'trial': 'bg-gray-100 text-gray-800'
    };
    return styles[plan] || 'bg-gray-100 text-gray-800';
  };

  const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">SaaS Admin Dashboard</h1>
              <p className="text-gray-600">Platform-wide analytics and subscriber management</p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={seedAllTemplates}
                disabled={isSeedingTemplates}
                data-testid="button-seed-templates"
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <FileText className={`w-4 h-4 ${isSeedingTemplates ? 'animate-spin' : ''}`} />
                {isSeedingTemplates ? 'Seeding...' : 'Seed Templates'}
              </Button>
              <Button
                onClick={runPlatformAudit}
                disabled={isAuditing}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Activity className={`w-4 h-4 ${isAuditing ? 'animate-spin' : ''}`} />
                {isAuditing ? 'Scanning Platform...' : 'Run Data Audit'}
              </Button>
              <Button
                onClick={() => navigate(createPageUrl('SecurityCompliance'))}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Shield className="w-4 h-4" />
                Security & Compliance
              </Button>
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="flex flex-wrap gap-1 w-full lg:w-auto h-auto p-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="companies">Companies</TabsTrigger>
            <TabsTrigger value="limits">Limits</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="live" className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Live
            </TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
           <TabsContent value="overview" className="space-y-6">
             {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-white border-l-4 border-l-emerald-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Monthly Recurring Revenue</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <DollarSign className="w-6 h-6 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-gray-900">${metrics.mrr}</div>
                      <p className="text-xs text-gray-500 mt-1">+12% from last month</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Total Companies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-gray-900">{metrics.totalCompanies}</div>
                      <p className="text-xs text-gray-500 mt-1">{metrics.activeSubscriptions} active</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white border-l-4 border-l-violet-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Active Subscriptions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-violet-600" />
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-gray-900">{metrics.activeSubscriptions}</div>
                      <p className="text-xs text-gray-500 mt-1">Churn rate: {metrics.churnRate}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white border-l-4 border-l-amber-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">In Trial</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                      <Clock className="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                      <div className="text-3xl font-bold text-gray-900">{metrics.trialSubscriptions}</div>
                      <p className="text-xs text-gray-500 mt-1">Convert to paid</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Usage Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Total Users
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">{metrics.totalUsers}</div>
                  <p className="text-sm text-gray-600 mt-1">Across all companies</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Total Customers
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">{metrics.totalCustomers}</div>
                  <p className="text-sm text-gray-600 mt-1">Platform-wide</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Total Leads
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">{metrics.totalLeads}</div>
                  <p className="text-sm text-gray-600 mt-1">In pipeline</p>
                </CardContent>
              </Card>
            </div>

            {/* Growth Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Growth Trends (Last 6 Months)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={metrics.monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="companies" stroke="#3b82f6" strokeWidth={2} name="Companies" />
                    <Line type="monotone" dataKey="customers" stroke="#10b981" strokeWidth={2} name="Customers" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Calendar Widget */}
            <Card className="h-[600px] flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  Subscription & Payment Calendar
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCurrentMonth(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>
                    <span className="sr-only">Previous month</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-left w-4 h-4"><path d="m15 18-6-6 6-6"/></svg>
                  </Button>
                  <Button variant="outline" onClick={() => setCurrentMonth(new Date())}>Today</Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentMonth(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>
                    <span className="sr-only">Next month</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-right w-4 h-4"><path d="m9 18 6-6-6-6"/></svg>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
                <div className="grid grid-cols-7 border-b bg-gray-50">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="py-2 text-center text-xs font-semibold text-gray-600 border-r last:border-r-0">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 flex-1 auto-rows-fr">
                  {eachDayOfInterval({
                    start: startOfWeek(startOfMonth(currentMonth)),
                    end: endOfWeek(endOfMonth(currentMonth))
                  }).map((day, dayIdx) => {
                    const dayEvents = metrics.calendarEvents.filter(e => isSameDay(e.date, day));
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    
                    return (
                      <div 
                        key={day.toISOString()} 
                        className={`
                          border-b border-r p-1 min-h-[80px] flex flex-col
                          ${!isCurrentMonth ? 'bg-gray-50/50 text-gray-400' : 'bg-white'} 
                          ${isToday(day) ? 'bg-blue-50/30' : ''}
                          ${dayIdx % 7 === 6 ? 'border-r-0' : ''}
                        `}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className={`
                            text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full
                            ${isToday(day) ? 'bg-blue-600 text-white' : ''}
                          `}>
                            {format(day, 'd')}
                          </span>
                        </div>
                        
                        <div className="space-y-1 overflow-y-auto max-h-[80px] custom-scrollbar">
                          {dayEvents.map((event, evtIdx) => (
                            <div 
                              key={evtIdx}
                              className={`
                                px-1.5 py-0.5 rounded text-[10px] border font-medium truncate cursor-pointer transition-colors
                                ${event.type === 'trial' 
                                  ? 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200' 
                                  : 'bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200'}
                              `}
                              title={`${event.title} - ${format(event.date, 'h:mm a')}`}
                            >
                              {event.type === 'trial' ? '⏳' : '💰'} {event.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Live Users Tab */}
          <TabsContent value="live" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Radio className="h-5 w-5 text-green-500" />
                      Live Users
                    </CardTitle>
                    <p className="text-sm text-gray-500 mt-1">See who's active right now. Updates every 30 seconds.</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchLive()} className="flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Select company:</label>
                  <select
                    className="flex-1 border rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={liveCompanyId}
                    onChange={e => setLiveCompanyId(e.target.value)}
                    data-testid="live-company-select"
                  >
                    <option value="">— Choose a company —</option>
                    {[...companies].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                {!liveCompanyId && (
                  <div className="text-center py-12 text-gray-400">
                    <MonitorDot className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">Select a company to view active users</p>
                  </div>
                )}

                {liveCompanyId && liveUsers.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <UserCheck className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">No active users right now</p>
                    <p className="text-xs mt-1">Users appear here within 30 seconds of activity</p>
                  </div>
                )}

                {liveUsers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                      {liveUsers.length} active user{liveUsers.length !== 1 ? 's' : ''}
                    </p>
                    {liveUsers.map((u, i) => {
                      const selectedCompany = companies.find(c => c.id === liveCompanyId);
                      const seenAgo = u.last_seen ? formatDistanceToNow(new Date(u.last_seen), { addSuffix: true }) : 'just now';
                      return (
                        <div
                          key={u.user_email || i}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                          data-testid={`live-user-row-${i}`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="relative">
                              <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm">
                                {(u.user_name || u.user_email || '?')[0].toUpperCase()}
                              </div>
                              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 bg-green-400 border-2 border-white rounded-full"></span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{u.user_name || u.user_email}</p>
                              <p className="text-xs text-gray-500 truncate">{u.user_email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right hidden sm:block">
                              <p className="text-xs font-medium text-gray-700">{u.page_label || u.page}</p>
                              <p className="text-xs text-gray-400">{seenAgo}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              data-testid={`btn-view-as-${i}`}
                              onClick={async () => {
                                if (!selectedCompany) return;
                                if (!ctxIsImpersonating) {
                                  await ctxStartImpersonation({ companyId: selectedCompany.id, companyName: selectedCompany.name, adminEmail: user.email });
                                }
                                ctxStartViewAsUser({ userEmail: u.user_email, userName: u.user_name });
                                window.location.href = createPageUrl('Dashboard');
                              }}
                              className="flex items-center gap-1.5 text-xs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View As
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscription Limits Tab */}
          <TabsContent value="limits" className="space-y-6">
            <SubscriptionLimitsAdmin companies={filteredCompanies} />
          </TabsContent>

          {/* Companies Tab */}
          <TabsContent value="companies" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>All Companies</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isScanning}
                      onClick={async () => {
                        setIsScanning(true);
                        setOrphanScanResults(null);
                        try {
                          const resp = await fetch('/api/local/admin/scan-orphan-companies');
                          const data = await resp.json();
                          setOrphanScanResults(data.orphans || []);
                          if ((data.orphans || []).length === 0) toast.success('All companies registered!');
                        } catch(e) { toast.error('Scan failed'); }
                        setIsScanning(false);
                      }}
                      data-testid="button-scan-orphan-companies"
                      className="text-blue-600 border-blue-300 hover:bg-blue-50"
                    >
                      {isScanning ? '🔍 Scanning...' : '🔍 Scan for Missing Companies'}
                    </Button>
                    <select 
                      className="px-3 py-2 border rounded-md text-sm bg-white min-w-[120px]"
                      value={filterPlan}
                      onChange={(e) => setFilterPlan(e.target.value)}
                    >
                      <option value="all">All Plans</option>
                      <option value="trial">Trial</option>
                      <option value="starter">Starter</option>
                      <option value="professional">Professional</option>
                      <option value="enterprise">Enterprise</option>
                      <option value="legacy">Legacy</option>
                    </select>

                    <select 
                      className="px-3 py-2 border rounded-md text-sm bg-white min-w-[120px]"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="trial">Trial</option>
                      <option value="past_due">Past Due</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="expired">Expired</option>
                      <option value="suspended">Suspended</option>
                    </select>

                    <div className="flex items-center gap-2">
                       <input 
                         type="checkbox" 
                         id="showDeleted"
                         checked={showDeleted}
                         onChange={(e) => setShowDeleted(e.target.checked)}
                         className="rounded border-gray-300"
                       />
                       <label htmlFor="showDeleted" className="text-sm text-gray-600">Show Deleted</label>
                    </div>

                    <div className="relative w-64">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <Input
                        placeholder="Search companies..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>

              {/* Orphan company scanner results */}
              {orphanScanResults && orphanScanResults.length > 0 && (
                <div className="mx-6 mb-4 p-4 bg-amber-50 border border-amber-300 rounded-lg">
                  <div className="font-semibold text-amber-800 mb-2">⚠️ Found {orphanScanResults.length} unregistered company ID(s) with real data:</div>
                  {orphanScanResults.map(o => (
                    <div key={o.company_id} className="flex items-center justify-between bg-white border border-amber-200 rounded p-3 mb-2">
                      <div>
                        <div className="font-mono text-sm font-bold text-gray-800">{o.company_id}</div>
                        <div className="text-xs text-gray-600 mt-1">
                          {o.customers} customers · {o.leads} leads · {o.invoices} invoices · {o.estimates} estimates · {o.staff} staff · {o.entities} entities
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white ml-4 shrink-0"
                        disabled={isRegistering === o.company_id}
                        onClick={async () => {
                          setIsRegistering(o.company_id);
                          try {
                            const name = window.prompt(`Company name for ${o.company_id}:`, 'YICN Roofing');
                            if (!name) { setIsRegistering(null); return; }
                            const resp = await fetch('/api/local/admin/register-orphan-company', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ company_id: o.company_id, company_name: name }),
                            });
                            if (resp.ok) {
                              toast.success(`✅ Registered "${name}" successfully!`);
                              setOrphanScanResults(prev => prev.filter(x => x.company_id !== o.company_id));
                              queryClient.invalidateQueries({ queryKey: ['/api/local/entity'] });
                            }
                          } catch(e) { toast.error('Failed to register'); }
                          setIsRegistering(null);
                        }}
                        data-testid={`button-register-orphan-${o.company_id}`}
                      >
                        {isRegistering === o.company_id ? 'Registering...' : '+ Register'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {orphanScanResults !== null && orphanScanResults.length === 0 && (
                <div className="mx-6 mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
                  ✅ All companies with data are already registered.
                </div>
              )}

              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 text-sm font-medium text-gray-600">Company</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Plan</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Status</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Users</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Customers</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Leads</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Created</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCompanies.map((company) => {
                        const companyUsers = allStaffProfiles.filter(s => s.company_id === company.id).length;
                        const companyCustomers = allCustomers.filter(c => c.company_id === company.id).length;
                        const companyLeads = allLeads.filter(l => l.company_id === company.id).length;

                        return (
                          <tr key={company.id} className={`border-b hover:bg-gray-50 ${company.is_deleted ? 'bg-red-50' : ''}`}>
                            <td className="py-4">
                              <div>
                                <div className="font-medium text-gray-900">
                                  {company.company_name}
                                  {company.is_deleted && <Badge variant="destructive" className="ml-2 text-xs">Deleted</Badge>}
                                </div>
                                <div className="text-sm text-gray-500">{company.created_by}</div>
                                <div
                                  className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-xs font-mono text-blue-700 cursor-pointer hover:bg-blue-100 hover:border-blue-400 transition-colors max-w-[220px] truncate"
                                  onClick={() => {
                                    navigator.clipboard.writeText(company.id);
                                    toast.success('Company ID copied!');
                                  }}
                                  title={`Click to copy: ${company.id}`}
                                  data-testid={`company-id-${company.id}`}
                                >
                                  🔑 {company.id}
                                </div>
                              </div>
                            </td>
                            <td className="py-4">
                              <Badge className={getPlanBadge(company.subscription_plan)}>
                                {company.subscription_plan || 'trial'}
                              </Badge>
                            </td>
                            <td className="py-4">
                              <Badge className={getStatusBadge(company.subscription_status)}>
                                {company.subscription_status || 'trial'}
                              </Badge>
                            </td>
                            <td className="py-4 text-gray-700">
                              {company.subscription_plan === 'legacy' || company.subscription_plan === 'lifetime' || company.id === 'companysync_master_001' || company.company_name?.includes('Insurance Claims Network') 
                                ? '∞' 
                                : `${companyUsers}/${company.max_users || 5}`}
                            </td>
                            <td className="py-4 text-gray-700">
                              {company.subscription_plan === 'legacy' || company.subscription_plan === 'lifetime' || company.id === 'companysync_master_001' || company.company_name?.includes('Insurance Claims Network')
                                ? '∞'
                                : companyCustomers}
                            </td>
                            <td className="py-4 text-gray-700">
                              {company.subscription_plan === 'legacy' || company.subscription_plan === 'lifetime' || company.id === 'companysync_master_001' || company.company_name?.includes('Insurance Claims Network')
                                ? '∞'
                                : companyLeads}
                            </td>
                            <td className="py-4 text-sm text-gray-600">
                              {new Date(company.created_date).toLocaleDateString()}
                            </td>
                            <td className="py-4">
                              <div className="flex gap-2">
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => {
                                    setEditingCompany(company);
                                    setEditForm({
                                      company_name: company.company_name,
                                      email: company.email,
                                      subscription_plan: company.subscription_plan || 'trial',
                                      subscription_status: company.subscription_status || 'trial',
                                      max_users: company.max_users || 5,
                                      max_customers: company.max_customers || 1000,
                                      trial_ends_at: company.trial_ends_at || ''
                                    });
                                    setEditCompanyDialog(true);
                                  }}
                                  title="Edit company"
                                  className="text-blue-600 hover:text-blue-700"
                                >
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm"
                                  onClick={() => {
                                    setSelectedCompany(company);
                                    setImpersonateDialog(true);
                                  }}
                                  title="Impersonate company"
                                  className="text-red-600 hover:text-red-700"
                                >
                                  <Shield className="w-4 h-4" />
                                </Button>
                                {company.id !== 'companysync_master_001' && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          const resp = await fetch('/api/local/admin/seed-templates', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ company_id: company.id }),
                                          });
                                          const data = await resp.json();
                                          if (data.success) {
                                            toast.success(`Seeded ${data.seeded} templates for ${company.company_name}`);
                                          } else {
                                            toast.error('Failed: ' + (data.error || 'Unknown'));
                                          }
                                        } catch {
                                          toast.error('Failed to seed templates');
                                        }
                                      }}
                                      title="Seed estimate templates"
                                      data-testid={`button-seed-templates-${company.id}`}
                                      className="text-emerald-600 hover:text-emerald-700"
                                    >
                                      <FileText className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        const newStatus = company.subscription_status === 'suspended' ? 'active' : 'suspended';
                                        if (confirm(`Are you sure you want to ${company.subscription_status === 'suspended' ? 'enable' : 'disable'} ${company.company_name}?`)) {
                                          updateCompanyMutation.mutate({
                                            companyId: company.id,
                                            updates: { subscription_status: newStatus }
                                          });
                                        }
                                      }}
                                      title={company.subscription_status === 'suspended' ? 'Enable Company' : 'Disable Company'}
                                      className={company.subscription_status === 'suspended' ? "text-green-600 hover:text-green-700" : "text-amber-600 hover:text-amber-700"}
                                    >
                                      {company.subscription_status === 'suspended' ? <CheckCircle2 className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                                    </Button>
                                    <Button 
                                      variant="ghost" 
                                      size="sm"
                                      onClick={() => {
                                        if (confirm(`Delete ${company.company_name}? This action cannot be undone.`)) {
                                          deleteCompanyMutation.mutate(company.id);
                                        }
                                      }}
                                      title="Delete company"
                                      className="text-red-600 hover:text-red-700"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-6">
            {/* User Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Total Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-gray-900">{metrics.totalUsers}</div>
                  <p className="text-xs text-gray-600 mt-1">All staff members</p>
                  <p className="text-xs text-blue-600 font-medium mt-2 bg-blue-50 p-1 rounded">Platform-wide</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Admins</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-purple-600">
                    {allStaffProfiles.filter(s => s.is_administrator).length}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Admin access</p>
                  <p className="text-xs text-blue-600 font-medium mt-2 bg-blue-50 p-1 rounded">Platform-wide</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Active Users (7d)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600">
                    {allStaffProfiles.filter(s => {
                      if (!s.last_login) return false;
                      const daysSinceLogin = Math.floor((new Date() - new Date(s.last_login)) / (1000 * 60 * 60 * 24));
                      return daysSinceLogin <= 7;
                    }).length}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Recently active</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Inactive Users (30d+)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-orange-600">
                    {allStaffProfiles.filter(s => {
                      if (!s.last_login) return true;
                      const daysSinceLogin = Math.floor((new Date() - new Date(s.last_login)) / (1000 * 60 * 60 * 24));
                      return daysSinceLogin > 30;
                    }).length}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Need engagement</p>
                </CardContent>
              </Card>
            </div>



                    {/* User Distribution by Company */}
            <Card>
              <CardHeader>
                <CardTitle>Users per Company</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={
                    companies.map(c => {
                      const totalUsers = allStaffProfiles.filter(s => s.company_id === c.id).length;
                      const adminCount = allStaffProfiles.filter(s => s.company_id === c.id && s.is_administrator).length;
                      return {
                        name: (c.company_name || 'Unknown').substring(0, 20) + ((c.company_name || '').length > 20 ? '...' : ''),
                        admins: adminCount,
                        regular: totalUsers - adminCount
                      };
                    }).sort((a, b) => (b.admins + b.regular) - (a.admins + a.regular)).slice(0, 15)
                  }>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip cursor={{ fill: 'rgba(0, 0, 0, 0.1)' }} />
                    <Legend />
                    <Bar dataKey="regular" fill="#3b82f6" name="Regular Users" label={{ position: 'top', fill: '#1e40af', fontSize: 14, fontWeight: 700 }} />
                    <Bar dataKey="admins" fill="#8b5cf6" name="Admins" label={{ position: 'top', fill: '#6d28d9', fontSize: 14, fontWeight: 700 }} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            {/* Platform Health Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Avg Users/Company</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">
                    {companies.length > 0 ? (metrics.totalUsers / companies.length).toFixed(1) : 0}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Platform average</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Avg Customers/Company</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">
                    {companies.length > 0 ? (metrics.totalCustomers / companies.length).toFixed(0) : 0}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Data utilization</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Avg Leads/Company</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">
                    {companies.length > 0 ? (metrics.totalLeads / companies.length).toFixed(0) : 0}
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Lead generation</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-600">Conversion Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900">
                    {metrics.totalLeads > 0 ? ((metrics.totalCustomers / (metrics.totalLeads + metrics.totalCustomers)) * 100).toFixed(1) : 0}%
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Lead to customer</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Subscription Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Subscription Distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Active', value: metrics.activeSubscriptions },
                          { name: 'Trial', value: metrics.trialSubscriptions },
                          { name: 'Cancelled', value: metrics.cancelledSubscriptions }
                        ]}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {[0, 1, 2].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Company Activity Levels */}
              <Card>
                <CardHeader>
                  <CardTitle>Company Activity Levels</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={
                      companies.map(c => ({
                        name: (c.company_name || 'Unknown').substring(0, 15) + '...',
                        users: allStaffProfiles.filter(s => s.company_id === c.id).length,
                        customers: allCustomers.filter(cu => cu.company_id === c.id).length,
                        leads: allLeads.filter(l => l.company_id === c.id).length
                      })).slice(0, 10)
                    }>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="users" fill="#3b82f6" name="Staff" />
                      <Bar dataKey="customers" fill="#10b981" name="Customers" />
                      <Bar dataKey="leads" fill="#f59e0b" name="Leads" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Top Revenue Companies */}
              <Card>
                <CardHeader>
                  <CardTitle>Top Revenue Companies</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {metrics.revenueByCompany.slice(0, 5).map((item, index) => (
                      <div key={item.company.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                            {index + 1}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{item.company.company_name}</div>
                            <div className="text-sm text-gray-600">{item.company.email}</div>
                          </div>
                        </div>
                        <div className="text-lg font-semibold text-green-600">
                          ${item.totalRevenue.toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Platform Usage Stats */}
              <Card>
                <CardHeader>
                  <CardTitle>Platform Data Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-gray-600">Total Staff Across Platform</span>
                      <span className="font-semibold text-gray-900">{metrics.totalUsers}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-gray-600">Total Customers Managed</span>
                      <span className="font-semibold text-gray-900">{metrics.totalCustomers}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-gray-600">Total Active Leads</span>
                      <span className="font-semibold text-gray-900">{metrics.totalLeads}</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-gray-600">Total Invoices Processed</span>
                      <span className="font-semibold text-gray-900">{allInvoices.length}</span>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-600">Total Revenue Tracked</span>
                      <span className="font-semibold text-green-600">
                        ${allInvoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + Number(inv.amount || 0), 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Company Comparison Table */}
            <Card>
              <CardHeader>
                <CardTitle>Company Performance Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-3 text-sm font-medium text-gray-600">Company</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Staff</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Customers</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Leads</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Invoices</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Revenue</th>
                        <th className="pb-3 text-sm font-medium text-gray-600">Engagement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map((company) => {
                        const companyUsers = allStaffProfiles.filter(s => s.company_id === company.id).length;
                        const companyCustomers = allCustomers.filter(c => c.company_id === company.id).length;
                        const companyLeads = allLeads.filter(l => l.company_id === company.id).length;
                        const companyInvoices = allInvoices.filter(inv => inv.company_id === company.id);
                        const companyRevenue = companyInvoices.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
                        const engagementScore = companyUsers + companyCustomers + companyLeads + companyInvoices.length;

                        return (
                          <tr key={company.id} className="border-b hover:bg-gray-50">
                            <td className="py-4">
                              <div className="font-medium text-gray-900">{company.company_name}</div>
                              <div className="text-xs text-gray-600">{company.email}</div>
                            </td>
                            <td className="py-4 text-gray-700">{companyUsers}</td>
                            <td className="py-4 text-gray-700">{companyCustomers}</td>
                            <td className="py-4 text-gray-700">{companyLeads}</td>
                            <td className="py-4 text-gray-700">{companyInvoices.length}</td>
                            <td className="py-4 text-green-600 font-semibold">${companyRevenue.toLocaleString()}</td>
                            <td className="py-4">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                                  <div 
                                    className="bg-blue-600 h-2 rounded-full" 
                                    style={{ width: `${Math.min((engagementScore / 1000) * 100, 100)}%` }}
                                  />
                                </div>
                                <span className="text-sm text-gray-600">{engagementScore}</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Calendar Tab */}
          <TabsContent value="calendar" className="space-y-6">
            <Card className="h-[800px] flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-4">
                  <Calendar className="w-6 h-6 text-blue-600" />
                  <h2 className="text-xl font-bold">{format(currentMonth, 'MMMM yyyy')}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCurrentMonth(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>
                    <span className="sr-only">Previous month</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-left w-4 h-4"><path d="m15 18-6-6 6-6"/></svg>
                  </Button>
                  <Button variant="outline" onClick={() => setCurrentMonth(new Date())}>Today</Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentMonth(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>
                    <span className="sr-only">Next month</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-right w-4 h-4"><path d="m9 18 6-6-6-6"/></svg>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
                <div className="grid grid-cols-7 border-b bg-gray-50">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                    <div key={day} className="py-3 text-center text-sm font-semibold text-gray-600 border-r last:border-r-0">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 flex-1 auto-rows-fr">
                  {eachDayOfInterval({
                    start: startOfWeek(startOfMonth(currentMonth)),
                    end: endOfWeek(endOfMonth(currentMonth))
                  }).map((day, dayIdx) => {
                    const dayEvents = metrics.calendarEvents.filter(e => isSameDay(e.date, day));
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    
                    return (
                      <div 
                        key={day.toISOString()} 
                        className={`
                          border-b border-r p-2 min-h-[100px] flex flex-col
                          ${!isCurrentMonth ? 'bg-gray-50/50 text-gray-400' : 'bg-white'} 
                          ${isToday(day) ? 'bg-blue-50/30' : ''}
                          ${dayIdx % 7 === 6 ? 'border-r-0' : ''}
                        `}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className={`
                            text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full
                            ${isToday(day) ? 'bg-blue-600 text-white' : ''}
                          `}>
                            {format(day, 'd')}
                          </span>
                        </div>
                        
                        <div className="space-y-1 overflow-y-auto max-h-[100px] custom-scrollbar">
                          {dayEvents.map((event, evtIdx) => (
                            <div 
                              key={evtIdx}
                              className={`
                                px-2 py-1 rounded text-xs border font-medium truncate cursor-pointer transition-colors
                                ${event.type === 'trial' 
                                  ? 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200' 
                                  : 'bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-200'}
                              `}
                              title={`${event.title} - ${format(event.date, 'h:mm a')}`}
                            >
                              {event.type === 'trial' ? '⏳' : '💰'} {event.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Usage Tab */}
           <TabsContent value="usage" className="space-y-6">
             <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800">Usage for {format(usageMonth, 'MMMM yyyy')}</h2>
                <div className="flex items-center gap-2">
                   <Button variant="outline" size="icon" onClick={() => setUsageMonth(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n; })}>
                     <span className="sr-only">Previous month</span>
                     <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-left w-4 h-4"><path d="m15 18-6-6 6-6"/></svg>
                   </Button>
                   <Button variant="outline" onClick={() => {
                     const today = new Date();
                     setUsageMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                   }}>Week</Button>
                   <Button variant="outline" onClick={() => {
                     const today = new Date();
                     setUsageMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                   }} className="bg-blue-100 text-blue-900">Month</Button>
                   <Button variant="outline" onClick={() => {
                     const today = new Date();
                     setUsageMonth(new Date(today.getFullYear(), 0, 1));
                   }}>Year</Button>
                   <Button variant="outline" size="icon" onClick={() => setUsageMonth(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n; })}>
                     <span className="sr-only">Next month</span>
                     <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-right w-4 h-4"><path d="m9 18 6-6-6-6"/></svg>
                   </Button>
                </div>
             </div>

            {(() => {
              const selectedMonthStr = format(usageMonth, 'yyyy-MM');
              const filteredUsage = allUsage.filter(u => u.usage_month === selectedMonthStr);
              
              return (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="bg-gradient-to-br from-green-50 to-green-100/50 border-green-200">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-gray-600">Total Usage Cost ({format(usageMonth, 'MMM')})</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-gray-900">
                          ${filteredUsage.reduce((sum, u) => sum + Number(u.total_cost || 0), 0).toFixed(2)}
                        </div>
                        <p className="text-sm text-gray-600 mt-2">Platform-wide cost</p>
                      </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-gray-600">Top Cost Driver</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {(() => {
                          const costByFeature = {};
                          filteredUsage.forEach(u => {
                            costByFeature[u.feature] = (costByFeature[u.feature] || 0) + Number(u.total_cost || 0);
                          });
                          const topFeature = Object.entries(costByFeature).sort((a, b) => b[1] - a[1])[0];
                          return (
                            <>
                              <div className="text-3xl font-bold text-purple-600 capitalize">
                                {topFeature ? topFeature[0].replace(/_/g, ' ') : 'None'}
                              </div>
                              <p className="text-sm text-gray-600 mt-2">
                                ${topFeature ? topFeature[1].toFixed(2) : '0.00'}
                              </p>
                            </>
                          );
                        })()}
                      </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200">
                      <CardHeader>
                        <CardTitle className="text-sm font-medium text-gray-600">Active Companies</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-blue-600">
                          {new Set(filteredUsage.map(u => u.company_id)).size}
                        </div>
                        <p className="text-sm text-gray-600 mt-2">Using paid features</p>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle>Usage Breakdown by Company ({format(usageMonth, 'MMMM yyyy')})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-3 text-sm font-medium text-gray-600">Company</th>
                              <th className="pb-3 text-sm font-medium text-gray-600">Lexi</th>
                              <th className="pb-3 text-sm font-medium text-gray-600">Sarah</th>
                              <th className="pb-3 text-sm font-medium text-gray-600">Marcus</th>
                              <th className="pb-3 text-sm font-medium text-gray-600">AI Estimator</th>
                              <th className="pb-3 text-sm font-medium text-gray-600">SMS/Voice</th>
                              <th className="pb-3 text-sm font-medium text-gray-600">Total Cost</th>
                            </tr>
                          </thead>
                          <tbody>
                            {companies.map(company => {
                              const companyUsage = filteredUsage.filter(u => u.company_id === company.id);
                              // Filter out companies with no usage for this month
                              if (companyUsage.length === 0) return null;

                              const getCost = (feature) => companyUsage
                                .filter(u => u.feature === feature)
                                .reduce((sum, u) => sum + Number(u.total_cost || 0), 0);

                               const lexiCost = getCost('lexi');
                               const sarahCost = getCost('sarah');
                               const marcusCost = getCost('marcus');
                               const estimatorCost = getCost('ai_estimator');
                               const commsCost = getCost('sms_credits') + getCost('phone_minutes') + getCost('voice_minutes');
                               const totalCost = companyUsage.reduce((sum, u) => sum + Number(u.total_cost || 0), 0);

                               return (
                                 <tr key={company.id} className="border-b hover:bg-gray-50">
                                   <td className="py-4">
                                     <div className="font-medium text-gray-900">{company.company_name}</div>
                                     <div className="text-xs text-gray-600">{company.email}</div>
                                   </td>
                                   <td className="py-4 text-gray-700">${lexiCost.toFixed(2)}</td>
                                   <td className="py-4 text-gray-700">${sarahCost.toFixed(2)}</td>
                                   <td className="py-4 text-gray-700">${marcusCost.toFixed(2)}</td>
                                   <td className="py-4 text-gray-700">${estimatorCost.toFixed(2)}</td>
                                   <td className="py-4 text-gray-700">${commsCost.toFixed(2)}</td>
                                   <td className="py-4 font-bold text-gray-900">${totalCost.toFixed(2)}</td>
                                 </tr>
                               );
                            })}
                            {/* Empty state if no companies have usage */}
                            {companies.every(c => filteredUsage.filter(u => u.company_id === c.id).length === 0) && (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-gray-500">
                                  No usage data found for {format(usageMonth, 'MMMM yyyy')}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </TabsContent>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-6">
            {(() => {
              const currentMonthStr = new Date().toISOString().slice(0, 7);
              const thisMonthUsage = allUsage.filter(u => u.usage_month === currentMonthStr);
              const totalPlatformAIFees = thisMonthUsage.reduce((sum, u) => sum + Number(u.total_cost || 0), 0);
              const overdueAccounts = (metrics.activeCompanies || []).filter(c => c.subscription_status === 'overdue' || c.payment_status === 'overdue').length;

              return (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-gradient-to-br from-green-50 to-green-100/50 border-green-200">
                      <CardContent className="p-4">
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Total MRR</div>
                        <div className="text-2xl font-bold text-green-700">${metrics.mrr.toLocaleString()}</div>
                        <div className="text-xs text-gray-500 mt-0.5">ARR: ${(metrics.mrr * 12).toLocaleString()}</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200">
                      <CardContent className="p-4">
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">AI Fees This Month</div>
                        <div className="text-2xl font-bold text-purple-700">${totalPlatformAIFees.toFixed(2)}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{thisMonthUsage.length} usage events</div>
                      </CardContent>
                    </Card>
                    <Card className={`border-2 ${overdueAccounts > 0 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                      <CardContent className="p-4">
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Overdue Accounts</div>
                        <div className={`text-2xl font-bold ${overdueAccounts > 0 ? 'text-red-600' : 'text-gray-400'}`}>{overdueAccounts}</div>
                        <div className="text-xs text-gray-500 mt-0.5">Needs attention</div>
                      </CardContent>
                    </Card>
                    <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200">
                      <CardContent className="p-4">
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Trial Accounts</div>
                        <div className="text-2xl font-bold text-amber-600">{metrics.trialSubscriptions}</div>
                        <div className="text-xs text-gray-500 mt-0.5">Converting = growth</div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Per-Tenant Billing Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-green-600" />
                        Tenant Billing Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 border-b">
                            <tr>
                              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Monthly Fee</th>
                              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Usage ({new Date().toLocaleString('default', { month: 'short' })})</th>
                              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Owed</th>
                              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {(metrics.activeCompanies || companies).filter(c => c.id !== 'companysync_master_001').map(company => {
                              const planFee = (metrics.planPrices || {})[company.subscription_plan] || 0;
                              const companyUsage = thisMonthUsage.filter(u => u.company_id === company.id);
                              const aiCost = companyUsage.reduce((sum, u) => sum + Number(u.total_cost || 0), 0);
                              const totalOwed = planFee + aiCost;
                              const plan = company.subscription_plan || 'trial';
                              const isTrial = plan === 'trial';
                              const isLegacy = plan === 'legacy';
                              const isOverdue = company.subscription_status === 'overdue' || company.payment_status === 'overdue';
                              const isCancelled = company.subscription_status === 'cancelled';
                              
                              const staffCount = allStaffProfiles.filter(s => s.company_id === company.id).length;
                              const lastStaff = allStaffProfiles.filter(s => s.company_id === company.id && s.last_login).sort((a,b) => new Date(b.last_login) - new Date(a.last_login))[0];
                              const daysSinceActive = lastStaff ? Math.floor((new Date() - new Date(lastStaff.last_login)) / (1000 * 60 * 60 * 24)) : null;

                              return (
                                <tr key={company.id} className={`hover:bg-gray-50 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                                  <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900">{company.company_name}</div>
                                    <div className="text-xs text-gray-500">{company.email || company.created_by}</div>
                                    {daysSinceActive !== null && (
                                      <div className="text-xs text-gray-400">{daysSinceActive === 0 ? 'Active today' : `${daysSinceActive}d since active`}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <Badge className={
                                      isTrial ? 'bg-gray-100 text-gray-700' :
                                      isLegacy ? 'bg-green-100 text-green-800' :
                                      plan === 'basic' ? 'bg-blue-100 text-blue-800' :
                                      plan === 'business' ? 'bg-purple-100 text-purple-800' :
                                      plan === 'enterprise' ? 'bg-amber-100 text-amber-800' :
                                      'bg-gray-100 text-gray-700'
                                    }>
                                      {plan}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-3 text-right font-medium">
                                    {isTrial ? <span className="text-gray-400">Free</span> : `$${planFee}`}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    {aiCost > 0 ? (
                                      <span className="text-purple-700 font-medium">${aiCost.toFixed(2)}</span>
                                    ) : (
                                      <span className="text-gray-400">$0.00</span>
                                    )}
                                    {companyUsage.length > 0 && (
                                      <div className="text-xs text-gray-400">{companyUsage.length} events</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right font-bold">
                                    {totalOwed > 0 ? `$${totalOwed.toFixed(2)}` : <span className="text-gray-400">$0</span>}
                                  </td>
                                  <td className="px-4 py-3">
                                    {isOverdue ? (
                                      <Badge className="bg-red-100 text-red-800">⚠ Overdue</Badge>
                                    ) : isCancelled ? (
                                      <Badge className="bg-gray-100 text-gray-600">Cancelled</Badge>
                                    ) : isTrial ? (
                                      <Badge className="bg-amber-100 text-amber-800">Trial</Badge>
                                    ) : (
                                      <Badge className="bg-green-100 text-green-800">✓ Active</Badge>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 text-xs"
                                      onClick={() => { setViewingCompany(company); setViewCompanyDialog(true); }}
                                    >
                                      View
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                            {(metrics.activeCompanies || companies).filter(c => c.id !== 'companysync_master_001').length === 0 && (
                              <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">No tenants found</td>
                              </tr>
                            )}
                          </tbody>
                          <tfoot className="bg-gray-50 border-t-2">
                            <tr>
                              <td colSpan={2} className="px-4 py-3 font-semibold text-gray-700">Totals</td>
                              <td className="px-4 py-3 text-right font-bold text-green-700">${metrics.mrr.toLocaleString()}/mo</td>
                              <td className="px-4 py-3 text-right font-bold text-purple-700">${totalPlatformAIFees.toFixed(2)}</td>
                              <td className="px-4 py-3 text-right font-bold">${(metrics.mrr + totalPlatformAIFees).toFixed(2)}</td>
                              <td colSpan={2}></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Churn Rate */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader><CardTitle className="text-sm font-medium text-gray-600">Churn Rate</CardTitle></CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-gray-900">{metrics.churnRate}%</div>
                        <p className="text-sm text-gray-600 mt-2">Customer churn</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader><CardTitle className="text-sm font-medium text-gray-600">Revenue by Tenant (Paid Invoices)</CardTitle></CardHeader>
                      <CardContent className="p-2">
                        <ResponsiveContainer width="100%" height={120}>
                          <BarChart data={metrics.revenueByCompany.slice(0, 8)} margin={{ top: 5, right: 10, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="company.company_name" angle={-30} textAnchor="end" height={50} tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="totalRevenue" fill="#10b981" name="Revenue" />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Stripe Billing Section */}
                  <Card className="border-violet-200">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <CreditCard className="w-5 h-5 text-violet-600" />
                          Stripe Billing
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => refetchStripe()}>
                            <RefreshCw className="w-3 h-3" /> Refresh
                          </Button>
                          <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer">
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                              <ExternalLink className="w-3 h-3" /> Stripe Dashboard
                            </Button>
                          </a>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {stripeLoading ? (
                        <div className="text-center py-8 text-gray-400">Loading Stripe data...</div>
                      ) : !stripeData ? (
                        <div className="text-center py-8 text-gray-400">
                          <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
                          <p className="font-medium">Could not load Stripe data</p>
                          <p className="text-sm mt-1">Check that Stripe credentials are configured.</p>
                        </div>
                      ) : (
                        <>
                          {/* Stripe Summary Cards */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div className="bg-violet-50 rounded-lg p-3 border border-violet-100">
                              <div className="text-xs text-violet-600 font-medium mb-1">Total Collected</div>
                              <div className="text-xl font-bold text-violet-800">${(stripeData.summary?.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                              <div className="text-xs text-gray-500">All time via Stripe</div>
                            </div>
                            <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                              <div className="text-xs text-green-600 font-medium mb-1">Active Subscriptions</div>
                              <div className="text-xl font-bold text-green-800">{stripeData.summary?.activeSubscriptions || 0}</div>
                              <div className="text-xs text-gray-500">{stripeData.subscriptions?.length || 0} total subs</div>
                            </div>
                            <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                              <div className="text-xs text-blue-600 font-medium mb-1">Stripe Customers</div>
                              <div className="text-xl font-bold text-blue-800">{stripeData.summary?.totalCustomers || 0}</div>
                              <div className="text-xs text-gray-500">In Stripe</div>
                            </div>
                            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                              <div className="text-xs text-emerald-600 font-medium mb-1">Invoices Paid</div>
                              <div className="text-xl font-bold text-emerald-800">{stripeData.summary?.paidInvoices || 0}</div>
                              <div className="text-xs text-gray-500">${Number(stripeData.summary?.paidInvoicesTotal || 0).toFixed(2)} total</div>
                            </div>
                          </div>

                          {/* No data yet */}
                          {(stripeData.subscriptions?.length === 0 && stripeData.invoices?.length === 0) && (
                            <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                              <CreditCard className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                              <p className="text-sm font-medium text-gray-600">No Stripe subscriptions yet</p>
                              <p className="text-xs text-gray-400 mt-1">Subscriptions will appear here once tenants subscribe via Stripe. Payments flow automatically through webhooks.</p>
                              <a href="https://dashboard.stripe.com/products" target="_blank" rel="noreferrer" className="mt-3 inline-block">
                                <Button variant="outline" size="sm" className="gap-1 text-xs">
                                  <ExternalLink className="w-3 h-3" /> Set up Stripe Products
                                </Button>
                              </a>
                            </div>
                          )}

                          {/* Subscriptions table */}
                          {stripeData.subscriptions?.length > 0 && (
                            <div className="mb-4">
                              <div className="text-sm font-semibold text-gray-700 mb-2">Subscriptions</div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-50 border-b">
                                    <tr>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Customer</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Status</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Plan</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Period</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">ID</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {stripeData.subscriptions.map(sub => {
                                      const customer = stripeData.customers?.find(c => c.id === sub.customer);
                                      const planName = sub.items?.data?.[0]?.price?.nickname || sub.metadata?.plan_name || 'Subscription';
                                      const periodEnd = sub.current_period_end ? new Date(Number(sub.current_period_end) * 1000).toLocaleDateString() : '—';
                                      return (
                                        <tr key={sub.id} className="hover:bg-gray-50">
                                          <td className="px-3 py-2">
                                            <div className="font-medium">{customer?.name || customer?.email || sub.customer}</div>
                                            {customer?.email && <div className="text-xs text-gray-400">{customer.email}</div>}
                                          </td>
                                          <td className="px-3 py-2">
                                            <Badge className={sub.status === 'active' ? 'bg-green-100 text-green-800' : sub.status === 'trialing' ? 'bg-blue-100 text-blue-800' : sub.status === 'past_due' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}>
                                              {sub.status}
                                            </Badge>
                                          </td>
                                          <td className="px-3 py-2 capitalize">{planName}</td>
                                          <td className="px-3 py-2 text-xs text-gray-500">Renews {periodEnd}</td>
                                          <td className="px-3 py-2 text-xs font-mono text-gray-400">{sub.id?.slice(0, 18)}…</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Recent invoices */}
                          {stripeData.invoices?.length > 0 && (
                            <div>
                              <div className="text-sm font-semibold text-gray-700 mb-2">Recent Invoices</div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-50 border-b">
                                    <tr>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Customer</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Invoice #</th>
                                      <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Amount</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Status</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Date</th>
                                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Link</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {stripeData.invoices.slice(0, 10).map(inv => (
                                      <tr key={inv.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2">
                                          <div className="font-medium">{inv.customer_name || inv.customer_email || '—'}</div>
                                          {inv.customer_email && inv.customer_name && <div className="text-xs text-gray-400">{inv.customer_email}</div>}
                                        </td>
                                        <td className="px-3 py-2 text-xs font-mono">{inv.number || '—'}</td>
                                        <td className="px-3 py-2 text-right font-semibold">${(Number(inv.amount_paid || inv.total || 0) / 100).toFixed(2)}</td>
                                        <td className="px-3 py-2">
                                          <Badge className={inv.status === 'paid' ? 'bg-green-100 text-green-800' : inv.status === 'open' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}>
                                            {inv.status}
                                          </Badge>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{inv.created ? new Date(Number(inv.created) * 1000).toLocaleDateString() : '—'}</td>
                                        <td className="px-3 py-2">
                                          {inv.hosted_invoice_url ? (
                                            <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700">
                                              <ExternalLink className="w-3 h-3" />
                                            </a>
                                          ) : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </>
              );
            })()}
          </TabsContent>
        </Tabs>

        {/* Company Details Dialog */}
        <Dialog open={viewCompanyDialog} onOpenChange={setViewCompanyDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-2xl">
                <Building2 className="w-6 h-6 text-blue-600" />
                {viewingCompany?.company_name}
              </DialogTitle>
            </DialogHeader>

            {viewingCompany && (
              <div className="space-y-6">
                {/* Quick Stats */}
                <div className="grid grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">Users</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {allStaffProfiles.filter(s => s.company_id === viewingCompany.id).length}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">Customers</div>
                      <div className="text-2xl font-bold text-green-600">
                        {allCustomers.filter(c => c.company_id === viewingCompany.id).length}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">Leads</div>
                      <div className="text-2xl font-bold text-purple-600">
                        {allLeads.filter(l => l.company_id === viewingCompany.id).length}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-600">Revenue</div>
                      <div className="text-2xl font-bold text-green-600">
                        ${allInvoices.filter(i => i.company_id === viewingCompany.id && i.status === 'paid').reduce((sum, i) => sum + Number(i.amount || 0), 0).toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Billing & Subscription */}
                {(() => {
                  const currentMonthStr = new Date().toISOString().slice(0, 7);
                  const companyUsage = allUsage.filter(u => u.company_id === viewingCompany.id && u.usage_month === currentMonthStr);
                  const aiCostThisMonth = companyUsage.reduce((sum, u) => sum + (u.total_cost || 0), 0);
                  const planFees = { trial: 0, basic: 99, business: 199, enterprise: 399, legacy: 199 };
                  const planFee = planFees[viewingCompany.subscription_plan] || 0;
                  const featureBreakdown = {};
                  companyUsage.forEach(u => { featureBreakdown[u.feature] = (featureBreakdown[u.feature] || 0) + (u.total_cost || 0); });

                  return (
                    <Card className="border-blue-200 bg-blue-50/30">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <DollarSign className="w-5 h-5 text-blue-600" />
                          Billing & Subscription
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          <div className="bg-white rounded-lg p-3 border">
                            <div className="text-xs text-gray-500 mb-1">Monthly Plan Fee</div>
                            <div className="text-xl font-bold text-gray-900">{planFee === 0 ? 'Free' : `$${planFee}/mo`}</div>
                            <Badge className={getPlanBadge(viewingCompany.subscription_plan)} style={{ marginTop: 4 }}>
                              {viewingCompany.subscription_plan || 'trial'}
                            </Badge>
                          </div>
                          <div className="bg-white rounded-lg p-3 border">
                            <div className="text-xs text-gray-500 mb-1">AI Usage This Month</div>
                            <div className="text-xl font-bold text-purple-700">${aiCostThisMonth.toFixed(2)}</div>
                            <div className="text-xs text-gray-400">{companyUsage.length} events</div>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-green-200">
                            <div className="text-xs text-gray-500 mb-1">Total Owed This Month</div>
                            <div className="text-xl font-bold text-green-700">${(planFee + aiCostThisMonth).toFixed(2)}</div>
                            <div className="text-xs text-gray-400">Sub + AI usage</div>
                          </div>
                        </div>
                        {Object.keys(featureBreakdown).length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Usage Breakdown</div>
                            <div className="grid grid-cols-3 gap-2">
                              {Object.entries(featureBreakdown).map(([feature, cost]) => (
                                <div key={feature} className="bg-white rounded p-2 border text-center">
                                  <div className="text-xs text-gray-500 capitalize">{feature.replace(/_/g, ' ')}</div>
                                  <div className="font-semibold text-purple-700">${cost.toFixed(2)}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Company Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Company Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-600">Email</div>
                        <div className="font-medium">{viewingCompany.email || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Phone</div>
                        <div className="font-medium">{viewingCompany.phone || 'N/A'}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Plan</div>
                        <Badge className={getPlanBadge(viewingCompany.subscription_plan)}>
                          {viewingCompany.subscription_plan || 'trial'}
                        </Badge>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Status</div>
                        <Badge className={getStatusBadge(viewingCompany.subscription_status)}>
                          {viewingCompany.subscription_status || 'trial'}
                        </Badge>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Created</div>
                        <div className="font-medium">{new Date(viewingCompany.created_date).toLocaleDateString()}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Created By</div>
                        <div className="font-medium">{viewingCompany.created_by}</div>
                      </div>
                      {viewingCompany.trial_ends_at && (
                        <div>
                          <div className="text-sm text-gray-600">Trial Ends</div>
                          <div className="font-medium">{new Date(viewingCompany.trial_ends_at).toLocaleDateString()}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-sm text-gray-600">Setup Completed</div>
                        <Badge className={viewingCompany.setup_completed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                          {viewingCompany.setup_completed ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Team Members */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Team Members</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {allStaffProfiles.filter(s => s.company_id === viewingCompany.id).map(staff => (
                        <div key={staff.id} className="flex items-center justify-between p-2 border rounded-lg">
                          <div>
                            <div className="font-medium">{staff.full_name}</div>
                            <div className="text-sm text-gray-600">{staff.user_email}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={staff.is_administrator ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'}>
                              {staff.is_administrator ? 'Admin' : staff.position || 'Staff'}
                            </Badge>
                            {staff.last_login && (
                              <div className="text-xs text-gray-500">
                                {formatDistanceToNow(new Date(staff.last_login), { addSuffix: true })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Recent Activity */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Recent Invoices</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {allInvoices
                        .filter(i => i.company_id === viewingCompany.id)
                        .slice(0, 5)
                        .map(invoice => (
                          <div key={invoice.id} className="flex items-center justify-between p-2 border-b">
                            <div>
                              <div className="font-medium">{invoice.invoice_number}</div>
                              <div className="text-sm text-gray-600">{invoice.customer_name}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-green-600">${invoice.amount?.toLocaleString()}</div>
                              <Badge className={getStatusBadge(invoice.status)}>
                                {invoice.status || 'draft'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <div className="flex justify-between pt-4">
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setViewingCompany(null);
                      setViewCompanyDialog(false);
                      setSelectedCompany(viewingCompany);
                      setImpersonateDialog(true);
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Shield className="w-4 h-4 mr-2" />
                    Impersonate Company
                  </Button>
                  <Button onClick={() => setViewCompanyDialog(false)}>
                    Close
                  </Button>
                </div>
                
                {/* Diagnostics Section */}
                <div className="mt-6 border-t pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Diagnostics & Health</h3>
                    <Button 
                      onClick={() => runDiagnosticsMutation.mutate(viewingCompany.id)}
                      disabled={runDiagnosticsMutation.isPending}
                      variant="outline"
                      className="gap-2"
                    >
                      <Activity className={`w-4 h-4 ${runDiagnosticsMutation.isPending ? 'animate-spin' : ''}`} />
                      Run Health Check
                    </Button>
                  </div>

                  {diagnosticResult && (
                    <div className="bg-slate-50 border rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-2">
                         <div className={`w-3 h-3 rounded-full ${
                           diagnosticResult.status === 'healthy' ? 'bg-green-500' : 
                           diagnosticResult.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                         }`} />
                         <span className="font-semibold capitalize">{diagnosticResult.status} Status</span>
                      </div>
                      
                      <div className="grid gap-2">
                        {diagnosticResult.checks.map((check, i) => (
                          <div key={i} className="flex items-start gap-3 text-sm p-2 bg-white rounded border">
                            {check.status === 'pass' && <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5" />}
                            {check.status === 'warning' && <AlertCircle className="w-4 h-4 text-yellow-500 mt-0.5" />}
                            {check.status === 'fail' && <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />}
                            {check.status === 'info' && <Shield className="w-4 h-4 text-blue-500 mt-0.5" />}
                            <div>
                              <div className="font-medium">{check.name}</div>
                              <div className="text-gray-600">{check.details}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Company Dialog */}
        <Dialog open={editCompanyDialog} onOpenChange={setEditCompanyDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                Edit Company - {editingCompany?.company_name}
              </DialogTitle>
            </DialogHeader>

            {editingCompany && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="company_name">Company Name</Label>
                    <Input
                      id="company_name"
                      value={editForm.company_name}
                      onChange={(e) => setEditForm({...editForm, company_name: e.target.value})}
                      className="mt-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="email">Company Email</Label>
                    <Input
                      id="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                      className="mt-2"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="company_id">Company ID</Label>
                    <Input
                      id="company_id"
                      value={editingCompany?.id || ''}
                      readOnly
                      className="mt-2 bg-gray-50 text-gray-600 font-mono text-sm cursor-pointer"
                      onClick={() => {
                        navigator.clipboard.writeText(editingCompany?.id || '');
                        toast.success('Company ID copied to clipboard');
                      }}
                      title="Click to copy"
                    />
                    <p className="text-xs text-gray-500 mt-1">Click to copy. This is the unique identifier for this company.</p>
                  </div>
                  <div>
                    <Label htmlFor="subscription_plan">Subscription Plan</Label>
                    <select
                      id="subscription_plan"
                      value={editForm.subscription_plan}
                      onChange={(e) => setEditForm({...editForm, subscription_plan: e.target.value})}
                      className="w-full mt-2 px-3 py-2 border rounded-lg"
                    >
                      <option value="trial">Trial</option>
                      <option value="starter">Starter</option>
                      <option value="professional">Professional</option>
                      <option value="enterprise">Enterprise</option>
                      <option value="legacy">Legacy (Unlimited)</option>
                      <option value="lifetime">Lifetime (Unlimited)</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="subscription_status">Subscription Status</Label>
                    <select
                      id="subscription_status"
                      value={editForm.subscription_status}
                      onChange={(e) => setEditForm({...editForm, subscription_status: e.target.value})}
                      className="w-full mt-2 px-3 py-2 border rounded-lg"
                    >
                      <option value="trial">Trial</option>
                      <option value="active">Active</option>
                      <option value="past_due">Past Due</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="expired">Expired</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>

                  <div>
                    <Label htmlFor="max_users">Max Users</Label>
                    <Input
                      id="max_users"
                      type="number"
                      value={editForm.max_users}
                      onChange={(e) => setEditForm({...editForm, max_users: parseInt(e.target.value)})}
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Set to 9999 for unlimited</p>
                  </div>

                  <div>
                    <Label htmlFor="max_customers">Max Customers</Label>
                    <Input
                      id="max_customers"
                      type="number"
                      value={editForm.max_customers}
                      onChange={(e) => setEditForm({...editForm, max_customers: parseInt(e.target.value)})}
                      className="mt-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Set to 9999 for unlimited</p>
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="trial_ends_at">Trial End Date</Label>
                    <Input
                      id="trial_ends_at"
                      type="date"
                      value={editForm.trial_ends_at}
                      onChange={(e) => setEditForm({...editForm, trial_ends_at: e.target.value})}
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditCompanyDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  updateCompanyMutation.mutate({
                    companyId: editingCompany.id,
                    updates: editForm
                  });
                }}
                disabled={updateCompanyMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {updateCompanyMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Impersonation Dialog */}
        <Dialog open={impersonateDialog} onOpenChange={setImpersonateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-600" />
                Impersonate Company
              </DialogTitle>
            </DialogHeader>

            {selectedCompany && (
              <div className="space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 font-medium mb-2">⚠️ Security Warning</p>
                  <p className="text-xs text-yellow-700">
                    This action will be logged and audited. Use impersonation only for support and troubleshooting purposes.
                  </p>
                </div>

                <div>
                  <p className="text-sm font-medium mb-1">Target Company:</p>
                  <p className="text-lg font-bold text-gray-900">{selectedCompany.company_name}</p>
                  <p className="text-sm text-gray-600">{selectedCompany.email}</p>
                </div>

                <div>
                  <Label htmlFor="reason">Reason for Impersonation *</Label>
                  <Textarea
                    id="reason"
                    placeholder="e.g., Customer reported issue with invoice generation"
                    value={impersonationReason}
                    onChange={(e) => setImpersonationReason(e.target.value)}
                    className="mt-2"
                    rows={3}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setImpersonateDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!impersonationReason.trim()) {
                    toast.error('Please provide a reason for impersonation');
                    return;
                  }
                  startImpersonationMutation.mutate({
                    companyId: selectedCompany.id,
                    companyName: selectedCompany.company_name,
                    reason: impersonationReason
                  });
                }}
                disabled={startImpersonationMutation.isPending || !impersonationReason.trim()}
                className="bg-red-600 hover:bg-red-700"
              >
                {startImpersonationMutation.isPending ? 'Starting...' : 'Start Impersonation'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Audit Results Dialog */}
        <Dialog open={showAuditDialog} onOpenChange={setShowAuditDialog}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Activity className="w-6 h-6 text-indigo-600" />
                Platform Data Isolation Audit
              </DialogTitle>
            </DialogHeader>
            
            {auditResult && (
              <div className="space-y-6 pt-2">
                <div className="flex gap-4">
                  <Card className="flex-1 bg-slate-50">
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-500">Total Companies Scanned</div>
                      <div className="text-2xl font-bold">{auditResult.total_companies}</div>
                    </CardContent>
                  </Card>
                  <Card className="flex-1 bg-slate-50">
                    <CardContent className="p-4">
                      <div className="text-sm text-gray-500">Scan Timestamp</div>
                      <div className="text-sm font-medium">{new Date(auditResult.timestamp).toLocaleString()}</div>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    Orphaned Records (Missing Company ID)
                  </h3>
                  {Object.keys(auditResult.orphaned_records).length === 0 ? (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-800">
                      <CheckCircle2 className="w-5 h-5" />
                      All records are properly linked to companies.
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {Object.entries(auditResult.orphaned_records).map(([entity, stats]) => (
                        <div key={entity} className="flex items-center justify-between p-3 border rounded-lg bg-white">
                          <span className="font-medium">{entity}</span>
                          <div className="flex gap-4">
                            {stats.missing_company_id > 0 && (
                              <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-200">
                                {stats.missing_company_id} Missing ID
                              </Badge>
                            )}
                            {stats.invalid_company_id > 0 && (
                              <Badge variant="destructive" className="bg-orange-100 text-orange-800 hover:bg-orange-200">
                                {stats.invalid_company_id} Invalid ID
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-500" />
                    Cross-Tenant Access Risks
                  </h3>
                  {auditResult.cross_tenant_risks.length === 0 ? (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-800">
                      <CheckCircle2 className="w-5 h-5" />
                      No users found with access to multiple unrelated companies.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {auditResult.cross_tenant_risks.map((risk, idx) => (
                        <Card key={idx} className="border-l-4 border-l-amber-500">
                          <CardContent className="p-4">
                            <div className="font-semibold text-amber-800 mb-1">{risk.type}</div>
                            <p className="text-sm text-gray-600 mb-2">{risk.description}</p>
                            <div className="bg-amber-50 p-2 rounded text-xs font-mono max-h-32 overflow-y-auto">
                              {risk.details.map((d, i) => (
                                <div key={i}>{d.email} ({d.company_count} companies)</div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <DialogFooter>
              <Button onClick={() => setShowAuditDialog(false)}>Close Report</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}