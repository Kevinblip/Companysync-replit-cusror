import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle, Clock3, Home, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PaymentSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invoiceId = searchParams.get("invoice_id");
  const sessionId = searchParams.get("session_id");
  const [countdown, setCountdown] = useState(10);
  const [paymentStatus, setPaymentStatus] = useState("checking");

  useEffect(() => {
    if (!invoiceId || !sessionId) {
      setPaymentStatus("error");
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer;
    const checkStatus = async () => {
      try {
        const params = new URLSearchParams({ invoice_id: invoiceId, session_id: sessionId });
        const response = await fetch(`/api/public/portal/invoice-payment-status?${params}`, {
          cache: "no-store",
        });
        const result = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(result?.error || "Unable to verify payment");
        setPaymentStatus(result.status);
        if (result.status === "confirmed" || result.status === "ach_pending") return;
      } catch {
        if (!cancelled && attempts >= 8) setPaymentStatus("error");
      }
      attempts += 1;
      if (!cancelled && attempts < 10) timer = setTimeout(checkStatus, 2000);
      else if (!cancelled) setPaymentStatus(current => current === "checking" ? "processing" : current);
    };
    checkStatus();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [invoiceId, sessionId]);

  useEffect(() => {
    if (paymentStatus !== "confirmed") return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate("/");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate, paymentStatus]);

  const view = paymentStatus === "confirmed"
    ? {
        icon: <CheckCircle className="w-12 h-12 text-green-600" />,
        iconBg: "bg-green-100",
        title: "Payment Confirmed",
        message: "Your payment is recorded and the invoice balance has been updated.",
      }
    : paymentStatus === "ach_pending"
      ? {
          icon: <Clock3 className="w-12 h-12 text-amber-600" />,
          iconBg: "bg-amber-100",
          title: "Bank Transfer Processing",
          message: "Stripe received your bank transfer. It usually takes 3–5 business days to clear.",
        }
      : paymentStatus === "error"
        ? {
            icon: <AlertCircle className="w-12 h-12 text-amber-600" />,
            iconBg: "bg-amber-100",
            title: "Payment Submitted",
            message: "We could not confirm the CRM update yet. Please do not pay again; contact the company if this remains unresolved.",
          }
        : {
            icon: <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />,
            iconBg: "bg-blue-100",
            title: "Confirming Payment",
            message: "Stripe accepted the checkout. We’re waiting for the invoice record to update.",
          };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <div className="flex justify-center mb-4">
          <div className={`w-20 h-20 ${view.iconBg} rounded-full flex items-center justify-center`}>
            {view.icon}
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{view.title}</h1>
        <p className="text-gray-600 mb-3">
          {view.message}
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 text-left text-sm text-gray-600">
          <p><strong>Card payments</strong> are processed instantly.</p>
          <p className="mt-1"><strong>Bank transfers (ACH)</strong> take 3–5 business days to clear. You'll get a confirmation email when it's done.</p>
        </div>

        {invoiceId && (
          <p className="text-sm text-gray-400 mb-3">Invoice reference: {invoiceId}</p>
        )}
        {paymentStatus === "confirmed" ? (
          <p className="text-sm text-gray-400 mb-6">
            A receipt will be sent to the email used for payment. Redirecting in {countdown}s.
          </p>
        ) : (
          <p className="text-sm text-gray-400 mb-6">
            You can safely leave this page. Do not submit the payment again while confirmation is pending.
          </p>
        )}

        <Button
          onClick={() => navigate("/")}
          className="bg-green-600 hover:bg-green-700 text-white gap-2"
        >
          <Home className="w-4 h-4" />
          Go Home
        </Button>
      </div>
    </div>
  );
}
