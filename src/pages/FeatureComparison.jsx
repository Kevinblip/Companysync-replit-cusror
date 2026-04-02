import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Crown, Zap, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const FEATURES = [
  {
    category: "Core CRM",
    items: [
      { name: "Users", basic: "Up to 5", business: "Up to 10", enterprise: "Up to 25" },
      { name: "Active Customers", basic: "100", business: "1,000", enterprise: "Unlimited" },
      { name: "Active Leads", basic: "250", business: "Unlimited", enterprise: "Unlimited" },
      { name: "Customers & Contact Management", basic: true, business: true, enterprise: true },
      { name: "Lead Management", basic: true, business: true, enterprise: true },
      { name: "Projects & Tasks", basic: true, business: true, enterprise: true },
      { name: "Calendar & Scheduling", basic: true, business: true, enterprise: true },
      { name: "Document Storage", basic: true, business: true, enterprise: true },
      { name: "Mobile App Access", basic: true, business: true, enterprise: true },
    ]
  },
  {
    category: "Sales & Invoicing",
    items: [
      { name: "Estimates & Proposals", basic: true, business: true, enterprise: true },
      { name: "Invoices", basic: true, business: true, enterprise: true },
      { name: "Basic Payment Processing (Stripe)", basic: true, business: true, enterprise: true },
      { name: "PDF Branding", basic: true, business: true, enterprise: true },
      { name: "Commission Tracking", basic: false, business: true, enterprise: true },
      { name: "Family Commission Splits", basic: false, business: false, enterprise: true },
    ]
  },
  {
    category: "AI Features",
    items: [
      { name: "AI Estimator", basic: "Basic", business: "Advanced", enterprise: "Advanced" },
      { name: "Lexi AI Assistant", basic: "1,000 queries/mo", business: "10,000 queries/mo", enterprise: "Unlimited" },
      { name: "Sarah AI Receptionist", basic: false, business: true, enterprise: true },
      { name: "Marcus AI Marketing", basic: false, business: true, enterprise: true },
      { name: "AI Damage Analysis", basic: false, business: true, enterprise: true },
      { name: "Daily AI Reports", basic: false, business: false, enterprise: true },
      { name: "Video Training Generator", basic: false, business: false, enterprise: true },
      { name: "Permit Assistant", basic: false, business: false, enterprise: true },
    ]
  },
  {
    category: "Inspections",
    items: [
      { name: "CrewCam Inspections", basic: "10/month", business: "Unlimited", enterprise: "Unlimited" },
      { name: "AI Damage Analysis", basic: false, business: true, enterprise: true },
    ]
  },
  {
    category: "Communication",
    items: [
      { name: "Email & SMS", basic: true, business: true, enterprise: true },
      { name: "Email/SMS Templates", basic: true, business: true, enterprise: true },
      { name: "Campaign Manager", basic: false, business: true, enterprise: true },
      { name: "Workflow Automation", basic: false, business: true, enterprise: true },
      { name: "Live Call Dashboard", basic: false, business: true, enterprise: true },
    ]
  },
  {
    category: "Advanced Features",
    items: [
      { name: "Storm Tracking & Alerts", basic: false, business: true, enterprise: true },
      { name: "Lead Finder & Skip Tracing", basic: false, business: true, enterprise: true },
      { name: "Field Sales Tracker", basic: false, business: true, enterprise: true },
      { name: "Territory Management", basic: false, business: true, enterprise: true },
      { name: "Round Robin Assignment", basic: false, business: true, enterprise: true },
      { name: "Contract Signing & E-Signatures", basic: false, business: true, enterprise: true },
      { name: "Review Request Automation", basic: false, business: true, enterprise: true },
    ]
  },
  {
    category: "Integrations",
    items: [
      { name: "QuickBooks Integration", basic: false, business: true, enterprise: true },
      { name: "GoHighLevel Sync", basic: false, business: true, enterprise: true },
      { name: "Custom Integrations", basic: false, business: true, enterprise: true },
      { name: "API Access", basic: false, business: false, enterprise: true },
    ]
  },
  {
    category: "Accounting",
    items: [
      { name: "Full Accounting Module", basic: false, business: false, enterprise: true },
      { name: "AR/AP Management", basic: false, business: false, enterprise: true },
      { name: "Bank Reconciliation", basic: false, business: false, enterprise: true },
      { name: "Subcontractor Management", basic: false, business: false, enterprise: true },
    ]
  },
  {
    category: "Administration",
    items: [
      { name: "Advanced Staff Roles & Permissions", basic: false, business: false, enterprise: true },
      { name: "White-Label Customer Portal", basic: false, business: false, enterprise: true },
      { name: "Custom Field Builder", basic: false, business: false, enterprise: true },
      { name: "Knowledge Base", basic: false, business: false, enterprise: true },
      { name: "Competitor Analysis", basic: false, business: false, enterprise: true },
      { name: "Advanced Analytics & Reporting", basic: false, business: false, enterprise: true },
    ]
  },
  {
    category: "Support",
    items: [
      { name: "Email Support", basic: true, business: true, enterprise: true },
      { name: "Priority Support", basic: false, business: true, enterprise: true },
      { name: "Dedicated Account Manager", basic: false, business: false, enterprise: true },
      { name: "24/7 Phone Support", basic: false, business: false, enterprise: true },
      { name: "Custom Development", basic: false, business: false, enterprise: true },
      { name: "Data Migration Assistance", basic: false, business: false, enterprise: true },
    ]
  }
];

export default function FeatureComparison() {
  const navigate = useNavigate();

  const renderValue = (value) => {
    if (value === true) return <Check className="w-5 h-5 text-green-600 mx-auto" />;
    if (value === false) return <X className="w-5 h-5 text-gray-300 mx-auto" />;
    return <span className="text-sm font-medium text-gray-700">{value}</span>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Feature Comparison</h1>
          <p className="text-gray-600 text-lg">Choose the plan that fits your business</p>
        </div>

        {/* Plan Headers */}
        <div className="grid grid-cols-4 gap-4 mb-6 sticky top-0 bg-gradient-to-br from-blue-50 to-purple-50 py-4 z-10">
          <div className="font-semibold text-gray-700"></div>
          
          <Card className="border-2 border-blue-200 bg-white">
            <CardHeader className="pb-3 text-center bg-gradient-to-br from-blue-50 to-blue-100">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <CardTitle className="text-xl">Basic</CardTitle>
              </div>
              <Badge className="bg-blue-100 text-blue-700 mx-auto">Perfect for freelancers</Badge>
            </CardHeader>
          </Card>

          <Card className="border-2 border-purple-200 bg-white">
            <CardHeader className="pb-3 text-center bg-gradient-to-br from-purple-50 to-purple-100">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Zap className="w-5 h-5 text-purple-600" />
                <CardTitle className="text-xl">Business</CardTitle>
              </div>
              <Badge className="bg-purple-100 text-purple-700 mx-auto">For growing teams</Badge>
            </CardHeader>
          </Card>

          <Card className="border-2 border-amber-300 bg-white shadow-lg">
            <CardHeader className="pb-3 text-center bg-gradient-to-br from-amber-50 to-amber-100">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Crown className="w-5 h-5 text-amber-600" />
                <CardTitle className="text-xl">Enterprise</CardTitle>
              </div>
              <Badge className="bg-amber-100 text-amber-700 mx-auto">Full-scale operations</Badge>
            </CardHeader>
          </Card>
        </div>

        {/* Feature Rows */}
        <div className="space-y-8">
          {FEATURES.map((category) => (
            <div key={category.category}>
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <div className="h-1 w-1 bg-blue-600 rounded-full"></div>
                {category.category}
              </h2>
              
              <Card className="overflow-hidden">
                <CardContent className="p-0">
                  {category.items.map((feature, idx) => (
                    <div 
                      key={feature.name}
                      className={`grid grid-cols-4 gap-4 p-4 ${idx !== category.items.length - 1 ? 'border-b' : ''} hover:bg-gray-50 transition-colors`}
                    >
                      <div className="font-medium text-gray-700 flex items-center">
                        {feature.name}
                      </div>
                      <div className="flex items-center justify-center">
                        {renderValue(feature.basic)}
                      </div>
                      <div className="flex items-center justify-center">
                        {renderValue(feature.business)}
                      </div>
                      <div className="flex items-center justify-center">
                        {renderValue(feature.enterprise)}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Button 
            onClick={() => navigate(createPageUrl('Pricing'))}
            size="lg"
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            View Pricing & Subscribe
          </Button>
        </div>
      </div>
    </div>
  );
}