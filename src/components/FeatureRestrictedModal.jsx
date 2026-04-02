import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const PLAN_FEATURES_MAP = {
  'ai-tools': { requiredPlan: 'business', message: 'Advanced AI Tools (Lexi Memory, Permit Assistant, Daily Reports) are available on Business plan and above' },
  'field-operations': { requiredPlan: 'business', message: 'Field Operations features are available on Business plan and above' },
  'reports': { requiredPlan: 'business', message: 'Advanced Reports are available on Business plan and above' },
  'accounting': { requiredPlan: 'enterprise', message: 'Full Accounting features are available on Enterprise plan' },
  'storm-tracking': { requiredPlan: 'business', message: 'Storm Tracking is available on Business plan and above' },
  'lead-finder': { requiredPlan: 'business', message: 'Lead Finder is available on Business plan and above' },
  'lead-inspections': { requiredPlan: 'business', message: 'Lead Inspections are available on Business plan and above' },
  'commissions': { requiredPlan: 'business', message: 'Commission Tracking is available on Business plan and above' },
  'ai-damage': { requiredPlan: 'business', message: 'AI Damage Analysis is available on Business plan and above' },
  'subcontractors': { requiredPlan: 'enterprise', message: 'Subcontractor Management is available on Enterprise plan' },
  'campaigns': { requiredPlan: 'business', message: 'Campaign Manager is available on Business plan and above' },
  'workflow-automation': { requiredPlan: 'business', message: 'Workflow Automation is available on Business plan and above' },
  'contracts': { requiredPlan: 'business', message: 'Contract Signing & Management is available on Business plan and above' },
};

export function FeatureRestrictedModal({ restrictedFeature, onClose }) {
  const navigate = useNavigate();
  
  // Wait for restrictedFeature to be present before rendering anything logic-wise, 
  // though the parent should control 'open' state.
  if (!restrictedFeature) return null;

  return (
    <AlertDialog open={!!restrictedFeature} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-amber-600" />
            <AlertDialogTitle>Feature Restricted</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pt-2">
            {restrictedFeature.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-3">
          <AlertDialogCancel onClick={onClose}>Dismiss</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onClose();
              navigate(createPageUrl('Pricing'));
            }}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <Zap className="w-4 h-4 mr-2" />
            View Plans
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function useFeatureRestriction() {
  const [restrictedFeature, setRestrictedFeature] = React.useState(null);

  const checkFeatureAccess = (featureId, currentPlanLevel, isPlatformAdmin, userEmail) => {
    if (isPlatformAdmin) return true; // Platform admin has full access

    // Bypass restrictions for YICN/CompanySync related emails
    if (userEmail) {
      const email = userEmail.toLowerCase();
      if (email.includes('yicn') || 
          email.includes('companysync') || 
          email.includes('insuranceclaimsnetwork') ||
          email === 'io.companysync@gmail.com' ||
          email === 'stonekevin866@gmail.com' ||
          email === 'yicnteam@gmail.com') {
        return true;
      }
    }

    const feature = PLAN_FEATURES_MAP[featureId];
    if (!feature) return true; // Unknown feature, allow access

    const planHierarchy = { trial: 3, basic: 0, business: 1, professional: 1, enterprise: 2 };
    const requiredLevel = planHierarchy[feature.requiredPlan] || 0;

    if (currentPlanLevel < requiredLevel) {
      setRestrictedFeature(feature);
      return false;
    }
    return true;
  };

  return {
    restrictedFeature,
    setRestrictedFeature,
    checkFeatureAccess,
  };
}

export default useFeatureRestriction;