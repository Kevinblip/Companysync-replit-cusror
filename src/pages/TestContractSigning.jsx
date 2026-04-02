import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, ExternalLink, Loader2 } from "lucide-react";

export default function TestContractSigning() {
  const [creating, setCreating] = useState(false);
  const [testLink, setTestLink] = useState(null);

  const createTestSession = async () => {
    setCreating(true);
    try {
      const testToken = 'test_' + Math.random().toString(36).substring(7);
      
      // Create test template
      const template = await base44.entities.ContractTemplate.create({
        template_name: "Test Contract Template",
        original_file_url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
        fillable_fields: [
          {
            field_name: "customer_name",
            field_label: "Customer Name",
            field_type: "text",
            filled_by: "customer",
            required: true
          },
          {
            field_name: "customer_email",
            field_label: "Email",
            field_type: "email",
            filled_by: "customer",
            required: true
          },
          {
            field_name: "customer_signature",
            field_label: "Signature",
            field_type: "signature",
            filled_by: "customer",
            required: true
          }
        ]
      });

      // Create test signing session with CUSTOMER FIELDS PRE-FILLED
      const session = await base44.entities.ContractSigningSession.create({
        template_id: template.id,
        template_name: "Test Contract Template",
        contract_name: "Test Contract #123",
        customer_name: "Test Customer",
        customer_email: "test@example.com",
        rep_name: "Sales Rep",
        rep_email: "rep@example.com",
        rep_fields: {
          sales_rep_name: "John Doe",
          company_name: "Test Company Inc"
        },
        customer_fields: {
          customer_name: "Jane Smith",
          customer_email: "jane@example.com"
        },
        rep_signature_url: "https://via.placeholder.com/300x100/0066FF/FFFFFF?text=Rep+Signature",
        signing_token: testToken,
        status: "pending"
      });

      const link = `${window.location.origin}/sign-contract-customer?token=${testToken}`;
      setTestLink(link);
      
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to create test session: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(testLink);
    alert('Link copied!');
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>🧪 Test Contract Signing Link Generator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-gray-600">
            Generate a test link to quickly test the contract signing flow without setting up real data.
          </p>

          <Button 
            onClick={createTestSession}
            disabled={creating}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating Test Session...
              </>
            ) : (
              'Generate Test Link'
            )}
          </Button>

          {testLink && (
            <div className="space-y-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <Label className="text-green-900 font-semibold">✅ Test Link Generated!</Label>
              
              <div className="flex gap-2">
                <Input 
                  value={testLink} 
                  readOnly 
                  className="bg-white"
                />
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={copyLink}
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => window.open(testLink, '_blank')}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>

              <p className="text-sm text-gray-600">
                Open this link to test the customer signing experience. You can sign and submit to test the full flow.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}