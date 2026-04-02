import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createPageUrl } from "@/utils";
import {
  CreditCard,
  KeyRound,
  Sparkles,
  Mail,
  Phone,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Zap,
  Shield,
  TrendingUp,
  DollarSign,
  Info,
  ExternalLink,
  ChevronRight,
  Star,
  Lock,
} from "lucide-react";

const PLAN_DETAILS = {
  trial: {
    label: "Free Trial",
    color: "bg-gray-100 text-gray-700 border-gray-300",
    badgeColor: "secondary",
    description: "Platform AI keys with usage limits. Upgrade to use your own keys.",
    level: 0,
  },
  basic: {
    label: "Basic",
    color: "bg-blue-50 text-blue-700 border-blue-300",
    badgeColor: "outline",
    description: "Bring your own API keys. Pay only for what you use.",
    level: 1,
  },
  business: {
    label: "Business",
    color: "bg-purple-50 text-purple-700 border-purple-300",
    badgeColor: "outline",
    description: "Full BYOK support with metered billing and priority support.",
    level: 2,
  },
  enterprise: {
    label: "Enterprise",
    color: "bg-amber-50 text-amber-700 border-amber-300",
    badgeColor: "outline",
    description: "Unlimited usage, dedicated support, and custom integrations.",
    level: 3,
  },
  legacy: {
    label: "Legacy",
    color: "bg-green-50 text-green-700 border-green-300",
    badgeColor: "outline",
    description: "Legacy access with full platform features.",
    level: 2,
  },
};

function PlanBadge({ plan }) {
  const details = PLAN_DETAILS[plan] || PLAN_DETAILS.trial;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold border ${details.color}`}>
      <Star className="w-3.5 h-3.5" />
      {details.label}
    </span>
  );
}

function KeyStatusCard({ icon: Icon, title, connected, description, configUrl, color }) {
  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border ${connected ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-sm">{title}</span>
          {connected ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-gray-400" />
          )}
        </div>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs h-7 px-2"
        onClick={() => window.location.href = configUrl}
        data-testid={`btn-configure-${title.toLowerCase().replace(/\s/g, '-')}`}
      >
        {connected ? "Manage" : "Set Up"}
        <ChevronRight className="w-3 h-3 ml-1" />
      </Button>
    </div>
  );
}

function HowItWorksCard({ isTrial }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-500" />
          How Billing Works
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={`p-3 rounded-lg border ${isTrial ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">1</div>
              <span className="font-medium text-sm">Free Trial</span>
              {isTrial && <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 ml-auto">You are here</Badge>}
            </div>
            <p className="text-xs text-gray-600">Platform handles all AI costs. Limited usage per month to get you started.</p>
          </div>
          <div className={`p-3 rounded-lg border ${!isTrial ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-xs font-bold text-white">2</div>
              <span className="font-medium text-sm">Paid Plan (BYOK)</span>
              {!isTrial && <Badge variant="outline" className="text-xs border-green-300 text-green-600 ml-auto">Active</Badge>}
            </div>
            <p className="text-xs text-gray-600">Bring your own API keys. You pay your providers directly. We charge a small platform fee.</p>
          </div>
        </div>

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Platform Fees (Paid Plans)</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="flex items-start gap-2 p-2.5 bg-white rounded border border-gray-200">
              <Sparkles className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium">AI Usage</p>
                <p className="text-xs text-gray-500">Per Sarah call / Lexi session / SMS reply</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2.5 bg-white rounded border border-gray-200">
              <DollarSign className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium">Stripe Payments</p>
                <p className="text-xs text-gray-500">0.5% on payments processed via our platform</p>
              </div>
            </div>
            <div className="flex items-start gap-2 p-2.5 bg-white rounded border border-gray-200">
              <Shield className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium">Platform Subscription</p>
                <p className="text-xs text-gray-500">Monthly fee for platform access and support</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function BillingDashboard() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  const userEmail = user?.email;

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_at"),
    initialData: [],
    enabled: !!userEmail,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-billing', userEmail],
    queryFn: () => userEmail ? base44.entities.StaffProfile.filter({ user_email: userEmail }) : [],
    enabled: !!userEmail,
    initialData: [],
  });

  const myCompany = useMemo(() => {
    if (!user) return null;
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) return companies.find(c => c.id === impersonatedId) || null;
    const lastUsedId = localStorage.getItem('last_used_company_id');
    if (lastUsedId) {
      const found = companies.find(c => c.id === lastUsedId);
      if (found) return found;
    }
    const owned = companies.filter(c => c.created_by === user.email);
    if (owned.length > 0) return owned[0];
    if (staffProfiles.length > 0 && staffProfiles[0]?.company_id) {
      return companies.find(c => c.id === staffProfiles[0].company_id) || null;
    }
    return null;
  }, [user, companies, staffProfiles]);

  const companyId = myCompany?.id;
  const subscriptionPlan = myCompany?.subscription_plan || 'trial';
  const isTrial = subscriptionPlan === 'trial';
  const planDetails = PLAN_DETAILS[subscriptionPlan] || PLAN_DETAILS.trial;
  const apiKeysUrl = createPageUrl("APIKeysSettings");

  const { data: apiKeysData, isLoading: isLoadingKeys } = useQuery({
    queryKey: ['company-api-keys', companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const resp = await fetch(`/api/local/company-api-keys/${companyId}`);
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: !!companyId,
  });

  const aiConnected = apiKeysData?.gemini?.connected || false;
  const emailConnected = apiKeysData?.email?.connected || false;
  const voiceConnected = apiKeysData?.twilio?.connected || false;
  const connectedCount = [aiConnected, emailConnected, voiceConnected].filter(Boolean).length;

  const apiKeyUrl = createPageUrl("APIKeysSettings");

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6" data-testid="page-billing-dashboard">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-blue-600" />
          Billing & API Keys
        </h1>
        <p className="text-gray-500 mt-1 text-sm">Manage your subscription, connect your own API keys, and view usage.</p>
      </div>

      {/* Current Plan Card */}
      <Card className="border-2" data-testid="card-current-plan">
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <PlanBadge plan={subscriptionPlan} />
                <span className="text-sm text-gray-500">Current Plan</span>
              </div>
              <p className="text-sm text-gray-600">{planDetails.description}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {isTrial && (
                <Button
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => window.location.href = createPageUrl("Pricing")}
                  data-testid="btn-upgrade-plan"
                >
                  <Zap className="w-4 h-4 mr-1.5" />
                  Upgrade Plan
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => window.location.href = createPageUrl("ManageSubscription")}
                data-testid="btn-manage-subscription"
              >
                Manage Subscription
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>

          {isTrial && (
            <Alert className="mt-4 border-amber-200 bg-amber-50">
              <Lock className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 text-sm">
                <strong>Trial mode:</strong> AI features use platform keys with monthly usage limits. Upgrade to a paid plan to connect your own API keys and remove limits.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* API Keys Status */}
      <Card data-testid="card-api-keys-status">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-gray-600" />
              Your API Keys
              <Badge variant={connectedCount === 3 ? "outline" : "secondary"} className={connectedCount === 3 ? "text-green-600 border-green-300" : ""}>
                {connectedCount}/3 Connected
              </Badge>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => window.location.href = apiKeyUrl} data-testid="btn-manage-api-keys">
              Manage Keys
              <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingKeys ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 p-4">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Loading key status...
            </div>
          ) : (
            <>
              <KeyStatusCard
                icon={Sparkles}
                title="Google Gemini AI"
                connected={aiConnected}
                description={aiConnected ? "Your Gemini key is active — Sarah, Lexi & AI tools use your account." : "Not configured. Platform key used with usage limits."}
                configUrl={apiKeyUrl}
                color="bg-purple-500"
              />
              <KeyStatusCard
                icon={Phone}
                title="Twilio Voice & SMS"
                connected={voiceConnected}
                description={voiceConnected ? "Your Twilio account is active — calls and SMS use your number." : "Not configured. Platform Twilio used (if available)."}
                configUrl={apiKeyUrl}
                color="bg-red-500"
              />
              <KeyStatusCard
                icon={Mail}
                title="Email (SMTP / Resend)"
                connected={emailConnected}
                description={emailConnected ? "Your email settings are active — emails send from your domain." : "Not configured. Platform Resend account used."}
                configUrl={apiKeyUrl}
                color="bg-blue-500"
              />
            </>
          )}

          {!isTrial && connectedCount < 3 && (
            <Alert className="border-blue-200 bg-blue-50 mt-2">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 text-sm">
                Connect your own keys to use unlimited AI features and send from your own phone number and email domain.{" "}
                <button className="underline font-medium" onClick={() => window.location.href = apiKeyUrl}>
                  Set up now →
                </button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Quick Access Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <button
          className="text-left p-4 rounded-lg border border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50 transition-colors group"
          onClick={() => window.location.href = createPageUrl("SarahSettings")}
          data-testid="btn-quick-sarah-settings"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <Phone className="w-4 h-4 text-purple-600" />
            </div>
            <span className="font-medium text-sm">Sarah AI Voice</span>
          </div>
          <p className="text-xs text-gray-500">Configure AI phone agent settings and campaigns</p>
          <div className="flex items-center gap-1 mt-2 text-xs text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity">
            Open settings <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          className="text-left p-4 rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          onClick={() => window.location.href = createPageUrl("LexiSettings")}
          data-testid="btn-quick-lexi-settings"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-blue-600" />
            </div>
            <span className="font-medium text-sm">Lexi AI Chat</span>
          </div>
          <p className="text-xs text-gray-500">Configure AI chat assistant and knowledge base</p>
          <div className="flex items-center gap-1 mt-2 text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
            Open settings <ArrowRight className="w-3 h-3" />
          </div>
        </button>

        <button
          className="text-left p-4 rounded-lg border border-gray-200 bg-white hover:border-green-300 hover:bg-green-50 transition-colors group"
          onClick={() => window.location.href = createPageUrl("StripeConnect")}
          data-testid="btn-quick-stripe-settings"
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-green-600" />
            </div>
            <span className="font-medium text-sm">Accept Payments</span>
          </div>
          <p className="text-xs text-gray-500">Connect Stripe to accept customer payments online</p>
          <div className="flex items-center gap-1 mt-2 text-xs text-green-600 opacity-0 group-hover:opacity-100 transition-opacity">
            Open settings <ArrowRight className="w-3 h-3" />
          </div>
        </button>
      </div>

      {/* How It Works */}
      <HowItWorksCard isTrial={isTrial} />

      {/* View Usage & Subscription */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="hover:border-blue-300 transition-colors cursor-pointer" onClick={() => window.location.href = createPageUrl("SubscriptionUsage")} data-testid="card-view-usage">
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">View Usage</p>
              <p className="text-xs text-gray-500">See your AI calls, messages, and feature usage</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </CardContent>
        </Card>

        <Card className="hover:border-purple-300 transition-colors cursor-pointer" onClick={() => window.location.href = createPageUrl("Pricing")} data-testid="card-view-plans">
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-purple-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">View All Plans</p>
              <p className="text-xs text-gray-500">Compare features across Basic, Business & Enterprise</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
