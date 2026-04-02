# Mobile UX Upgrade — Instructions for Base44

These changes make the mobile CRM experience significantly better for roofing contractors working in the field. All changes are mobile-only (screens under 768px wide) — the desktop experience is completely unchanged.

## What's New
1. **Bottom Navigation Bar** — 5 tabs: Dashboard, Leads, Camera (CrewCam), Calendar, More
2. **Camera Quick Access** — Prominent raised button in the center of the nav for instant photo capture
3. **Reorganized "More" Menu** — Bottom sheet organized into Field Work, Office, and Tools sections
4. **Dashboard Quick Actions** — 4 colorful action buttons on mobile dashboard (New Lead, Photos, Schedule, Map)
5. **Swipeable Lead Cards** — On mobile, leads show as cards you can swipe left to call, SMS, email, or delete
6. **Offline/Syncing Banners** — Amber banner when offline, blue banner with progress bar when syncing

---

## Dependencies Required

Make sure these npm packages are installed:
- `framer-motion` (for swipe gestures and banner animations)
- `lucide-react` (for icons — likely already installed)

---

## Files to Add or Update

### FILE 1: NEW FILE — `src/components/SwipeableCard.jsx`

This is a reusable component that wraps any card content and makes it swipeable on mobile. Swipe left to reveal action buttons (Call, SMS, Email, Delete).

```jsx
import React, { useRef, useState } from "react";
import { motion, useMotionValue, useAnimation } from "framer-motion";
import { Phone, Mail, MessageCircle, Trash2, ChevronLeft } from "lucide-react";

export default function SwipeableCard({ 
  children, 
  onCall, 
  onEmail, 
  onSMS, 
  onDelete,
  className = ""
}) {
  const [isDragging, setIsDragging] = useState(false);
  const x = useMotionValue(0);
  const controls = useAnimation();

  const actionCount = [onCall, onSMS, onEmail, onDelete].filter(Boolean).length;
  const swipeDistance = Math.min(actionCount * 70 + 10, 290);

  const handleDragEnd = (event, info) => {
    setIsDragging(false);
    const threshold = -60;
    
    if (info.offset.x < threshold) {
      controls.start({ x: -swipeDistance });
    } else {
      controls.start({ x: 0 });
    }
  };

  const handleActionClick = (action) => {
    if (action) action();
    controls.start({ x: 0 });
  };

  return (
    <div className="relative overflow-hidden rounded-lg mb-3 bg-gray-100">
      <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end gap-2 pr-3" style={{ width: swipeDistance }}>
        {onCall && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onCall);
            }}
            className="w-16 h-16 bg-green-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-green-600 active:bg-green-700 transition-colors"
            title="Call"
          >
            <Phone className="w-7 h-7" />
          </button>
        )}
        {onSMS && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onSMS);
            }}
            className="w-16 h-16 bg-purple-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-purple-600 active:bg-purple-700 transition-colors"
            title="Send SMS"
          >
            <MessageCircle className="w-7 h-7" />
          </button>
        )}
        {onEmail && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onEmail);
            }}
            className="w-16 h-16 bg-blue-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-blue-600 active:bg-blue-700 transition-colors"
            title="Send Email"
          >
            <Mail className="w-7 h-7" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleActionClick(onDelete);
            }}
            className="w-16 h-16 bg-red-500 rounded-xl flex items-center justify-center text-white shadow-lg hover:bg-red-600 active:bg-red-700 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-7 h-7" />
          </button>
        )}
      </div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -swipeDistance, right: 0 }}
        dragElastic={0.2}
        dragMomentum={false}
        dragDirectionLock={true}
        style={{ x }}
        animate={controls}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        className={`${className} bg-white relative z-10 touch-pan-y`}
      >
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
          <ChevronLeft className="w-5 h-5 animate-pulse" />
        </div>
        
        {children}
      </motion.div>
    </div>
  );
}
```

---

### FILE 2: NEW FILE — `src/hooks/useOfflineStatus.jsx`

This hook detects offline/online status and manages syncing queued items when the connection is restored.

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { getQueueCount, getPendingItems, markItemComplete, markItemFailed, clearCompletedItems } from '@/lib/offlineQueue';

export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const syncingRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updateCounts = useCallback(async () => {
    try {
      const count = await getQueueCount();
      setPendingCount(count.pending || 0);
      setFailedCount(count.failed || 0);
    } catch {}
  }, []);

  useEffect(() => {
    updateCounts();
    const interval = setInterval(updateCounts, 10000);
    return () => clearInterval(interval);
  }, [updateCounts]);

  const syncQueue = useCallback(async (base44Client) => {
    if (!navigator.onLine || syncingRef.current) return;
    const client = base44Client || window.__base44Client;
    if (!client) return;

    syncingRef.current = true;
    setIsSyncing(true);
    try {
      await clearCompletedItems();

      const items = await getPendingItems();
      for (const item of items) {
        try {
          if (item.type === 'photo_upload' && item.data?.blob) {
            await client.files.upload(item.data.blob, item.metadata?.filename);
            await markItemComplete(item.id);
          } else if (item.type === 'entity_create' && item.entity_type) {
            const entity = client.entities[item.entity_type];
            if (entity) {
              await entity.create(item.data);
              await markItemComplete(item.id);
            }
          } else if (item.type === 'entity_update' && item.entity_type && item.entity_id) {
            const entity = client.entities[item.entity_type];
            if (entity) {
              await entity.update(item.entity_id, item.data);
              await markItemComplete(item.id);
            }
          }
        } catch (err) {
          console.warn('[Offline Sync] Failed to sync item:', item.id, err);
          await markItemFailed(item.id);
        }
      }

      await updateCounts();
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [updateCounts]);

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      const timer = setTimeout(() => syncQueue(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount, syncQueue]);

  useEffect(() => {
    if (isOnline) {
      const handleMessage = (event) => {
        if (event.data?.type === 'SYNC_OFFLINE_QUEUE') {
          syncQueue();
        }
      };

      navigator.serviceWorker?.addEventListener('message', handleMessage);
      return () => navigator.serviceWorker?.removeEventListener('message', handleMessage);
    }
  }, [isOnline, syncQueue]);

  useEffect(() => {
    if (isOnline && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        if ('sync' in registration) {
          registration.sync.register('sync-offline-queue').catch(() => {});
        }
      });
    }
  }, [isOnline]);

  return {
    isOnline,
    pendingCount,
    failedCount,
    isSyncing,
    syncQueue,
  };
}
```

---

### FILE 3: REPLACE — `src/components/MobileNav.jsx`

Replace the entire MobileNav.jsx with this version. It adds the Camera button, reorganized More menu, and offline banners.

```jsx
import React, { useState } from "react";
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
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { base44 } from "@/api/base44Client";
import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import { motion, AnimatePresence } from "framer-motion";

export default function MobileNav({ allNavItems, user, company }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { isOnline, pendingCount, failedCount, isSyncing } = useOfflineStatus();

  const navItems = [
    { title: "Dashboard", url: createPageUrl("Dashboard"), icon: LayoutDashboard },
    { title: "Leads", url: createPageUrl("Leads"), icon: UserPlus },
    { title: "Camera", url: createPageUrl("InspectionsDashboard"), icon: Camera, highlight: true },
    { title: "Calendar", url: createPageUrl("Calendar"), icon: Calendar },
  ];

  const isActive = (url) => location.pathname === url;

  const handleLinkClick = (url) => {
    setSheetOpen(false);
    navigate(url);
  };

  const fieldWorkItems = [
    { title: "Estimates", url: createPageUrl("Estimates"), icon: FileText, color: "text-orange-600", bg: "bg-orange-50" },
    { title: "Projects", url: createPageUrl("Projects"), icon: Briefcase, color: "text-blue-600", bg: "bg-blue-50" },
    { title: "Map", url: createPageUrl("Map"), icon: MapIcon, color: "text-red-600", bg: "bg-red-50" },
    { title: "Customers", url: createPageUrl("Customers"), icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
  ];

  const officeItems = [
    { title: "Invoices", url: createPageUrl("Invoices"), icon: Receipt, color: "text-green-600", bg: "bg-green-50" },
    { title: "Tasks", url: createPageUrl("Tasks"), icon: ClipboardList, color: "text-purple-600", bg: "bg-purple-50" },
    { title: "Communication", url: createPageUrl("Communication"), icon: MessageSquare, color: "text-teal-600", bg: "bg-teal-50" },
    { title: "Payments", url: createPageUrl("Payments"), icon: DollarSign, color: "text-yellow-600", bg: "bg-yellow-50" },
  ];

  const aiToolItems = [
    { title: "AI Assistant", url: createPageUrl("AIAssistant"), icon: Sparkles, color: "text-violet-600", bg: "bg-violet-50" },
    { title: "Reports", url: createPageUrl("Reports"), icon: BarChart3, color: "text-sky-600", bg: "bg-sky-50" },
    { title: "Documents", url: createPageUrl("Documents"), icon: Folder, color: "text-amber-600", bg: "bg-amber-50" },
    { title: "Knowledge Base", url: createPageUrl("KnowledgeBase"), icon: BookOpen, color: "text-indigo-600", bg: "bg-indigo-50" },
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
                <span className="text-sm font-medium">You're offline</span>
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
              <span className="text-sm font-medium">Syncing {pendingCount} items...</span>
              <div className="flex-1 bg-blue-400 rounded-full h-1.5 ml-2">
                <div className="bg-white rounded-full h-1.5 animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-16">
          {navItems.map((item) => (
            <Link
              key={item.title}
              to={item.url}
              data-testid={`bottom-nav-${item.title.toLowerCase()}`}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors min-w-[60px] active:bg-gray-50 ${
                item.highlight
                  ? "text-white"
                  : isActive(item.url)
                    ? "text-blue-600 font-semibold"
                    : "text-gray-500"
              }`}
            >
              {item.highlight ? (
                <div className="w-12 h-12 -mt-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg border-4 border-white">
                  <item.icon className="w-6 h-6 text-white" />
                </div>
              ) : (
                <item.icon className={`w-6 h-6 ${isActive(item.url) ? "text-blue-600" : ""}`} />
              )}
              <span className={`text-[10px] mt-0.5 ${item.highlight ? "text-blue-600 font-semibold -mt-0" : ""}`}>{item.title}</span>
            </Link>
          ))}

          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button
                data-testid="bottom-nav-more"
                className="flex flex-col items-center justify-center flex-1 h-full text-gray-500 transition-colors active:bg-gray-50 min-w-[60px]"
              >
                <Menu className="w-6 h-6" />
                <span className="text-[10px] mt-0.5 font-medium">More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl p-0 flex flex-col">
              <SheetHeader className="px-5 pt-4 pb-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <SheetTitle className="text-left text-lg font-semibold">
                    Menu
                  </SheetTitle>
                  {!isOnline && (
                    <div className="flex items-center gap-1.5 text-amber-600 text-xs font-medium bg-amber-50 rounded-full px-2.5 py-1">
                      <WifiOff className="w-3 h-3" />
                      Offline
                    </div>
                  )}
                </div>
                {company?.company_name && (
                  <p className="text-xs text-gray-400 text-left -mt-1">{company.company_name}</p>
                )}
              </SheetHeader>
              <ScrollArea className="flex-1 px-4 pb-6">
                {renderGridSection("Field Work", fieldWorkItems)}
                {renderGridSection("Office", officeItems)}
                {renderGridSection("Tools", aiToolItems)}

                <div className="border-t border-gray-100 mt-2 pt-3 space-y-1">
                  <button
                    data-testid="mobile-nav-settings"
                    onClick={() => {
                      setSheetOpen(false);
                      navigate(createPageUrl("GeneralSettings"));
                    }}
                    className="flex items-center w-full p-3 rounded-xl text-gray-700 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  >
                    <Settings className="w-5 h-5 text-gray-400 mr-3" />
                    <span>Settings</span>
                    <ChevronRight className="w-4 h-4 text-gray-300 ml-auto" />
                  </button>
                  <button
                    data-testid="mobile-nav-logout"
                    onClick={() => base44.auth.logout()}
                    className="flex items-center w-full p-3 rounded-xl text-red-600 font-medium hover:bg-red-50 active:bg-red-100 transition-colors"
                  >
                    <LogOut className="w-5 h-5 mr-3" />
                    <span>Logout</span>
                  </button>
                </div>

                <div className="pt-3 text-center text-[11px] text-gray-300">
                  {user?.full_name}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </>
  );
}
```

---

### FILE 4: UPDATE — `src/pages/Dashboard.jsx`

Two changes needed in Dashboard.jsx:

#### Change A: Add mobile detection (near the top of the component, after the first line of the function)

Add this right after `const navigate = useNavigate();` and `const queryClient = useQueryClient();`:

```jsx
const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

useEffect(() => {
  const checkMobile = () => setIsMobile(window.innerWidth < 768);
  window.addEventListener('resize', checkMobile);
  return () => window.removeEventListener('resize', checkMobile);
}, []);
```

Also add these imports at the top of the file if not already present:
```jsx
import { Camera, UserPlus, MapPin } from "lucide-react";
```
(CalendarIcon should already be imported — use whatever calendar icon alias exists in the file)

#### Change B: Add quick action cards (insert right BEFORE the "Top 4 Metric Cards" section)

Find the comment `{/* Top 4 Metric Cards */}` and add this block right BEFORE it:

```jsx
{isMobile && (
  <div className="grid grid-cols-4 gap-2 mb-4">
    {[
      { title: "New Lead", icon: UserPlus, color: "from-blue-500 to-blue-600", url: createPageUrl("Leads") + "?create=true" },
      { title: "Photos", icon: Camera, color: "from-emerald-500 to-emerald-600", url: createPageUrl("InspectionsDashboard") },
      { title: "Schedule", icon: CalendarIcon, color: "from-orange-500 to-orange-600", url: createPageUrl("Calendar") },
      { title: "Map", icon: MapPin, color: "from-red-500 to-red-600", url: createPageUrl("Map") },
    ].map((action) => (
      <button
        key={action.title}
        data-testid={`quick-action-${action.title.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={() => navigate(action.url)}
        className={`bg-gradient-to-br ${action.color} text-white rounded-2xl p-3 flex flex-col items-center justify-center gap-1.5 shadow-md active:scale-95 transition-transform min-h-[80px]`}
      >
        <action.icon className="w-7 h-7" />
        <span className="text-[11px] font-semibold leading-tight">{action.title}</span>
      </button>
    ))}
  </div>
)}
```

---

### FILE 5: UPDATE — `src/pages/Leads.jsx`

Two changes needed in Leads.jsx:

#### Change A: Add mobile detection and import SwipeableCard

Add at the top of the file:
```jsx
import SwipeableCard from "../components/SwipeableCard";
import { MapPin } from "lucide-react";
```

Add this right after the function declaration line (`export default function Leads() {`), after `const navigate = useNavigate();`:

```jsx
const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

useEffect(() => {
  const checkMobile = () => setIsMobile(window.innerWidth < 768);
  window.addEventListener('resize', checkMobile);
  return () => window.removeEventListener('resize', checkMobile);
}, []);
```

#### Change B: Add mobile card view

Inside the `<CardContent>` where leads are listed (the table section), wrap the table in a conditional and add the mobile card view:

Replace:
```jsx
<CardContent className="p-0">
  <div className="overflow-x-auto">
    <table className="w-full">
      ...existing table code...
    </table>
  </div>
</CardContent>
```

With:
```jsx
<CardContent className="p-0">
  {isMobile ? (
    <div className="px-3 py-3 space-y-0">
      {paginatedLeads.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <UserPlus className="w-16 h-16 mx-auto mb-3 text-gray-300" />
          <p className="font-medium">No leads found</p>
          <p className="text-sm mt-1">Try adjusting your search or filters</p>
        </div>
      )}
      {paginatedLeads.map((lead) => {
        const leadScore = getLeadScore(lead.id);
        return (
          <SwipeableCard
            key={lead.id}
            onCall={lead.phone ? () => handleCommunication(lead, 'phone') : null}
            onEmail={lead.email ? () => handleCommunication(lead, 'email') : null}
            onSMS={lead.phone ? () => handleCommunication(lead, 'sms') : null}
            onDelete={() => handleDelete(lead.id)}
            className="p-4 rounded-lg shadow-sm border border-gray-200"
          >
            <div
              onClick={() => navigate(createPageUrl('LeadProfile') + `?id=${lead.id}`)}
              className="space-y-2"
              data-testid={`lead-card-${lead.id}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-4">
                  <h3 className="font-semibold text-base text-gray-900">{lead.name}</h3>
                  {lead.company && (
                    <p className="text-sm text-gray-500 mt-0.5">{lead.company}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline" className={getStatusColor(lead.status)}>
                    {lead.status}
                  </Badge>
                  {renderTemperatureBadge(lead.id)}
                </div>
              </div>

              <div className="space-y-1.5">
                {lead.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <a href={`tel:${lead.phone}`} className="text-blue-600 font-medium" onClick={(e) => e.stopPropagation()}>
                      {lead.phone}
                    </a>
                  </div>
                )}
                {lead.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="text-blue-600 truncate">{lead.email}</span>
                  </div>
                )}
                {(lead.street || lead.city) && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="truncate">{[lead.street, lead.city, lead.state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
              </div>

              {lead.service_needed && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 truncate">
                  {lead.service_needed}
                </p>
              )}

              <div className="flex items-center justify-between text-xs text-gray-400 pt-1.5 border-t border-gray-100">
                <span>{lead.source || 'No source'}</span>
                {lead.value > 0 && (
                  <span className="font-semibold text-green-600 text-sm">${lead.value.toLocaleString()}</span>
                )}
                <span>{safeFormatDate(lead.created_date, 'MMM d')}</span>
              </div>
            </div>
          </SwipeableCard>
        );
      })}
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full">
        ...existing table code stays exactly as-is...
      </table>
    </div>
  )}
</CardContent>
```

---

### FILE 6: UPDATE — `src/Layout.jsx`

Make sure MobileNav is imported and rendered only on mobile. These should already be in place, but verify:

At the top:
```jsx
import MobileNav from "@/components/MobileNav";
```

In the JSX where the layout renders (near the bottom), make sure this exists:
```jsx
{isMobile && <MobileNav allNavItems={displayNavigationItems} user={user} company={myCompany} />}
```

The Layout already uses `useMediaQuery("(max-width: 768px)")` to detect mobile — no changes needed there.

---

## Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/components/SwipeableCard.jsx` | NEW | Swipe-to-action card component |
| `src/hooks/useOfflineStatus.jsx` | NEW | Offline/online detection hook |
| `src/components/MobileNav.jsx` | REPLACE | Bottom nav + Camera + More menu + offline banners |
| `src/pages/Dashboard.jsx` | UPDATE | Add mobile quick action cards |
| `src/pages/Leads.jsx` | UPDATE | Add mobile swipeable card view |
| `src/Layout.jsx` | VERIFY | Ensure MobileNav is mounted on mobile |

No backend or Base44 function changes are needed — this is all frontend code.
