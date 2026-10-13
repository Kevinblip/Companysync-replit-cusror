import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertCircle, Zap, ShoppingCart, MessageSquare, Phone, Check, X, Package, Key } from "lucide-react";
import { createPageUrl } from "@/utils";
import { useToast } from "@/components/ui/use-toast";
import { CREDIT_PACKAGES, BUNDLE_PACKAGES } from "@/config/creditPackages";

const CREDIT_TYPE_LABELS = {
  ai_interaction: { title: "AI Credits", icon: Zap, color: "text-blue-600" },
  sms: { title: "SMS Credits", icon: MessageSquare, color: "text-green-600" },
  call_minute: { title: "Call Minutes", icon: Phone, color: "text-purple-600" },
  bundle: { title: "All-in-One Bundle", icon: Package, color: "text-blue-600" },
};

export default function SubscriptionUsage() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [buyType, setBuyType] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  React.useEffect(() => {
    const init = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
      if (impersonatedId) {
        setImpersonating(true);
        const companies = await base44.entities.Company.filter({ id: impersonatedId });
        if (companies.length > 0) {
          setMyCompany(companies[0]);
          return;
        }
      }

      const companies = await base44.entities.Company.filter({ created_by: currentUser.email });
      if (companies.length > 0) {
        setMyCompany(companies[0]);
      }
    };
    init();
  }, []);

  // Handle the return from Stripe Checkout (?success=true / ?canceled=true).
  // Credits are granted server-side by the Stripe webhook — the browser never
  // grants them. On success we wait a moment for the webhook to land, refresh
  // the company + usage, then strip the query params so a reload won't re-toast.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const paid = params.get('success');
    const canceled = params.get('canceled');
    if (!paid && !canceled) return;

    if (paid) {
      toast({
        title: 'Payment received',
        description: 'Your credits are being added to your account and should appear in a few moments.',
      });
      const refresh = async () => {
        try {
          const currentUser = await base44.auth.me();
          const impersonatedId = sessionStorage.getItem('impersonating_company_id');
          const companies = impersonatedId
            ? await base44.entities.Company.filter({ id: impersonatedId })
            : await base44.entities.Company.filter({ created_by: currentUser.email });
          if (companies.length > 0) setMyCompany(companies[0]);
          queryClient.invalidateQueries({ queryKey: ['subscription-usage'] });
        } catch (_) { /* non-fatal */ }
      };
      setTimeout(refresh, 3000);
    } else if (canceled) {
      toast({
        title: 'Purchase canceled',
        description: 'No payment was taken. You can try again whenever you like.',
        variant: 'destructive',
      });
    }

    window.history.replaceState({}, '', window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: currentUsage } = useQuery({
    queryKey: ['subscription-usage', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.SubscriptionUsage.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  // Detect BYOK (Bring Your Own Key) so we know whether caps apply.
  // BYOK Gemini → unlimited AI interactions. BYOK Twilio → unlimited voice minutes.
  const { data: apiKeys = [] } = useQuery({
    queryKey: ['company-api-keys', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CompanyApiKeys.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });
  const apiKeysData = apiKeys[0] || {};
  const hasByokGemini = !!(apiKeysData.google_gemini_api_key);
  const hasByokTwilio = !!(apiKeysData.twilio_account_sid && apiKeysData.twilio_auth_token);

  const planName = myCompany?.subscription_plan || 'trial';
  const PLAN_LIMITS = {
    trial: { ai: 50, sms: -1, calls: -1 },
    basic: { ai: 1000, sms: 200, calls: 50 },
    business: { ai: 5000, sms: -1, calls: -1 },
    // Enterprise on platform key: 50,000/mo cap. BYOK (own Gemini key) = truly unlimited.
    enterprise: { ai: 50000, sms: -1, calls: -1 },
    legacy: { ai: 50000, sms: -1, calls: -1 },
    lifetime: { ai: 50000, sms: -1, calls: -1 },
    unlimited: { ai: 50000, sms: -1, calls: -1 },
    professional: { ai: 10000, sms: 2000, calls: 500 },
  };
  const planLimits = PLAN_LIMITS[planName] || PLAN_LIMITS.trial;

  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const monthEvents = (currentUsage || []).filter(u => u.usage_month === currentMonthStr);

  // Dollar-based spend circuit breaker — mirrors AI_SPEND_WARN_USD /
  // AI_SPEND_HARD_CAP_USD in vite-functions-plugin.js. Sums only the AI
  // features the gate blocks (same list as ai_used below — SMS/voice have
  // their own caps). BYOK events are logged as 'ai_byok' at $0 cost, so BYOK
  // companies never trip these.
  const AI_SPEND_WARN_USD = 150;
  const AI_SPEND_HARD_CAP_USD = 200;
  const mtdSpend = monthEvents
    .filter(u => ['lexi', 'ai', 'ai_estimator', 'crew_cam', 'marcus', 'check_payment'].includes(u.feature))
    .reduce((s, u) => s + (Number(u.total_cost) || 0), 0);

  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const usage = {
    plan_name: planName,
    billing_cycle_start: cycleStart,
    billing_cycle_end: cycleEnd,
    ai_limit: planLimits.ai,
    // Keep this feature list in sync with AI_USAGE_FEATURES in vite-functions-plugin.js
    ai_used: monthEvents.filter(u => ['lexi', 'ai', 'ai_estimator', 'crew_cam', 'marcus', 'check_payment'].includes(u.feature)).reduce((s, u) => s + (u.units || 1), 0),
    ai_credits_purchased: myCompany?.ai_credits_purchased || 0,
    sms_limit: planLimits.sms,
    sms_used: monthEvents.filter(u => u.feature === 'sms_ai' || u.feature === 'sms').reduce((s, u) => s + (u.units || 1), 0),
    sms_credits_purchased: myCompany?.sms_credits_purchased || 0,
    call_minutes_limit: planLimits.calls,
    call_minutes_used: monthEvents.filter(u => u.feature === 'sarah').reduce((s, u) => s + (u.units || 1), 0),
    call_credits_purchased: myCompany?.call_credits_purchased || 0,
  };

  const openBuyDialog = (type) => {
    setBuyType(type);
    setSelectedPackage(null);
    setBuyDialogOpen(true);
  };

  // Start a real Stripe Checkout for the selected package. The browser only
  // sends the package INDEX — the server prices the checkout and grants the
  // credits from the webhook, so credits are never added without payment.
  const handlePurchase = async () => {
    if (selectedPackage === null || !buyType || !myCompany?.id) return;

    if (impersonating) {
      toast({
        title: "Not available while impersonating",
        description: "Credit purchases are disabled while you're viewing another company as an admin.",
        variant: "destructive",
      });
      return;
    }

    setPurchasing(true);
    try {
      const payload = buyType === 'bundle'
        ? { kind: 'bundle', packageIndex: selectedPackage }
        : { kind: 'single', creditType: buyType, packageIndex: selectedPackage };

      const { data } = await base44.functions.invoke('purchaseUsageCredits', payload);

      if (data?.url) {
        // Redirect to Stripe. Keep the spinner up — the browser is navigating away.
        window.location.href = data.url;
        return;
      }
      throw new Error(data?.error || 'Could not start checkout. Please try again.');
    } catch (err) {
      toast({
        title: "Purchase Failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setPurchasing(false);
    }
  };

  if (!myCompany) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center py-12">
            <p className="text-gray-600">Loading subscription data...</p>
          </div>
        </div>
      </div>
    );
  }

  // BYOK overrides: BYOK Gemini → no AI cap; BYOK Twilio → no voice cap.
  // Platform voice cap (500 min/mo) mirrors PLATFORM_VOICE_MINUTES_CAP in vite-twilio-ws-plugin.js.
  const PLATFORM_VOICE_MINUTES_CAP = 500;
  const aiLimit = hasByokGemini ? -1 : (usage.ai_limit ?? 1000);
  const smsLimit = usage.sms_limit ?? 200;
  // Platform Twilio: 500 min/mo hard cap (what localCheckVoiceAccess actually enforces).
  // BYOK Twilio: unlimited (-1).
  const callLimit = hasByokTwilio ? -1 : PLATFORM_VOICE_MINUTES_CAP;

  const isAiUnlimited = aiLimit < 0;
  const isSmsUnlimited = smsLimit < 0;
  const isCallUnlimited = callLimit < 0;

  const aiTotal = isAiUnlimited ? -1 : aiLimit + (usage.ai_credits_purchased || 0);
  const smsTotal = isSmsUnlimited ? -1 : smsLimit + (usage.sms_credits_purchased || 0);
  const callTotal = isCallUnlimited ? -1 : callLimit + (usage.call_credits_purchased || 0);

  const aiAvailable = isAiUnlimited ? -1 : Math.max(0, aiTotal - usage.ai_used);
  const smsAvailable = isSmsUnlimited ? -1 : Math.max(0, smsTotal - usage.sms_used);
  const callAvailable = isCallUnlimited ? -1 : Math.max(0, callTotal - usage.call_minutes_used);

  const aiPercent = isAiUnlimited ? 0 : (aiTotal > 0 ? (usage.ai_used / aiTotal) * 100 : 0);
  const smsPercent = isSmsUnlimited ? 0 : (smsTotal > 0 ? (usage.sms_used / smsTotal) * 100 : 0);
  const callPercent = isCallUnlimited ? 0 : (callTotal > 0 ? (usage.call_minutes_used / callTotal) * 100 : 0);

  const isAiWarning = aiPercent >= 80 && !isAiUnlimited;
  const isSmsWarning = smsPercent >= 80 && !isSmsUnlimited;
  const isCallWarning = callPercent >= 80 && !isCallUnlimited;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2" data-testid="text-page-title">Subscription Usage</h1>
          <p className="text-gray-600">Current plan: <strong>{usage.plan_name?.toUpperCase()}</strong></p>
        </div>

        {impersonating && (
          <div className="mb-6 flex items-start gap-2 p-4 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-impersonating">
            <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              You're viewing this company as an admin. Credit purchases are disabled while impersonating.
            </p>
          </div>
        )}

        {!hasByokGemini && planName !== 'trial' && mtdSpend >= AI_SPEND_HARD_CAP_USD && (
          <div className="mb-6 flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg" data-testid="banner-spend-hard-stop">
            <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">
              <strong>AI features are paused for this month</strong> — your account reached this month's AI usage limit.{' '}
              <a href={createPageUrl('APIKeysSettings')} className="underline font-medium">
                Connect your own Gemini API key
              </a>{' '}
              to reactivate instantly with no limits, or wait until next month.
            </p>
          </div>
        )}
        {!hasByokGemini && planName !== 'trial' && mtdSpend >= AI_SPEND_WARN_USD && mtdSpend < AI_SPEND_HARD_CAP_USD && (
          <div className="mb-6 flex items-start gap-2 p-4 bg-amber-50 border border-amber-200 rounded-lg" data-testid="banner-spend-warning">
            <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              <strong>You're one of our heaviest AI users this month.</strong> Accounts approaching the monthly usage limit are paused until next month.{' '}
              <a href={createPageUrl('APIKeysSettings')} className="underline font-medium">
                Connect your own Gemini API key
              </a>{' '}
              for truly unlimited AI — no caps, ever.
            </p>
          </div>
        )}

        <Card className="mb-8 bg-gradient-to-r from-blue-600 to-purple-600 text-white border-0">
          <CardContent className="p-8">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-3xl font-bold mb-2">{usage.plan_name?.charAt(0).toUpperCase() + usage.plan_name?.slice(1)} Plan</h2>
                <p className="text-blue-100">
                  Billing cycle: {usage.billing_cycle_start} to {usage.billing_cycle_end}
                </p>
              </div>
              <Button 
                onClick={() => window.location.href = createPageUrl('SubscriptionPackages')}
                className="bg-white text-blue-600"
                data-testid="button-change-plan"
              >
                Change Plan
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className={isAiWarning ? 'border-2 border-yellow-300 bg-yellow-50' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-5 h-5 text-blue-600" />
                AI Interactions
                {hasByokGemini && (
                  <Badge className="bg-green-100 text-green-800 border-green-200 text-xs font-normal ml-1">BYOK</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">This month</span>
                  <span className="text-2xl font-bold text-gray-900" data-testid="text-ai-usage">
                    {usage.ai_used.toLocaleString()}
                    {isAiUnlimited ? '' : ` / ${aiTotal.toLocaleString()}`}
                  </span>
                </div>
                {!isAiUnlimited && (
                  <>
                    <Progress value={Math.min(aiPercent, 100)} className="h-2 mb-2" />
                    <p className="text-sm text-gray-600">
                      {aiAvailable >= 0 ? `${aiAvailable.toLocaleString()} remaining` : 'Unlimited'}
                    </p>
                  </>
                )}
                {isAiUnlimited && hasByokGemini && (
                  <p className="text-sm text-green-700">Your own Gemini key — no monthly cap</p>
                )}
              </div>

              {isAiWarning && !hasByokGemini && (
                <div className="flex items-start gap-2 p-3 bg-yellow-100 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-800 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-800">
                    Approaching your limit.{' '}
                    <a href={createPageUrl('APIKeysSettings')} className="underline font-medium whitespace-nowrap">
                      Connect your own Gemini key
                    </a>{' '}
                    to remove it.
                  </p>
                </div>
              )}

              {!isAiUnlimited && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full"
                  onClick={() => openBuyDialog('ai_interaction')}
                  data-testid="button-buy-ai"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Buy More
                </Button>
              )}
              {isAiUnlimited && !hasByokGemini && (
                <p className="text-xs text-gray-500 text-center">Unlimited on your current plan</p>
              )}
            </CardContent>
          </Card>

          <Card className={isSmsWarning ? 'border-2 border-yellow-300 bg-yellow-50' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-green-600" />
                SMS Messages
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">Usage</span>
                  <span className="text-2xl font-bold text-gray-900" data-testid="text-sms-usage">
                    {usage.sms_used}
                    {isSmsUnlimited ? '' : `/${smsTotal}`}
                  </span>
                </div>
                {!isSmsUnlimited && (
                  <>
                    <Progress value={Math.min(smsPercent, 100)} className="h-2 mb-2" />
                    <p className="text-sm text-gray-600">
                      {smsAvailable >= 0 ? `${smsAvailable} remaining` : 'Unlimited'}
                    </p>
                  </>
                )}
              </div>

              {isSmsWarning && (
                <div className="flex items-start gap-2 p-3 bg-yellow-100 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-800 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-800">You're approaching your limit</p>
                </div>
              )}

              {!isSmsUnlimited && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full"
                  onClick={() => openBuyDialog('sms')}
                  data-testid="button-buy-sms"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Buy More
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className={isCallWarning ? 'border-2 border-yellow-300 bg-yellow-50' : ''}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Phone className="w-5 h-5 text-purple-600" />
                Alex Voice (AI)
                {hasByokTwilio && (
                  <Badge className="bg-green-100 text-green-800 border-green-200 text-xs font-normal ml-1">BYOK</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">This month</span>
                  <span className="text-2xl font-bold text-gray-900" data-testid="text-call-usage">
                    {Math.round(usage.call_minutes_used)} min
                    {isCallUnlimited ? '' : ` / ${callTotal}`}
                  </span>
                </div>
                {!isCallUnlimited && (
                  <>
                    <Progress value={Math.min(callPercent, 100)} className="h-2 mb-2" />
                    <p className="text-sm text-gray-600">
                      {callAvailable >= 0 ? `${Math.round(callAvailable)} min remaining` : 'Unlimited'}
                    </p>
                  </>
                )}
                {isCallUnlimited && hasByokTwilio && (
                  <p className="text-sm text-green-700">Your own Twilio account — no monthly cap</p>
                )}
              </div>

              {isCallWarning && !hasByokTwilio && (
                <div className="flex items-start gap-2 p-3 bg-yellow-100 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-800 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-800">
                    Approaching your {PLATFORM_VOICE_MINUTES_CAP} min/mo limit.{' '}
                    <a href={createPageUrl('APIKeysSettings')} className="underline font-medium whitespace-nowrap">
                      Add your own Twilio account
                    </a>{' '}
                    to remove it.
                  </p>
                </div>
              )}

              {!isCallUnlimited && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="w-full"
                  onClick={() => openBuyDialog('call_minute')}
                  data-testid="button-buy-calls"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Buy More
                </Button>
              )}
              {isCallUnlimited && !hasByokTwilio && (
                <p className="text-xs text-gray-500 text-center">Unlimited on your current plan</p>
              )}
            </CardContent>
          </Card>
        </div>

        {!(isAiUnlimited && isSmsUnlimited && isCallUnlimited) && (
          <Card className="mb-8 border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-purple-50">
            <CardContent className="p-3 sm:p-6">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Package className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xl font-bold text-gray-900">All-in-One Bundle</h3>
                      <Badge className="bg-green-100 text-green-800 border-green-200">Save up to 21%</Badge>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 max-w-md">
                      Get AI credits, SMS, and call minutes together in one package — for less than buying each on its own.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => openBuyDialog('bundle')}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 text-white"
                  data-testid="button-buy-bundle"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  View Bundle Deals
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {(usage.ai_credits_purchased > 0 || usage.sms_credits_purchased > 0 || usage.call_credits_purchased > 0) && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Purchased Credits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4">
                {usage.ai_credits_purchased > 0 && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-gray-600">AI Interactions</p>
                    <p className="text-2xl font-bold text-gray-900" data-testid="text-ai-purchased">{usage.ai_credits_purchased}</p>
                  </div>
                )}
                {usage.sms_credits_purchased > 0 && (
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-gray-600">SMS Messages</p>
                    <p className="text-2xl font-bold text-gray-900" data-testid="text-sms-purchased">{usage.sms_credits_purchased}</p>
                  </div>
                )}
                {usage.call_credits_purchased > 0 && (
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-gray-600">Call Minutes</p>
                    <p className="text-2xl font-bold text-gray-900" data-testid="text-calls-purchased">{usage.call_credits_purchased}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {buyType && (() => {
                const TypeIcon = CREDIT_TYPE_LABELS[buyType]?.icon;
                return TypeIcon ? <TypeIcon className={`w-5 h-5 ${CREDIT_TYPE_LABELS[buyType].color}`} /> : null;
              })()}
              {buyType === 'bundle' ? 'All-in-One Bundle' : `Buy ${CREDIT_TYPE_LABELS[buyType]?.title}`}
            </DialogTitle>
            <DialogDescription>
              {buyType === 'bundle'
                ? "Get all three credit types together and save. You'll be taken to secure checkout — credits are added after payment and never expire."
                : "Select a credit package. You'll be taken to secure checkout — credits are added after payment and never expire."}
            </DialogDescription>
          </DialogHeader>

          {buyType === 'bundle' ? (
            <div className="grid gap-3 py-4" data-testid="bundle-packages-list">
              {BUNDLE_PACKAGES.map((bundle, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedPackage(idx)}
                  className={`relative w-full text-left p-4 rounded-md border-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    selectedPackage === idx
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
                  }`}
                  data-testid={`bundle-package-${idx}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex-shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center ${
                      selectedPackage === idx ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                    }`}>
                      {selectedPackage === idx && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">{bundle.name}</p>
                        <div className="flex items-center gap-2">
                          {bundle.popular && <Badge variant="secondary">Popular</Badge>}
                          {bundle.best && <Badge className="bg-green-100 text-green-800 border-green-200">Best Value</Badge>}
                          <span className="text-sm text-muted-foreground line-through">${bundle.regularPrice}</span>
                          <span className="text-xl font-bold text-foreground">${bundle.price}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Zap className="w-4 h-4 text-blue-600" />{bundle.ai.toLocaleString()} AI</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-4 h-4 text-green-600" />{bundle.sms.toLocaleString()} SMS</span>
                        <span className="flex items-center gap-1"><Phone className="w-4 h-4 text-purple-600" />{bundle.call} min</span>
                      </div>
                      <p className="text-xs font-semibold text-green-700 mt-1">You save ${bundle.regularPrice - bundle.price}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : buyType && (
            <div className="grid gap-3 py-4" data-testid="credit-packages-list">
              {CREDIT_PACKAGES[buyType].map((pkg, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedPackage(idx)}
                  className={`relative w-full text-left p-4 rounded-md border-2 cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    selectedPackage === idx
                      ? 'border-blue-500 bg-blue-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40'
                  }`}
                  data-testid={`credit-package-${idx}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      selectedPackage === idx ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                    }`}>
                      {selectedPackage === idx && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-semibold text-foreground">{pkg.label}</p>
                        <p className="text-sm text-muted-foreground">{pkg.perUnit}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {pkg.popular && <Badge variant="secondary">Popular</Badge>}
                        {pkg.best && <Badge className="bg-green-100 text-green-800 border-green-200">Best Value</Badge>}
                        <span className="text-xl font-bold text-foreground">${pkg.price}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBuyDialogOpen(false)} data-testid="button-cancel-purchase">
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={selectedPackage === null || purchasing || impersonating}
              data-testid="button-confirm-purchase"
            >
              {impersonating
                ? 'Disabled while impersonating'
                : purchasing ? 'Redirecting to checkout…' : selectedPackage === null
                ? 'Select a package above'
                : buyType === 'bundle'
                  ? `Continue to payment — $${BUNDLE_PACKAGES[selectedPackage]?.price}`
                  : `Continue to payment — $${CREDIT_PACKAGES[buyType]?.[selectedPackage]?.price}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
