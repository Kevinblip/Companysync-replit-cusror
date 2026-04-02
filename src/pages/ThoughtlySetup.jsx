import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export default function ThoughtlySetup() {
  const [agentId, setAgentId] = useState("xlHlPjRc");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleConfigureWebhook = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const response = await base44.functions.invoke('configureThoughtlyWebhook', {
        agent_id: agentId
      });

      setResult(response.data);
    } catch (err) {
      setError(err.message || "Failed to configure webhook");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Thoughtly Webhook Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label htmlFor="agent_id">Thoughtly Agent ID</Label>
              <Input
                id="agent_id"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="Enter your Thoughtly agent ID"
                className="mt-2"
              />
              <p className="text-sm text-gray-500 mt-2">
                Find this in your Thoughtly dashboard URL (e.g., xlHlPjRc)
              </p>
            </div>

            <Button
              onClick={handleConfigureWebhook}
              disabled={loading || !agentId}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Configuring...
                </>
              ) : (
                "Configure Webhook"
              )}
            </Button>

            {result && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <strong>✅ Success!</strong> Webhook configured successfully!
                  <div className="mt-2 text-sm">
                    <p><strong>Webhook URL:</strong> {result.webhook_url}</p>
                    <p><strong>Agent ID:</strong> {result.agent_id}</p>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert className="bg-red-50 border-red-200">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-900">
                  <strong>❌ Error:</strong> {error}
                </AlertDescription>
              </Alert>
            )}

            <div className="pt-4 border-t">
              <h3 className="font-semibold mb-2">What this does:</h3>
              <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                <li>Configures your Thoughtly agent to send call logs to your CRM</li>
                <li>Enables automatic lead creation from inbound calls</li>
                <li>Tracks all call communications in your system</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}