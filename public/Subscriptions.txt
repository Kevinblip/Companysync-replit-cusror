import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CreditCard,
  Check,
  Zap,
  Crown,
  Users,
  Building2,
  Calendar,
  DollarSign,
  TrendingUp
} from "lucide-react";
import { format } from "date-fns";

export default function Subscriptions() {
  const [selectedPlan, setSelectedPlan] = useState(null);

  const queryClient = useQueryClient();

  const [user, setUser] = useState(null);
  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: plans = [] } = useQuery({
    queryKey: ['subscription-plans'],
    queryFn: () => base44.entities.SubscriptionPlan.list(),
    initialData: [],
  });

  const { data: subscriptions = [] } = useQuery({
    queryKey: ['company-subscriptions', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CompanySubscription.filter({ company_id: myCompany.id }, "-created_date", 1) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentSubscription = subscriptions[0];

  const createSubscriptionMutation = useMutation({
    mutationFn: (data) => base44.entities.CompanySubscription.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-subscriptions'] });
    },
  });

  const handleSelectPlan = (plan) => {
    if (window.confirm(`Switch to ${plan.plan_name} plan?`)) {
      const subscriptionData = {
        company_name: "My Company",
        plan_name: plan.plan_name,
        status: "trial",
        billing_cycle_start: new Date().toISOString().split('T')[0],
        billing_cycle_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        user_count: 1,
        monthly_cost: plan.base_price,
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      };
      createSubscriptionMutation.mutate(subscriptionData);
    }
  };

  const getPlanIcon = (planName) => {
    if (planName.toLowerCase().includes('starter')) return Zap;
    if (planName.toLowerCase().includes('professional')) return Building2;
    if (planName.toLowerCase().includes('enterprise')) return Crown;
    return Users;
  };

  const getStatusColor = (status) => {
    const colors = {
      'active': 'bg-green-100 text-green-700 border-green-200',
      'trial': 'bg-blue-100 text-blue-700 border-blue-200',
      'past_due': 'bg-orange-100 text-orange-700 border-orange-200',
      'cancelled': 'bg-red-100 text-red-700 border-red-200',
      'expired': 'bg-gray-100 text-gray-700 border-gray-200'
    };
    return colors[status] || colors.trial;
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Subscription Plans</h1>
        <p className="text-gray-500 mt-1">Choose the perfect plan for your business</p>
      </div>

      {currentSubscription && (
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-xl font-bold text-gray-900">Current Plan: {currentSubscription.plan_name}</h3>
                  <Badge variant="outline" className={getStatusColor(currentSubscription.status)}>
                    {currentSubscription.status}
                  </Badge>
                </div>
                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    <span>${currentSubscription.monthly_cost}/month</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span>{currentSubscription.user_count} active users</span>
                  </div>
                  {currentSubscription.trial_ends_at && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>Trial ends: {format(new Date(currentSubscription.trial_ends_at), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                  {currentSubscription.billing_cycle_end && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <span>Next billing: {format(new Date(currentSubscription.billing_cycle_end), 'MMM d, yyyy')}</span>
                    </div>
                  )}
                </div>
              </div>
              <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                <CreditCard className="w-4 h-4 mr-2" />
                Manage Billing
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const PlanIcon = getPlanIcon(plan.plan_name);
          const isCurrentPlan = currentSubscription?.plan_name === plan.plan_name;
          
          return (
            <Card 
              key={plan.id} 
              className={`hover:shadow-xl transition-all duration-300 ${
                isCurrentPlan ? 'border-2 border-blue-500 shadow-lg' : 'border border-gray-200'
              }`}
            >
              <CardHeader className="text-center pb-4">
                <div className="mx-auto w-16 h-16 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center mb-4">
                  <PlanIcon className="w-8 h-8 text-blue-600" />
                </div>
                <CardTitle className="text-2xl">{plan.plan_name}</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">${plan.base_price}</span>
                  <span className="text-gray-500">/month</span>
                </div>
                {plan.price_per_user > 0 && (
                  <p className="text-sm text-gray-500 mt-2">
                    +${plan.price_per_user}/user/month
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-green-600" />
                    <span>{plan.included_users} user{plan.included_users > 1 ? 's' : ''} included</span>
                  </div>
                  {plan.max_customers && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      <span>Up to {plan.max_customers} customers</span>
                    </div>
                  )}
                  {!plan.max_customers && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      <span>Unlimited customers</span>
                    </div>
                  )}
                  {plan.max_projects && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      <span>Up to {plan.max_projects} projects</span>
                    </div>
                  )}
                  {!plan.max_projects && (
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      <span>Unlimited projects</span>
                    </div>
                  )}
                  {plan.features && plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-600" />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                {isCurrentPlan ? (
                  <Button className="w-full" disabled>
                    <Check className="w-4 h-4 mr-2" />
                    Current Plan
                  </Button>
                ) : (
                  <Button 
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    onClick={() => handleSelectPlan(plan)}
                  >
                    <TrendingUp className="w-4 h-4 mr-2" />
                    {currentSubscription ? 'Upgrade to this Plan' : 'Select Plan'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {plans.length === 0 && (
        <Card className="bg-gray-50">
          <CardContent className="p-12 text-center">
            <Crown className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Plans Available</h3>
            <p className="text-gray-500">Subscription plans will appear here once configured.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}