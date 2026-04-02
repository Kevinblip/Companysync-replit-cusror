import React, { useState, useEffect } from 'react';
import { X, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";

export default function TourTrigger({ onStartTour, myCompany, myStaffProfile }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!myCompany) return;

    // Check localStorage first (fastest)
    const localTourCompleted = localStorage.getItem('companySync_tour_completed');
    
    // Check user profile (persistent)
    const profileTourCompleted = myStaffProfile?.tour_completed === true;

    if (localTourCompleted || profileTourCompleted) return;

    // Logic: Only show for new trials or very new companies (< 14 days)
    const isTrial = myCompany.subscription_plan === 'trial';
    const createdDate = new Date(myCompany.created_date || new Date());
    const daysOld = (new Date() - createdDate) / (1000 * 60 * 60 * 24);
    const isNew = daysOld < 14;

    if (isTrial || isNew) {
      // Show prompt after a short delay
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [myCompany, myStaffProfile]);

  const markAsCompleted = async () => {
    localStorage.setItem('companySync_tour_completed', 'true');
    if (myStaffProfile?.id) {
      try {
        await base44.entities.StaffProfile.update(myStaffProfile.id, {
          tour_completed: true
        });
      } catch (e) {
        console.error("Failed to update tour status", e);
      }
    }
  };

  const handleStart = () => {
    setIsVisible(false);
    onStartTour();
    markAsCompleted();
  };

  const handleDismiss = () => {
    setIsVisible(false);
    markAsCompleted();
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 50, scale: 0.9 }}
          className="fixed bottom-6 right-6 z-40 max-w-sm w-full"
        >
          <div className="bg-slate-900 text-white p-5 rounded-xl shadow-2xl border border-slate-700 relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-500 rounded-full opacity-20 blur-xl"></div>
            
            <button 
              onClick={handleDismiss}
              className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg">
                  <PlayCircle className="w-6 h-6 text-white" />
                </div>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-1">Got 5 minutes?</h3>
                <p className="text-slate-300 text-sm mb-4 leading-relaxed">
                  Take a quick tour of CompanySync to discover features that can help grow your business.
                </p>
                <div className="flex gap-3">
                  <Button 
                    onClick={handleStart}
                    className="bg-blue-600 hover:bg-blue-500 text-white border-none shadow-md"
                    size="sm"
                  >
                    Take a Tour
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={handleDismiss}
                    className="text-slate-300 hover:text-white hover:bg-white/10"
                    size="sm"
                  >
                    No thanks
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}