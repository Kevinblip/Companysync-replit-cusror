import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
function isCompanyNotificationQuietTime(company, now = new Date()) {
  const quiet = company?.settings?.notification_quiet_hours;
  if (quiet?.enabled !== true) return false;
  const timezone = company?.timezone || company?.settings?.time_zone || 'America/New_York';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = value => {
    const [hour, minute] = String(value).split(':').map(Number);
    return hour * 60 + minute;
  };
  const start = toMinutes(quiet.start || '22:00');
  const end = toMinutes(quiet.end || '07:00');
  return start === end || (start < end ? current >= start && current < end : current >= start || current < end);
}

import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { useImpersonation } from "@/lib/ImpersonationContext";
import { PLATFORM_COMPANY_ID } from "@/lib/constants";
import { isPlatformAdminCheck } from "@/hooks/usePlatformAdmin";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { DEFAULT_SHORTCUT_IDS, SHORTCUT_MAP } from "@/config/quickCreateShortcuts";
import useHiddenFeatures from "@/hooks/useHiddenFeatures";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Plus,
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
  PlayCircle,
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
  Sun,
  Moon,
  Trophy,
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
const ProductTour = React.lazy(() => import("@/components/tour/ProductTour"));
import TourTrigger from "@/components/tour/TourTrigger";
const HelpWidget = React.lazy(() => import("@/components/help/HelpWidget"));
import PlatformCapDialog from "@/components/PlatformCapDialog";
import { HelpCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { base44 } from "@/api/base44Client";
import AppSidebarNav, { NavCommandPalette } from "@/components/sidebar/AppSidebarNav";
import { buildSidebarModel, collectVisibleSources } from "@/lib/sidebarNav";
import { useAuth } from "@/lib/AuthContext";
import { getLastUsedCompanyId, getPreferredCompanyId, hasCrossTenantCompanyAccess, resolveActiveCompanyId, setLastUsedCompanyId } from "@/lib/activeCompanySelection";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";
import { useLocalSync } from "@/hooks/useLocalSync";
import { usePageVisibility } from "@/hooks/usePageVisibility";
const Dialer = React.lazy(() => import("@/components/communication/Dialer"));
const EmailDialog = React.lazy(() => import("@/components/communication/EmailDialog"));
const SMSDialog = React.lazy(() => import("@/components/communication/SMSDialog"));
import MobileNav from "@/components/MobileNav";
import PwaInstallBanner from "@/components/PwaInstallBanner";
import OnlineUsersWidget from "@/components/OnlineUsersWidget";
import FloatingActionButton from "@/components/FloatingActionButton";
import ConflictAlertListener from "@/components/ConflictAlertListener";
import { Toaster, toast } from "sonner";
import GoogleMeetButton from "@/components/communication/GoogleMeetButton";
import TrialReminderBanner from "@/components/TrialReminderBanner";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import EmailDeliveryBanner from "@/components/EmailDeliveryBanner";
import { useFeatureRestriction, FeatureRestrictedModal } from "@/components/FeatureRestrictedModal";
import { hasFeatureAccess } from "@/components/SubscriptionGate";
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

// Defer downloads until first use, then retain drafts and active call state
// when a dialog is closed, just as the previously eager components did.
function LoadOnFirstOpen({ open, children }) {
  const [hasOpened, setHasOpened] = useState(false);
  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);
  return open || hasOpened ? <React.Suspense fallback={null}>{children}</React.Suspense> : null;
}

export default function Layout({ children, currentPageName }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const SIDEBAR_CACHE_KEY = 'companysync_sidebar_cache';
  const [openMenu, setOpenMenu] = useState(null);
  const userClickedNavRef = React.useRef(false);
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const closeMobileSidebarRef = useRef(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [editWorkStart, setEditWorkStart] = useState('08:00');
  const [editWorkEnd, setEditWorkEnd] = useState('20:00');

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('dashboardDarkMode');
    return saved === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('dashboardDarkMode', next.toString());
  };
  const [editCellPhone, setEditCellPhone] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const queryClient = useQueryClient();
  const { restrictedFeature, setRestrictedFeature, checkFeatureAccess } = useFeatureRestriction();
  const { isOnline, pendingCount, failedCount, isSyncing } = useOfflineStatus();
  const isPageVisible = usePageVisibility();

  const { t } = useTranslation();
  const s = t.sidebar;
  const HIDDEN_FEATURES = useHiddenFeatures();

  const isMobile = useMediaQuery("(max-width: 1023px)");
  // Only compact the narrow phone header; keep the unfolded Fold layout.
  const isCompactHeader = useMediaQuery("(max-width: 639px)");
  // A modal survives the profile menu's closing focus handoff on phones.
  // The wide toolbar keeps its existing anchored popover.
  const StatusPanelRoot = isCompactHeader ? Dialog : Popover;
  const StatusPanelContent = isCompactHeader ? DialogContent : PopoverContent;
  const StatusPanelTitle = isCompactHeader ? DialogTitle : 'p';
  const StatusPanelDescription = isCompactHeader ? DialogDescription : 'p';
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return false;
    return true;
  });

  // Auto-open sidebar when the screen gets wide enough (e.g. Z Fold unfolding),
  // auto-close it when it gets narrow again (folding back).
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);
  
  const {
    isImpersonating,
    impersonatedCompanyId: impersonatedId,
    impersonationData,
    startImpersonation,
    stopImpersonation,
    markDirectCompanySelection,
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

  const {
    data: companies = [],
    isLoading: isLoadingCompanies,
    isError: hasCompanyLoadError,
  } = useQuery({
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

      // The list must cover every company this user may resolve to, or the
      // shell falls back to a default while the data layer stays on the
      // selected tenant — the branding/data mismatch this guards against.
      if (isPlatformAdminCheck(user, null, null) || hasCrossTenantCompanyAccess({ user, profiles: myProfiles })) {
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
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const {
    data: staffProfiles = [],
    isLoading: isLoadingStaffProfiles,
    isError: hasStaffProfileLoadError,
  } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const myStaffProfile = useMemo(() => {
    if (!user) return null;
    // Prefer the admin profile so the display name matches the user's own company.
    // Without this, a platform admin accidentally added as non-admin staff in a
    // tenant company would show that tenant's staff name (e.g. "Sedgwick MRP").
    const adminProfile = staffProfiles.find(s => s.user_email === user.email && s.is_administrator);
    return adminProfile || staffProfiles.find(s => s.user_email === user.email);
  }, [user, staffProfiles]);

  const displayName = myStaffProfile?.full_name || user?.full_name || 'User';
  const avatarUrl = myStaffProfile?.avatar_url || user?.profile_image_url || null;
  // CompanySync administrators can work across tenants. Their own account must
  // never be trapped in a subscriber's onboarding wizard while the active
  // company is being resolved or switched.
  const isCompanySyncMember = staffProfiles.some(
    profile => profile.user_email === user?.email && profile.company_id === PLATFORM_COMPANY_ID
  );

  const lastUsedId = impersonatedId ||
    getLastUsedCompanyId(user?.email) ||
    (isCompanySyncMember ? getPreferredCompanyId(staffProfiles) : null);

  const cachedSidebar = useMemo(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  const isDataStillLoading = isLoadingCompanies || isLoadingStaffProfiles;
  const hasSidebarDataError = hasCompanyLoadError || hasStaffProfileLoadError;

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

    const myProfiles = staffProfiles.filter(s => s.user_email === user.email);
    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    const isPlatformAdmin = hasCrossTenantCompanyAccess({ user, profiles: myProfiles });

    if (lastUsedId) {
      // A stored choice must not briefly fall back to the first profile while
      // the company/profile queries are still resolving. That transient
      // fallback is what made the shell appear to switch tenants.
      if (isDataStillLoading) {
        return cachedSidebar?.company?.id === lastUsedId ? cachedSidebar.company : null;
      }
      // The shell must accept a selection only when the data layer will accept
      // the same one. A platform admin's company list contains every tenant, so
      // without this check the sidebar branded a tenant the dashboard was not
      // reading from — the branding said one company, the data said another.
      const selectionIsUsable = resolveActiveCompanyId({
        selectedCompanyId: lastUsedId,
        profiles: myProfiles,
        ownedCompanies,
        isPlatformAdmin,
      }) === lastUsedId;
      const lastUsed = companies.find(c => c.id === lastUsedId);
      if (lastUsed && selectionIsUsable) return lastUsed;
    }

    const defaultCompanyId = resolveActiveCompanyId({
      profiles: myProfiles,
      ownedCompanies,
      isPlatformAdmin,
    });
    if (defaultCompanyId) {
      const defaultCompany = companies.find(c => c.id === defaultCompanyId);
      if (defaultCompany) return defaultCompany;
    }

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

    return ownedCompanies[0];
  }, [user, companies, staffProfiles, impersonatedCompany, impersonatedId, impersonationData, lastUsedId, isDataStillLoading, cachedSidebar]);

  // Persist only the company Layout has already validated for this signed-in
  // user. This gives the request client the same context as the visible shell
  // and repairs a saved company after access/membership has changed.
  useEffect(() => {
    if (!user?.email || !myCompany?.id || impersonatedId) return;
    if (lastUsedId !== myCompany.id) {
      setLastUsedCompanyId(myCompany.id, user.email);
      window.dispatchEvent(new CustomEvent('company-switched', { detail: { companyId: myCompany.id } }));
    }
  }, [user?.email, myCompany?.id, impersonatedId, lastUsedId]);

  // 🚪 Onboarding gate: companies that haven't finished Quick Setup are routed
  // back to it. Only an EXPLICIT false blocks — null/undefined means the company
  // predates the flag (grandfathered in) and is never redirected.
  // ── Default landing page per user ──────────────────────────────────────────
  const hasAppliedDefaultPageRef = useRef(false);
  useEffect(() => {
    if (hasAppliedDefaultPageRef.current) return;
    if (!myStaffProfile) return;
    const defaultPage = myStaffProfile.data?.default_page;
    if (!defaultPage || defaultPage === 'Dashboard') return;
    const isOnDefault = location.pathname === '/' || location.pathname === '/Dashboard';
    if (!isOnDefault) return;
    hasAppliedDefaultPageRef.current = true;
    navigate(createPageUrl(defaultPage), { replace: true });
  }, [myStaffProfile, location.pathname, navigate]);

  useEffect(() => {
    if (!user || !myCompany) return;
    if (impersonatedId) return; // never gate super-admin impersonation sessions
    const path = (location.pathname || '').toLowerCase();
    const onSetupPage = currentPageName === 'QuickSetup' || path.includes('quicksetup');
    const onPublicPage = currentPageName === 'sign-contract-customer' || path.includes('sign-contract-customer') ||
      currentPageName === 'TrainingVideoPlayer' || path.includes('trainingvideoplayer') ||
      currentPageName === 'ViewEstimate' || path.includes('viewestimate') ||
      currentPageName === 'BetaQuestionnaire' || path.includes('betaquestionnaire') ||
      currentPageName === 'CustomerPortalPublic' || path.includes('customerportalpublic');

    // CompanySync is the platform home, not a subscriber setup flow. Send a
    // platform member out of an already-open setup page as well; simply
    // skipping the gate leaves the stale /QuickSetup route visible.
    if (myCompany.id === PLATFORM_COMPANY_ID || isCompanySyncMember) {
      if (onSetupPage) {
        navigate(createPageUrl('Dashboard'), { replace: true });
      }
      return;
    }

    // Older setup flows persisted setup_completed before the newer onboarding
    // flag was introduced. Treat that explicit completion as completed too;
    // otherwise a user who already finished setup is sent back to QuickSetup
    // whenever the newer flag is absent/stale.
    if (myCompany.onboarding_completed !== false || myCompany.setup_completed === true) return;
    if (!onSetupPage && !onPublicPage) {
      navigate(createPageUrl('QuickSetup'), { replace: true });
    }
  }, [user, myCompany, impersonatedId, isCompanySyncMember, currentPageName, location.pathname, navigate]);

  const {
    user: rbdUser,
    myStaffProfile: rbdStaffProfile,
    myCompany: rbdCompany,
  } = useRoleBasedData();
  const _badgeEmail = rbdUser?.email;
  const _badgeName = rbdStaffProfile?.full_name;
  const _badgeCompanyId = rbdCompany?.id || rbdStaffProfile?.company_id;
  const _badgeEnabled = !!_badgeEmail && !!_badgeCompanyId;

  const { data: sidebarTasks = [] } = useQuery({
    queryKey: ["my-assignments-tasks", _badgeEmail, _badgeCompanyId],
    queryFn: async () => {
      const results = await base44.entities.Task.filter(
        { company_id: _badgeCompanyId, is_deleted: { $ne: true } },
        "-created_date",
        500
      );
      return results.filter(t => {
        if (_badgeEmail) {
          if (t.assigned_to_email && t.assigned_to_email.split(',').map(e => e.trim()).includes(_badgeEmail)) return true;
          if (Array.isArray(t.assignees) && t.assignees.some(a => a?.email === _badgeEmail)) return true;
        }
        if (_badgeName) {
          if (t.assigned_to === _badgeName) return true;
          if (t.assigned_to_name === _badgeName) return true;
          if (t.assigned_to && t.assigned_to.split(',').map(n => n.trim()).includes(_badgeName)) return true;
          if (Array.isArray(t.assignees) && t.assignees.some(a => a?.name === _badgeName)) return true;
        }
        return false;
      });
    },
    enabled: _badgeEnabled && isPageVisible,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: sidebarLeads = [] } = useQuery({
    queryKey: ["my-assignments-leads", _badgeEmail, _badgeCompanyId],
    queryFn: async () => {
      // Use a single query with $in to avoid two round-trips
      const filters = { company_id: _badgeCompanyId };
      if (_badgeEmail && _badgeName && _badgeName !== _badgeEmail) {
        filters.assigned_to = { $in: [_badgeEmail, _badgeName] };
      } else if (_badgeEmail) {
        filters.assigned_to = _badgeEmail;
      } else if (_badgeName) {
        filters.assigned_to = _badgeName;
      }
      return _badgeEmail || _badgeName
        ? base44.entities.Lead.filter(filters, "-created_date", 200)
        : [];
    },
    enabled: _badgeEnabled && isPageVisible,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: sidebarCustomers = [] } = useQuery({
    queryKey: ["sidebar-my-assignments-customers", _badgeEmail, _badgeCompanyId],
    queryFn: async () => {
      const filters = {
        company_id: _badgeCompanyId,
        is_deleted: { $ne: true },
      };
      if (_badgeEmail && _badgeName && _badgeName !== _badgeEmail) {
        filters.assigned_to = { $in: [_badgeEmail, _badgeName] };
      } else if (_badgeEmail) {
        filters.assigned_to = _badgeEmail;
      } else if (_badgeName) {
        filters.assigned_to = _badgeName;
      }
      return _badgeEmail || _badgeName
        ? base44.entities.Customer.filter(filters, "-created_date", 500)
        : [];
    },
    enabled: _badgeEnabled && isPageVisible,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const { data: sidebarProjects = [] } = useQuery({
    queryKey: ["my-assignments-projects", _badgeEmail, _badgeCompanyId],
    queryFn: async () => {
      const all = await base44.entities.Project.filter({ company_id: _badgeCompanyId, is_deleted: { $ne: true } }, "-created_date", 200);
      return all.filter(p => p.assigned_to === _badgeEmail || p.assigned_to === _badgeName);
    },
    enabled: _badgeEnabled && isPageVisible,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });

  const myAssignmentsBadgeCount = useMemo(() => {
    const openTasks = sidebarTasks.filter(t => t.status !== "done" && t.status !== "completed").length;
    const openLeads = sidebarLeads.filter(l => !["closed", "lost", "won"].includes(l.status)).length;
    const openCustomers = sidebarCustomers.filter(c => !["completed", "inactive", "closed"].includes(c.status)).length;
    const openProjects = sidebarProjects.filter(p => !["completed", "closed"].includes(p.status)).length;
    return openTasks + openLeads + openCustomers + openProjects;
  }, [sidebarTasks, sidebarLeads, sidebarCustomers, sidebarProjects]);

  const myOpenTasksCount = useMemo(() => {
    return sidebarTasks.filter(t => t.status !== "done" && t.status !== "completed").length;
  }, [sidebarTasks]);

  const autoProvisionRef = useRef(false);
  const [autoProvisionDone, setAutoProvisionDone] = useState(false);

  // Platform-cap dialog — shown when any AI/voice function call hits a monthly cap.
  const [platformCapAlert, setPlatformCapAlert] = useState(null);
  useEffect(() => {
    const handler = (e) => setPlatformCapAlert(e.detail || {});
    window.addEventListener('platform-cap-reached', handler);
    return () => window.removeEventListener('platform-cap-reached', handler);
  }, []);

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
            setLastUsedCompanyId(result.company.id, user.email);
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

  // Note: is_administrator is intentionally NOT auto-cleared.
  // Owners may designate head admins (e.g. office managers) who need full CRM access.
  // Commission-specific restrictions are controlled separately per staff profile.

  const { data: userRole = [] } = useQuery({
    queryKey: ['user-role', myStaffProfile?.role_id],
    queryFn: () => myStaffProfile?.role_id ? base44.entities.StaffRole.filter({ id: myStaffProfile.role_id }) : [],
    enabled: !!myStaffProfile?.role_id && !(myCompany?.created_by === user?.email),
  });

  const rolePermissions = userRole[0]?.permissions || {};

  const hasPermission = (feature, capability = 'view') => {
    if (user?.platform_role === 'super_admin') return true;
    if (myStaffProfile?.is_super_admin) return true;
    if (myStaffProfile?.is_administrator) return true;
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
          isAdministrator: myStaffProfile?.is_administrator || false,
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
  });

  const platformRestrictions = platformMenuSettings[0];

  const { data: menuSettings = [] } = useQuery({
    queryKey: ['menu-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.MenuSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
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
    enabled: !!user && !!myCompany?.id && isPageVisible,
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
  });

  // Show notifications for this user specifically OR company-wide (no user_email = meant for everyone)
  const notifications = React.useMemo(() => {
    if (!user?.email) return [];
    return allCompanyNotifications.filter(n => 
      (!n.deferred_until || new Date(n.deferred_until).getTime() <= Date.now())
        && (!n.user_email || n.user_email === user.email)
    );
  }, [allCompanyNotifications, user?.email]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const { data: pendingActionItems = [] } = useQuery({
    queryKey: ['action-items-sidebar', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.ActionItem.filter({ company_id: myCompany.id, status: 'pending' }) : [],
    enabled: !!myCompany?.id && isPageVisible,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  });
  const actionItemsCount = pendingActionItems.length;

  // Team Chat unread count for sidebar badge
  const { data: chatConvsData = { conversations: [] } } = useQuery({
    queryKey: ['chat-conversations-sidebar', myCompany?.id, user?.email],
    queryFn: async () => {
      if (!myCompany?.id || !user?.email) return { conversations: [] };
      const p = new URLSearchParams({ company_id: myCompany.id });
      const res = await fetch(`/api/chat/conversations?${p}`);
      if (!res.ok) return { conversations: [] };
      return res.json();
    },
    enabled: !!myCompany?.id && !!user?.email && isPageVisible,
    staleTime: 60_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    initialData: { conversations: [] },
  });
  const chatUnreadCount = (chatConvsData.conversations || []).reduce((sum, c) => sum + (c.unread_count || 0), 0);

  // Play notification sound when new notifications arrive
  const prevUnreadCountRef = useRef(unreadCount);
  useEffect(() => {
    if (unreadCount > prevUnreadCountRef.current && prevUnreadCountRef.current !== 0 && !isCompanyNotificationQuietTime(myCompany)) {
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
      setTimeout(() => audioContext.close().catch(() => {}), 700);
    }
    prevUnreadCountRef.current = unreadCount;
  }, [unreadCount, myCompany]);

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

  const handleCompleteActionFromNotification = async (e, notification) => {
    e.stopPropagation();
    if (notification.related_entity_id && notification.related_entity_type === 'ActionItem') {
      try {
        await base44.entities.ActionItem.update(notification.related_entity_id, { status: 'completed', completed_at: new Date().toISOString() });
        await base44.entities.Notification.update(notification.id, { is_read: true, read_at: new Date().toISOString() });
        queryClient.invalidateQueries({ queryKey: ['action-items'] });
        queryClient.invalidateQueries({ queryKey: ['action-items-sidebar'] });
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        toast.success('Action item completed');
      } catch (err) {
        toast.error('Failed to complete action item');
      }
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!myCompany?.id || !user?.email || isMarkingAllRead) return;

    setIsMarkingAllRead(true);
    try {
      // The bell only loads the newest 100 rows for display. Fetch the full
      // company notification set here so older unread items are included too.
      const companyNotificationRows = await base44.entities.Notification.filter(
        { company_id: myCompany.id },
        "-created_date",
        10000,
      );
      const now = Date.now();
      const unreadNotifications = companyNotificationRows.filter(notification =>
        !notification.is_read
        && (!notification.user_email || notification.user_email === user.email)
        && (!notification.deferred_until || new Date(notification.deferred_until).getTime() <= now)
      );

      if (unreadNotifications.length === 0) {
        setNotificationsOpen(false);
        queryClient.invalidateQueries({ queryKey: ['notifications', myCompany.id] });
        return;
      }

      const readAt = new Date().toISOString();
      const successfullyReadIds = new Set();
      let failedCount = 0;
      // Keep requests bounded, while ensuring one rejected update does not
      // prevent the remaining notifications from being processed.
      for (let index = 0; index < unreadNotifications.length; index += 10) {
        const batch = unreadNotifications.slice(index, index + 10);
        const results = await Promise.allSettled(batch.map(notification =>
          base44.entities.Notification.update(notification.id, {
            is_read: true,
            read_at: readAt,
          })
        ));
        results.forEach((result, resultIndex) => {
          if (result.status === 'fulfilled') {
            successfullyReadIds.add(batch[resultIndex].id);
          } else {
            failedCount += 1;
            console.error('[Notifications] Failed to mark notification as read:', batch[resultIndex].id, result.reason);
          }
        });
      }

      queryClient.setQueryData(['notifications', myCompany.id], cachedNotifications => (
        Array.isArray(cachedNotifications)
          ? cachedNotifications.map(notification => successfullyReadIds.has(notification.id)
            ? { ...notification, is_read: true, read_at: readAt }
            : notification)
          : cachedNotifications
      ));
      await queryClient.invalidateQueries({ queryKey: ['notifications', myCompany.id] });

      if (failedCount > 0) {
        toast.error(`${failedCount} notification${failedCount === 1 ? '' : 's'} could not be marked as read. Please try again.`);
        return;
      }

      setNotificationsOpen(false);
      toast.success('All notifications marked as read');
    } catch (error) {
      console.error('[Notifications] Failed to mark all notifications as read:', error);
      toast.error('Could not mark notifications as read. Please try again.');
    } finally {
      setIsMarkingAllRead(false);
    }
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

  const _scheduleData = myStaffProfile?.data || {};
  const _withinBusinessHours = (() => {
    if (!_scheduleData.after_hours_enabled) return true;
    const start = _scheduleData.after_hours_start;
    const end = _scheduleData.after_hours_end;
    if (!start || !end) return true;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return cur >= sh * 60 + sm && cur < eh * 60 + em;
  })();
  const isAvailable = myStaffProfile?.availability_status !== 'unavailable' && _withinBusinessHours;
  const routingMode = myStaffProfile?.call_routing_mode || 'sarah_answers';

  const routingLabels = {
    sarah_answers: 'Alex Answers',
    forward_to_cell: 'Forward to Cell',
    sarah_then_transfer: 'Alex Then Transfer',
    sarah_only: 'Alex Only (No Transfer)',
  };

  const handleOpenStatusPopover = (open) => {
    if (open && myStaffProfile) {
      setEditCellPhone(myStaffProfile.cell_phone || '');
      setEditWorkStart(myStaffProfile.data?.after_hours_start || '08:00');
      setEditWorkEnd(myStaffProfile.data?.after_hours_end || '20:00');
    }
    setStatusPopoverOpen(open);
  };

  const saveWorkHours = async () => {
    if (!myStaffProfile?.id) return;
    setStatusSaving(true);
    try {
      await base44.entities.StaffProfile.update(myStaffProfile.id, {
        data: {
          ...(myStaffProfile.data || {}),
          after_hours_enabled: true,
          after_hours_start: editWorkStart,
          after_hours_end: editWorkEnd,
        }
      });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
    } catch (e) {
      console.error('Failed to save work hours', e);
    } finally {
      setStatusSaving(false);
    }
  };

  const saveStatusField = async (field, value) => {
    if (!myStaffProfile?.id) return;
    setStatusSaving(true);
    try {
      await base44.entities.StaffProfile.update(myStaffProfile.id, { [field]: value });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });

      const twilioPhone = myStaffProfile.twilio_number;
      if (twilioPhone && myCompany?.id && ['call_routing_mode', 'availability_status', 'cell_phone'].includes(field)) {
        try {
          await fetch('/api/twilio/update-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone_number: twilioPhone,
              company_id: myCompany.id,
              company_name: myCompany.company_name || myCompany.name || '',
              rep_name: myStaffProfile.full_name || '',
              rep_email: myStaffProfile.user_email || '',
              cell_phone: field === 'cell_phone' ? value : (myStaffProfile.cell_phone || ''),
              routing_mode: field === 'call_routing_mode' ? value : (myStaffProfile.call_routing_mode || 'sarah_answers'),
              availability_status: field === 'availability_status' ? value : (myStaffProfile.availability_status || 'available'),
              data: myStaffProfile.data || {},
            })
          });
        } catch (e) {
          console.warn('[Layout] Cache update failed:', e.message);
        }
      }
      const labels = { cell_phone: 'Cell phone', call_routing_mode: 'Call routing', availability_status: 'Availability' };
      toast.success(`${labels[field] || 'Setting'} saved`);
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
      case 'action_item_reminder': return '⚡';
      case 'stale_lead': return '⚠️';
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

  const canAccessWorkflows = isPlatformAdminCheck(user, myCompany, myStaffProfile) ||
    hasFeatureAccess(myCompany?.subscription_plan || 'trial', 'workflows');

  const defaultNavigationItems = useMemo(() => [
    { id: 'dashboard', title: s.dashboard, url: createPageUrl("Dashboard"), icon: LayoutDashboard, order: 0 },
    { id: 'my-assignments', title: s.myAssignments, url: createPageUrl("MyAssignments"), icon: ClipboardList, order: 0, badge: myAssignmentsBadgeCount || null },
    
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
        ...(HIDDEN_FEATURES.PERMIT_ASSISTANT ? [
          { id: 'permit-assistant', title: s.permitAssistant, url: createPageUrl("PermitAssistant"), enabled: true },
        ] : []),
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
        { id: 'rep-performance', title: s.repPerformance, url: createPageUrl("RepPerformance") },
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
            { id: 'mapping-rules', title: s.mappingRules, url: createPageUrl("MappingRules") },
          ]
          },

    {
      id: 'field-operations',
      title: s.fieldOperations,
      icon: MapPin,
      order: 3.5,
      submenu: [
        { id: 'field-sales-tracker', title: s.fieldSalesTracker, url: createPageUrl("FieldSalesTracker"), subtitle: s.liveGpsCompliance },
        { id: 'field-rep-app', title: s.workTerritory, url: createPageUrl("FieldRepApp"), subtitle: s.logDoorToDoor },
        { id: 'territory-manager', title: s.territoryManager, url: createPageUrl("TerritoryManager"), subtitle: s.defineRepZones },
        { id: 'inspection-routing', title: s.routePlanner, url: createPageUrl("InspectionRouting"), subtitle: s.planOptimizeStops },
        { id: 'storm-tracking-field', title: s.stormTracking, url: createPageUrl("StormTracking"), subtitle: s.findStormDamagedAreas },
        { id: 'build-schedule', title: s.buildSchedule, url: createPageUrl("BuildSchedule") },
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
        { id: 'subcontractor-work-orders', title: s.workOrders, url: createPageUrl("SubcontractorWorkOrders"), subtitle: s.approveCrewPayouts },
        { id: 'labor-rates', title: s.laborRates, url: createPageUrl("LaborRates"), subtitle: s.standardCrewPayouts },
        { id: 'tasks', title: s.tasks, url: createPageUrl("Tasks") },
        { id: 'review-requests', title: s.reviewRequests, url: createPageUrl("ReviewRequests") },
        { id: 'action-items', title: s.actionItems || 'Action Items', url: createPageUrl("ActionItems"), badge: actionItemsCount > 0 ? actionItemsCount : null },
        { id: 'projects', title: s.projects, url: createPageUrl("Projects") },
        { id: 'leaderboard', title: s.leaderboard, url: createPageUrl("Leaderboard") },
        { id: 'activity', title: s.activityFeed, url: createPageUrl("Activity") },
      ]
    },
    { id: 'smart-glasses', title: s.smartGlasses, url: createPageUrl("SmartGlassesSetup"), icon: Camera, order: 4.1 },

    { id: 'calendar', title: s.calendar, url: createPageUrl("Calendar"), icon: Calendar, order: 5 },
    { id: 'reminders', title: s.reminders, url: createPageUrl("Reminders"), icon: Bell, order: 5.5 },

    {
      id: 'communication',
      title: s.communication,
      icon: MessageSquare,
      order: 13,
      enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('Communication Hub', 'view') || hasPermission('Live Call Dashboard', 'view') || hasPermission('Campaigns', 'view') || hasPermission('Workflows', 'view'),
      submenu: [
        { id: 'live-call-dashboard', title: s.liveCallDashboard, url: createPageUrl("LiveCallDashboard"), enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('Live Call Dashboard', 'view') },
        { id: 'communication-hub', title: s.communicationHub, url: createPageUrl("Communication"), enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('Communication Hub', 'view') },
        { id: 'campaigns', title: s.campaignManager, url: createPageUrl("Campaigns"), enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('Campaigns', 'view') },
        { id: 'ad-builder', title: s.adBuilder, url: createPageUrl("MarcusMarketing"), enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('Ad Builder', 'view') },
        { id: 'workflow-automation', title: s.workflowAutomation, url: createPageUrl("Workflows"), enabled: canAccessWorkflows && (myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('Workflows', 'view')) },
        { id: 'ai-dashboard', title: s.aiDashboard, url: createPageUrl("Settings") + '?tab=communications', enabled: myCompany?.created_by === user?.email || myStaffProfile?.is_super_admin || myStaffProfile?.is_administrator || hasPermission('AI Dashboard', 'view') },
        { id: 'mailbox', title: s.mailbox, url: createPageUrl("Mailbox") },
        { id: 'messages', title: s.messages, url: createPageUrl("Messages") },
        { id: 'team-chat', title: s.teamChat, url: createPageUrl("TeamChat"), badge: chatUnreadCount > 0 ? chatUnreadCount : null },
        { id: 'zoom', title: s.zoomMeeting, url: createPageUrl("ZoomMeeting") },
        { id: 'google-meet', title: s.googleMeet, url: createPageUrl("GoogleMeet") },
        { id: 'slack', title: 'Slack', url: createPageUrl("SlackSettings") },
        { id: 'google-chat', title: 'Google Chat', url: createPageUrl("GoogleChatSettings") },
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
    { id: 'training-videos', title: 'Training Videos', url: createPageUrl("TrainingVideos"), icon: PlayCircle, order: 10.5 },
    { id: 'subscription', title: s.subscription, url: createPageUrl("Pricing"), icon: CreditCard, order: 11 },
    { id: 'feature-comparison', title: s.featureComparison, url: createPageUrl("FeatureComparison"), icon: Layers, order: 11.5 },
    { id: 'coming-soon', title: s.comingSoon, url: createPageUrl("ComingSoon"), icon: Sparkles, order: 12 },
    ], [s, myAssignmentsBadgeCount, canAccessWorkflows, myCompany?.created_by, user?.email, myStaffProfile?.is_super_admin, myStaffProfile?.is_administrator, userRole, rolePermissions, HIDDEN_FEATURES.PERMIT_ASSISTANT]);

  const settingsMenuItems = useMemo(() => {
    const allItems = [
      { id: 'saas-admin', title: s.saasAdmin || 'Platform Admin', url: createPageUrl("SaaSAdminDashboard"), icon: Shield, platformOnly: true },
      { id: 'platform-menu-restrictions', title: s.platformRestrictions, url: createPageUrl("PlatformMenuRestrictions"), icon: Lock, platformOnly: true },
      { id: 'billing-api-keys', title: 'Billing & API Keys', url: createPageUrl("BillingDashboard"), icon: KeyRound, platformOnly: true },
      { id: 'backup-manager', title: s.backupManager, url: createPageUrl("BackupManager"), icon: Shield },
      { id: 'cleanup-restart', title: s.cleanupRestart, url: createPageUrl("CleanupAndRestart"), icon: RefreshCw, platformOnly: true },
      { id: 'quick-setup', title: s.quickSetup, url: createPageUrl("QuickSetup"), icon: Zap },
      { id: 'launch-checklist', title: s.launchChecklist, url: createPageUrl("LaunchChecklist"), icon: CheckCircle2 },
      { id: 'marketing-videos', title: 'Marketing Videos', url: createPageUrl("MarketingVideos"), icon: Video },
      { id: 'claims-audit', title: 'Claims Audit', url: createPageUrl("ClaimsAudit"), icon: CheckCircle2 },
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
      { id: 'integrations-accounting', title: 'Integrations & Accounting', url: createPageUrl("Settings") + '?tab=integrations', icon: Plug },
      { id: 'integration-manager', title: 'Price List Import', url: createPageUrl("IntegrationManager"), icon: Upload },
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
      const currentPlanLevel = isPlatformAdmin ? 999 : (planHierarchy[subscriptionPlan] !== undefined ? planHierarchy[subscriptionPlan] : 0);

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

    // 🔐 Filter by role permissions (if not admin or head administrator)
    if (!(myCompany?.created_by === user?.email) && !myStaffProfile?.is_super_admin && !myStaffProfile?.is_administrator && userRole[0]) {
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
            if (sub.id === 'rep-performance') return true;
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

        // Operations — each item is grantable via Roles Management permissions.
        if (item.id === 'operations') {
          const submenu = item.submenu?.filter(sub => {
            if (['crewcam-dashboard', 'new-crewcam', 'crewcam-capture'].includes(sub.id)) return hasPermission('photosync');
            if (sub.id === 'ai-damage') return hasPermission('drone_analysis');
            if (sub.id === 'subcontractors') return hasPermission('subcontractors');
            if (sub.id === 'tasks') return hasPermission('tasks');
            if (sub.id === 'review-requests') return hasPermission('review_requests');
            if (sub.id === 'action-items') return hasPermission('action_items') || hasPermission('tasks');
            if (sub.id === 'projects') return hasPermission('projects');
            if (sub.id === 'activity') return hasPermission('activity');
            return false;
          }) || [];
          return submenu.length > 0 ? { ...item, submenu } : null;
        }
        if (item.id === 'field-operations') return null;

        // Communication submenu
        if (item.id === 'communication') {
          if (!hasPermission('communication_hub')) return null;
          const submenu = item.submenu?.filter(sub => {
            // Admin-only items: respect the enabled flag computed in defaultNavigationItems
            if (sub.id === 'live-call-dashboard') return sub.enabled !== false;
            if (sub.id === 'communication-hub') return sub.enabled !== false;
            if (sub.id === 'ad-builder') return sub.enabled !== false;
            if (sub.id === 'ai-dashboard') return sub.enabled !== false;
            if (sub.id === 'campaigns') return sub.enabled !== false && hasPermission('campaigns');
            if (sub.id === 'workflow-automation') return sub.enabled !== false && hasPermission('workflows');
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
        // Subscription & Feature Comparison — admin-only
        if (item.id === 'subscription') return null;
        if (item.id === 'feature-comparison') return null;

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
              // Workflow Automation is available to every paid subscriber.
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

    // ✅ FINAL STEP: Apply company menu settings (hides/shows items & submenus)
    // This runs LAST so it always takes effect regardless of role or plan filtering above.
    if (!currentMenuSettings?.menu_items?.length) {
      return filteredItems.filter(Boolean).sort((a, b) => a.order - b.order);
    }

    const customItems = currentMenuSettings.menu_items;

    const applyCustomSettings = (navItem) => {
      if (!navItem) return null;
      const customItem = customItems.find(ci => ci.id === navItem.id);

      // Hide top-level item if explicitly disabled
      if (customItem && customItem.enabled === false) return null;

      const result = {
        ...navItem,
        order: customItem?.order ?? navItem.order,
      };

      // Apply submenu filtering for any item that has a submenu
      if (result.submenu && customItem) {
        const customSubs = customItem.submenuItems || customItem.submenu || [];
        if (customSubs.length > 0) {
          result.submenu = result.submenu.filter(sub => {
            const customSub = customSubs.find(cs => cs.id === sub.id);
            if (!customSub) return true; // not in saved settings → show by default
            return customSub.enabled !== false;
          });
        }
      }

      return result;
    };

    return filteredItems
      .map(applyCustomSettings)
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
  }, [currentMenuSettings, platformRestrictions, defaultNavigationItems, myStaffProfile, userRole, myCompany?.subscription_plan]);

  const visibleSources = useMemo(
    () => collectVisibleSources(displayNavigationItems, settingsMenuItems),
    [displayNavigationItems, settingsMenuItems]
  );
  const isPlatformStaff = settingsMenuItems.some((item) => item.id === 'saas-admin');
  const canOpenSettings = !!(
    String(myCompany?.created_by || '').trim().toLowerCase() === String(user?.email || '').trim().toLowerCase() ||
    user?.platform_role === 'super_admin' ||
    myStaffProfile?.is_super_admin ||
    myStaffProfile?.is_administrator ||
    ((isDataStillLoading || hasSidebarDataError || !myCompany) &&
      String(cachedSidebar?.userEmail || '').trim().toLowerCase() === String(user?.email || '').trim().toLowerCase() &&
      (cachedSidebar?.isAdmin ||
        cachedSidebar?.isSuperAdmin ||
        cachedSidebar?.isAdministrator ||
        String(cachedSidebar?.company?.created_by || '').trim().toLowerCase() === String(user?.email || '').trim().toLowerCase()))
  );
  const sidebarModel = useMemo(
    () => buildSidebarModel({
      visibleSources,
      canOpenSettings,
      isPlatformStaff,
      sidebarOrder: currentMenuSettings?.sidebar_order,
    }),
    [visibleSources, canOpenSettings, isPlatformStaff, currentMenuSettings]
  );

  // Keep a ref so the route-change effect can read nav items without re-running when badges update
  const displayNavItemsRef = useRef(displayNavigationItems);
  displayNavItemsRef.current = displayNavigationItems;

  useEffect(() => {
    // If the user just explicitly clicked a nav item, don't auto-expand the submenu
    if (userClickedNavRef.current) {
      userClickedNavRef.current = false;
      return;
    }
    const currentMenuItem = displayNavItemsRef.current.find(item => {
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
  }, [location.pathname, location.search]);

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
  const currentPlanLevel = isPlatformOwner ? 999 : (planHierarchy[subscriptionPlan] !== undefined ? planHierarchy[subscriptionPlan] : 0);

  const handleNavigationClick = (e, url, featureId) => {
    e.preventDefault();
    e.stopPropagation();

    if (featureId && !checkFeatureAccess(featureId, currentPlanLevel, isPlatformOwner, user?.email)) {
      return;
    }

    // Flag so the route-change useEffect skips re-opening the submenu
    userClickedNavRef.current = true;
    setOpenMenu(null);
    setShowSettingsMenu(false);
    if (isMobile) setSidebarOpen(false);
    navigate(url);
  };

  const goTo = useCallback((url, featureId) => {
    if (featureId && !checkFeatureAccess(featureId, currentPlanLevel, isPlatformOwner, user?.email)) {
      return;
    }
    userClickedNavRef.current = true;
    setOpenMenu(null);
    setShowSettingsMenu(false);
    setCommandOpen(false);
    if (isMobile) setSidebarOpen(false);
    closeMobileSidebarRef.current?.();
    navigate(url);
  }, [checkFeatureAccess, currentPlanLevel, isPlatformOwner, user?.email, isMobile, navigate]);

  const handleSidebarActivate = (e, item) => {
    if (item?.openSettings) {
      e?.preventDefault?.();
      setShowSettingsMenu(true);
      return;
    }
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    goTo(item.url, item.featureId);
  };

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [location.pathname]);

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
      <EmailDeliveryBanner isAdmin={!!(myStaffProfile?.is_administrator || myStaffProfile?.is_super_admin || (myCompany?.created_by && myCompany.created_by === user?.email))} />

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
          touch-action: pan-y;
        }

        /* On mobile the sidebar renders inside a Radix Sheet. The Sheet must be
           overflow:hidden so the fixed-height flex column works correctly and
           the sidebar-content-wrapper (below) becomes the scroll container.
           touch-action:pan-y reclaims vertical swipe from the Sheet's
           body-level touch-action:none lock. */
        [data-sidebar="sidebar"][data-mobile="true"] {
          display: flex !important;
          flex-direction: column !important;
          overflow: hidden !important;
          touch-action: pan-y;
        }

        [data-sidebar="sidebar"][data-mobile="true"] > div {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        [data-sidebar="sidebar"][data-mobile="true"] .sidebar-content-wrapper {
          flex: 1 !important;
          min-height: 0 !important;
          height: auto !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          touch-action: pan-y;
        }
        
        @media (max-width: 1023px) {
          main > div {
            padding-bottom: 4rem !important;
          }

          input, textarea, select {
            font-size: 16px !important;
          }
        }
      `}</style>
      <div className="min-h-screen flex w-full min-w-0 max-w-full overflow-x-clip bg-background">
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
                      />
                    ) : (
                      <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-6 h-6 text-blue-600" />
                      </div>
                    )}
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
                        void startImpersonation({
                          companyId: myCompanyHierarchy.parent.id,
                          companyName: myCompanyHierarchy.parent.company_name,
                          adminEmail: user?.email,
                        }).then(() => window.location.reload());
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
                          // Selecting a company directly must never restore the
                          // prior impersonated tenant over the user's new choice.
                          const isOwned = c.created_by === user?.email;
                          return (
                            <DropdownMenuItem key={c.id} className="cursor-pointer" onClick={() => {
                              if (isPlatform) {
                                const pendingStop = markDirectCompanySelection();
                                setLastUsedCompanyId(c.id, user?.email);
                                if (!isImpersonating) {
                                  if (pendingStop) {
                                    void pendingStop
                                      .then(() => {
                                        window.location.href = createPageUrl('Dashboard');
                                      })
                                      .catch(() => toast.error('Could not end the current company session. Please try again.'));
                                  } else {
                                    window.location.href = createPageUrl('Dashboard');
                                  }
                                } else {
                                  void stopImpersonation({ restoreSelection: false })
                                    .then(() => {
                                      window.location.href = createPageUrl('Dashboard');
                                    })
                                    .catch(() => toast.error('Could not end the current company session. Please try again.'));
                                }
                              } else if (isOwned) {
                                const pendingStop = markDirectCompanySelection();
                                setLastUsedCompanyId(c.id, user?.email);
                                if (!isImpersonating) {
                                  if (pendingStop) {
                                    void pendingStop
                                      .then(() => window.location.reload())
                                      .catch(() => toast.error('Could not end the current company session. Please try again.'));
                                  } else {
                                    window.location.reload();
                                  }
                                } else {
                                  void stopImpersonation({ restoreSelection: false })
                                    .then(() => window.location.reload())
                                    .catch(() => toast.error('Could not end the current company session. Please try again.'));
                                }
                              } else {
                                void startImpersonation({
                                  companyId: c.id,
                                  companyName: c.company_name,
                                  adminEmail: user?.email,
                                }).then(() => window.location.reload());
                              }
                            }}>
                              <Building2 className={`w-4 h-4 mr-2 ${isPlatform ? 'text-blue-500' : 'text-gray-500'}`} />
                              <div className="flex flex-col">
                                <span className={isPlatform ? 'font-bold' : ''}>{c.company_name}</span>
                                {isPlatform && <span className="text-xs text-blue-600">Platform Home</span>}
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
                            void startImpersonation({
                              companyId: child.id,
                              companyName: child.company_name,
                              adminEmail: user?.email,
                            }).then(() => window.location.reload());
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
            <AppSidebarNav
              visibleSources={visibleSources}
              canOpenSettings={canOpenSettings}
              isPlatformStaff={isPlatformStaff}
              sidebarOrder={currentMenuSettings?.sidebar_order}
              userEmail={user?.email}
              pathname={location.pathname}
              search={location.search}
              showSettings={showSettingsMenu}
              onNavigate={handleSidebarActivate}
              onOpenSearch={() => setCommandOpen(true)}
              registerCloseMobile={(fn) => { closeMobileSidebarRef.current = fn; }}
            />
          </div>
        </Sidebar>

        <main className="min-w-0 flex-1 flex flex-col overflow-x-clip" style={{ marginTop: isImpersonating ? '60px' : '0' }}>
          <header data-testid="app-header" className={`bg-gradient-to-r from-blue-600 via-blue-500 to-purple-600 border-b border-blue-400 shadow-lg ${isCompactHeader ? 'px-2 pb-2' : 'px-4 md:px-6 pb-3 md:py-4'}`} style={{paddingTop:'max(12px, env(safe-area-inset-top))'}}>

            <div className={`flex justify-between gap-2 min-w-0 ${isCompactHeader ? 'items-center' : 'items-start'}`}>
              <div className="flex shrink-0 items-center gap-2 md:gap-4">
                <SidebarTrigger className={`text-white hover:bg-white/10 p-2 rounded-lg transition-colors duration-200 ${isCompactHeader ? 'h-11 w-11 shrink-0' : ''}`} />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className={`text-white hover:bg-white/10 items-center gap-2 min-h-[44px] ${isCompactHeader ? 'hidden' : 'flex'}`}
                  type="button"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span className="hidden md:inline">Back</span>
                </Button>


              </div>

              <StatusPanelRoot open={statusPopoverOpen} onOpenChange={handleOpenStatusPopover}>
              <div className={`min-w-0 flex-1 flex items-center justify-end gap-1 md:gap-2 ${isCompactHeader ? 'flex-nowrap' : 'flex-wrap'}`}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`text-white hover:bg-white/10 min-h-[44px] gap-1.5 px-2 md:px-3 ${isCompactHeader ? 'hidden' : ''}`}
                      title="Quick Create"
                      data-testid="button-quick-create"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="hidden md:inline text-sm">Quick Create</span>
                      <ChevronDown className="w-3 h-3 ml-1 hidden md:block opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-white border border-gray-200 shadow-xl rounded-lg p-1">
                    {(() => {
                      const savedShortcuts = myCompany?.settings?.quick_create_shortcuts;
                      const isCustom = Array.isArray(savedShortcuts) && savedShortcuts.length > 0;
                      // Normalize: handle both legacy string[] and new {id,color}[] formats
                      const activeSlots = isCustom
                        ? savedShortcuts.map((item) => typeof item === 'string' ? { id: item, color: null } : { id: item.id, color: item.color || null })
                        : DEFAULT_SHORTCUT_IDS.map((id) => ({ id, color: null }));
                      // Backward-compat fallback for any data saved with separate shortcut_color_overrides
                      const colorOverrides = myCompany?.settings?.shortcut_color_overrides || {};

                      if (!isCustom) {
                        const createNewIds = ['lead', 'estimate', 'invoice', 'customer'];
                        const operationsIds = ['build', 'inspection', 'task'];
                        return (
                          <>
                            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Create New</div>
                            {createNewIds.map((id) => {
                              const item = SHORTCUT_MAP[id];
                              if (!item) return null;
                              const Icon = item.icon;
                              const iconColor = colorOverrides[id] || item.color;
                              return (
                                <DropdownMenuItem
                                  key={id}
                                  onClick={() => navigate(createPageUrl(item.page) + (item.params || ''))}
                                  className="cursor-pointer rounded-md flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700"
                                  data-testid={`quick-create-${id}`}
                                >
                                  <Icon className={`w-4 h-4 ${iconColor}`} />
                                  {item.label}
                                </DropdownMenuItem>
                              );
                            })}
                            <DropdownMenuSeparator className="my-1 bg-gray-100" />
                            <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Operations</div>
                            {operationsIds.map((id) => {
                              const item = SHORTCUT_MAP[id];
                              if (!item) return null;
                              const Icon = item.icon;
                              const iconColor = colorOverrides[id] || item.color;
                              return (
                                <DropdownMenuItem
                                  key={id}
                                  onClick={() => navigate(createPageUrl(item.page) + (item.params || ''))}
                                  className="cursor-pointer rounded-md flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700"
                                  data-testid={`quick-create-${id}`}
                                >
                                  <Icon className={`w-4 h-4 ${iconColor}`} />
                                  {item.label}
                                </DropdownMenuItem>
                              );
                            })}
                          </>
                        );
                      }

                      return (
                        <>
                          <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Quick Create</div>
                          {activeSlots.map((slot) => {
                            const item = SHORTCUT_MAP[slot.id];
                            if (!item) return null;
                            const Icon = item.icon;
                            const iconColor = slot.color || colorOverrides[slot.id] || item.color;
                            return (
                              <DropdownMenuItem
                                key={slot.id}
                                onClick={() => navigate(createPageUrl(item.page) + (item.params || ''))}
                                className="cursor-pointer rounded-md flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700"
                                data-testid={`quick-create-${slot.id}`}
                              >
                                <Icon className={`w-4 h-4 ${iconColor}`} />
                                {item.label}
                              </DropdownMenuItem>
                            );
                          })}
                        </>
                      );
                    })()}
                  </DropdownMenuContent>
                </DropdownMenu>
                <GoogleMeetButton companyId={myCompany?.id} />

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px]"
                  onClick={() => setShowDialer(true)}
                  title="Make a call"
                  aria-label="Make a call"
                >
                  <Phone className="w-5 h-5" />
                </Button>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-white hover:bg-white/10 min-h-[44px] min-w-[44px] ${isCompactHeader ? 'hidden' : ''}`}
                  onClick={() => setShowEmailDialog(true)}
                  title="Send email"
                >
                  <Mail className="w-5 h-5" />
                </Button>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-white hover:bg-white/10 min-h-[44px] min-w-[44px] ${isCompactHeader ? 'hidden' : ''}`}
                  onClick={() => setShowSMSDialog(true)}
                  title="Send SMS"
                >
                  <MessageCircle className="w-5 h-5" />
                </Button>

                {isCompactHeader && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-white hover:bg-white/10 h-11 w-11 shrink-0"
                        aria-label="Messages"
                        title="Email or text"
                        data-testid="button-compact-messages"
                      >
                        <MessageCircle className="w-5 h-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onSelect={() => setShowEmailDialog(true)}>
                        <Mail className="w-4 h-4 mr-2" /> Send email
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setShowSMSDialog(true)}>
                        <MessageCircle className="w-4 h-4 mr-2" /> Send text
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className={`text-white hover:bg-white/10 min-h-[44px] min-w-[44px] ${isCompactHeader ? 'hidden' : ''}`}
                  onClick={toggleDarkMode}
                  title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
                >
                  {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </Button>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`text-white hover:bg-white/10 min-h-[44px] min-w-[44px] ${isCompactHeader ? 'hidden' : ''}`}
                  onClick={() => setShowHelp(true)}
                  title="Help Center"
                >
                  <HelpCircle className="w-5 h-5" />
                </Button>

                {myStaffProfile && (
                  <>
                    {!isCompactHeader && (
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        data-testid="button-status-bar"
                        className={`text-white hover:bg-white/10 min-h-[44px] items-center gap-1.5 px-2 ${isCompactHeader ? 'hidden' : 'flex'}`}
                        title="My call status & routing"
                      >
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isAvailable ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="hidden lg:inline text-xs font-medium">
                          {isAvailable ? routingLabels[routingMode] || 'Available' : 'Unavailable'}
                        </span>
                        <PhoneForwarded className="w-4 h-4 lg:hidden" />
                      </Button>
                    </PopoverTrigger>
                    )}
                    <StatusPanelContent className={isCompactHeader ? "w-full max-w-none max-h-[100dvh] overflow-y-auto p-4" : "w-80 max-w-[calc(100vw-1rem)] max-h-[75dvh] overflow-y-auto p-4"} {...(!isCompactHeader ? { align: 'end' } : {})}>
                      <div className="min-w-0 space-y-4">
                        <div className={`flex items-center justify-between ${isCompactHeader ? 'pr-6' : ''}`}>
                          <div>
                            <StatusPanelTitle className="font-semibold text-sm">My Call Status</StatusPanelTitle>
                            <StatusPanelDescription className="text-xs text-muted-foreground">{myStaffProfile.full_name}</StatusPanelDescription>
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
                              <SelectItem value="sarah_answers">🤖 Alex Answers All</SelectItem>
                              <SelectItem value="sarah_then_transfer">🔀 Alex Then Transfer</SelectItem>
                              <SelectItem value="sarah_only">🚫 Alex Only (No Transfer)</SelectItem>
                            </SelectContent>
                          </Select>
                          {routingMode === 'forward_to_cell' && (
                            <p className="text-xs text-muted-foreground">Your cell rings first (~4 rings). If you don't answer, Alex takes over.</p>
                          )}
                          {routingMode === 'sarah_answers' && (
                            <p className="text-xs text-muted-foreground">Alex handles all calls. You'll get a notification after.</p>
                          )}
                          {routingMode === 'sarah_then_transfer' && (
                            <p className="text-xs text-muted-foreground">Alex answers, gathers info, then transfers to you.</p>
                          )}
                          {routingMode === 'sarah_only' && (
                            <p className="text-xs text-muted-foreground">Alex handles the entire call — saves leads, books inspections, takes messages. Transfer is fully disabled.</p>
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
                              className="flex-1 min-w-0 text-sm"
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

                        <div className="space-y-1.5 border-t pt-3">
                          <p className="text-sm font-medium">Work Hours</p>
                          <p className="text-xs text-muted-foreground">Green dot turns off automatically outside these hours.</p>
                          <div className={`flex gap-2 ${isCompactHeader ? 'flex-col items-stretch' : 'items-center'}`}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground mb-1">Start</p>
                              <Input
                                type="time"
                                value={editWorkStart}
                                onChange={(e) => setEditWorkStart(e.target.value)}
                                className="text-sm"
                                data-testid="input-work-start"
                              />
                            </div>
                            <span className={`text-muted-foreground mt-4 ${isCompactHeader ? 'hidden' : ''}`}>–</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-muted-foreground mb-1">End</p>
                              <Input
                                type="time"
                                value={editWorkEnd}
                                onChange={(e) => setEditWorkEnd(e.target.value)}
                                className="text-sm"
                                data-testid="input-work-end"
                              />
                            </div>
                            <Button
                              size="sm"
                              className={isCompactHeader ? "w-full mt-1" : "mt-4"}
                              disabled={statusSaving}
                              onClick={saveWorkHours}
                              data-testid="button-save-work-hours"
                            >
                              Save
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Currently: {editWorkStart} – {editWorkEnd}
                            {!_withinBusinessHours && <span className="text-red-500 ml-1">● Off duty</span>}
                            {_withinBusinessHours && <span className="text-green-500 ml-1">● On duty</span>}
                          </p>
                        </div>
                      </div>
                    </StatusPanelContent>
                  </>
                )}

                <div className="w-px h-6 bg-white/20 mx-1 md:mx-2 hidden md:block"></div>

                <Popover open={notificationsOpen} onOpenChange={setNotificationsOpen}>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-white hover:bg-white/10 min-h-[44px] min-w-[44px] relative"
                      title="Notifications"
                      aria-label="Notifications"
                    >
                      <Bell className="w-5 h-5" />
                      {unreadCount > 0 && (
                        <Badge className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 bg-red-500 text-white text-xs">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 max-w-[calc(100vw-1rem)] p-0" align="end">
                    <div className="flex items-center justify-between p-4 border-b">
                      <h3 className="font-semibold text-lg">Notifications</h3>
                      {unreadCount > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={handleMarkAllAsRead}
                          disabled={isMarkingAllRead}
                          className="text-xs"
                          data-testid="button-mark-all-notifications-read"
                        >
                          {isMarkingAllRead ? 'Marking…' : 'Mark all as read'}
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
                                        {notification.type === 'action_item_reminder' && notification.related_entity_type === 'ActionItem' && (
                                          <button
                                            onClick={(e) => handleCompleteActionFromNotification(e, notification)}
                                            className="mt-2 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded transition-colors"
                                            data-testid={`notif-complete-action-${notification.id}`}
                                          >
                                            <CheckCircle2 className="w-3 h-3" /> Mark Done
                                          </button>
                                        )}
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
                    <Button variant="ghost" aria-label="Profile and settings" data-testid="button-header-profile" className={`relative text-white hover:bg-white/10 flex items-center gap-2 min-h-[44px] ${isCompactHeader ? 'h-11 w-11 shrink-0 p-0' : ''}`}>
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

                    {isCompactHeader && (
                      <>
                        <DropdownMenuItem onSelect={handleBack}>
                          <ArrowLeft className="w-4 h-4 mr-2" /> Back
                        </DropdownMenuItem>
                        {myStaffProfile && (
                          <DropdownMenuItem onSelect={() => requestAnimationFrame(() => handleOpenStatusPopover(true))}>
                            <span className={`w-2 h-2 rounded-full mr-2 ${isAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
                            Call status &amp; routing
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={toggleDarkMode}>
                          {darkMode ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
                          {darkMode ? 'Light mode' : 'Dark mode'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setShowHelp(true)}>
                          <HelpCircle className="w-4 h-4 mr-2" /> Help Center
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {myStaffProfile && (
                      <>
                        <DropdownMenuItem
                          data-testid="menu-item-my-profile"
                          onClick={() => navigate(createPageUrl('StaffProfilePage') + `?email=${encodeURIComponent(user.email)}`)}
                        >
                          <UserCircle className="w-4 h-4 mr-2" />
                          My Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}

                    {sidebarModel.account.some((item) => item.source === 'subscription') && (
                      <DropdownMenuItem
                        data-testid="menu-item-plan-billing"
                        onClick={() => navigate(createPageUrl('Pricing'))}
                      >
                        <CreditCard className="w-4 h-4 mr-2" />
                        Plan & Billing
                      </DropdownMenuItem>
                    )}
                    {sidebarModel.account.some((item) => item.source === 'feature-comparison') && (
                      <DropdownMenuItem
                        data-testid="menu-item-compare-plans"
                        onClick={() => navigate(createPageUrl('FeatureComparison'))}
                      >
                        <Layers className="w-4 h-4 mr-2" />
                        Compare Plans
                      </DropdownMenuItem>
                    )}
                    {sidebarModel.account.length > 0 && <DropdownMenuSeparator />}

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
              </StatusPanelRoot>
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
            <div className="min-w-0 flex-1 overflow-auto overflow-x-hidden relative">
              {children}
            </div>
          )}
          
          {isMobile && (
            <>
              <div
                className="min-w-0 flex-1 overflow-auto overflow-x-hidden relative z-[1]"
                style={{ paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
              >
                {children}
              </div>
              <MobileNav allNavItems={displayNavigationItems} sections={[...sidebarModel.sections, ...sidebarModel.footer, ...(sidebarModel.account.length ? [{ id: "account", label: "Account", items: sidebarModel.account }] : [])]} onOpenSettings={() => { setShowSettingsMenu(true); setSidebarOpen(true); }} user={user} company={myCompany} myAssignmentsBadgeCount={myAssignmentsBadgeCount} myOpenTasksCount={myOpenTasksCount} myStaffProfile={myStaffProfile} />
              <FloatingActionButton company={myCompany} />
              <PwaInstallBanner />
            </>
          )}
        </main>
      </div>

      <LoadOnFirstOpen open={showDialer}>
      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
      />
      </LoadOnFirstOpen>
      <LoadOnFirstOpen open={showEmailDialog}>
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
      />
      </LoadOnFirstOpen>
      <LoadOnFirstOpen open={showSMSDialog}>
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        companyId={myCompany?.id}
      />
      </LoadOnFirstOpen>
      
      <TourTrigger
        onStartTour={() => setShowTour(true)}
        myCompany={myCompany}
        myStaffProfile={myStaffProfile}
      />
      <LoadOnFirstOpen open={showTour}>
      <ProductTour isOpen={showTour} onClose={() => setShowTour(false)} />
      </LoadOnFirstOpen>

      <PlatformCapDialog
        alert={platformCapAlert}
        onClose={() => setPlatformCapAlert(null)}
      />

      <LoadOnFirstOpen open={showHelp}>
      <HelpWidget
        isOpen={showHelp}
        onClose={() => setShowHelp(false)}
        onStartTour={() => { setShowHelp(false); setShowTour(true); }}
        myCompany={myCompany}
        myStaffProfile={myStaffProfile}
      />
      </LoadOnFirstOpen>

      <FeatureRestrictedModal 
        restrictedFeature={restrictedFeature} 
        onClose={() => setRestrictedFeature(null)} 
      />

      <NavCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        pages={sidebarModel.pages}
        onSelect={(item) => handleSidebarActivate(null, item)}
      />

      </SidebarProvider>
      );
      }