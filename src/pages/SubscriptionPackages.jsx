import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Zap } from "lucide-react";
import { createPageUrl } from "@/utils";

export default function SubscriptionPackages() {
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);

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

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => base44.entities.SubscriptionPlan.filter({ is_active: true }),
    initialData: [],
  });

  const { data: currentUsage } = useQuery({
    queryKey: ['subscription-usage', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.SubscriptionUsage.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const currentPlan = currentUsage?.[0];

  const handleUpgrade = async (planName) => {
    if (!myCompany?.id) return;
    try {
      const response = await base44.functions.invoke('upgradePlan', { 
        company_id: myCompany.id, 
        new_plan: planName 
      });
      if (response.data?.success) {
        alert('✅ Successfully upgraded to ' + planName + ' plan!');
        window.location.reload();
      }
    } catch (error) {
      alert('❌ Upgrade failed: ' + error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Subscription Plans</h1>
          <p className="text-gray-600">Choose the plan that fits your needs</p>
        </div>

        {/* Current Plan Alert */}
        {currentPlan && (
          <Card className="mb-8 border-blue-200 bg-blue-50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-blue-900">Current Plan</h3>
                  <p className="text-blue-700">You are on the <strong>{currentPlan.plan_name}</strong> plan</p>
                </div>
                <Button 
                  onClick={() => window.location.href = createPageUrl('SubscriptionUsage')}
                  variant="outline"
                  className="border-blue-300"
                >
                  View Usage
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Plans Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.plan_name === plan.plan_name;
            const isUnlimited = plan.monthly_price === 97 && plan.ai_interactions_limit === -1;

            return (
              <Card 
                key={plan.id}
                className={`transition-all duration-300 ${
                  isUnlimited
                    ? 'border-2 border-purple-600 shadow-2xl transform scale-105' 
                    : 'border border-gray-200'
                } ${isCurrent ? 'ring-2 ring-green-500' : ''}`}
              >
                <CardHeader className={isUnlimited ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white' : ''}>
                  <div className="flex items-center justify-between">
                    <CardTitle className={isUnlimited ? 'text-white' : ''}>
                      {plan.plan_name.charAt(0).toUpperCase() + plan.plan_name.slice(1)}
                    </CardTitle>
                    {isCurrent && (
                      <Badge className="bg-green-500">Current</Badge>
                    )}
                    {isUnlimited && (
                      <Badge className="bg-yellow-400 text-gray-900">Popular</Badge>
                    )}
                  </div>
                  <div className={`mt-4 ${isUnlimited ? 'text-white' : 'text-gray-900'}`}>
                    <span className="text-4xl font-bold">${plan.monthly_price}</span>
                    <span className="text-sm ml-2">/month</span>
                  </div>
                </CardHeader>

                <CardContent className="p-6 space-y-6">
                  {/* Usage Details */}
                  <div className="space-y-3 pb-6 border-b">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">AI Interactions</span>
                      <span className="font-semibold text-gray-900">
                        {plan.ai_interactions_limit === -1 ? 'Unlimited' : `${plan.ai_interactions_limit}/mo`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">SMS Messages</span>
                      <span className="font-semibold text-gray-900">
                        {plan.sms_limit === -1 ? 'Unlimited' : `${plan.sms_limit}/mo`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">Call Minutes</span>
                      <span className="font-semibold text-gray-900">
                        {plan.call_minutes_limit === -1 ? 'Unlimited' : `${plan.call_minutes_limit}/mo`}
                      </span>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="space-y-3">
                    {(plan.features || []).map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-gray-700">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* CTA Button */}
                  {!isCurrent ? (
                    <Button 
                      onClick={() => handleUpgrade(plan.plan_name)}
                      className={`w-full ${
                        isUnlimited
                          ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                    >
                      {plan.plan_name === 'trial' ? 'Start Trial' : 'Upgrade Now'}
                    </Button>
                  ) : (
                    <Button disabled className="w-full" variant="outline">
                      ✓ Current Plan
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-16 max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Frequently Asked Questions</h2>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Can I change plans anytime?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">Yes, you can upgrade or downgrade your plan anytime. Changes take effect at the start of your next billing cycle.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">What happens if I exceed my limits?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">We'll notify you when you're approaching your limits. You can purchase additional credits to continue using our services.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Do you offer annual billing?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700">Currently, all plans are billed monthly. Contact support for enterprise pricing options.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}