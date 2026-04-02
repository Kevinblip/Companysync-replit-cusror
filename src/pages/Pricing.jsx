import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Zap, Crown, Loader2 } from "lucide-react";

export default function Pricing() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});

    // Auto-select plan from sessionStorage if exists
    const storedPlan = sessionStorage.getItem('selected_plan');
    if (storedPlan) {
      try {
        const plan = JSON.parse(storedPlan);
        // Find matching plan in our plans array
        const matchingPlan = plans.find(p => p.name === plan.name);
        if (matchingPlan && user) {
          // Auto-start trial for pre-selected plan
          handleSubscribe(matchingPlan);
        }
      } catch (e) {
        console.error('Failed to parse stored plan:', e);
      }
    }
  }, [user]);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;
    
    // ONLY return companies owned by this user (not staff companies)
    // This ensures new subscribers create their own company, not join existing ones
    const ownedCompanies = companies.filter(c => c.created_by === user.email);
    
    if (ownedCompanies.length > 0) {
      return ownedCompanies[0];
    }
    
    return null;
  }, [user, companies, staffProfiles]);

  const plans = [
    {
      name: "Basic",
      price: 99,
      priceId: "price_1T4QXjAKHCJVDE3AFy2GSbsc",
      icon: Sparkles,
      color: "blue",
      description: "Perfect for getting started",
      features: [
        "Up to 5 users",
        "100 active customers",
        "250 active leads",
        "Customers, Leads, Projects & Tasks",
        "Estimates, Proposals & Invoices",
        "Basic payment processing (Stripe)",
        "Calendar & scheduling",
        "CrewCam inspections (10/month)",
        "AI Interactions (1,000/month)",
        "SMS Messages (200/month)",
        "Call Minutes (50/month)",
        "Email/SMS templates",
        "Document storage",
        "PDF branding",
        "Mobile app access",
        "Email support"
      ],
      limits: {
        users: 5,
        clients: 100,
        leads: 250,
        ai_interactions: 1000,
        sms: 200,
        call_minutes: 50
      }
    },
    {
      name: "Business",
      price: 199,
      priceId: "price_1T4QXkAKHCJVDE3A38GIMRYi",
      icon: Zap,
      color: "purple",
      popular: true,
      description: "For growing roofing contractors",
      features: [
        "Up to 10 users",
        "1,000 active customers",
        "Unlimited leads",
        "Everything in Basic, plus:",
        "AI Interactions (5,000/month)",
        "Unlimited SMS Messages",
        "Unlimited Call Minutes",
        "CrewCam inspections (unlimited)",
        "AI Damage Analysis",
        "Storm Tracking & alerts",
        "Lead Finder & Skip Tracing",
        "Sarah AI Receptionist",
        "Marcus AI Marketing",
        "Workflow automation",
        "Campaign manager",
        "Commission tracking",
        "Field Sales Tracker",
        "Territory management",
        "Round Robin lead assignment",
        "Live call dashboard",
        "Contract signing & e-signatures",
        "Review request automation",
        "QuickBooks integration",
        "GoHighLevel sync",
        "Custom integrations",
        "Priority support"
      ],
      limits: {
        users: 10,
        clients: 1000,
        leads: 999999,
        ai_interactions: 5000,
        sms: -1,
        call_minutes: -1
      }
    },
    {
      name: "Enterprise",
      price: 399,
      priceId: "price_1T4QXkAKHCJVDE3ADvXtp806",
      icon: Crown,
      color: "gold",
      description: "For established roofing companies",
      features: [
        "Up to 25 users",
        "Unlimited active customers",
        "Unlimited leads",
        "Everything in Business, plus:",
        "Unlimited AI Interactions",
        "Unlimited SMS Messages",
        "Unlimited Call Minutes",
        "Full accounting module (AR/AP, reconciliation)",
        "Family commission splits",
        "Subcontractor management",
        "Advanced staff roles & permissions",
        "White-label customer portal",
        "Video training generator",
        "Permit assistant",
        "Daily AI reports",
        "Competitor analysis",
        "Advanced analytics & reporting",
        "Custom field builder",
        "Knowledge base",
        "Dedicated account manager",
        "24/7 phone support",
        "Custom development",
        "API access",
        "Data migration assistance"
      ],
      limits: {
        users: 25,
        clients: 999999,
        leads: 999999,
        ai_interactions: -1,
        sms: -1,
        call_minutes: -1
      }
    }
  ];

  const handleSubscribe = async (plan) => {
    // Check if user is logged in
    if (!user) {
      // Redirect to login with plan selection stored
      sessionStorage.setItem('selected_plan', JSON.stringify(plan));
      base44.auth.redirectToLogin(window.location.pathname);
      return;
    }

    // Check if company exists
    if (!myCompany) {
      // Store selected plan and redirect to company setup
      sessionStorage.setItem('selected_plan', JSON.stringify(plan));
      navigate(createPageUrl('CompanySetup'));
      return;
    }

    setIsLoading(true);
    setSelectedPlan(plan.name);

    try {
      // Logic:
      // 1. If user is already on a trial, offer to "Add Payment Method" to get bonus days
      // 2. If user is expired, force checkout
      // 3. If user is new/trial (and wants to start without card), keep existing flow?
      // For now, let's allow "No Card Trial" ONLY if they don't have a subscription yet.
      
      const isTrial = myCompany.subscription_status === 'trial';
      const isExpired = myCompany.subscription_status === 'expired' || myCompany.subscription_status === 'cancelled';
      const isActive = myCompany.subscription_status === 'active';

      // If already active or expired, or they want to add card -> Go to Stripe
      // For this simplified version: Click always goes to Stripe Checkout if they already have a company
      // This allows them to "Activate" the trial with a card or Upgrade
      
      // EXCEPTION: If they are BRAND NEW (no plan set or just created), allow the No-Card Trial
      if ((!myCompany.subscription_plan || myCompany.subscription_plan === 'trial') && !isExpired && !isActive) {
         // Calculate trial end date (14 days from now)
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14);

        // Start trial immediately - no credit card required
        await base44.entities.Company.update(myCompany.id, {
          subscription_plan: plan.name.toLowerCase(),
          subscription_status: 'trial',
          trial_ends_at: trialEndDate.toISOString().split('T')[0],
          max_users: plan.limits.users,
          max_customers: plan.limits.clients
        });

        alert(`🎉 Your ${plan.name} plan trial has started!\n\n✅ No credit card required\n✅ Full access for 14 days\n\n💡 Add payment details anytime to get 7 bonus days!`);
        
        sessionStorage.removeItem('selected_plan');
        navigate(createPageUrl('Dashboard'));
        return;
      }

      // OTHERWISE: Stripe Checkout (Upgrade, Reactivate, or Add Card)
      console.log('💳 Initiating Stripe Checkout for:', plan.name);
      
      const { data } = await base44.functions.invoke('createCheckoutSession', {
        priceId: plan.priceId,
        mode: 'subscription',
        companyId: myCompany.id,
        planName: plan.name,
        metadata: {
          extend_trial: isTrial ? '7' : '0' // Bonus logic
        }
      });

      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data?.error || 'Failed to initialize checkout');
      }

    } catch (error) {
      console.error('💥 Subscription error:', error);
      alert('Failed to process request: ' + error.message);
      setIsLoading(false);
      setSelectedPlan(null);
    }
  };

  const getColorClasses = (color) => {
    const colors = {
      blue: {
        gradient: "from-blue-600 to-blue-700",
        bg: "bg-blue-50",
        border: "border-blue-200",
        text: "text-blue-600",
        hover: "hover:bg-blue-700"
      },
      purple: {
        gradient: "from-purple-600 to-purple-700",
        bg: "bg-purple-50",
        border: "border-purple-200",
        text: "text-purple-600",
        hover: "hover:bg-purple-700"
      },
      gold: {
        gradient: "from-yellow-600 to-orange-600",
        bg: "bg-yellow-50",
        border: "border-yellow-200",
        text: "text-yellow-600",
        hover: "hover:bg-yellow-700"
      }
    };
    return colors[color] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600 mb-2">
            Start with a <span className="font-bold text-green-600">14-day free trial</span> on any plan
          </p>
          <p className="text-sm text-gray-500">
            No credit card required • Cancel anytime • Full access during trial
          </p>
        </div>

        {/* Current Plan Banner */}
        {myCompany?.subscription_plan && (
          <Card className="mb-8 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Current Plan</p>
                  <p className="text-2xl font-bold text-gray-900 capitalize">
                    {myCompany.subscription_plan}
                  </p>
                  <p className="text-sm text-gray-600">
                    Status: <Badge>{myCompany.subscription_status || 'active'}</Badge>
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => navigate(createPageUrl('ManageSubscription'))}
                >
                  Manage Subscription
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan) => {
            const colors = getColorClasses(plan.color);
            const Icon = plan.icon;

            return (
              <Card
                key={plan.name}
                className={`relative ${plan.popular ? 'ring-4 ring-purple-500 shadow-2xl scale-105' : 'shadow-lg'} hover:shadow-xl transition-all`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-1">
                      MOST POPULAR
                    </Badge>
                  </div>
                )}

                <CardHeader className={`bg-gradient-to-r ${colors.gradient} text-white rounded-t-lg pb-8`}>
                  <div className="flex items-center justify-center mb-4">
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                      <Icon className="w-8 h-8" />
                    </div>
                  </div>
                  <CardTitle className="text-center text-2xl font-bold">
                    {plan.name}
                  </CardTitle>
                  <p className="text-center text-white/80 text-sm mt-2">
                    {plan.description}
                  </p>
                </CardHeader>

                <CardContent className="pt-8 pb-6">
                  <div className="text-center mb-6">
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-5xl font-bold text-gray-900">${plan.price}</span>
                      <span className="text-gray-600">/month</span>
                    </div>
                    <Badge className="mt-3 bg-green-100 text-green-700">
                      14-day free trial
                    </Badge>
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-700 text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSubscribe(plan)}
                    disabled={isLoading}
                    className={`w-full bg-gradient-to-r ${colors.gradient} ${colors.hover} text-white py-6 text-lg font-semibold`}
                  >
                    {isLoading && selectedPlan === plan.name ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        {myCompany?.subscription_status === 'trial' ? 'Add Card (+7 Days Bonus)' : 
                         myCompany?.subscription_status === 'active' ? 'Switch Plan' :
                         myCompany?.subscription_status === 'expired' ? 'Reactivate' :
                         'Start Free Trial'}
                      </>
                    )}
                  </Button>

                  <p className="text-xs text-center text-gray-500 mt-3">
                    {myCompany?.subscription_status === 'trial' ? 'No charge today • Cancel anytime' : `Then $${plan.price}/month after trial`}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* FAQ or additional info */}
        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            All plans include:
          </h2>
          <div className="grid md:grid-cols-4 gap-6 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-blue-600" />
              </div>
              <p className="font-semibold text-gray-900">14-Day Trial</p>
              <p className="text-sm text-gray-600">No credit card needed</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Sparkles className="w-6 h-6 text-purple-600" />
              </div>
              <p className="font-semibold text-gray-900">AI Features</p>
              <p className="text-sm text-gray-600">Estimator & Lexi AI</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Zap className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-semibold text-gray-900">Cancel Anytime</p>
              <p className="text-sm text-gray-600">No contracts or commitments</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Crown className="w-6 h-6 text-orange-600" />
              </div>
              <p className="font-semibold text-gray-900">Premium Support</p>
              <p className="text-sm text-gray-600">Email & chat included</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}