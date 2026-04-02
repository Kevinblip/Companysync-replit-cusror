import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertCircle, Zap, ShoppingCart, MessageSquare, Phone, Check, X } from "lucide-react";
import { createPageUrl } from "@/utils";
import { useToast } from "@/components/ui/use-toast";

const CREDIT_PACKAGES = {
  ai_interaction: [
    { amount: 500, price: 29, label: "500 AI Credits", perUnit: "$0.058/credit" },
    { amount: 1000, price: 49, label: "1,000 AI Credits", perUnit: "$0.049/credit", popular: true },
    { amount: 2500, price: 99, label: "2,500 AI Credits", perUnit: "$0.040/credit" },
    { amount: 5000, price: 179, label: "5,000 AI Credits", perUnit: "$0.036/credit", best: true },
  ],
  sms: [
    { amount: 200, price: 19, label: "200 SMS Credits", perUnit: "$0.095/sms" },
    { amount: 500, price: 39, label: "500 SMS Credits", perUnit: "$0.078/sms", popular: true },
    { amount: 1000, price: 69, label: "1,000 SMS Credits", perUnit: "$0.069/sms" },
    { amount: 2500, price: 149, label: "2,500 SMS Credits", perUnit: "$0.060/sms", best: true },
  ],
  call_minute: [
    { amount: 25, price: 19, label: "25 Call Minutes", perUnit: "$0.76/min" },
    { amount: 50, price: 34, label: "50 Call Minutes", perUnit: "$0.68/min", popular: true },
    { amount: 100, price: 59, label: "100 Call Minutes", perUnit: "$0.59/min" },
    { amount: 250, price: 129, label: "250 Call Minutes", perUnit: "$0.52/min", best: true },
  ],
};

const CREDIT_TYPE_LABELS = {
  ai_interaction: { title: "AI Credits", icon: Zap, color: "text-blue-600" },
  sms: { title: "SMS Credits", icon: MessageSquare, color: "text-green-600" },
  call_minute: { title: "Call Minutes", icon: Phone, color: "text-purple-600" },
};

export default function SubscriptionUsage() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [buyType, setBuyType] = useState(null);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  React.useEffect(() => {
    const init = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
      if (impersonatedId) {
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

  const { data: currentUsage } = useQuery({
    queryKey: ['subscription-usage', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.SubscriptionUsage.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const planName = myCompany?.subscription_plan || 'trial';
  const PLAN_LIMITS = {
    trial: { ai: 50, sms: 10, calls: 5 },
    basic: { ai: 1000, sms: 200, calls: 50 },
    business: { ai: 5000, sms: 1000, calls: 200 },
    enterprise: { ai: -1, sms: -1, calls: -1 },
    legacy: { ai: -1, sms: -1, calls: -1 },
    lifetime: { ai: -1, sms: -1, calls: -1 },
    unlimited: { ai: -1, sms: -1, calls: -1 },
    professional: { ai: 10000, sms: 2000, calls: 500 },
  };
  const planLimits = PLAN_LIMITS[planName] || PLAN_LIMITS.trial;

  const currentMonthStr = new Date().toISOString().slice(0, 7);
  const monthEvents = (currentUsage || []).filter(u => u.usage_month === currentMonthStr);

  const now = new Date();
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const usage = {
    plan_name: planName,
    billing_cycle_start: cycleStart,
    billing_cycle_end: cycleEnd,
    ai_limit: planLimits.ai,
    ai_used: monthEvents.filter(u => u.feature === 'lexi' || u.feature === 'ai').reduce((s, u) => s + (u.units || 1), 0),
    ai_credits_purchased: 0,
    sms_limit: planLimits.sms,
    sms_used: monthEvents.filter(u => u.feature === 'sms_ai' || u.feature === 'sms').reduce((s, u) => s + (u.units || 1), 0),
    sms_credits_purchased: 0,
    call_minutes_limit: planLimits.calls,
    call_minutes_used: monthEvents.filter(u => u.feature === 'sarah').reduce((s, u) => s + (u.units || 1), 0),
    call_credits_purchased: 0,
    id: 'computed',
  };

  const openBuyDialog = (type) => {
    setBuyType(type);
    setSelectedPackage(null);
    setBuyDialogOpen(true);
  };

  const handlePurchase = async () => {
    if (selectedPackage === null || !usage || !buyType) return;

    setPurchasing(true);
    try {
      const pkg = CREDIT_PACKAGES[buyType][selectedPackage];
      const fieldMap = {
        ai_interaction: 'ai_credits_purchased',
        sms: 'sms_credits_purchased',
        call_minute: 'call_credits_purchased',
      };
      const field = fieldMap[buyType];
      const currentPurchased = usage[field] || 0;

      await base44.entities.SubscriptionUsage.update(usage.id, {
        [field]: currentPurchased + pkg.amount,
      });

      toast({
        title: "Credits Added",
        description: `${pkg.label} have been added to your account.`,
      });

      queryClient.invalidateQueries({ queryKey: ['subscription-usage', myCompany?.id] });
      setBuyDialogOpen(false);
    } catch (err) {
      toast({
        title: "Purchase Failed",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      });
    } finally {
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

  const aiLimit = usage.ai_limit ?? 1000;
  const smsLimit = usage.sms_limit ?? 200;
  const callLimit = usage.call_minutes_limit ?? 50;

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
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">Usage</span>
                  <span className="text-2xl font-bold text-gray-900" data-testid="text-ai-usage">
                    {usage.ai_used}
                    {isAiUnlimited ? '' : `/${aiTotal}`}
                  </span>
                </div>
                {!isAiUnlimited && (
                  <>
                    <Progress value={Math.min(aiPercent, 100)} className="h-2 mb-2" />
                    <p className="text-sm text-gray-600">
                      {aiAvailable >= 0 ? `${aiAvailable} remaining` : 'Unlimited'}
                    </p>
                  </>
                )}
              </div>

              {isAiWarning && (
                <div className="flex items-start gap-2 p-3 bg-yellow-100 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-800 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-800">You're approaching your limit</p>
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
                Call Minutes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-700">Usage</span>
                  <span className="text-2xl font-bold text-gray-900" data-testid="text-call-usage">
                    {Math.round(usage.call_minutes_used)}
                    {isCallUnlimited ? '' : `/${callTotal}`}
                  </span>
                </div>
                {!isCallUnlimited && (
                  <>
                    <Progress value={Math.min(callPercent, 100)} className="h-2 mb-2" />
                    <p className="text-sm text-gray-600">
                      {callAvailable >= 0 ? `${Math.round(callAvailable)} remaining` : 'Unlimited'}
                    </p>
                  </>
                )}
              </div>

              {isCallWarning && (
                <div className="flex items-start gap-2 p-3 bg-yellow-100 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-yellow-800 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-yellow-800">You're approaching your limit</p>
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
            </CardContent>
          </Card>
        </div>

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
              Buy {CREDIT_TYPE_LABELS[buyType]?.title}
            </DialogTitle>
            <DialogDescription>
              Select a credit package to add to your account. Credits are added instantly and never expire.
            </DialogDescription>
          </DialogHeader>

          {buyType && (
            <div className="grid gap-3 py-4" data-testid="credit-packages-list">
              {CREDIT_PACKAGES[buyType].map((pkg, idx) => (
                <div
                  key={idx}
                  onClick={() => setSelectedPackage(idx)}
                  className={`relative p-4 rounded-md border-2 cursor-pointer transition-colors ${
                    selectedPackage === idx
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-muted hover-elevate'
                  }`}
                  data-testid={`credit-package-${idx}`}
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
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
                  {selectedPackage === idx && (
                    <div className="absolute top-2 right-2">
                      <Check className="w-5 h-5 text-blue-600" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBuyDialogOpen(false)} data-testid="button-cancel-purchase">
              Cancel
            </Button>
            <Button
              onClick={handlePurchase}
              disabled={selectedPackage === null || purchasing}
              data-testid="button-confirm-purchase"
            >
              {purchasing ? 'Processing...' : selectedPackage !== null
                ? `Add ${CREDIT_PACKAGES[buyType]?.[selectedPackage]?.label} - $${CREDIT_PACKAGES[buyType]?.[selectedPackage]?.price}`
                : 'Select a package'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
