import React, { useState, useCallback, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  Users,
  Calendar,
  UserPlus,
  Menu,
  LogOut,
  Settings,
  FileText,
  Receipt,
  Briefcase,
  ClipboardList,
  Map as MapIcon,
  MessageSquare,
  Folder,
  Camera,
  Phone,
  DollarSign,
  Sparkles,
  Headphones,
  BookOpen,
  BarChart3,
  WifiOff,
  Wifi,
  RefreshCw,
  Loader2,
  ChevronRight,
  X,
  Languages,
  Inbox,
  Package,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { base44 } from "@/api/base44Client";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import useTranslation from "@/hooks/useTranslation";
import { motion, AnimatePresence } from "framer-motion";

export default function MobileNav({ allNavItems, user, company }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isOnline, pendingCount, failedCount, isSyncing } = useOfflineStatus();
  const { t } = useTranslation();
  const m = t.mobileNav;

  // Close on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const handleCameraButtonTap = useCallback(() => {
    navigate(createPageUrl("InspectionCapture"));
  }, [navigate]);

  const navItems = [
    { title: m.dashboard, url: createPageUrl("Dashboard"), icon: LayoutDashboard },
    { title: m.leads, url: createPageUrl("Leads"), icon: UserPlus },
    { title: m.camera, url: createPageUrl("InspectionsDashboard"), icon: Camera, highlight: true, isCamera: true },
    { title: m.calendar, url: createPageUrl("Calendar"), icon: Calendar },
  ];

  const isActive = (url) => location.pathname === url;

  const handleLinkClick = (url) => {
    setMenuOpen(false);
    navigate(url);
  };

  const fieldWorkItems = [
    { title: m.estimates, url: createPageUrl("Estimates"), icon: FileText, color: "text-orange-600", bg: "bg-orange-50" },
    { title: m.projects, url: createPageUrl("Projects"), icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50" },
    { title: m.customers, url: createPageUrl("Customers"), icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
    { title: m.map, url: createPageUrl("Map"), icon: MapIcon, color: "text-red-600", bg: "bg-red-50" },
    { title: "Price List", url: createPageUrl("Items"), icon: Package, color: "text-violet-600", bg: "bg-violet-50" },
  ];

  const officeItems = [
    { title: m.invoices, url: createPageUrl("Invoices"), icon: Receipt, color: "text-green-600", bg: "bg-green-50" },
    { title: m.tasks, url: createPageUrl("Tasks"), icon: ClipboardList, color: "text-purple-600", bg: "bg-purple-50" },
    { title: m.payments, url: createPageUrl("Payments"), icon: DollarSign, color: "text-yellow-600", bg: "bg-yellow-50" },
  ];

  const aiToolItems = [
    { title: m.aiAssistant, url: createPageUrl("AIAssistant"), icon: Sparkles, color: "text-violet-600", bg: "bg-violet-50" },
    { title: m.reports, url: createPageUrl("Reports"), icon: BarChart3, color: "text-sky-600", bg: "bg-sky-50" },
    { title: m.documents, url: createPageUrl("Documents"), icon: Folder, color: "text-amber-600", bg: "bg-amber-50" },
    { title: m.knowledgeBase, url: createPageUrl("KnowledgeBase"), icon: BookOpen, color: "text-indigo-600", bg: "bg-indigo-50" },
  ];

  const communicationItems = [
    { title: m.messages || "Messages", url: createPageUrl("Messages"), icon: MessageSquare, color: "text-blue-600", bg: "bg-blue-50" },
    { title: m.communicationHub || "Inbox", url: createPageUrl("Communication"), icon: Inbox, color: "text-teal-600", bg: "bg-teal-50" },
  ];

  const renderGridSection = (title, items) => (
    <div className="mb-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{title}</h3>
      <div className="grid grid-cols-4 gap-2">
        {items.map((item) => (
          <button
            key={item.title}
            data-testid={`mobile-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
            onClick={() => handleLinkClick(item.url)}
            className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 ${
              isActive(item.url)
                ? "bg-blue-50 border border-blue-200"
                : "bg-white border border-gray-100 hover:border-gray-200"
            }`}
          >
            <div className={`w-9 h-9 rounded-full ${item.bg} flex items-center justify-center mb-1.5`}>
              <item.icon className={`w-4.5 h-4.5 ${item.color}`} />
            </div>
            <span className="text-[11px] font-medium text-gray-700 leading-tight text-center">{item.title}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const currentLanguage = localStorage.getItem("crewcam_language") || "en";
  const handleLanguageToggle = async () => {
    const newLang = currentLanguage === "en" ? "es" : "en";
    localStorage.setItem("crewcam_language", newLang);
    window.dispatchEvent(new StorageEvent("storage", { key: "crewcam_language", newValue: newLang }));
    try {
      const me = await base44.auth.me();
      if (me?.email) {
        const profiles = await base44.entities.StaffProfile.filter({ user_email: me.email });
        if (profiles[0]?.id) {
          await base44.entities.StaffProfile.update(profiles[0].id, { preferred_language: newLang });
        }
      }
    } catch (e) {
      console.warn("Could not save language preference to profile:", e.message);
    }
    window.location.reload();
  };

  return (
    <>
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 0, opacity: 0 }}
            className="fixed bottom-16 left-0 right-0 z-50 px-3 pb-1"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="bg-amber-500 text-white rounded-xl px-4 py-2.5 flex items-center justify-between shadow-lg" data-testid="offline-banner">
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm font-medium">{m.offline}</span>
              </div>
              {pendingCount > 0 && (
                <span className="text-xs bg-amber-600 rounded-full px-2 py-0.5">
                  {pendingCount} pending
                </span>
              )}
            </div>
          </motion.div>
        )}
        {isOnline && isSyncing && (
          <motion.div
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 0, opacity: 0 }}
            className="fixed bottom-16 left-0 right-0 z-50 px-3 pb-1"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="bg-blue-500 text-white rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg" data-testid="syncing-banner">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span className="text-sm font-medium">{m.syncing} {pendingCount} items...</span>
              <div className="flex-1 bg-blue-400 rounded-full h-1.5 ml-2">
                <div className="bg-white rounded-full h-1.5 animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom nav bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-14 overflow-visible max-w-lg mx-auto w-full">
          {navItems.map((item) =>
            item.isCamera ? (
              <button
                key={item.title}
                data-testid="bottom-nav-camera"
                onClick={handleCameraButtonTap}
                className="flex flex-col items-center justify-center flex-1 h-full transition-colors min-w-[60px] active:scale-95 relative"
                style={{ WebkitTapHighlightColor: 'transparent' }}
              >
                <div className="w-12 h-12 -mt-3 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg border-4 border-white active:from-blue-600 active:to-blue-700">
                  <Camera className="w-6 h-6 text-white" />
                </div>
                <span className="text-[10px] mt-0.5 text-blue-600 font-semibold">{item.title}</span>
              </button>
            ) : (
              <Link
                key={item.title}
                to={item.url}
                data-testid={`bottom-nav-${item.title.toLowerCase()}`}
                className={`flex flex-col items-center justify-center flex-1 h-full transition-colors min-w-[60px] active:bg-gray-50 ${
                  isActive(item.url)
                    ? "text-blue-600 font-semibold"
                    : "text-gray-500"
                }`}
              >
                <item.icon className={`w-6 h-6 ${isActive(item.url) ? "text-blue-600" : ""}`} />
                <span className="text-[10px] mt-0.5">{item.title}</span>
              </Link>
            )
          )}

          {/* More button — plain button, no Radix primitives */}
          <button
            data-testid="bottom-nav-more"
            onClick={() => setMenuOpen(true)}
            className="flex flex-col items-center justify-center flex-1 h-full text-gray-500 transition-colors active:bg-gray-50 min-w-[60px]"
            style={{ WebkitTapHighlightColor: 'transparent' }}
          >
            <Menu className="w-6 h-6" />
            <span className="text-[10px] mt-0.5 font-medium">{m.more}</span>
          </button>
        </div>
      </div>

      {/* More menu overlay — rendered at document root level via portal-like fixed positioning */}
      <AnimatePresence>
        {menuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-[500]"
              onClick={() => setMenuOpen(false)}
            />

            {/* Drawer panel */}
            <motion.div
              key="drawer"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 right-0 bottom-0 z-[501] bg-white rounded-t-2xl flex flex-col"
              style={{ maxHeight: '85vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              {/* Handle + header */}
              <div className="flex-shrink-0 px-5 pt-3 pb-2">
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">{m.more}</h2>
                  <div className="flex items-center gap-2">
                    {!isOnline && (
                      <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium bg-amber-50 rounded-full px-2.5 py-1">
                        <WifiOff className="w-3 h-3" />
                        Offline
                      </div>
                    )}
                    <button
                      onClick={() => setMenuOpen(false)}
                      className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 active:bg-gray-100"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                {company?.company_name && (
                  <p className="text-xs text-gray-400 mt-0.5">{company.company_name}</p>
                )}
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-4 pb-6">
                {renderGridSection(m.fieldWork, fieldWorkItems)}
                {renderGridSection(m.office, officeItems)}
                {renderGridSection(m.communication || "Communication", communicationItems)}
                {renderGridSection(m.tools, aiToolItems)}

                <div className="border-t border-gray-100 mt-2 pt-3 space-y-1">
                  <button
                    data-testid="mobile-nav-language"
                    onClick={handleLanguageToggle}
                    className="flex items-center w-full p-3 rounded-xl text-gray-700 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <Languages className="w-5 h-5 text-gray-400 mr-3" />
                    <span>{currentLanguage === 'en' ? 'Español' : 'English'}</span>
                    <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
                  </button>
                  <button
                    data-testid="mobile-nav-settings"
                    onClick={() => handleLinkClick(createPageUrl("GeneralSettings"))}
                    className="flex items-center w-full p-3 rounded-xl text-gray-700 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <Settings className="w-5 h-5 text-gray-400 mr-3" />
                    <span>{m.settings}</span>
                    <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
                  </button>
                  <button
                    data-testid="mobile-nav-logout"
                    onClick={() => base44.auth.logout()}
                    className="flex items-center w-full p-3 rounded-xl text-red-600 font-medium hover:bg-red-50 active:bg-red-100 transition-colors"
                    style={{ WebkitTapHighlightColor: 'transparent' }}
                  >
                    <LogOut className="w-5 h-5 mr-3" />
                    <span>{t.sidebar.logout}</span>
                  </button>
                </div>

                <div className="pt-3 text-center text-[11px] text-gray-300">
                  {user?.full_name}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
