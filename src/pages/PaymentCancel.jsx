import React from "react";
import { useNavigate } from "react-router-dom";
import { XCircle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import CompanySyncLogo from "@/components/brand/CompanySyncLogo";

export default function PaymentCancel() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <CompanySyncLogo tone="light" className="mx-auto mb-6 h-8 w-auto" />
        <div className="flex justify-center mb-4">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center">
            <XCircle className="w-12 h-12 text-red-500" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Cancelled</h1>
        <p className="text-gray-600 mb-6">
          No charge was made. You can close this page or go back home.
          If you have questions about your invoice, please contact us.
        </p>

        <Button
          onClick={() => navigate("/")}
          variant="outline"
          className="gap-2"
        >
          <Home className="w-4 h-4" />
          Go Home
        </Button>
      </div>
    </div>
  );
}
