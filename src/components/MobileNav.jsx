import React, { useState, useCallback, useEffect } from "react";
import { createPortal, flushSync } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  LayoutDashboard,
  Users,
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
  PlayCircle,
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
  CalendarDays,
  UserCircle,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { base44 } from "@/api/base44Client";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import useTranslation from "@/hooks/useTranslation";
import { motion, AnimatePresence } from "framer-motion";

function MobileSectionList({ nodes, depth, onOpen }) {
  return (
    <div className={depth ? "ml-3 border-l border-gray-100 pl-2" : ""}>
      {nodes.map((node) =>
        node.items ? (
          <div key={node.id} className="mb-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1 px-1">{node.label}</h3>
            {node.tooltip && depth === 0 && (
              <p className="text-[11px] text-gray-400 px-1 mb-1">{node.tooltip}</p>
            )}
            <MobileSectionList nodes={node.items} depth={depth + 1} onOpen={onOpen} />
          </div>
        ) : (
          <button
            key={node.source || node.id}
            type="button"
            onClick={() => onOpen(node.url)}
            className="flex flex-col items-start w-full text-left px-2 py-2 rounded-lg hover:bg-gray-50 active:bg-gray-100"
          >
            <span className="text-sm font-medium text-gray-800">{node.label}</span>
            {node.tooltip && <span className="text-[11px] text-gray-500 leading-snug">{node.tooltip}</span>}
          </button>
        )
      )}
    </div>
  );
}

export default function MobileNav({ allNavItems, sections, onOpenSettings, user, company, myAssignmentsBadgeCount = 0, myOpenTasksCount = 0, myStaffProfile }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const { isOnline, pendingCount, failedCount, isSyncing } = useOfflineStatus();
  const { t } = useTranslation();
  const m = t.mobileNav;

  // Close on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search, location.hash]);

  // Restore the previous scroll lock when closing; do not overwrite another modal.
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = event => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const handleCameraButtonTap = useCallback(() => {
    navigate(createPageUrl("InspectionCapture"));
  }, [navigate]);

  const navItems = [
    { title: m.dashboard, url: createPageUrl("Dashboard"), icon: LayoutDashboard },
    { title: m.leads, url: createPageUrl("Leads"), icon: UserPlus },
    { title: m.camera, url: createPageUrl("InspectionsDashboard"), icon: Camera, highlight: true, isCamera: true },
    { title: m.assignments, url: createPageUrl("MyAssignments"), icon: ClipboardList, badge: myAssignmentsBadgeCount > 0 ? myAssignmentsBadgeCount : null },
  ];

  const isActive = (url) => location.pathname === url;

  const handleLinkClick = (url) => {
    // Commit dismissal before navigation can suspend on a lazy-loaded page.
    // Otherwise React can retain the portal while the destination loads.
    flushSync(() => setMenuOpen(false));
    navigate(url);
  };

  const fieldWorkItems = [
    { title: m.estimates, url: createPageUrl("Estimates"), icon: FileText, color: "text-orange-600", bg: "bg-orange-50" },
    { title: m.projects, url: createPageUrl("Projects"), icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50" },
    { title: m.customers, url: createPageUrl("Customers"), icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
    { title: m.map, url: createPageUrl("Map"), icon: MapIcon, color: "text-red-600", bg: "bg-red-50" },
    { title: m.priceList, url: createPageUrl("Items"), icon: Package, color: "text-violet-600", bg: "bg-violet-50" },
    { title: m.calendar, url: createPageUrl("Calendar"), icon: CalendarDays, color: "text-cyan-600", bg: "bg-cyan-50" },
  ];

  const officeItems = [
    { title: m.invoices, url: createPageUrl("Invoices"), icon: Receipt, color: "text-green-600", bg: "bg-green-50" },
    { title: m.tasks, url: createPageUrl("Tasks"), icon: ClipboardList, color: "text-purple-600", bg: "bg-purple-50", badge: myOpenTasksCount > 0 ? myOpenTasksCount : null },
    { title: m.payments, url: createPageUrl("Payments"), icon: DollarSign, color: "text-yellow-600", bg: "bg-yellow-50" },
  ];

  const aiToolItems = [
    { title: m.aiAssistant, url: createPageUrl("AIAssistant"), icon: Sparkles, color: "text-violet-600", bg: "bg-violet-50" },
    { title: 'Voice Msg', url: createPageUrl("TeamChat") + "?handsfree=1", icon: Headphones, color: "text-violet-500", bg: "bg-violet-50" },
    { title: m.reports, url: createPageUrl("Reports"), icon: BarChart3, color: "text-sky-600", bg: "bg-sky-50" },
    { title: m.documents, url: createPageUrl("Documents"), icon: Folder, color: "text-amber-600", bg: "bg-amber-50" },
    { title: m.knowledgeBase, url: createPageUrl("KnowledgeBase"), icon: BookOpen, color: "text-indigo-600", bg: "bg-indigo-50" },
    { title: 'Training Videos', url: createPageUrl("TrainingVideos"), icon: PlayCircle, color: "text-violet-600", bg: "bg-violet-50" },
  ];

  const communicationItems = [
    { title: m.messages, url: createPageUrl("Messages"), icon: MessageSquare, color: "text-blue-600", bg: "bg-blue-50" },
    { title: m.communicationHub, url: createPageUrl("Communication"), icon: Inbox, color: "text-teal-600", bg: "bg-teal-50" },
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
            className={`relative flex flex-col items-center justify-center p-3 rounded-xl transition-all active:scale-95 ${
              isActive(item.url)
                ? "bg-blue-50 border border-blue-200"
                : "bg-white border border-gray-100 hover:border-gray-200"
            }`}
          >
            {item.badge != null && (
              <span
                data-testid={`mobile-nav-badge-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
              >
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
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

  // Keep fixed navigation outside page layout/scroll containers. A wide page
  // or an ancestor containing block must not resize or clip the menu.
  return createPortal(
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
                  {pendingCount} {m.pending}
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
              <span className="text-sm font-medium">{m.syncing} {pendingCount} {m.items}</span>
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
                <span className="text-[12px] mt-0.5 text-blue-600 font-semibold">{item.title}</span>
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
                <div className="relative">
                  <item.icon className={`w-6 h-6 ${isActive(item.url) ? "text-blue-600" : ""}`} />
                  {item.badge != null && (
                    <span
                      data-testid={`bottom-nav-badge-${item.title.toLowerCase()}`}
                      className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none"
                    >
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[12px] mt-0.5">{item.title}</span>
              </Link>
            )
          )}

          {/* Use one activation handler for mouse, touch, and keyboard. */}
          <button
            type="button"
            data-testid="bottom-nav-more"
            aria-expanded={menuOpen}
            aria-controls="mobile-more-menu"
            onClick={() => setMenuOpen(true)}
            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors active:bg-gray-50 min-w-[60px] ${menuOpen ? 'text-blue-600' : 'text-gray-500'}`}
            style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
          >
            {myStaffProfile ? (
              myStaffProfile.avatar_url ? (
                <img
                  src={myStaffProfile.avatar_url}
                  alt={myStaffProfile.full_name || ''}
                  className={`w-7 h-7 rounded-full object-cover ring-2 shadow-sm ${menuOpen ? 'ring-blue-500' : 'ring-white'}`}
                />
              ) : (
                <div className={`w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center ring-2 shadow-sm ${menuOpen ? 'ring-blue-500' : 'ring-white'}`}>
                  <span className="text-white text-xs font-semibold leading-none">
                    {(myStaffProfile.full_name || user?.full_name || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
              )
            ) : (
              <Menu className="w-6 h-6" />
            )}
            <span className="text-[10px] mt-0.5 font-medium">{m.more}</span>
          </button>
        </div>
      </div>

      {/* Unmount immediately on close/navigation. Exit animations must not leave
          an invisible panel or backdrop intercepting taps on the destination. */}
        {menuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              data-testid="mobile-more-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/50 z-[500]"
              onClick={() => setMenuOpen(false)}
            />

            {/* Drawer panel */}
            <motion.div
              key="drawer"
              id="mobile-more-menu"
              data-testid="mobile-more-menu"
              role="dialog"
              aria-modal="true"
              aria-label={m.more}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed left-0 right-0 bottom-0 z-[501] bg-white rounded-t-2xl flex flex-col"
              style={{ maxHeight: '85dvh', paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              {/* Handle + header */}
              <div className="flex-shrink-0 px-5 pt-3 pb-2">
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
                <div className="flex items-center justify-between">
                  {/* Avatar + name row — taps to My Profile */}
                  {myStaffProfile && user?.email ? (
                    <button
                      data-testid="mobile-nav-header-profile"
                      onClick={() => handleLinkClick(createPageUrl('StaffProfilePage') + `?email=${encodeURIComponent(user.email)}`)}
                      className="flex items-center gap-3 min-w-0 active:opacity-70"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      {myStaffProfile.avatar_url ? (
                        <img
                          src={myStaffProfile.avatar_url}
                          alt={myStaffProfile.full_name || user?.full_name || ''}
                          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-sm font-semibold">
                            {(myStaffProfile.full_name || user?.full_name || '?').charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-semibold text-gray-900 truncate leading-tight">
                          {myStaffProfile.full_name || user?.full_name}
                        </p>
                        {(myStaffProfile.role || company?.company_name) && (
                          <p className="text-xs text-gray-400 truncate leading-tight">
                            {myStaffProfile.role || company?.company_name}
                          </p>
                        )}
                      </div>
                    </button>
                  ) : (
                    <h2 className="text-lg font-semibold text-gray-900">{m.more}</h2>
                  )}
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    {!isOnline && (
                      <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium bg-amber-50 rounded-full px-2.5 py-1">
                        <WifiOff className="w-3 h-3" />
                        {m.offlineBadge}
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label="Close More menu"
                      data-testid="mobile-more-close"
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
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
                {sections?.length ? (
                  <MobileSectionList nodes={sections} depth={0} onOpen={handleLinkClick} />
                ) : (
                  <>
                    {renderGridSection(m.fieldWork, fieldWorkItems)}
                    {renderGridSection(m.office, officeItems)}
                    {renderGridSection(m.communication, communicationItems)}
                    {renderGridSection(m.tools, aiToolItems)}
                  </>
                )}

                <div className="border-t border-gray-100 mt-2 pt-3 space-y-1">
                  {myStaffProfile && user?.email && (
                    <button
                      data-testid="mobile-nav-my-profile"
                      onClick={() => handleLinkClick(createPageUrl('StaffProfilePage') + `?email=${encodeURIComponent(user.email)}`)}
                      className="flex items-center w-full p-3 rounded-xl text-gray-700 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <UserCircle className="w-5 h-5 text-gray-400 mr-3" />
                      <span>{m.myProfile}</span>
                      <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
                    </button>
                  )}
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
                    onClick={() => {
                      setMenuOpen(false);
                      if (onOpenSettings) onOpenSettings();
                      else handleLinkClick(createPageUrl("GeneralSettings"));
                    }}
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

              </div>
            </motion.div>
          </>
        )}
    </>,
    document.body
  );
}
