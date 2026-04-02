import React from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { XCircle, ArrowLeft } from "lucide-react";

export default function SubscriptionCancel() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full shadow-2xl">
        <CardHeader className="bg-gradient-to-r from-gray-600 to-gray-700 text-white rounded-t-lg">
          <div className="flex items-center justify-center mb-4">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center">
              <XCircle className="w-12 h-12 text-gray-600" />
            </div>
          </div>
          <CardTitle className="text-center text-3xl">
            Subscription Cancelled
          </CardTitle>
        </CardHeader>

        <CardContent className="p-8 text-center space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              No problem!
            </h2>
            <p className="text-gray-600">
              Your checkout was cancelled. You can start a subscription anytime you're ready.
            </p>
          </div>

          <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
            <p className="text-gray-700 mb-4">
              💡 <strong>Remember:</strong> All plans include a 14-day free trial with full access to premium features.
            </p>
            <p className="text-sm text-gray-600">
              No credit card required • Cancel anytime • No commitment
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={() => navigate(createPageUrl('Pricing'))}
              className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-6 text-lg"
            >
              View Plans Again
            </Button>

            <Button
              onClick={() => navigate(createPageUrl('Dashboard'))}
              variant="outline"
              className="flex-1 py-6 text-lg"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}