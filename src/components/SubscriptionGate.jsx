import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Sparkles, Zap, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

// Subscription tier feature limits
export const SUBSCRIPTION_LIMITS = {
  trial: {
    max_users: 5,
    max_customers: 100,
    max_leads: 250,
    crewcam_monthly: 10,
    ai_queries_monthly: 1000,
  },
  basic: {
    max_users: 5,
    max_customers: 100,
    max_leads: 250,
    crewcam_monthly: 10,
    ai_queries_monthly: 1000,
  },
  business: {
    max_users: 10,
    max_customers: 1000,
    max_leads: null, // unlimited
    crewcam_monthly: null, // unlimited
    ai_queries_monthly: 10000,
  },
  enterprise: {
    max_users: 25,
    max_customers: null, // unlimited
    max_leads: null, // unlimited
    crewcam_monthly: null, // unlimited
    ai_queries_monthly: null, // unlimited
  }
};

// Feature availability by plan
export const PLAN_FEATURES = {
  basic: [
    'customers', 'leads', 'projects', 'tasks', 'estimates', 'proposals', 'invoices',
    'payments', 'calendar', 'crewcam_basic', 'ai_estimator_basic', 'lexi_ai_basic',
    'email_sms', 'templates', 'documents', 'pdf_branding', 'mobile_app'
  ],
  business: [
    'crewcam_unlimited', 'ai_damage_analysis', 'storm_tracking', 'lead_finder',
    'sarah_ai', 'marcus_ai', 'workflows', 'campaigns', 'commission_tracking',
    'field_sales_tracker', 'territory_manager', 'round_robin', 'live_call_dashboard',
    'contract_signing', 'review_automation', 'quickbooks', 'gohighlevel', 'custom_integrations'
  ],
  enterprise: [
    'accounting_full', 'family_commissions', 'subcontractors', 'advanced_roles',
    'white_label_portal', 'video_training', 'permit_assistant', 'daily_ai_reports',
    'competitor_analysis', 'advanced_analytics', 'custom_fields', 'knowledge_base',
    'api_access'
  ]
};

export function hasFeatureAccess(plan, feature) {
  if (plan === 'enterprise') return true;
  if (plan === 'business') {
    return PLAN_FEATURES.basic.includes(feature) || PLAN_FEATURES.business.includes(feature);
  }
  if (plan === 'basic' || plan === 'trial') {
    return PLAN_FEATURES.basic.includes(feature);
  }
  return false;
}

export function SubscriptionGate({ plan, requiredPlan, feature, children }) {
  const navigate = useNavigate();
  
  const planHierarchy = { trial: 0, basic: 0, business: 1, professional: 1, enterprise: 2 };
  const currentLevel = planHierarchy[plan] || 0;
  const requiredLevel = planHierarchy[requiredPlan] || 0;

  if (currentLevel >= requiredLevel) {
    return <>{children}</>;
  }

  const planIcons = {
    basic: Sparkles,
    business: Zap,
    professional: Zap,
    enterprise: Crown
  };

  const PlanIcon = planIcons[requiredPlan] || Lock;

  return (
    <Card className="border-2 border-dashed border-gray-300 bg-gradient-to-br from-gray-50 to-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-gray-700">
          <Lock className="w-5 h-5" />
          {requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)} Plan Required
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-gray-600">
          Upgrade to <strong>{requiredPlan.charAt(0).toUpperCase() + requiredPlan.slice(1)}</strong> to unlock {feature || 'this feature'}.
        </p>
        <Button 
          onClick={() => navigate(createPageUrl('Pricing'))}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
        >
          <PlanIcon className="w-4 h-4 mr-2" />
          View Plans & Upgrade
        </Button>
      </CardContent>
    </Card>
  );
}

export default SubscriptionGate;