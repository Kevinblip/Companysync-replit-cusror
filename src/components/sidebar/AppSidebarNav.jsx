import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Home,
  CloudLightning,
  House,
  Camera,
  FileSignature,
  Hammer,
  DollarSign,
  MessageSquare,
  Zap,
  BarChart3,
  HelpCircle,
  Settings,
  Search,
  Star,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Layers,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { buildSidebarModel, findAncestorIds, isNavItemActive } from "@/lib/sidebarNav";

const ICONS = {
  Home,
  CloudLightning,
  House,
  Camera,
  FileSignature,
  Hammer,
  DollarSign,
  MessageSquare,
  Zap,
  BarChart3,
  HelpCircle,
  Settings,
  CreditCard,
  Layers,
};

function loadPrefs(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      open: parsed.open && typeof parsed.open === "object" ? parsed.open : {},
      pins: Array.isArray(parsed.pins) ? parsed.pins : [],
    };
  } catch {
    return null;
  }
}

function useNavPrefs(userEmail) {
  const key = `companysync_nav_v1_${userEmail || "anonymous"}`;
  const [prefs, setPrefs] = useState(() => loadPrefs(key) || { open: { home: true }, pins: [] });
  const skipSave = useRef(true);

  useEffect(() => {
    setPrefs(loadPrefs(key) || { open: { home: true }, pins: [] });
    skipSave.current = true;
  }, [key]);

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    localStorage.setItem(key, JSON.stringify(prefs));
  }, [key, prefs]);

  return [prefs, setPrefs];
}

function Icon({ name, className }) {
  const Comp = ICONS[name];
  if (!Comp) return null;
  return <Comp className={className} />;
}

export function NavCommandPalette({ open, onOpenChange, pages, onSelect }) {
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const page of pages) {
      const key = page.section || "Pages";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(page);
    }
    return Array.from(groups.entries());
  }, [pages]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages…" />
      <CommandList>
        <CommandEmpty>No matching pages.</CommandEmpty>
        {grouped.map(([section, items]) => (
          <CommandGroup key={section} heading={section}>
            {items.map((item) => (
              <CommandItem
                key={`${item.section}-${item.source || item.id}-${item.url}`}
                value={`${item.label} ${item.tooltip || ""} ${(item.synonyms || []).join(" ")} ${item.section}`}
                onSelect={() => onSelect(item)}
              >
                <span className="flex flex-col">
                  <span>{item.label}</span>
                  {item.tooltip && (
                    <span className="text-xs text-muted-foreground line-clamp-2">{item.tooltip}</span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

function NavLeaf({ item, pathname, search, pinned, onTogglePin, onNavigate, showSubtitle }) {
  const active = isNavItemActive(item.url, pathname, search);
  return (
    <div className="group relative">
      <Link
        to={item.url}
        title={item.tooltip}
        data-testid={`nav-${(item.source || item.id || item.label).toString().replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}
        onClick={(e) => onNavigate(e, item)}
        className={`block rounded-lg pl-3 pr-9 py-2 min-h-[44px] text-sm text-white hover:bg-white/10 transition-colors ${
          active ? "bg-white/20 shadow-lg" : ""
        }`}
      >
        <span className="block font-medium leading-snug">{item.label}</span>
        {showSubtitle && item.tooltip && (
          <span className="block text-[11px] leading-snug text-blue-100/75 mt-0.5">{item.tooltip}</span>
        )}
      </Link>
      <button
        type="button"
        title={pinned ? "Unpin from favorites" : "Pin to favorites"}
        aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTogglePin(item);
        }}
        className={`absolute right-1 top-1.5 rounded-md w-8 h-8 text-blue-100 hover:bg-white/10 hover:text-white flex items-center justify-center ${
          pinned ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-70"
        }`}
      >
        <Star className={`w-3.5 h-3.5 ${pinned ? "fill-amber-300 text-amber-300" : ""}`} />
      </button>
    </div>
  );
}

function NavGroup({ node, depth, openMap, toggle, pathname, search, pins, onTogglePin, onNavigate, showSubtitle }) {
  const open = !!openMap[node.id];
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className={depth > 0 ? "ml-3" : ""}>
      <button
        type="button"
        title={node.tooltip}
        aria-expanded={open}
        data-testid={`nav-section-${node.id}`}
        onClick={() => toggle(node.id)}
        className="hover:bg-white/10 text-white transition-all duration-200 rounded-lg mb-1 w-full flex items-center justify-between gap-2 min-h-[44px] px-3 py-2"
      >
        <span className="flex items-center gap-3 min-w-0">
          {node.icon && depth === 0 && <Icon name={node.icon} className="w-5 h-5 shrink-0" />}
          <span className={`font-medium text-left leading-snug ${depth === 0 ? "text-sm" : "text-sm text-blue-100"}`}>
            {node.label}
          </span>
        </span>
        <Chevron className="w-4 h-4 shrink-0" />
      </button>
      {open && (
        <div className={`${depth === 0 ? "ml-4" : "ml-2"} mb-1 space-y-0.5`}>
          {node.items.map((child) =>
            child.items ? (
              <NavGroup
                key={child.id}
                node={child}
                depth={depth + 1}
                openMap={openMap}
                toggle={toggle}
                pathname={pathname}
                search={search}
                pins={pins}
                onTogglePin={onTogglePin}
                onNavigate={onNavigate}
                showSubtitle={showSubtitle}
              />
            ) : (
              <NavLeaf
                key={child.source || child.id}
                item={child}
                pathname={pathname}
                search={search}
                pinned={pins.includes(child.source || child.id)}
                onTogglePin={onTogglePin}
                onNavigate={onNavigate}
                showSubtitle={showSubtitle}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function AppSidebarNav({
  visibleSources,
  canOpenSettings,
  isPlatformStaff,
  userEmail,
  pathname,
  search,
  showSettings,
  onNavigate,
  onOpenSearch,
  registerCloseMobile,
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const model = useMemo(
    () => buildSidebarModel({ visibleSources, canOpenSettings, isPlatformStaff }),
    [visibleSources, canOpenSettings, isPlatformStaff]
  );
  const [prefs, setPrefs] = useNavPrefs(userEmail);
  const [settingsQuery, setSettingsQuery] = useState("");

  useEffect(() => {
    if (registerCloseMobile) registerCloseMobile(() => setOpenMobile(false));
  }, [registerCloseMobile, setOpenMobile]);

  const pathKey = `${pathname}${search}`;
  useEffect(() => {
    const ancestors = [
      ...(findAncestorIds(model.sections, pathname, search) || []),
      ...(findAncestorIds(model.footer, pathname, search) || []),
    ];
    if (!ancestors.length) return;
    setPrefs((prev) => {
      const open = { ...prev.open };
      let changed = false;
      for (const id of ancestors) {
        if (!open[id]) {
          open[id] = true;
          changed = true;
        }
      }
      return changed ? { ...prev, open } : prev;
    });
  }, [pathKey, model, pathname, search, setPrefs]);

  const toggle = (id) => {
    setPrefs((prev) => ({ ...prev, open: { ...prev.open, [id]: !prev.open[id] } }));
  };

  const pinKey = (item) => item.source || item.id;

  const togglePin = (item) => {
    const key = pinKey(item);
    setPrefs((prev) => {
      const has = prev.pins.includes(key);
      return { ...prev, pins: has ? prev.pins.filter((p) => p !== key) : [...prev.pins, key] };
    });
  };

  const pinnedItems = prefs.pins
    .map((key) => model.pages.find((page) => (page.source || page.id) === key))
    .filter(Boolean);

  const settingsQueryNorm = settingsQuery.trim().toLowerCase();
  const filteredSettings = model.settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!settingsQueryNorm) return true;
        const hay = `${item.label} ${item.tooltip || ""} ${(item.synonyms || []).join(" ")}`.toLowerCase();
        return hay.includes(settingsQueryNorm);
      }),
    }))
    .filter((group) => group.items.length > 0);

  if (showSettings) {
    return (
      <div className="flex flex-col flex-1 h-full min-h-0" data-testid="settings-panel">
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-2 rounded-lg bg-white/10 px-3 min-h-[44px]">
            <Search className="w-4 h-4 text-blue-100 shrink-0" />
            <input
              value={settingsQuery}
              onChange={(e) => setSettingsQuery(e.target.value)}
              placeholder="Search settings…"
              data-testid="settings-search"
              className="w-full bg-transparent text-sm text-white placeholder:text-blue-200/70 outline-none"
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-6">
          {filteredSettings.length === 0 && (
            <p className="text-sm text-blue-100/80 px-2 py-4">No matching settings.</p>
          )}
          {filteredSettings.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-200/80">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLeaf
                    key={`${group.id}-${item.source || item.id}`}
                    item={item}
                    pathname={pathname}
                    search={search}
                    pinned={prefs.pins.includes(pinKey(item))}
                    onTogglePin={togglePin}
                    onNavigate={onNavigate}
                    showSubtitle={isMobile}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0" data-testid="app-sidebar-nav">
      <div className="px-3 pt-3 pb-2 shrink-0 space-y-2">
        <button
          type="button"
          onClick={onOpenSearch}
          data-testid="sidebar-search"
          title="Search pages"
          className="w-full flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 text-blue-100 px-3 min-h-[44px] text-left"
        >
          <Search className="w-4 h-4 shrink-0" />
          <span className="flex-1 text-sm">Search pages…</span>
          <kbd className="text-[10px] bg-white/10 rounded px-1.5 py-0.5 text-blue-50">⌘K</kbd>
        </button>
        {pinnedItems.length > 0 && (
          <div data-testid="pinned-strip">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-200/80 flex items-center gap-1">
              <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
              Pinned
            </p>
            <div className="flex flex-wrap gap-1">
              {pinnedItems.map((item) => (
                <Link
                  key={pinKey(item)}
                  to={item.url}
                  title={item.tooltip}
                  onClick={(e) => onNavigate(e, item)}
                  className={`text-xs text-white rounded-full px-2.5 py-1 bg-white/10 hover:bg-white/20 ${
                    isNavItemActive(item.url, pathname, search) ? "bg-white/25" : ""
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
        {model.sections.map((section) => (
          <NavGroup
            key={section.id}
            node={section}
            depth={0}
            openMap={prefs.open}
            toggle={toggle}
            pathname={pathname}
            search={search}
            pins={prefs.pins}
            onTogglePin={togglePin}
            onNavigate={onNavigate}
            showSubtitle={isMobile}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-white/15 px-2 py-2 bg-black/10">
        {model.footer.map((section) => (
          <NavGroup
            key={section.id}
            node={section}
            depth={0}
            openMap={prefs.open}
            toggle={toggle}
            pathname={pathname}
            search={search}
            pins={prefs.pins}
            onTogglePin={togglePin}
            onNavigate={onNavigate}
            showSubtitle={isMobile}
          />
        ))}
        {canOpenSettings && (
          <button
            type="button"
            data-testid="nav-settings"
            onClick={() => onNavigate(null, { openSettings: true })}
            title="Company, team, phone, payments, and integrations"
            className="hover:bg-white/10 text-white transition-all duration-200 rounded-lg mb-1 w-full flex items-center justify-between gap-2 min-h-[44px] px-3 py-2 bg-gradient-to-r from-purple-600/30 to-blue-600/30"
          >
            <span className="flex items-center gap-3">
              <Settings className="w-5 h-5" />
              <span className="font-medium text-sm">Settings</span>
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export { useNavPrefs };
