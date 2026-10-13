import React, { useEffect, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  Plus, X, UserPlus, Briefcase, FileText, Calendar, Sparkles, Receipt,
  Users, Camera, CheckCircle2, CreditCard, FileSignature, BarChart3,
  UserCog, ShoppingCart, Cloud, Zap, Mic, UserCircle,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { motion } from "framer-motion";
import { SHORTCUT_MAP, DEFAULT_SHORTCUT_IDS } from "@/config/quickCreateShortcuts";

export const PILL_COLOR_MAP = {
  ask_lexi:      "bg-gradient-to-r from-purple-500 to-pink-500",
  lead:          "bg-blue-500",
  customer:      "bg-green-500",
  estimate:      "bg-purple-500",
  invoice:       "bg-emerald-600",
  build:         "bg-amber-500",
  inspection:    "bg-pink-500",
  task:          "bg-teal-500",
  payment:       "bg-indigo-500",
  contract:      "bg-cyan-600",
  report:        "bg-violet-500",
  crew_member:   "bg-yellow-500",
  material_order:"bg-red-500",
  calendar_event:"bg-orange-500",
  storm_tracking:"bg-slate-500",
  ghl_import:    "bg-emerald-500",
  live_voice:    "bg-indigo-600",
  voice_message: "bg-violet-600",
};

const ICON_OVERRIDE_MAP = {
  lead: UserPlus,
  customer: Briefcase,
  calendar_event: Calendar,
};

export default function FloatingActionButton({ company }) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname, location.search]);

  const hiddenPages = [
    createPageUrl("AIAssistant"),
    createPageUrl("LiveVoice"),
    createPageUrl("GeminiLiveMode"),
  ];
  if (hiddenPages.some(p => location.pathname === p)) return null;

  const savedShortcuts = company?.settings?.quick_create_shortcuts;
  const isCustom = Array.isArray(savedShortcuts) && savedShortcuts.length > 0;
  // Normalize to [{id, color}] — color is the saved Tailwind text-* class (may be null)
  const activeSlots = isCustom
    ? savedShortcuts.map(item => typeof item === "string" ? { id: item, color: null } : { id: item.id, color: item.color || null })
    : DEFAULT_SHORTCUT_IDS.map(id => ({ id, color: null }));

  // Legacy separate overrides map (backward compat)
  const colorOverrides = company?.settings?.shortcut_color_overrides || {};

  // Convert a Tailwind text-* class to a bg-* class for pill backgrounds.
  // Falls back to PILL_COLOR_MAP default, then generic blue.
  function resolvePillColor(id, slotColor) {
    const textClass = slotColor || colorOverrides[id] || null;
    if (textClass && textClass.startsWith("text-")) {
      return textClass.replace("text-", "bg-");
    }
    return PILL_COLOR_MAP[id] || "bg-blue-500";
  }

  // Ask Lexi is always pinned at the top — dedupe if already in the list
  const lexiSlot = { id: "ask_lexi", color: null };
  const dedupedSlots = [lexiSlot, ...activeSlots.filter(s => s.id !== "ask_lexi")];

  const actions = dedupedSlots
    .map(slot => {
      const shortcut = SHORTCUT_MAP[slot.id];
      if (!shortcut) return null;
      const Icon = ICON_OVERRIDE_MAP[slot.id] || shortcut.icon;
      return {
        icon: Icon,
        label: shortcut.label,
        color: resolvePillColor(slot.id, slot.color),
        onClick: () => navigate(createPageUrl(shortcut.page) + (shortcut.params || "")),
      };
    })
    .filter(Boolean);

  return createPortal(
    <div className="fixed right-4 z-30" style={{ bottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
      {/* Remove choices immediately; an exiting portal can survive a route
          suspension even after the toggle has switched back to closed. */}
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-2 mb-3"
            style={{
              maxHeight: "calc(100dvh - 180px)",
              overflowY: "auto",
              overflowX: "visible",
              paddingRight: 2,
            }}
          >
            {actions.map((action, index) => (
              <motion.button
                key={action.label}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.04 }}
                onClick={() => {
                  flushSync(() => setIsOpen(false));
                  action.onClick();
                }}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                className={`${action.color} text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2 pr-4 pl-2.5 py-2.5 flex-shrink-0`}
              >
                <action.icon className="w-4.5 h-4.5" />
                <span className="text-sm font-medium whitespace-nowrap">{action.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}

      <motion.button
        type="button"
        data-testid="fab-main-button"
        aria-label={isOpen ? "Close quick-create menu" : "Open quick-create menu"}
        aria-expanded={isOpen}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(v => !v)}
        className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all"
        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
      >
        {isOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
      </motion.button>
    </div>,
    document.body
  );
}
