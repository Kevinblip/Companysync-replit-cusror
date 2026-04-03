import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { useImpersonation } from "@/lib/ImpersonationContext";
import { PLATFORM_COMPANY_ID } from "@/lib/constants";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Calendar,
  MessageSquare,
  FileText,
  DollarSign,
  Briefcase,
  Sparkles,
  Settings,
  Bell,
  Search,
  ChevronDown,
  LogOut,
  Bot,
  Clock,
  Activity,
  ShoppingCart,
  UserCircle,
  MapPin,
  Video,
  UserCog,
  Wallet,
  Calculator,
  Mail,
  CreditCard,
  Receipt,
  Layout as LayoutIcon,
  FileSignature,
  Map as MapIcon,
  Headphones,
  ClipboardList,
  BookOpen,
  Wrench,
  BarChart3,
  Plug,
  Shield,
  ArrowLeft,
  Upload,
  Phone,
  MessageCircle,
  Cloud,
  Layers,
  Menu,
  Camera,
  Zap,
  X,
  ChevronRight,
  ChevronLeft,
  Building2,
  Percent,
  Tag,
  Workflow,
  CheckCircle2,
  Palette,
  AlertTriangle,
  RefreshCw,
  Lock,
  Trash2,
  KeyRound,
  PhoneForwarded,
  PhoneOff,
  Radio,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import ProductTour from "@/components/tour/ProductTour";
import TourTrigger from "@/components/tour/TourTrigger";
import HelpWidget from "@/components/help/HelpWidget";
import { HelpCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

import useTranslation from "@/hooks/useTranslation";
import { useLocalSync } from "@/hooks/useLocalSync";
import Dialer from "@/components/communication/Dialer";
import EmailDialog from "@/components/communication/EmailDialog";
import SMSDialog from "@/components/communication/SMSDialog";
import MobileNav from "@/components/MobileNav";
import FloatingActionButton from "@/components/FloatingActionButton";
import ConflictAlertListener from "@/components/ConflictAlertListener";
import { Toaster, toast } from "sonner";
import GoogleMeetButton from "@/components/communication/GoogleMeetButton";
import TrialReminderBanner from "@/components/TrialReminderBanner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { useFeatureRestriction, FeatureRestrictedModal } from "@/components/FeatureRestrictedModal";
import PullToRefresh from "@/components/PullToRefresh";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e) => setMatches(e.matches);
    media.addEventListener('change', listener);
    
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
};

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const SIDEBAR_CACHE_KEY = 'companysync_sidebar_cache';
  const [openMenu, setOpenMenu] = useState(null);
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [editCellPhone, setEditCellPhone] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const queryClient = useQueryClient();
  const { restrictedFeature, setRestrictedFeature, checkFeatureAccess } = useFeatureRestriction();
  const { isOnline, pendingCount, failedCount, isSyncing } = useOfflineStatus();

  const { t } = useTranslation();
  const s = t.sidebar;

  const isMobile = useMediaQuery("(max-width: 768px)");
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) return false;
    return true;
  });
  
  const {
    isImpersonating,
    impersonatedCompanyId: impersonatedId,
    impersonationData,
    startImpersonation,
    stopImpersonation,
  } = useImpersonation();

  useEffect(() => {
    if (user?.email) {
      try { localStorage.setItem('base44_user_email', user.email); } catch(e) {}
    }
  }, [user?.email]);

  const { data: impersonatedCompany } = useQuery({
    queryKey: ['layout-impersonated-company', impersonatedId],
    queryFn: async () => {
      if (!impersonatedId) return null;
      const results = await base44.entities.Company.filter({ id: impersonatedId });
      return results && results.length > 0 ? results[0] : null;
    },
    enabled: !!impersonatedId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: companies = [], isLoading: isLoadingCompanies } = useQuery({
    queryKey: ['layout-companies-list', user?.email], 
    queryFn: async () => {
      if (!user) return [];
      const owned = await base44.entities.Company.filter({ created_by: user.email, is_deleted: { $ne: true } });

      const myProfiles = await base44.entities.StaffProfile.filter({ user_email: user.email });
      const companyIds = myProfiles.map(p => p.company_id).filter(id => id);

      let staffed = [];
      if (companyIds.length > 0) {
         const promises = companyIds.map(id => base44.entities.Company.filter({ id }));
         const results = await Promise.all(promises);
         staffed = results.flat();
      }

      const all = [...owned, ...staffed];

      if (isPlatformAdminCheck(user, null, null)) {
        const allCompanies = await base44.entities.Company.filter({ is_deleted: { $ne: true } });
        for (const c of allCompanies) {
          if (!all.find(existing => existing.id === c.id)) {
            all.push(c);
          }
        }
      }

      const unique = Array.from(new Map(all.map(item => [item.id, item])).values());
      return unique.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
    },
    enabled: !!user,
    initialData: [],
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: staffProfiles = [], isLoading: isLoadingStaffProfiles } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
    staleTime: 2 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const myStaffProfile = useMemo(() => {
    if (!user) return null;
    return staffProfiles.find(s => s.user_email === user.email);
  }, [user, staffProfiles]);

  const displayName = myStaffProfile?.full_name || user?.full_name || 'User';
  const avatarUrl = myStaffProfile?.avatar_url || user?.profile_image_url || null;

  const LAST_USED_KEY = 'last_used_company_id';
  const lastUsedId = impersonatedId || (typeof window !== 'undefined' ? localStorage.getItem(LAST_USED_KEY) : null);

  const cachedSidebar = useMemo(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  const isDataStillLoading = isLoadingCompanies || isLoadingStaffProfiles;

  const myCompany = useMemo(() => {
    if (impersonatedId) {
      if (impersonatedCompany) return impersonatedCompany;
      if (companies.length > 0) {
        const target = companies.find(c => c.id === impersonatedId);
        if (target) return target;
      }
      if (impersonationData) {
        return { id: impersonatedId, company_name: impersonationData.companyName };
      }
      return null;
    }

    if (!user) return null;

    if (lastUsedId) {
      const lastUsed = companies.find(c => c.id === lastUsedId);
      if (lastUsed) return lastUsed;
    }

    const myProfiles = staffProfiles.filter(s => s.user_email === user.email);
    if (myProfiles.length > 0 && myProfiles[0]?.company_id) {
      const profileCompany = companies.find(c => c.id === myProfiles[0].company_id);
      if (profileCompany) return profileCompany;
    }

    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    if (ownedCompanies.length === 0) {
      if (staffProfiles.length === 0) {
        if (isDataStillLoading && cachedSidebar?.company) {
          return cachedSidebar.company;
        }
        return null;
      }
      const staffProfile = staffProfiles[0];
      if (staffProfile?.company_id) {
        return companies.find(c => c.id === staffProfile.company_id);
      }
      return null;
    }

    const sortedByNewest = [...ownedCompanies].sort((a, b) => 
      new Date(b.created_date) - new Date(a.created_date)
    );
    return sortedByNewest[0];
  }, [user, companies, staffProfiles, impersonatedCompany, impersonatedId, impersonationData, lastUsedId, isDataStillLoading, cachedSidebar]);

  const autoProvisionRef = useRef(false);
  const [autoProvisionDone, setAutoProvisionDone] = useState(false);

  useEffect(() => {
    if (!user || isLoadingCompanies || isLoadingStaffProfiles || autoProvisionRef.current || autoProvisionDone) return;
    if (companies.length > 0) {
      if (!autoProvisionDone) setAutoProvisionDone(true);
      return;
    }

    autoProvisionRef.current = true;
    (async () => {
      try {
        const resp = await fetch('/api/local/auto-provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            name: user.name || user.email.split('@')[0],
          }),
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.company?.id) {
            localStorage.setItem('last_used_company_id', result.company.id);
          }
          queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] });
          queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
        }
      } catch (err) {
        console.error('[Layout] Auto-provision failed:', err);
      } finally {
        setAutoProvisionDone(true);
        autoProvisionRef.current = false;
      }
    })();
  }, [user, isLoadingCompanies, isLoadingStaffProfiles, companies.length, autoProvisionDone, queryClient]);

  // Update last_login for the current user (Consolidated duplicated effect)
  useEffect(() => {
    if (myStaffProfile && myStaffProfile.id) {
      const lastLogin = myStaffProfile.last_login ? new Date(myStaffProfile.last_login) : new Date(0);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      if (lastLogin < fiveMinutesAgo) {
        base44.entities.StaffProfile.update(myStaffProfile.id, {
          last_login: new Date().toISOString()
        }).catch(err => console.error("Failed to update last_login", err));
      }
    }
  }, [myStaffProfile]);

  useEffect(() => {
    if (!myCompany?.id || !user?.email) return;
    if (myCompany.created_by !== user.email) return;
    const sessionKey = `admin_flag_cleared_${myCompany.id}`;
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, 'true');
    (async () => {
      try {
        const allProfiles = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
        const ownerEmail = myCompany.created_by;
        let cleared = 0;
        for (const profile of (allProfiles || [])) {
          const profileEmail = profile.user_email || profile.email || '';
          if (profile.is_administrator === true && profileEmail !== ownerEmail) {
            await base44.entities.StaffProfile.update(profile.id, { is_administrator: false });
            cleared++;
            console.log(`[Security] Cleared is_administrator from non-owner: ${profile.full_name || profileEmail}`);
          }
        }
        if (cleared > 0) {
          console.log(`[Security] Auto-cleared is_administrator flag from ${cleared} non-owner staff profile(s)`);
          queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
          queryClient.invalidateQueries({ queryKey: ['company-staff'] });
        }
      } catch (err) {
        console.error('[Security] Failed to auto-clear admin flags:', err);
      }
    })();
  }, [myCompany?.id, user?.email]);

  const { data: userRole = [] } = useQuery({
    queryKey: ['user-role', myStaffProfile?.role_id],
    queryFn: () => myStaffProfile?.role_id ? base44.entities.StaffRole.filter({ id: myStaffProfile.role_id }) : [],
    enabled: !!myStaffProfile?.role_id && !(myCompany?.created_by === user?.email),
    initialData: [],
  });

  const rolePermissions = userRole[0]?.permissions || {};

  const hasPermission = (feature, capability = 'view') => {
    if (user?.platform_role === 'super_admin') return true;
    if (myStaffProfile?.is_super_admin) return true;
    if (myCompany?.created_by === user?.email) return true;
    if (!userRole[0]) return false;

    const rolePermissions = userRole[0]?.permissions || {};

    if (capability === 'view') {
      return rolePermissions[feature]?.view === true || 
             rolePermissions[feature]?.view_own === true || 
             rolePermissions[feature]?.view_global === true;
    }
    if (capability === 'edit') {
      return rolePermissions[feature]?.edit === true || 
             rolePermissions[feature]?.edit_own === true;
    }
    if (capability === 'delete') {
      return rolePermissions[feature]?.delete === true || 
             rolePermissions[feature]?.delete_own === true;
    }
    return rolePermissions[feature]?.[capability] === true;
  };

  useEffect(() => {
    if (myCompany?.id && myStaffProfile) {
      try {
        localStorage.setItem(SIDEBAR_CACHE_KEY, JSON.stringify({
          company: { id: myCompany.id, company_name: myCompany.company_name, company_tagline: myCompany.company_tagline, company_logo: myCompany.company_logo, created_by: myCompany.created_by },
          isAdmin: myCompany?.created_by === user?.email || false,
          isSuperAdmin: myStaffProfile?.is_super_admin || false,
          userEmail: user?.email,
          updatedAt: Date.now(),
        }));
      } catch {}
    }
  }, [myCompany, myStaffProfile, user]);

  // DISABLED: useLocalSync caused infinite duplicate creation loop
  // All data already routes locally via base44Client.js - sync is redundant
  // const localSync = useLocalSync(myCompany?.id);


  // Fetch platform-level restrictions (CompanySync platform only)
  const { data: platformMenuSettings = [] } = useQuery({
    queryKey: ['platform-menu-settings'],
    queryFn: () => base44.entities.PlatformMenuSettings.list(),
    initialData: [],
  });

  const platformRestrictions = platformMenuSettings[0];

  const { data: menuSettings = [] } = useQuery({
    queryKey: ['menu-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.MenuSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentMenuSettings = menuSettings[0];

  const { data: myCompanyHierarchy } = useQuery({
    queryKey: ['company-hierarchy', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return null;
      const response = await base44.functions.invoke('getCompanyHierarchy', { company_id: myCompany.id });
      return response.data;
    },
    enabled: !!myCompany?.id,
  });



  const { data: allCompanyNotifications = [] } = useQuery({
    queryKey: ['notifications', myCompany?.id],
    queryFn: () => (user && myCompany?.id) ? base44.entities.Notification.filter({ 
      company_id: myCompany.id 
    }, "-created_date", 100) : [],
    enabled: !!user && !!myCompany?.id,
    initialData: [],
    refetchInterval: 30000,
  });

  // Show notifications for this user specifically OR company-wide (no user_email = meant for everyone)
  const notifications = React.useMemo(() => {
    if (!user?.email) return [];
    return allCompanyNotifications.filter(n => 
      !n.user_email || n.user_email === user.email
    );
  }, [allCompanyNotifications, user?.email]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Play notification sound when new notifications arrive
  const prevUnreadCountRef = useRef(unreadCount);
  useEffect(() => {
    if (unreadCount > prevUnreadCountRef.current && prevUnreadCountRef.current !== 0) {
      // Play ding sound
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    }
    prevUnreadCountRef.current = unreadCount;
  }, [unreadCount]);

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await base44.entities.Notification.update(notification.id, {
        is_read: true,
        read_at: new Date().toISOString()
      });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }

    if (notification.link_url) {
      navigate(notification.link_url);
      setNotificationsOpen(false);
    }
  };

  const handleMarkAllAsRead = async () => {
    const unreadNotifications = notifications.filter(n => !n.is_read);
    for (const notification of unreadNotifications) {
      await base44.entities.Notification.update(notification.id, {
        is_read: true,
        read_at: new Date().toISOString()
      });
    }
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await base44.functions.invoke('deleteUserAccount', { email: user.email });
      base44.auth.logout();
    } catch (error) {
      console.error("Failed to delete account:", error);
      alert("Failed to delete account. Please try again.");
      setIsDeletingAccount(false);
      setShowDeleteAccountDialog(false);
    }
  };

  const isAvailable = myStaffProfile?.availability_status !== 'unavailable';
  const routingMode = myStaffProfile?.call_routing_mode || 'sarah_answers';

  const routingLabels = {
    sarah_answers: 'Sarah Answers',
    forward_to_cell: 'Forward to Cell',
    sarah_then_transfer: 'Sarah Then Transfer',
  };

  const handleOpenStatusPopover = (open) => {
    if (open && myStaffProfile) {
      setEditCellPhone(myStaffProfile.cell_phone || '');
    }
    setStatusPopoverOpen(open);
  };

  const saveStatusField = async (field, value) => {
    if (!myStaffProfile?.id) return;
    setStatusSaving(true);
    try {
      await base44.entities.StaffProfile.update(myStaffProfile.id, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
    } catch (e) {
      toast.error('Failed to save status');
    } finally {
      setStatusSaving(false);
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'task_assigned': return '📋';
      case 'task_comment': return '💬';
      case 'estimate_created': return '📄';
      case 'estimate_accepted': return '✅';
      case 'invoice_created': return '🧾';
      case 'invoice_paid': return '💰';
      case 'lead_created': return '🎯';
      case 'customer_created': return '👤';
      case 'payment_received': return '💵';
      case 'project_started': return '🚀';
      default: return '🔔';
    }
  };

  const getTimeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return time.toLocaleDateString();
  };

  const defaultNavigationItems = useMemo(() => [
    { id: 'dashboard', title: s.dashboard, url: createPageUrl("Dashboard"), icon: LayoutDashboard, order: 0 },
    
    {
      id: 'ai-tools',
      title: s.aiTools,
      icon: Sparkles,
      order: 1,
      enabled: true,
      submenu: [
        { id: 'ai-estimator', title: s.aiEstimator, url: createPageUrl("AIEstimator"), enabled: true },
        { id: 'lexi', title: s.lexiAssistant, url: createPageUrl("AIAssistant"), enabled: true },
        { id: 'lexi-memory', title: s.lexiMemory, url: createPageUrl("LexiMemory"), enabled: true },
        { id: 'permit-assistant', title: s.permitAssistant, url: createPageUrl("PermitAssistant"), enabled: true },
        { id: 'daily-reports', title: s.dailyReports, url: createPageUrl("DailyReports"), enabled: true },
        { id: 'ai-staff', title: s.aiTeam, url: createPageUrl("AIStaff"), enabled: true },
        { id: 'ai-training', title: s.aiMemory, url: createPageUrl("AITraining"), enabled: true },
        { id: 'video-training', title: s.videoTraining, url: createPageUrl("VideoTrainingGenerator"), enabled: true },
      ]
    },

    {
      id: 'lead-manager',
      title: s.leadManager,
      icon: UserPlus,
      order: 2,
      submenu: [
        { id: 'all-leads', title: s.allLeads, url: createPageUrl("Leads") },
        { id: 'lead-finder', title: s.leadFinder, url: createPageUrl("LeadFinder") },
        { id: 'storm-tracking', title: s.stormTracking, url: createPageUrl("StormTracking") },
      ]
    },

    {
      id: 'sales',
      title: s.sales,
      icon: ShoppingCart,
      order: 3,
      submenu: [
        { id: 'customers', title: s.customers, url: createPageUrl("LocalCustomers") },
        { id: 'sales-dashboard', title: s.salesDashboard, url: createPageUrl("SalesDashboard") },
        { id: 'estimates', title: s.estimates, url: createPageUrl("Estimates") },
        { id: 'proposals', title: s.proposals, url: createPageUrl("Proposals") },
        { id: 'invoices', title: s.invoices, url: createPageUrl("Invoices") },
        { id: 'payments', title: s.payments, url: createPageUrl("Payments") },
        { id: 'items', title: s.itemsPricing, url: createPageUrl("Items") },
        { id: 'commissions', title: s.commissionTracker, url: createPageUrl("CommissionReport") },
        { id: 'family-commissions', title: s.familyCommissions, url: createPageUrl("FamilyCommissions") },
        ]
        },

        {
          id: 'accounting',
          title: s.accounting,
          icon: Wallet,
          order: 3.7,
          submenu: [
            { id: 'accounting-setup', title: s.setupWizard, url: createPageUrl("AccountingSetup") },
            { id: 'accounting-dashboard', title: s.dashboard, url: createPageUrl("AccountingDashboard") },
            { id: 'bills', title: s.billsPayables, url: createPageUrl("Bills") },
            { id: 'transactions', title: s.transactions, url: createPageUrl("Transactions") },
            { id: 'journal-entry', title: s.journalEntry, url: createPageUrl("JournalEntry") },
            { id: 'transfer', title: s.transfer, url: createPageUrl("TransferFunds") },
            { id: 'chart-of-accounts', title: s.chartOfAccounts, url: createPageUrl("ChartOfAccountsPage") },
            { id: 'reconcile', title: s.reconcile, url: createPageUrl("BankReconciliation") },
            { id: 'reports', title: s.reports, url: createPageUrl("AccountingReports") },
            { id: 'expenses', title: s.expenses, url: createPageUrl("Expenses") },
            { id: 'payouts', title: s.payouts, url: createPageUrl("Payouts") },
            { id: 'mapping-rules', title: 'Mapping Rules', url: createPageUrl("MappingRules") },
          ]
          },

    {
      id: 'field-operations',
      title: s.fieldOperations,
      icon: MapPin,
      order: 3.5,
      submenu: [
        { id: 'field-sales-tracker', title: s.fieldSalesTracker, url: createPageUrl("FieldSalesTracker") },
        { id: 'field-rep-app', title: s.workTerritory, url: createPageUrl("FieldRepApp") },
        { id: 'territory-manager', title: s.territoryManager, url: createPageUrl("TerritoryManager") },
        { id: 'build-schedule', title: 'Build Schedule', url: createPageUrl("BuildSchedule") },
      ]
    },

    {
      id: 'operations',
      title: s.operations,
      icon: Briefcase,
      order: 4,
      submenu: [
        { id: 'crewcam-dashboard', title: s.crewcamDashboard, url: createPageUrl("InspectionsDashboard") },
        { id: 'new-crewcam', title: s.newCrewcamJob, url: createPageUrl("NewInspection") },
        { id: 'crewcam-capture', title: s.crewcamCapture, url: createPageUrl("InspectionCapture") },
        { id: 'ai-damage', title: s.aiDamageAnalysis, url: createPageUrl("DroneInspections") },
        { id: 'subcontractors', title: s.subcontractors, url: createPageUrl("Subcontractors") },
        { id: 'tasks', title: s.tasks, url: createPageUrl("Tasks") },
        { id: 'review-requests', title: s.reviewRequests, url: createPageUrl("ReviewRequests") },
        { id: 'reminders', title: s.reminders, url: createPageUrl("Reminders") },
        { id: 'projects', title: s.projects, url: createPageUrl("Projects") },
        { id: 'activity', title: s.activityFeed, url: createPageUrl("Activity") },
      ]
    },
    { id: 'smart-glasses', title: s.smartGlasses, url: createPageUrl("SmartGlassesSetup"), icon: Camera, order: 4.1 },

    { id: 'calendar', title: s.calendar, url: createPageUrl("Calendar"), icon: Calendar, order: 5 },

    {
      id: 'communication',
      title: s.communication,
      icon: MessageSquare,
      order: 13,
      enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || hasPermission('Communication Hub', 'view'),
      submenu: [
        { id: 'live-call-dashboard', title: s.liveCallDashboard, url: createPageUrl("LiveCallDashboard") },
        { id: 'communication-hub', title: s.communicationHub, url: createPageUrl("Communication") },
        { id: 'campaigns', title: s.campaignManager, url: createPageUrl("Campaigns") },
        { id: 'ad-builder', title: s.adBuilder, url: createPageUrl("MarcusMarketing") },
        { id: 'workflow-automation', title: s.workflowAutomation, url: createPageUrl("Workflows") },
        { id: 'ai-dashboard', title: s.aiDashboard, url: createPageUrl("Settings") + '?tab=communications' },
        { id: 'mailbox', title: s.mailbox, url: createPageUrl("Mailbox") },
        { id: 'messages', title: s.messages, url: createPageUrl("Messages") },
        { id: 'zoom', title: s.zoomMeeting, url: createPageUrl("ZoomMeeting") },
      ]
    },
    {
      id: 'documents',
      title: s.documents,
      icon: FileText,
      order: 7,
      submenu: [
        { id: 'all-documents', title: s.allDocuments, url: createPageUrl("Documents") },
        { id: 'contracts', title: s.contracts, url: createPageUrl("Contracts") },
        { id: 'contract-templates', title: s.contractTemplates, url: createPageUrl("ContractTemplates") },
        { id: 'contract-signing', title: s.contractSigning, url: createPageUrl("ContractSigning") },
      ]
    },

    {
      id: 'reports',
      title: s.reports,
      icon: BarChart3,
      order: 8,
      submenu: [
        { id: 'analytics-dashboard', title: s.analytics, url: createPageUrl("Analytics") },
        { id: 'report-builder', title: s.reportBuilder, url: createPageUrl("ReportBuilder") },
        { id: 'sales-reports', title: s.salesReports, url: createPageUrl("Reports") + "?category=sales" },
        { id: 'competitor-analysis', title: s.competitorAnalysis, url: createPageUrl("CompetitorAnalysis") },
      ]
    },

    { id: 'map', title: s.map, url: createPageUrl("Map"), icon: MapIcon, order: 9 },
    { id: 'knowledge-base', title: s.knowledgeBase, url: createPageUrl("KnowledgeBase"), icon: BookOpen, order: 10 },
    { id: 'subscription', title: s.subscription, url: createPageUrl("Pricing"), icon: CreditCard, order: 11 },
    { id: 'feature-comparison', title: s.featureComparison, url: createPageUrl("FeatureComparison"), icon: Layers, order: 11.5 },
    { id: 'coming-soon', title: s.comingSoon, url: createPageUrl("ComingSoon"), icon: Sparkles, order: 12 },
    ], [s]);

  const settingsMenuItems = useMemo(() => {
    const allItems = [
      { id: 'saas-admin', title: s.saasAdmin || 'Platform Admin', url: createPageUrl("SaaSAdminDashboard"), icon: Shield, platformOnly: true },
      { id: 'platform-menu-restrictions', title: s.platformRestrictions, url: createPageUrl("PlatformMenuRestrictions"), icon: Lock, platformOnly: true },
      { id: 'billing-api-keys', title: 'Billing & API Keys', url: createPageUrl("BillingDashboard"), icon: KeyRound, platformOnly: true },
      { id: 'backup-manager', title: s.backupManager, url: createPageUrl("BackupManager"), icon: Shield },
      { id: 'cleanup-restart', title: s.cleanupRestart, url: createPageUrl("CleanupAndRestart"), icon: RefreshCw, platformOnly: true },
      { id: 'feature-comparison', title: s.featureComparison, url: createPageUrl("FeatureComparison"), icon: Layers },
      { id: 'quick-setup', title: s.quickSetup, url: createPageUrl("QuickSetup"), icon: Zap },
      { id: 'launch-checklist', title: s.launchChecklist, url: createPageUrl("LaunchChecklist"), icon: CheckCircle2 },
      { id: 'general-settings', title: s.generalSettings, url: createPageUrl("GeneralSettings"), icon: Settings },
      { id: 'company-setup', title: s.companySetup, url: createPageUrl("CompanySetup"), icon: Building2 },
      { id: 'stripe-connect', title: s.acceptPayments, url: createPageUrl("StripeConnect"), icon: CreditCard },
      { id: 'pdf-branding', title: s.pdfBranding, url: createPageUrl("PDFBranding"), icon: Palette },
      { id: 'report-templates', title: s.reportTemplates, url: createPageUrl("ReportTemplates"), icon: FileText },
      { id: 'staff-management', title: s.staffManagement, url: createPageUrl("StaffManagement"), icon: UserCog },
      { id: 'roles-management', title: s.rolesPermissions, url: createPageUrl("RolesManagement"), icon: Shield },
      { id: 'round-robin', title: s.roundRobin, url: createPageUrl("RoundRobinSettings"), icon: RefreshCw },
      { id: 'templates', title: s.templates, url: createPageUrl("Templates"), icon: FileText },
      { id: 'data-import', title: s.dataImport, url: createPageUrl("DataImport"), icon: Upload },
      { id: 'property-importer', title: s.propertyImporter, url: createPageUrl("PropertyDataImporter"), icon: Upload },
      { id: 'utilities', title: s.utilities, url: createPageUrl("Utilities"), icon: Wrench, platformOnly: true },
      { id: 'one-click-repair', title: s.oneClickRepair, url: createPageUrl("RunRepairs"), icon: Wrench, platformOnly: true },
      { id: 'custom-fields', title: s.customFields, url: createPageUrl("CustomFields"), icon: Layers },
      { id: 'menu-setup', title: s.menuCustomization, url: createPageUrl("MenuSetup"), icon: LayoutIcon },
      { id: 'email-templates', title: s.emailTemplates, url: createPageUrl("EmailTemplates"), icon: Mail },
      { id: 'sms-templates', title: s.smsTemplates, url: createPageUrl("SMSTemplates"), icon: MessageCircle },
      { id: 'api-keys', title: 'API Keys', url: createPageUrl("APIKeysSettings"), icon: KeyRound },
      { id: 'integration-manager', title: s.integrations, url: createPageUrl("IntegrationManager"), icon: Plug },
      { id: 'google-chat', title: s.googleChat, url: createPageUrl("GoogleChatSettings"), icon: MessageCircle },
      { id: 'slack', title: s.slack, url: createPageUrl("SlackSettings"), icon: MessageCircle },
    ];

    const isActualPlatformOwner = !impersonatedId && myCompany?.id === 'companysync_master_001';
    return isActualPlatformOwner ? allItems : allItems.filter(item => !item.platformOnly);
  }, [myCompany, impersonatedId, s]);

  const isSettingsPage = useMemo(() => {
    return settingsMenuItems.some(item => location.pathname === item.url);
  }, [location.pathname, settingsMenuItems]);

  // REMOVED: Auto-opening settings menu based on URL
  // Settings menu now ONLY opens when user explicitly clicks the "Settings" button
  // This ensures sidebar always starts with main menu (Dashboard, AI Tools, etc.)

  const displayNavigationItems = useMemo(() => {
    const baseItems = defaultNavigationItems;

    // Check if this is the platform company (CompanySync) - they bypass platform restrictions
    const isPlatformCompany = myCompany?.id === 'companysync_master_001';

    // 🔒 PLATFORM-LEVEL RESTRICTIONS (CompanySync controls what ALL subscribers see)
    // BUT: Platform companies themselves are NOT affected by these restrictions
    let filteredItems = baseItems.filter(item => {
      // Platform companies bypass platform restrictions - they control via Menu Customization only
      if (isPlatformCompany) return true;
      
      // Check if this item is restricted at platform level
      if (platformRestrictions?.restricted_items) {
        const isRestricted = platformRestrictions.restricted_items.some(r => r.id === item.id);
        if (isRestricted) {
          console.log(`🚫 Platform restriction: Hiding "${item.title}" for all subscribers`);
          return false;
        }
      }
      return true;
    }).map(item => {
      // Platform companies bypass platform restrictions
      if (isPlatformCompany) return item;
      
      // Filter submenu items based on platform restrictions
      if (item.submenu && platformRestrictions?.restricted_submenu_items) {
        const filteredSubmenu = item.submenu.filter(sub => {
          const isRestricted = platformRestrictions.restricted_submenu_items.some(
            r => r.parent_id === item.id && r.submenu_id === sub.id
          );
          if (isRestricted) {
            console.log(`🚫 Platform restriction: Hiding "${item.title} → ${sub.title}" for all subscribers`);
            return false;
          }
          return true;
        });
        return { ...item, submenu: filteredSubmenu };
      }
      return item;
    });

    // 🎯 SUBSCRIPTION-BASED FEATURE GATING
      const isPlatformAdmin = isPlatformAdminCheck(user, myCompany, myStaffProfile);
      const subscriptionPlan = myCompany?.subscription_plan || 'trial';
      // Plan hierarchy: Basic=$59(0), Business=$149(1), Enterprise=$299(2)
      // Trial grants Enterprise-level ACCESS (feature gating only) so users can explore all features
      // Legacy/unlimited/lifetime get full access (level 3)
      const planHierarchy = { trial: 3, basic: 0, freelance: 0, starter: 0, business: 1, professional: 1, enterprise: 2, legacy: 3, unlimited: 3, lifetime: 3 };
      const isInternalUser = user?.email && (
        user.email.toLowerCase().includes('yicn') || 
        user.email.toLowerCase().includes('companysync') || 
        user.email.toLowerCase().includes('insuranceclaimsnetwork') ||
        user.email.toLowerCase() === 'stonekevin866@gmail.com'
      );
      const currentPlanLevel = (isPlatformAdmin || isInternalUser) ? 999 : (planHierarchy[subscriptionPlan] !== undefined ? planHierarchy[subscriptionPlan] : 0);

    // 1. First Filter by Platform-Level Menu Restrictions (Global)
    if (platformRestrictions?.menu_items) {
      filteredItems = filteredItems.filter(item => {
        const platformSetting = platformRestrictions.menu_items.find(mi => mi.id === item.id);
        if (platformSetting?.enabled === false) return false;
        return true;
      }).map(item => {
        if (item.submenu) {
          const platformSetting = platformRestrictions.menu_items.find(mi => mi.id === item.id);
          const platformSubmenu = platformSetting?.submenuItems || platformSetting?.submenu || [];
          if (platformSubmenu.length > 0) {
            return {
              ...item,
              submenu: item.submenu.filter(sub => {
                const subSetting = platformSubmenu.find(s => s.id === sub.id);
                return subSetting?.enabled !== false;
              })
            };
          }
        }
        return item;
      });
    }

    // 2. Filter features by subscription plan
    filteredItems = filteredItems.filter(item => {
      // AI Tools - Business+ only (except basic Lexi)
      if (item.id === 'ai-tools' && currentPlanLevel < 1) {
        // Basic/Trial get limited AI Tools submenu
        return true; // We'll filter submenu items below
      }

      // Field Operations - Business+ only
      if (item.id === 'field-operations' && currentPlanLevel < 1) return false;

      // Reports - Business+ only
      if (item.id === 'reports' && currentPlanLevel < 1) return false;

      // Accounting - Enterprise only
      if (item.id === 'accounting' && currentPlanLevel < 2) return false;

      return true;
    });

    // 🔐 Filter by role permissions (if not admin)
    if (!(myCompany?.created_by === user?.email) && !myStaffProfile?.is_super_admin && userRole[0]) {
      filteredItems = baseItems.map(item => {
        // AI Tools submenu filtering
        if (item.id === 'ai-tools') {
          const submenu = item.submenu?.filter(sub => {
            if (sub.id === 'ai-estimator') return hasPermission('ai_estimator');
            if (sub.id === 'lexi') return hasPermission('lexi_ai');
            if (sub.id === 'lexi-memory') return hasPermission('lexi_ai');
            if (sub.id === 'daily-reports') return hasPermission('lexi_ai');
            if (sub.id === 'ai-staff') return hasPermission('ai_staff');
            return true;
          }) || [];
          
          return submenu.length > 0 ? { ...item, submenu } : null;
        }

        // Lead Manager submenu
        if (item.id === 'lead-manager') {
          if (!hasPermission('leads')) return null;
          
          // First filter by MenuSettings (check both submenuItems and submenu fields)
          let filteredSubmenu = item.submenu || [];
          const customItem = currentMenuSettings?.menu_items?.find(mi => mi.id === 'lead-manager');
          const customSubmenuData = customItem?.submenuItems || customItem?.submenu || [];
          if (customSubmenuData.length > 0) {
            filteredSubmenu = filteredSubmenu.filter(sub => {
              const customSub = customSubmenuData.find(cs => cs.id === sub.id);
              if (!customSub) return true;
              return customSub.enabled !== false;
            });
          }
          
          // Then filter by permissions
          const submenu = filteredSubmenu.filter(sub => {
            if (sub.id === 'storm-tracking') return hasPermission('storm_tracking');
            if (sub.id === 'property-importer') return hasPermission('property_importer');
            if (sub.id === 'lead-finder') return hasPermission('lead_finder');
            return hasPermission('leads');
          }) || [];
          return { ...item, submenu };
        }

        // Sales submenu
        if (item.id === 'sales') {
          const submenu = item.submenu?.filter(sub => {
            if (sub.id === 'customers') return hasPermission('customers');
            if (sub.id === 'estimates') return hasPermission('estimates');
            if (sub.id === 'invoices') return hasPermission('invoices');
            if (sub.id === 'payments') return hasPermission('payments');
            if (sub.id === 'proposals') return hasPermission('proposals');
            if (sub.id === 'items') return hasPermission('items');
            if (sub.id === 'commissions') return hasPermission('commission_report');
            return false;
          }) || [];
          return submenu.length > 0 ? { ...item, submenu } : null;
        }

        // Accounting submenu - show for admins or users with access
        if (item.id === 'accounting') {
          if (myStaffProfile?.is_super_admin || myCompany?.created_by === user?.email) {
            return item;
          }
          // Only show if user has explicit accounting access permission
          if (!myStaffProfile?.can_access_accounting) {
            return null;
          }
          return item;
        }

        // Operations submenu
        if (item.id === 'operations') {
          const submenu = item.submenu?.filter(sub => {
            if (sub.id.includes('crewcam') || sub.id.includes('inspection')) return hasPermission('inspections');
            if (sub.id.includes('drone')) return hasPermission('drone_analysis');
            if (sub.id === 'tasks' || sub.id === 'task-importer') return hasPermission('tasks');
            if (sub.id === 'projects') return hasPermission('projects');
            return true;
          }) || [];
          return submenu.length > 0 ? { ...item, submenu } : null;
        }

        // Communication submenu
        if (item.id === 'communication') {
          if (!hasPermission('communication_hub')) return null;
          const submenu = item.submenu?.filter(sub => {
            if (sub.id === 'campaigns') return hasPermission('campaigns');
            if (sub.id === 'workflow-automation') return hasPermission('workflows');
            if (sub.id === 'mailbox') return hasPermission('mailbox');
            return hasPermission('communication_hub');
          }) || [];
          return { ...item, submenu };
        }

        // Documents submenu
        if (item.id === 'documents') {
          if (!hasPermission('documents')) return null;
          const submenu = item.submenu?.filter(sub => {
            if (sub.id.includes('contract')) return hasPermission('contracts');
            return hasPermission('documents');
          }) || [];
          return { ...item, submenu };
        }

        // Reports submenu
        if (item.id === 'reports') {
          if (!hasPermission('reports')) return null;
          return item;
        }

        // Single pages
        if (item.id === 'calendar') return hasPermission('calendar') ? item : null;
        if (item.id === 'map') return hasPermission('map') ? item : null;
        if (item.id === 'knowledge-base') return hasPermission('knowledge_base') ? item : null;
        if (item.id === 'subscription') return item; // Always show

        return item;
      }).filter(Boolean);
    }

    // Also filter submenu items based on subscription (platform admin gets everything)
    if (!isPlatformAdmin) {
      filteredItems = filteredItems.map(item => {
        if (item.submenu) {
          let filteredSubmenu = [...item.submenu];

          // AI Tools submenu filtering
          if (item.id === 'ai-tools') {
            filteredSubmenu = filteredSubmenu.filter(sub => {
              // Basic/Trial: Only Lexi AI Assistant and basic AI Estimator
              if (currentPlanLevel === 0) {
                return ['lexi', 'ai-estimator'].includes(sub.id);
              }
              // Business: All AI tools except Video Training and Daily Reports
              if (currentPlanLevel === 1) {
                return !['video-training', 'daily-reports', 'permit-assistant'].includes(sub.id);
              }
              // Enterprise: Everything
              return true;
            });
          }

          // Lead Manager submenu filtering
          if (item.id === 'lead-manager') {
            // First apply MenuSettings filtering (check both submenuItems and submenu fields)
            const customItem = currentMenuSettings?.menu_items?.find(mi => mi.id === 'lead-manager');
            const customSubmenuData = customItem?.submenuItems || customItem?.submenu || [];
            if (customSubmenuData.length > 0) {
              filteredSubmenu = filteredSubmenu.filter(sub => {
                const customSub = customSubmenuData.find(cs => cs.id === sub.id);
                if (!customSub) return true;
                return customSub.enabled !== false;
              });
            }
            // Then apply subscription filtering
            filteredSubmenu = filteredSubmenu.filter(sub => {
              // Storm Tracking - Business+ only
              if (sub.id === 'storm-tracking' && currentPlanLevel < 1) return false;
              // Lead Finder - Business+ only
              if (sub.id === 'lead-finder' && currentPlanLevel < 1) return false;
              // Lead Inspections - Business+ only
              if (sub.id === 'lead-inspections' && currentPlanLevel < 1) return false;
              return true;
            });
          }

          // Sales submenu filtering
          if (item.id === 'sales') {
            filteredSubmenu = filteredSubmenu.filter(sub => {
              // Commission tracking - Business+ only
              if ((sub.id === 'commissions' || sub.id === 'family-commissions') && currentPlanLevel < 1) return false;
              return true;
            });
          }

          // Operations submenu filtering
          if (item.id === 'operations') {
            filteredSubmenu = filteredSubmenu.filter(sub => {
              // AI Damage Analysis - Business+ only
              if (sub.id === 'ai-damage' && currentPlanLevel < 1) return false;
              // Subcontractors - Enterprise only
              if (sub.id === 'subcontractors' && currentPlanLevel < 2) return false;
              // Review Requests - Business+ only
              if (sub.id === 'review-requests' && currentPlanLevel < 1) return false;
              return true;
            });
          }

          // Communication submenu filtering
          if (item.id === 'communication') {
            filteredSubmenu = filteredSubmenu.filter(sub => {
              // Campaigns - Business+ only
              if (sub.id === 'campaigns' && currentPlanLevel < 1) return false;
              // Workflow Automation - Business+ only
              if (sub.id === 'workflow-automation' && currentPlanLevel < 1) return false;
              // Live Call Dashboard - Business+ only
              if (sub.id === 'live-call-dashboard' && currentPlanLevel < 1) return false;
              return true;
            });
          }

          // Documents submenu filtering
          if (item.id === 'documents') {
            filteredSubmenu = filteredSubmenu.filter(sub => {
              // Contract signing - Business+ only
              if (sub.id.includes('contract') && currentPlanLevel < 1) return false;
              return true;
            });
          }

          return { ...item, submenu: filteredSubmenu };
        }
        return item;
      });
    }

    if (!currentMenuSettings?.menu_items) {
      return filteredItems.sort((a, b) => a.order - b.order);
    }

    const customItems = currentMenuSettings.menu_items;
    
    return filteredItems
      .map(defaultItem => {
        const customItem = customItems.find(item => item.id === defaultItem.id);
        
        if (defaultItem.id === 'ai-tools') {
          // Check if item is disabled in menu settings
          if (customItem?.enabled === false) {
            return null;
          }

          const item = {
            ...defaultItem,
            order: customItem?.order ?? defaultItem.order,
            enabled: customItem?.enabled ?? true,
          };
          // Filter submenu items based on enabled status from MenuSettings
          if (item.submenu && customItem?.submenuItems) {
            item.submenu = item.submenu.filter(sub => {
              const customSub = customItem.submenuItems.find(cs => cs.id === sub.id);
              // If no custom setting for this sub, show it by default
              if (!customSub) return true;
              return customSub.enabled !== false;
            });
          }
          return item;
        }

        if (defaultItem.id === 'operations') {
          // Check if item is disabled in menu settings
          if (customItem?.enabled === false) {
            return null;
          }

          const item = {
            ...defaultItem,
            order: customItem?.order ?? defaultItem.order,
            enabled: customItem?.enabled ?? true,
          };
          // Filter submenu items based on enabled status from MenuSettings (check both submenuItems and submenu)
          const customSubmenuData = customItem?.submenuItems || customItem?.submenu || [];
          if (item.submenu && customSubmenuData.length > 0) {
            item.submenu = item.submenu.filter(sub => {
              const customSub = customSubmenuData.find(cs => cs.id === sub.id);
              if (!customSub) return true;
              return customSub.enabled !== false;
            });
          }
          return item;
        }

        if (defaultItem.id === 'accounting') {
          // Always show Accounting for admins, check permissions for others
          if (customItem?.enabled === false) {
            return null;
          }

          return {
            ...defaultItem,
            order: customItem?.order ?? defaultItem.order,
            enabled: customItem?.enabled ?? true,
          };
        }

        if (defaultItem.id === 'subscription') {
          // Check if item is disabled in menu settings
          if (customItem?.enabled === false) {
            return null;
          }

          return {
            ...defaultItem,
            order: customItem?.order ?? defaultItem.order,
            enabled: customItem?.enabled ?? true,
          };
        }
        
        // Check if item is disabled
        if (customItem && customItem.enabled === false) {
          return null;
        }

        // If no custom item found, show the default item
        if (!customItem) {
          return defaultItem;
        }

        const item = {
          ...defaultItem,
          order: customItem.order ?? defaultItem.order,
          enabled: customItem.enabled ?? true,
        };

        // Filter submenu items based on MenuSettings
        if (item.submenu && customItem?.submenuItems) {
          item.submenu = item.submenu.filter(sub => {
            const customSub = customItem.submenuItems.find(cs => cs.id === sub.id);
            // If customSub doesn't exist, show it (default behavior)
            // If customSub exists, only show if enabled is not explicitly false
            if (!customSub) return true;
            return customSub.enabled !== false;
          });
        }

        return item;
        })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }, [currentMenuSettings, platformRestrictions, defaultNavigationItems, myStaffProfile, userRole, myCompany?.subscription_plan]);

  useEffect(() => {
    const currentMenuItem = displayNavigationItems.find(item => {
      if (item.url === location.pathname) return true;
      if (item.submenu) {
        return item.submenu.some(sub => 
          sub.url === location.pathname || 
          sub.url === location.pathname + location.search
        );
      }
      return false;
    });

    if (currentMenuItem && currentMenuItem.submenu) {
      setOpenMenu(currentMenuItem.title);
    } else {
      setOpenMenu(null);
    }
  }, [location.pathname, location.search, displayNavigationItems]);

  const toggleMenu = (title) => {
    setOpenMenu(prev => prev === title ? null : title);
  };

  const handleBack = () => {
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate(createPageUrl("Dashboard"));
    }
  };

  const handleMobileMenuClick = () => {
    setSidebarOpen(prev => !prev);
  };



  const isPlatformOwner = isPlatformAdminCheck(user, myCompany, myStaffProfile);
  const subscriptionPlan = myCompany?.subscription_plan || 'trial';
  // Trial grants full access (Enterprise level) to let users explore all features
  const planHierarchy = { trial: 3, basic: 0, freelance: 0, starter: 0, business: 1, professional: 1, enterprise: 2, legacy: 3, unlimited: 3, lifetime: 3 };
  const isYICNOrInternal = user?.email && (
    user.email.toLowerCase().includes('yicn') || 
    user.email.toLowerCase().includes('companysync') || 
    user.email.toLowerCase().includes('insuranceclaimsnetwork') ||
    user.email.toLowerCase() === 'stonekevin866@gmail.com'
  );
  const currentPlanLevel = (isPlatformOwner || isYICNOrInternal) ? 999 : (planHierarchy[subscriptionPlan] !== undefined ? planHierarchy[subscriptionPlan] : 0);

  const handleNavigationClick = (e, url, featureId) => {
    e.preventDefault();
    e.stopPropagation();

    if (featureId && !checkFeatureAccess(featureId, currentPlanLevel, isPlatformOwner, user?.email)) {
      return;
    }

    setOpenMenu(null);
    setShowSettingsMenu(false);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) setSidebarOpen(false);
    navigate(url);
  };

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, isMobile]);

  // 🔧 Smart duplicate detection for SaaS
  const showDuplicateWarning = useMemo(() => {
    if (location.pathname === createPageUrl('Utilities')) return false;
    if (!user) return false;
    
    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    if (ownedCompanies.length <= 1) return false;
    
    // Check for ACTUAL duplicates (same name, created within 1 hour)
    const duplicates = ownedCompanies.filter((c1, idx) => {
      return ownedCompanies.some((c2, idx2) => {
        if (idx >= idx2) return false;
        const sameNameOrSimilar = c1.company_name?.toLowerCase().trim() === c2.company_name?.toLowerCase().trim();
        const createdClose = Math.abs(new Date(c1.created_date) - new Date(c2.created_date)) < 3600000; // 1 hour
        return sameNameOrSimilar && createdClose;
      });
    });
    
    return duplicates.length > 0;
  }, [companies, user, location.pathname]);

  // 🔒 SECURITY: Exclude customer-facing public pages from Layout
  const isPublicPage = currentPageName === 'sign-contract-customer' || 
                       location.pathname.includes('sign-contract-customer') ||
                       currentPageName === 'TrainingVideoPlayer' ||
                       location.pathname.includes('TrainingVideoPlayer') ||
                       currentPageName === 'ViewEstimate' ||
                       location.pathname.toLowerCase().includes('viewestimate') ||
                       currentPageName === 'BetaQuestionnaire' ||
                       location.pathname.includes('BetaQuestionnaire') ||
                       currentPageName === 'CustomerPortalPublic' ||
                       location.pathname.includes('CustomerPortalPublic');

  if (isPublicPage) {
    return <>{children}</>;
  }

  // QuickSetup redirect handled by Dashboard for new users only

  // Removed cloned/staging badge logic

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <Toaster richColors position="top-right" />
      <ConflictAlertListener user={user} notifications={notifications} />
      <ImpersonationBanner />

      <style>{`
        :root {
          --sat: env(safe-area-inset-top);
          --sar: env(safe-area-inset-right);
          --sab: env(safe-area-inset-bottom);
          --sal: env(safe-area-inset-left);
        }

        header {
          padding-top: max(12px, var(--sat));
          padding-left: max(16px, var(--sal));
          padding-right: max(16px, var(--sar));
        }

        [data-sidebar="sidebar"] {
          background: linear-gradient(180deg, #1e3a8a 0%, #1e40af 50%, #7c3aed 100%) !important;
        }
        
        [data-sidebar="sidebar"] > div:last-child {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        
        [data-sidebar="sidebar"] .sidebar-content-wrapper {
          flex: 1;
          min-height: 0;
          height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }
        
        @media (max-width: 768px) {
          main > div {
            padding-bottom: 4rem !important;
          }

          input, textarea, select {
            font-size: 16px !important;
          }
        }
      `}</style>
      <div className="min-h-screen flex w-full bg-background">
        <Sidebar className="border-r border-blue-700">
          <SidebarHeader className="p-6 border-b border-blue-700 flex-shrink-0">
            {showSettingsMenu ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="w-6 h-6 text-white" />
                  <h2 className="font-bold text-white text-lg">Setup</h2>
                </div>
                <button 
                  onClick={() => setShowSettingsMenu(false)} 
                  className="text-white hover:bg-white/10 p-2 rounded-lg transition-colors"
                  title="Back to main menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-3 w-full hover:bg-white/10 p-2 rounded-lg transition-colors text-left group">
                    {myCompany?.logo_url ? (
                      <img 
                        src={myCompany.logo_url} 
                        alt={myCompany.company_name || "Company Logo"} 
                        className="w-10 h-10 rounded-lg object-cover bg-white p-1 flex-shrink-0"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div className="w-10 h-10 bg-white rounded-lg items-center justify-center flex-shrink-0 text-blue-700 font-bold text-sm"
                      style={{ display: myCompany?.logo_url ? 'none' : 'flex' }}>
                      {(myCompany?.company_name || 'CS').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-white text-lg truncate flex items-center gap-2">
                        {myCompany?.company_name || "CompanySync"}
                        <ChevronDown className="w-4 h-4 opacity-50 group-hover:opacity-100" />
                      </h2>
                      <p className="text-xs text-blue-200 truncate">
                        {myCompany?.company_tagline || "Smart Business Management"}
                      </p>
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="start">
                  {myCompanyHierarchy?.parent && (
                    <>
                      <DropdownMenuItem onClick={() => {
                        startImpersonation({
                          companyId: myCompanyHierarchy.parent.id,
                          companyName: myCompanyHierarchy.parent.company_name,
                          adminEmail: user?.email,
                        });
                        localStorage.setItem('last_used_company_id', myCompanyHierarchy.parent.id);
                        window.location.reload();
                      }}>
                        <Building2 className="w-4 h-4 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-medium">{myCompanyHierarchy.parent.company_name}</span>
                          <span className="text-xs text-muted-foreground">Parent Company</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  
                  {/* Platform Admin Quick Switch */}
                  {myCompany?.id === 'companysync_master_001' && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Platform Administration
                      </div>
                      <DropdownMenuItem onClick={() => navigate(createPageUrl('SaaSAdminDashboard'))}>
                        <LayoutDashboard className="w-4 h-4 mr-2" />
                        <span>SaaS Admin Panel</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}

                  {/* Company Switcher */}
                  {user && companies.length > 1 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Switch Company
                      </div>
                      {companies
                        .filter(c => c.id !== myCompany?.id)
                        .sort((a, b) => {
                          if (a.id === 'companysync_master_001') return -1;
                          if (b.id === 'companysync_master_001') return 1;
                          return 0;
                        })
                        .map(c => {
                          const isPlatform = c.id === 'companysync_master_001';
                          const isYICN = c.id === 'yicn_roofing_001' || c.company_name?.toLowerCase().includes('yicn');
                          return (
                            <DropdownMenuItem key={c.id} className="cursor-pointer" onClick={() => {
                              if (isPlatform) {
                                stopImpersonation();
                                localStorage.removeItem('last_used_company_id');
                                window.location.href = createPageUrl('Dashboard');
                              } else {
                                localStorage.setItem('last_used_company_id', c.id);
                                startImpersonation({
                                  companyId: c.id,
                                  companyName: c.company_name,
                                  adminEmail: user?.email,
                                });
                                window.location.reload();
                              }
                            }}>
                              <Building2 className={`w-4 h-4 mr-2 ${isPlatform ? 'text-blue-500' : isYICN ? 'text-green-600' : ''}`} />
                              <div className="flex flex-col">
                                <span className={isPlatform || isYICN ? 'font-bold' : ''}>{c.company_name}</span>
                                {isPlatform && <span className="text-xs text-blue-600">Platform Home</span>}
                                {isYICN && <span className="text-xs text-green-700">Premium Tenant</span>}
                              </div>
                            </DropdownMenuItem>
                          );
                        })
                      }
                      <DropdownMenuSeparator />
                    </>
                  )}

                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Current Location
                  </div>
                  <DropdownMenuItem disabled className="bg-accent">
                    <span className="font-medium">{myCompany?.company_name}</span>
                  </DropdownMenuItem>

                  {myCompanyHierarchy?.children && myCompanyHierarchy.children.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Child Locations
                      </div>
                      <ScrollArea className="h-[200px]">
                        {myCompanyHierarchy.children.map(child => (
                          <DropdownMenuItem key={child.id} onClick={() => {
                            startImpersonation({
                              companyId: child.id,
                              companyName: child.company_name,
                              adminEmail: user?.email,
                            });
                            localStorage.setItem('last_used_company_id', child.id);
                            window.location.reload();
                          }}>
                            <MapPin className="w-4 h-4 mr-2" />
                            <span>{child.company_name}</span>
                          </DropdownMenuItem>
                        ))}
                      </ScrollArea>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </SidebarHeader>

          {!isOnline && (
            <div className="mx-3 mt-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-md flex items-center gap-2" data-testid="offline-banner">
              <Cloud className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-400 font-medium">Offline Mode</span>
              {pendingCount > 0 && (
                <span className="ml-auto text-xs text-amber-300">{pendingCount} pending</span>
              )}
            </div>
          )}
          {isOnline && isSyncing && (
            <div className="mx-3 mt-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-md flex items-center gap-2" data-testid="syncing-banner">
              <Cloud className="w-4 h-4 text-blue-400 animate-pulse flex-shrink-0" />
              <span className="text-xs text-blue-300 font-medium">Syncing {pendingCount} items...</span>
            </div>
          )}
          {isOnline && !isSyncing && pendingCount > 0 && (
            <div className="mx-3 mt-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-md flex items-center gap-2" data-testid="pending-sync-banner">
              <Cloud className="w-4 h-4 text-green-400 flex-shrink-0" />
              <span className="text-xs text-green-300 font-medium">{pendingCount} items to sync</span>
            </div>
          )}

          <div className="sidebar-content-wrapper">
              <SidebarContent className="p-3 pb-8">


              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {!showSettingsMenu ? (
                      <>
                        {displayNavigationItems.map((item) => (
                          <SidebarMenuItem key={item.id} id={`menu-item-${item.id}`}>
                            {item.submenu ? (
                              <Collapsible open={openMenu === item.title} onOpenChange={() => {
                                toggleMenu(item.title);
                                // Auto-close on mobile when opening submenu
                                if (typeof window !== 'undefined') {
                                  const narrow = window.matchMedia('(max-width: 1024px)').matches;
                                  if (narrow && openMenu !== item.title) {
                                    // Closing submenu on mobile - close sidebar
                                    setTimeout(() => setSidebarOpen(false), 300);
                                  }
                                }
                              }}>
                                <CollapsibleTrigger asChild>
                                  <SidebarMenuButton
                                    className="hover:bg-white/10 text-white transition-all duration-200 rounded-lg mb-1 w-full justify-between min-h-[44px]"
                                  >
                                    <div className="flex items-center gap-3">
                                      {item.icon && <item.icon className="w-5 h-5" />}
                                      <span className="font-medium">{item.title}</span>
                                    </div>
                                    <ChevronDown className={`w-4 h-4 transition-transform ${openMenu === item.title ? 'rotate-180' : ''}`} />
                                  </SidebarMenuButton>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="ml-8 mt-1 space-y-1">
                                  {item.submenu.map((subitem) => (
                                    <SidebarMenuButton
                                      key={subitem.id}
                                      id={`menu-item-${subitem.id}`}
                                      asChild
                                      className={`hover:bg-white/10 text-white text-sm transition-all duration-200 rounded-lg min-h-[44px] ${
                                        location.pathname + location.search === subitem.url ? 'bg-white/20' : ''
                                      }`}
                                    >
                                      <Link 
                                        to={subitem.url} 
                                        className="flex items-center gap-3 px-3 py-2" 
                                        onClick={(e) => handleNavigationClick(e, subitem.url, subitem.id)}
                                      >
                                        <span>{subitem.title}</span>
                                      </Link>
                                    </SidebarMenuButton>
                                  ))}
                                </CollapsibleContent>
                              </Collapsible>
                            ) : (
                              <SidebarMenuButton
                                asChild
                                className={`hover:bg-white/10 text-white transition-all duration-200 rounded-lg mb-1 min-h-[44px] ${
                                  location.pathname === item.url ? 'bg-white/20 shadow-lg' : ''
                                }`}
                              >
                                <Link 
                                  to={item.url} 
                                  className="flex items-center gap-3 px-3 py-3" 
                                  onClick={(e) => handleNavigationClick(e, item.url)}
                                >
                                  {item.icon && <item.icon className="w-5 h-5" />}
                                  <span className="font-medium">{item.title}</span>
                                </Link>
                              </SidebarMenuButton>
                            )}
                          </SidebarMenuItem>
                        ))}

                        {(myCompany?.created_by === user?.email || user?.platform_role === 'super_admin' || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || (isDataStillLoading && cachedSidebar?.userEmail === user?.email && (cachedSidebar?.isAdmin || cachedSidebar?.isSuperAdmin || cachedSidebar?.company?.created_by === user?.email))) && (
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              onClick={() => setShowSettingsMenu(true)}
                              className="hover:bg-white/10 text-white transition-all duration-200 rounded-lg mb-1 min-h-[44px] w-full justify-between bg-gradient-to-r from-purple-600/30 to-blue-600/30"
                            >
                              <div className="flex items-center gap-3">
                                <Settings className="w-5 h-5" />
                                <span className="font-medium">Settings</span>
                              </div>
                              <ChevronRight className="w-4 h-4" />
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )}
                      </>
                    ) : (
                      <>
                        {settingsMenuItems.map(item => (
                          <SidebarMenuItem key={item.id}>
                            <SidebarMenuButton
                              asChild
                              className={`hover:bg-white/10 text-white transition-all duration-200 rounded-lg mb-1 min-h-[44px] ${
                                location.pathname === item.url ? 'bg-white/20 shadow-lg' : ''
                              }`}
                            >
                              <Link 
                                to={item.url} 
                                className="flex items-center gap-3 px-3 py-3"
                                onClick={(e) => handleNavigationClick(e, item.url, item.id)}
                              >
                                <item.icon className="w-5 h-5" />
                                <span className="font-medium">{item.title}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                      </>
                    )}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </div>
        </Sidebar>

        <main className="flex-1 flex flex-col" style={{ marginTop: isImpersonating ? '60px' : '0' }}>
          <header className="bg-gradient-to-r from-blue-600 via-blue-500 to-purple-600 border-b border-blue-400 px-4 md:px-6 pt-12 pb-3 md:py-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 md:gap-4">
                <SidebarTrigger className="text-white hover:bg-white/10 p-2 rounded-lg transition-colors duration-200" />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="text-white hover:bg-white/10 flex items-center gap-2 min-h-[44px]"
                  type="button"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden md:inline">Back</span>
                </Button>


              </div>

              <div className="flex items-center gap-1 md:gap-2">
                <GoogleMeetButton companyId={myCompany?.id} />

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px]"
                  onClick={() => setShowDialer(true)}
                  title="Make a call"
                >
                  <Phone className="w-5 h-5" />
                </Button>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px]"
                  onClick={() => setShowEmailDialog(true)}
                  title="Send email"
                >
                  <Mail className="w-5 h-5" />
                </Button>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px]"
                  onClick={() => setShowSMSDialog(true)}
                  title="Send SMS"
                >
                  <MessageCircle className="w-5 h-5" />
                </Button>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px]"
                  onClick={() => setShowHelp(true)}
                  title="Help Center"
                >
                  <HelpCircle className="w-5 h-5" />
                </Button>

                {myStaffProfile && (
                  <Popover open={statusPopoverOpen} onOpenChange={handleOpenStatusPopover}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="button-status-bar"
                        className="text-white hover:bg-white/10 min-h-[44px] flex items-center gap-1.5 px-2"
                        title="My call status & routing"
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isAvailable ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="hidden lg:inline text-xs font-medium">
                          {isAvailable ? routingLabels[routingMode] || 'Available' : 'Unavailable'}
                        </span>
                        <PhoneForwarded className="w-4 h-4 lg:hidden" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-4" align="end">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-sm">My Call Status</p>
                            <p className="text-xs text-muted-foreground">{myStaffProfile.full_name}</p>
                          </div>
                          <div className={`w-2.5 h-2.5 rounded-full ${isAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
                        </div>

                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium">Available</p>
                            <p className="text-xs text-muted-foreground">Calls follow routing rules below</p>
                          </div>
                          <Switch
                            data-testid="switch-availability"
                            checked={isAvailable}
                            disabled={statusSaving}
                            onCheckedChange={(checked) =>
                              saveStatusField('availability_status', checked ? 'available' : 'unavailable')
                            }
                          />
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">Call Routing</p>
                          <Select
                            value={routingMode}
                            disabled={statusSaving || !isAvailable}
                            onValueChange={(val) => saveStatusField('call_routing_mode', val)}
                          >
                            <SelectTrigger data-testid="select-routing-mode" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="forward_to_cell">📲 Forward to Cell Phone</SelectItem>
                              <SelectItem value="sarah_answers">🤖 Sarah Answers All</SelectItem>
                              <SelectItem value="sarah_then_transfer">🔀 Sarah Then Transfer</SelectItem>
                            </SelectContent>
                          </Select>
                          {routingMode === 'forward_to_cell' && (
                            <p className="text-xs text-muted-foreground">Your cell rings first (~4 rings). If you don't answer, Sarah takes over.</p>
                          )}
                          {routingMode === 'sarah_answers' && (
                            <p className="text-xs text-muted-foreground">Sarah handles all calls. You'll get a notification after.</p>
                          )}
                          {routingMode === 'sarah_then_transfer' && (
                            <p className="text-xs text-muted-foreground">Sarah answers, gathers info, then transfers to you.</p>
                          )}
                        </div>

                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">Personal Cell Phone</p>
                          <p className="text-xs text-muted-foreground">Calls forward here. Also receives missed call & text alerts.</p>
                          <div className="flex gap-2">
                            <Input
                              data-testid="input-cell-phone"
                              value={editCellPhone}
                              onChange={(e) => setEditCellPhone(e.target.value)}
                              placeholder="+1 (216) 555-0000"
                              className="flex-1 text-sm"
                            />
                            <Button
                              size="sm"
                              disabled={statusSaving || editCellPhone === (myStaffProfile.cell_phone || '')}
                              onClick={() => saveStatusField('cell_phone', editCellPhone)}
                              data-testid="button-save-cell"
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                <div className="w-px h-6 bg-white/20 mx-1 md:mx-2 hidden md:block"></div>

                <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px] relative"
                      title="Notifications"
                    >
                      <Bell className="w-5 h-5" />
                      {unreadCount > 0 && (
                        <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 bg-red-500 text-white text-xs">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 p-0" align="end">
                    <div className="flex items-center justify-between p-4 border-b">
                      <h3 className="font-semibold text-lg">Notifications</h3>
                      {unreadCount > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={handleMarkAllAsRead}
                          className="text-xs"
                        >
                          Mark all as read
                        </Button>
                      )}
                    </div>
                    <ScrollArea className="h-[400px]">
                      {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                          <Bell className="w-12 h-12 mb-3 text-gray-300" />
                          <p className="text-sm font-medium">No notifications yet</p>
                          <p className="text-xs mt-1">We'll notify you when something important happens</p>
                        </div>
                      ) : (
                        <div className="divide-y">
                          {notifications
                            .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
                            .map((notification) => (
                              <div
                                key={notification.id}
                                onClick={() => handleNotificationClick(notification)}
                                className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                                  !notification.is_read ? 'bg-blue-50' : ''
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="text-2xl flex-shrink-0">
                                    {getNotificationIcon(notification.type)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1">
                                        <p className={`text-sm ${!notification.is_read ? 'font-semibold' : 'font-medium'}`}>
                                          {notification.title}
                                        </p>
                                        <p className="text-xs text-gray-600 mt-1">
                                          {notification.message}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-2">
                                          {getTimeAgo(notification.created_date)}
                                        </p>
                                      </div>
                                      {!notification.is_read && (
                                        <div className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 mt-1.5"></div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </ScrollArea>
                  </PopoverContent>
                </Popover>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="text-white hover:bg-white/10 flex items-center gap-2 min-h-[44px]">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-white flex items-center justify-center flex-shrink-0">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-blue-600 font-semibold text-sm">{displayName?.[0] || 'U'}</span>
                        )}
                      </div>
                      <span className="hidden md:inline font-medium">{displayName}</span>
                      <ChevronDown className="w-4 h-4 hidden md:block" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">

                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        base44.auth.logout();
                      }}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <div className="px-4 md:px-6 pt-4">
            <TrialReminderBanner user={user} myCompany={myCompany} />
          </div>

          {showDuplicateWarning && (
            <Alert className="mx-6 mt-4 bg-red-50 border-red-300">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <strong>⚠️ Data Issue Detected:</strong> We detected multiple company profiles created by you, which may cause data visibility problems.
                {' '}
                <Button
                  variant="link"
                  className="text-red-600 underline p-0 h-auto"
                  onClick={() => navigate(createPageUrl('Utilities'))}
                >
                  Go to Utilities → Company Cleanup
                </Button>
                {' '}to fix this now.
              </AlertDescription>
            </Alert>
          )}

          {!isMobile && (
            <div className="flex-1 overflow-auto overflow-x-hidden relative">
              {children}
            </div>
          )}
          
          {isMobile && (
            <>
              <div className="flex-1 overflow-auto overflow-x-hidden relative pb-24 z-[1]">
                {children}
              </div>
              <MobileNav allNavItems={displayNavigationItems} user={user} company={myCompany} />
              <FloatingActionButton />
            </>
          )}
        </main>
      </div>

      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        companyId={myCompany?.id}
      />
      
      <TourTrigger
        onStartTour={() => setShowTour(true)}
        myCompany={myCompany}
        myStaffProfile={myStaffProfile}
      />
      <ProductTour isOpen={showTour} onClose={() => setShowTour(false)} />

      <HelpWidget
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        onStartTour={() => { setShowHelp(false); setShowTour(true); }}
        myCompany={myCompany}
        myStaffProfile={myStaffProfile}
      />

      <FeatureRestrictedModal 
        restrictedFeature={restrictedFeature} 
        onClose={() => setRestrictedFeature(null)} 
      />


      </SidebarProvider>
      );
      }