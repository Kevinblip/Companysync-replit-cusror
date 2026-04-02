import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, AlertCircle, DollarSign, CreditCard, Zap, Wallet, Banknote } from "lucide-react";

export default function StripeConnect() {
  const [user, setUser] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: companySettings = [] } = useQuery({
    queryKey: ['company-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CompanySetting.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentSettings = companySettings[0];

  const [paymentInfo, setPaymentInfo] = useState({
    zelle_email: '',
    cashapp_handle: '',
    venmo_handle: '',
    check_payment_instructions: '',
    cash_payment_instructions: ''
  });

  useEffect(() => {
    if (currentSettings) {
      setPaymentInfo({
        zelle_email: currentSettings.zelle_email || '',
        cashapp_handle: currentSettings.cashapp_handle || '',
        venmo_handle: currentSettings.venmo_handle || '',
        check_payment_instructions: currentSettings.check_payment_instructions || '',
        cash_payment_instructions: currentSettings.cash_payment_instructions || ''
      });
    }
  }, [currentSettings]);

  const savePaymentInfoMutation = useMutation({
    mutationFn: (data) => {
      if (currentSettings) {
        return base44.entities.CompanySetting.update(currentSettings.id, data);
      } else {
        return base44.entities.CompanySetting.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      alert('✅ Payment options saved successfully!');
    },
  });

  const { data: stripeStatus, isLoading: statusLoading, refetch } = useQuery({
    queryKey: ['stripe-status', myCompany?.id],
    queryFn: async () => {
      const result = await base44.functions.invoke('checkStripeAccountStatus', {});
      return result.data;
    },
    enabled: !!myCompany,
    initialData: { connected: false, onboarding_complete: false },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const result = await base44.functions.invoke('createConnectedAccount', {});
      return result.data;
    },
    onSuccess: (data) => {
      console.log('✅ Stripe connection response:', data);
      if (data.onboarding_url) {
        window.location.href = data.onboarding_url;
      } else if (data.error) {
        alert(`❌ Error: ${data.error}`);
      } else {
        alert('❌ No onboarding URL received. Please contact support.');
      }
    },
    onError: (error) => {
      console.error('❌ Stripe connection error:', error);
      alert(`❌ Failed to connect: ${error.message || 'Unknown error'}`);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-blue-50 to-purple-50 min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Accept Payments</h1>
        <p className="text-gray-600 mt-1">Connect your Stripe account to collect payments from customers</p>
      </div>

      {statusLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
            <p className="text-gray-600">Checking connection status...</p>
          </CardContent>
        </Card>
      ) : !stripeStatus?.connected ? (
        <>
          <Card className="bg-gradient-to-br from-blue-600 to-purple-600 text-white">
            <CardHeader>
              <CardTitle className="text-2xl flex items-center gap-3">
                <CreditCard className="w-8 h-8" />
                Enable Instant Payments
              </CardTitle>
              <CardDescription className="text-blue-100 text-base">
                Start collecting payments today and get paid next business day
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <Zap className="w-8 h-8 mb-3" />
                  <h3 className="font-semibold mb-2">Auto-Invoice</h3>
                  <p className="text-sm text-blue-100">
                    When crews upload completion photos, customers automatically receive a text with invoice and payment link
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <DollarSign className="w-8 h-8 mb-3" />
                  <h3 className="font-semibold mb-2">Instant Pay</h3>
                  <p className="text-sm text-blue-100">
                    Customers pay via credit card, Apple Pay, or ACH right from their phone
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <CheckCircle2 className="w-8 h-8 mb-3" />
                  <h3 className="font-semibold mb-2">Next-Day Funding</h3>
                  <p className="text-sm text-blue-100">
                    Money deposited to your bank account the next business day
                  </p>
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6">
                <h4 className="font-semibold mb-3 text-lg">Why This Is Better:</h4>
                <ul className="space-y-2 text-blue-100">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <span><strong>No More Disputes:</strong> Completion photos attached to invoice = proof of work</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <span><strong>Lower Stress:</strong> No driving to pick up checks or waiting for mail</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <span><strong>Professional:</strong> Look like a $200M company even with a team of 5</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0" />
                    <span><strong>Fast Setup:</strong> Be collecting payments this afternoon</span>
                  </li>
                </ul>
              </div>

              <Button
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
                size="lg"
                className="w-full bg-white text-blue-600 hover:bg-blue-50 font-semibold text-lg h-14"
              >
                {connectMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Connecting to Stripe...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    Enable Payments Now
                  </>
                )}
              </Button>

              <p className="text-sm text-blue-100 text-center">
                Powered by Stripe • Bank-level security • PCI compliant
              </p>
            </CardContent>
          </Card>

          <Alert>
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              <strong>Platform Fee:</strong> We charge a 0.5% platform fee on each transaction. Stripe's payment processing fees (2.9% + $0.30) are separate.
            </AlertDescription>
          </Alert>
        </>
      ) : !stripeStatus.onboarding_complete ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-6 h-6 text-yellow-600" />
              Complete Stripe Setup
            </CardTitle>
            <CardDescription>
              Your Stripe account is connected but needs additional information to start accepting payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertDescription className="text-yellow-800">
                <strong>Action Required:</strong> Complete your business information in Stripe to enable payment processing.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {stripeStatus.details_submitted ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                )}
                <span>Business Details {stripeStatus.details_submitted ? 'Submitted' : 'Pending'}</span>
              </div>
              <div className="flex items-center gap-2">
                {stripeStatus.charges_enabled ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                )}
                <span>Accept Charges {stripeStatus.charges_enabled ? 'Enabled' : 'Pending'}</span>
              </div>
              <div className="flex items-center gap-2">
                {stripeStatus.payouts_enabled ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-yellow-600" />
                )}
                <span>Receive Payouts {stripeStatus.payouts_enabled ? 'Enabled' : 'Pending'}</span>
              </div>
            </div>

            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="w-full"
            >
              {connectMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                'Continue Stripe Setup'
              )}
            </Button>

            <Button
              onClick={() => refreshMutation.mutate()}
              variant="outline"
              disabled={refreshMutation.isPending}
              className="w-full"
            >
              {refreshMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                'Refresh Status'
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-800">
              <CheckCircle2 className="w-6 h-6" />
              Payments Enabled
            </CardTitle>
            <CardDescription>
              You're all set to accept payments from customers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <h4 className="font-semibold">Accept Payments</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Customers can pay invoices via credit card, Apple Pay, or ACH
                </p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <h4 className="font-semibold">Auto-Invoice</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Invoices sent automatically when crews upload completion photos
                </p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  <h4 className="font-semibold">Next-Day Funding</h4>
                </div>
                <p className="text-sm text-gray-600">
                  Money deposited to your bank account automatically
                </p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-5 h-5 text-green-600" />
                  <h4 className="font-semibold">Platform Fee</h4>
                </div>
                <p className="text-sm text-gray-600">
                  0.5% + Stripe fees (2.9% + $0.30)
                </p>
              </div>
            </div>

            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription className="text-blue-800">
                <strong>Account ID:</strong> {stripeStatus.account_id}
              </AlertDescription>
            </Alert>

            <Button
              onClick={() => refreshMutation.mutate()}
              variant="outline"
              disabled={refreshMutation.isPending}
              className="w-full"
            >
              {refreshMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                'Refresh Status'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-6 h-6 text-blue-600" />
            Alternative Payment Methods
          </CardTitle>
          <CardDescription>
            Add your Zelle, Cash App, Venmo, and other payment details. These will appear on all invoice emails and PDFs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-800">
              <strong>💡 Tip:</strong> Customers prefer having multiple payment options. Add your Zelle, Cash App, or Venmo to give them flexibility.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div>
              <Label>Zelle Email or Phone</Label>
              <Input
                placeholder="your-email@example.com or +1234567890"
                value={paymentInfo.zelle_email}
                onChange={(e) => setPaymentInfo({ ...paymentInfo, zelle_email: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">Customers can send payments directly via Zelle</p>
            </div>

            <div>
              <Label>Cash App Handle</Label>
              <Input
                placeholder="$YourCashApp"
                value={paymentInfo.cashapp_handle}
                onChange={(e) => setPaymentInfo({ ...paymentInfo, cashapp_handle: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">Include the $ symbol (e.g., $YourHandle)</p>
            </div>

            <div>
              <Label>Venmo Handle</Label>
              <Input
                placeholder="@YourVenmo"
                value={paymentInfo.venmo_handle}
                onChange={(e) => setPaymentInfo({ ...paymentInfo, venmo_handle: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">Include the @ symbol (e.g., @YourHandle)</p>
            </div>

            <div>
              <Label>Check Payment Instructions</Label>
              <Textarea
                placeholder="Make checks payable to: Your Company Name&#10;Mail to: 123 Main St, City, ST 12345"
                value={paymentInfo.check_payment_instructions}
                onChange={(e) => setPaymentInfo({ ...paymentInfo, check_payment_instructions: e.target.value })}
                rows={3}
              />
              <p className="text-xs text-gray-500 mt-1">Where to mail checks and who to make them out to</p>
            </div>

            <div>
              <Label>Cash Payment Instructions</Label>
              <Textarea
                placeholder="Pay cash in person at our office or to crew upon completion"
                value={paymentInfo.cash_payment_instructions}
                onChange={(e) => setPaymentInfo({ ...paymentInfo, cash_payment_instructions: e.target.value })}
                rows={2}
              />
              <p className="text-xs text-gray-500 mt-1">Instructions for cash payments</p>
            </div>
          </div>

          <Button
            onClick={() => savePaymentInfoMutation.mutate(paymentInfo)}
            disabled={savePaymentInfoMutation.isPending}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {savePaymentInfoMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Banknote className="w-4 h-4 mr-2" />
                Save Payment Options
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            <li className="flex gap-3">
              <Badge className="w-6 h-6 flex items-center justify-center bg-blue-600 flex-shrink-0">1</Badge>
              <div>
                <strong>Crew Completes Job:</strong> Your team uploads final completion photos in CrewCam
              </div>
            </li>
            <li className="flex gap-3">
              <Badge className="w-6 h-6 flex items-center justify-center bg-blue-600 flex-shrink-0">2</Badge>
              <div>
                <strong>Auto-Invoice Sent:</strong> System texts customer with invoice + photo + payment link
              </div>
            </li>
            <li className="flex gap-3">
              <Badge className="w-6 h-6 flex items-center justify-center bg-blue-600 flex-shrink-0">3</Badge>
              <div>
                <strong>Customer Pays:</strong> They choose from multiple payment options (Credit Card, Zelle, Cash App, etc.)
              </div>
            </li>
            <li className="flex gap-3">
              <Badge className="w-6 h-6 flex items-center justify-center bg-blue-600 flex-shrink-0">4</Badge>
              <div>
                <strong>Money Arrives:</strong> Credit card payments deposited next business day, others as received
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}