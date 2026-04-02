import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, Building2 } from "lucide-react";

export default function SetupBankAccount() {
  const [loading, setLoading] = useState(true);
  const [familyMember, setFamilyMember] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    bank_account_holder: "",
    bank_name: "",
    bank_account_number: "",
    bank_routing_number: "",
  });

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");

    if (!token) {
      setError("Invalid or missing setup link");
      setLoading(false);
      return;
    }

    // Validate token and get family member
    base44.asServiceRole.entities.FamilyMember.filter({ setup_token: token })
      .then(members => {
        if (members.length === 0) {
          setError("Invalid or expired setup link");
          setLoading(false);
          return;
        }

        const member = members[0];

        // Check if token is expired
        if (member.setup_token_expires && new Date(member.setup_token_expires) < new Date()) {
          setError("This setup link has expired. Please request a new one.");
          setLoading(false);
          return;
        }

        setFamilyMember(member);
        setFormData({
          bank_account_holder: member.bank_account_holder || member.full_name,
          bank_name: member.bank_name || "",
          bank_account_number: member.bank_account_number || "",
          bank_routing_number: member.bank_routing_number || "",
        });
        setLoading(false);
      })
      .catch(err => {
        setError("Failed to load setup information");
        setLoading(false);
      });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      await base44.asServiceRole.entities.FamilyMember.update(familyMember.id, {
        ...formData,
        setup_token: null, // Clear token after use
        setup_token_expires: null
      });

      setSuccess(true);
    } catch (err) {
      setError("Failed to save bank details: " + err.message);
      setLoading(false);
    }
  };

  if (loading && !familyMember) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-4">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-12 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Setup Link Error</h2>
            <p className="text-gray-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">All Set!</h2>
            <p className="text-gray-600 mb-6">
              Your bank account details have been saved securely. You'll receive commission payments automatically via Wise.
            </p>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800">
                <strong>✓ Bank Account Connected</strong><br />
                Future commission payouts will be sent to your bank account automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center border-b">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Building2 className="w-8 h-8 text-blue-600" />
            <CardTitle className="text-2xl">Bank Account Setup</CardTitle>
          </div>
          <p className="text-gray-600">
            Hi <strong>{familyMember?.full_name}</strong>, please enter your bank details to receive commission payments
          </p>
        </CardHeader>
        <CardContent className="p-6">
          <Alert className="mb-6 bg-blue-50 border-blue-200">
            <AlertDescription className="text-sm text-blue-900">
              🔒 Your banking information is encrypted and secure. It will only be used for commission payouts via Wise.
            </AlertDescription>
          </Alert>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Account Holder Name *</Label>
              <Input
                value={formData.bank_account_holder}
                onChange={(e) => setFormData({ ...formData, bank_account_holder: e.target.value })}
                placeholder="Full name on bank account"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Must match your bank account exactly</p>
            </div>

            <div>
              <Label>Bank Name *</Label>
              <Input
                value={formData.bank_name}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                placeholder="e.g. Chase, Bank of America, Wells Fargo"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Account Number *</Label>
                <Input
                  value={formData.bank_account_number}
                  onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                  placeholder="Account number"
                  required
                />
              </div>
              <div>
                <Label>Routing Number *</Label>
                <Input
                  value={formData.bank_routing_number}
                  onChange={(e) => setFormData({ ...formData, bank_routing_number: e.target.value })}
                  placeholder="9-digit routing"
                  maxLength={9}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">9 digits (e.g. 021000021)</p>
              </div>
            </div>

            <div className="bg-gray-50 border rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-sm text-gray-700">Where to find this information:</h4>
              <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                <li>Check bottom of your paper checks</li>
                <li>Log into your online banking</li>
                <li>Call your bank's customer service</li>
                <li>Visit a local branch</li>
              </ul>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="submit"
                className="flex-1 bg-green-600 hover:bg-green-700"
                disabled={loading}
              >
                {loading ? "Saving..." : "Save Bank Details"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}