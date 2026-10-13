import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkles, Loader2 } from "lucide-react";

export default function SubscriptionSuccess() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(10);
  const [status, setStatus] = useState('checking');
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  // Poll for subscription status update
  useEffect(() => {
    if (!user) return;

    let attempts = 0;
    const maxAttempts = 20; // 40 seconds max

    const checkStatus = async () => {
      try {
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        const company = companies[0];

        if (company && (company.subscription_status === 'active' || company.subscription_status === 'trial')) {
          setStatus('confirmed');
          setTimeout(() => navigate(createPageUrl('Dashboard')), 1500);
          return true;
        }
      } catch (e) {
        console.error("Error checking status", e);
      }
      return false;
    };

    const interval = setInterval(async () => {
      attempts++;
      const confirmed = await checkStatus();
      if (confirmed) {
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        setStatus('timeout'); // Redirect anyway
        navigate(createPageUrl('Dashboard'));
      }
    }, 2000);

    // Also countdown for fallback redirect
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          clearInterval(interval); // Stop polling
          navigate(createPageUrl('Dashboard'));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full shadow-2xl">
        <CardHeader className="bg-gradient-to-r from-green-600 to-green-700 text-white rounded-t-lg">
          <div className="flex items-center justify-center mb-4">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
          </div>
          <CardTitle className="text-center text-3xl">
            🎉 Welcome Aboard!
          </CardTitle>
        </CardHeader>

        <CardContent className="p-8 text-center space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Your 14-Day Free Trial Has Started!
            </h2>
            <p className="text-gray-600">
              You now have full access to all premium features. No charges until your trial ends.
            </p>
          </div>

          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-6 border border-purple-200">
            <Sparkles className="w-8 h-8 text-purple-600 mx-auto mb-3" />
            <h3 className="font-bold text-lg text-gray-900 mb-2">What's Next?</h3>
            <ul className="text-left space-y-2 text-gray-700">
              <li>✅ Explore AI Estimator and Lexi AI Assistant</li>
              <li>✅ Import your customers and leads</li>
              <li>✅ Create your first estimate or invoice</li>
              <li>✅ Customize your company branding</li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => navigate(createPageUrl('Dashboard'))}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-6 text-lg"
            >
              Go to Dashboard
            </Button>

            <p className="text-sm text-gray-500 flex items-center justify-center gap-2">
              {status === 'confirmed' ? (
                <span className="text-green-600 font-medium">Subscription confirmed! Redirecting...</span>
              ) : (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Confirming subscription... ({countdown}s)</span>
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}