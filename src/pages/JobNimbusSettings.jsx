import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle, RefreshCw, Link2, Unlink, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function JobNimbusSettings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: integrationSettings = [] } = useQuery({
    queryKey: ['integration-settings', myCompany?.id, 'jobnimbus'],
    queryFn: () => myCompany ? base44.entities.IntegrationSetting.filter({
      company_id: myCompany.id,
      integration_name: 'jobnimbus'
    }) : [],
    enabled: !!myCompany,
  });

  const currentSettings = integrationSettings[0];
  const isConnected = !!(currentSettings?.is_enabled && currentSettings?.config?.api_key_encrypted);

  const handleConnect = async () => {
    if (!myCompany || !apiKeyInput.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const response = await base44.functions.invoke('saveJobNimbusConfig', {
        company_id: myCompany.id,
        api_key: apiKeyInput.trim(),
      });
      if (response.data?.success) {
        setApiKeyInput("");
        queryClient.invalidateQueries({ queryKey: ['integration-settings'] });
      } else {
        setSaveError(response.data?.error || 'Failed to save API key');
      }
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!myCompany) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const response = await base44.functions.invoke('testJobNimbusConnection', {
        company_id: myCompany.id,
      });
      setTestResult(response.data);
    } catch (error) {
      setTestResult({ success: false, error: error.message });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSync = async () => {
    if (!myCompany) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const response = await base44.functions.invoke('syncJobNimbusData', {
        company_id: myCompany.id,
      });
      setSyncResult(response.data);
      if (response.data?.success) {
        queryClient.invalidateQueries({ queryKey: ['leads'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
    } catch (error) {
      setSyncResult({ success: false, error: error.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!myCompany) return;
    if (!window.confirm("Disconnect JobNimbus? You can reconnect anytime with your API key.")) return;
    setIsDisconnecting(true);
    try {
      await base44.functions.invoke('disconnectJobNimbus', { company_id: myCompany.id });
      setTestResult(null);
      setSyncResult(null);
      queryClient.invalidateQueries({ queryKey: ['integration-settings'] });
    } catch (error) {
      setSaveError(error.message);
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(createPageUrl('DataImport'))} className="mb-3 -ml-2" data-testid="button-back-to-import">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Data Import
        </Button>
        <h1 className="text-3xl font-bold text-gray-900">JobNimbus Integration</h1>
        <p className="text-gray-500 mt-1">Connect JobNimbus to bring your contacts and jobs into CompanySync automatically</p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {isConnected ? <Link2 className="w-5 h-5 text-green-600" /> : <AlertCircle className="w-5 h-5 text-gray-400" />}
              Connection Status
            </CardTitle>
            <CardDescription>Your JobNimbus API key is stored encrypted and never shown again after saving</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isConnected ? (
              <>
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <div>
                      <p className="font-medium text-gray-900">Connected</p>
                      <p className="text-sm text-gray-600 font-mono">{currentSettings?.config?.api_key_masked || '••••••••'}</p>
                      {currentSettings?.config?.last_synced_at && (
                        <p className="text-xs text-gray-500 mt-1">Last synced: {new Date(currentSettings.config.last_synced_at).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-700">Active</Badge>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button onClick={handleTest} disabled={isTesting} variant="outline" data-testid="button-test-jobnimbus">
                    {isTesting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing...</> : <><CheckCircle2 className="w-4 h-4 mr-2" />Test Connection</>}
                  </Button>
                  <Button onClick={handleSync} disabled={isSyncing} className="bg-blue-600 hover:bg-blue-700" data-testid="button-sync-jobnimbus">
                    {isSyncing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing...</> : <><RefreshCw className="w-4 h-4 mr-2" />Sync Now</>}
                  </Button>
                  <Button onClick={handleDisconnect} disabled={isDisconnecting} variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" data-testid="button-disconnect-jobnimbus">
                    {isDisconnecting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Disconnecting...</> : <><Unlink className="w-4 h-4 mr-2" />Disconnect</>}
                  </Button>
                </div>

                {testResult && (
                  <Alert className={testResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}>
                    <AlertDescription className={testResult.success ? "text-green-800" : "text-red-800"}>
                      {testResult.success ? testResult.message : `Test failed: ${testResult.error}`}
                    </AlertDescription>
                  </Alert>
                )}

                {syncResult && (
                  <Alert className={syncResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}>
                    <AlertDescription className={syncResult.success ? "text-green-800" : "text-red-800"}>
                      {syncResult.success ? (
                        <div className="space-y-1">
                          <p className="font-semibold">{syncResult.message}</p>
                          <ul className="text-sm space-y-0.5 mt-2">
                            <li>Leads: {syncResult.leads?.created || 0} new, {syncResult.leads?.updated || 0} updated</li>
                            <li>Customers: {syncResult.customers?.created || 0} new, {syncResult.customers?.updated || 0} updated</li>
                            <li>Projects: {syncResult.projects?.created || 0} new, {syncResult.projects?.updated || 0} updated</li>
                          </ul>
                          {syncResult.truncated && (
                            <p className="text-sm mt-2 font-medium" data-testid="text-jobnimbus-sync-truncated">
                              Not everything came over yet — click Sync Now again to pull the rest.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p>{syncResult.error}</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            ) : (
              <>
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription>
                    <strong>How to find your JobNimbus API key:</strong>
                    <ol className="list-decimal list-inside mt-2 text-sm space-y-1">
                      <li>Log in to JobNimbus and go to Settings</li>
                      <li>Open the "API" section under Account settings</li>
                      <li>Generate or copy your API key</li>
                      <li>Paste it below and click Connect</li>
                    </ol>
                  </AlertDescription>
                </Alert>
                <div>
                  <Label>JobNimbus API Key</Label>
                  <Input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Paste your JobNimbus API key"
                    className="mt-2"
                    data-testid="input-jobnimbus-api-key"
                  />
                </div>
                {saveError && (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertDescription className="text-red-800">{saveError}</AlertDescription>
                  </Alert>
                )}
                <Button
                  onClick={handleConnect}
                  disabled={isSaving || !apiKeyInput.trim() || !myCompany}
                  className="bg-blue-600 hover:bg-blue-700"
                  data-testid="button-connect-jobnimbus"
                >
                  {isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</> : <><Link2 className="w-4 h-4 mr-2" />Connect JobNimbus</>}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What Gets Synced?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">Contacts → Leads / Customers</p>
                  <p className="text-sm text-gray-600">JobNimbus contacts marked as leads become Leads; the rest become Customers</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">Jobs → Projects</p>
                  <p className="text-sm text-gray-600">JobNimbus jobs are imported as Projects with their status</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">Safe re-sync</p>
                  <p className="text-sm text-gray-600">Running sync again updates existing records instead of creating duplicates</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
