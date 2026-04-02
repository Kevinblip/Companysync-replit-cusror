import React, { useState } from "react";
import { Plus, X, UserPlus, Briefcase, FileText, Calendar, Sparkles, Receipt, Mic } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { motion, AnimatePresence } from "framer-motion";

export default function FloatingActionButton() {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Hide the FAB on pages that have their own full-screen input (Lexi, Live Voice)
  const hiddenPages = [
    createPageUrl("AIAssistant"),
    createPageUrl("LiveVoice"),
    createPageUrl("GeminiLiveMode"),
  ];
  if (hiddenPages.some(p => location.pathname === p)) return null;

  const actions = [
    { icon: UserPlus,  label: "Add Lead",        onClick: () => navigate(createPageUrl("Leads") + "?create=true"),           color: "bg-blue-500" },
    { icon: Briefcase, label: "Add Customer",    onClick: () => navigate(createPageUrl("Customers") + "?create=true"),       color: "bg-green-500" },
    { icon: FileText,  label: "New Estimate",    onClick: () => navigate(createPageUrl("Estimates") + "?create=true"),       color: "bg-purple-500" },
    { icon: Receipt,   label: "New Invoice",     onClick: () => navigate(createPageUrl("Invoices") + "?create=true"),        color: "bg-emerald-600" },
    { icon: Calendar,  label: "Schedule",        onClick: () => navigate(createPageUrl("Calendar")),                         color: "bg-orange-500" },
    { icon: Mic,       label: "Live Voice",      onClick: () => navigate(createPageUrl("LiveVoice")),                        color: "bg-indigo-500" },
    { icon: Sparkles,  label: "Ask Lexi",        onClick: () => navigate(createPageUrl("AIAssistant")),                      color: "bg-gradient-to-r from-purple-500 to-pink-500" },
  ];

  return (
    <div className="fixed right-4 z-30" style={{ bottom: "calc(80px + env(safe-area-inset-bottom, 0px))" }}>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
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
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.04 }}
                onClick={() => {
                  action.onClick();
                  setIsOpen(false);
                }}
                className={`${action.color} text-white rounded-full shadow-lg hover:shadow-xl transition-all flex items-center gap-2 pr-4 pl-2.5 py-2.5 flex-shrink-0`}
              >
                <action.icon className="w-4.5 h-4.5" />
                <span className="text-sm font-medium whitespace-nowrap">{action.label}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        data-testid="fab-main-button"
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all"
      >
        {isOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
      </motion.button>
    </div>
  );
}
