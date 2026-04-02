import React from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkles, Zap, Crown } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function PublicPricing() {
  const navigate = useNavigate();

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
        "AI Estimator (basic)",
        "Lexi AI Assistant (1,000 queries/mo)",
        "Email & SMS communication",
        "Email/SMS templates",
        "Document storage",
        "PDF branding",
        "Mobile app access",
        "Email support"
      ],
      limits: {
        users: 5,
        clients: 100,
        leads: 250
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
        leads: 999999
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
        leads: 999999
      }
    }
  ];

  const handleSubscribe = (plan) => {
    // Store selected plan in sessionStorage for QuickSetup to use
    sessionStorage.setItem('selected_plan', JSON.stringify(plan));
    
    // Redirect to the onboarding wizard with the plan parameter
    navigate(createPageUrl('OnboardingWizard') + `?plan=${plan.name.toLowerCase()}`);
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
    <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 py-20 text-center">
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 drop-shadow-lg">
            Roofing CRM That Works
          </h1>
          <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-3xl mx-auto">
            AI-powered sales, crew management, and instant payments. Built for roofing contractors.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Badge className="bg-green-500 text-white px-6 py-2 text-lg">
              ✨ 14-Day Free Trial
            </Badge>
            <Badge className="bg-white/20 text-white px-6 py-2 text-lg">
              🚀 No Credit Card Required
            </Badge>
          </div>
        </div>
      </div>

      {/* Pricing Section */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Choose Your Plan
            </h2>
            <p className="text-lg text-gray-600">
              Full access during trial • Cancel anytime
            </p>
          </div>

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
                    className={`w-full bg-gradient-to-r ${colors.gradient} ${colors.hover} text-white py-6 text-lg font-semibold`}
                  >
                    Start Free Trial
                  </Button>

                  <p className="text-xs text-center text-gray-500 mt-3">
                    Then ${plan.price}/month after trial
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
    </div>
  );
}