import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, Copy, RefreshCw, AlertCircle, Link2, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function GoHighLevelSettings() {
  const [user, setUser] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [webhookTest, setWebhookTest] = useState(null);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState(30); // minutes
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

  const { data: integrationSettings = [] } = useQuery({
    queryKey: ['integration-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.IntegrationSetting.filter({ 
      company_id: myCompany.id,
      integration_name: 'gohighlevel'
    }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const currentSettings = integrationSettings[0];

  useEffect(() => {
    if (currentSettings?.config?.location_id) {
      setLocationId(currentSettings.config.location_id);
    }
    if (currentSettings?.config?.auto_sync_enabled) {
      setAutoSyncEnabled(currentSettings.config.auto_sync_enabled);
    }
    if (currentSettings?.config?.sync_interval_minutes) {
      setSyncInterval(currentSettings.config.sync_interval_minutes);
    }
  }, [currentSettings]);

  // Auto-sync polling effect
  useEffect(() => {
    if (!autoSyncEnabled) return;

    const intervalMs = syncInterval * 60 * 1000;
    
    const autoSync = async () => {
      try {
        console.log('🔄 Running automatic GHL sync...');
        const response = await base44.functions.invoke('syncGHLContacts', {
          locationId: locationId || undefined,
          skipDuplicates: true
        });
        console.log('✅ Auto-sync completed:', response.data);
        queryClient.invalidateQueries({ queryKey: ['leads'] });
      } catch (error) {
        console.error('❌ Auto-sync failed:', error);
      }
    };

    // Run initial sync
    autoSync();

    // Set up interval
    const intervalId = setInterval(autoSync, intervalMs);

    return () => clearInterval(intervalId);
  }, [autoSyncEnabled, syncInterval, locationId]);

  const saveSettingsMutation = useMutation({
    mutationFn: async (data) => {
      if (currentSettings) {
        return await base44.entities.IntegrationSetting.update(currentSettings.id, {
          config: {
            ...currentSettings.config,
            ...data
          }
        });
      } else {
        return await base44.entities.IntegrationSetting.create({
          company_id: myCompany.id,
          integration_name: 'gohighlevel',
          is_enabled: true,
          config: data
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration-settings'] });
      alert('✅ Settings saved successfully!');
    },
  });

  const handleSaveSettings = () => {
    saveSettingsMutation.mutate({ 
      location_id: locationId,
      auto_sync_enabled: autoSyncEnabled,
      sync_interval_minutes: syncInterval
    });
  };

  const handleTestSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const response = await base44.functions.invoke('testSyncOneGHL', {
        locationId: locationId || undefined
      });
      const data = response.data;
      
      if (data.success) {
        setSyncResult({
          success: true,
          isTest: true,
          action: data.result.action,
          preview: data.preview,
          message: `✅ Test successful! ${data.result.action === 'created' ? 'Created new lead' : 'Updated existing lead'}: ${data.preview.name}`
        });
      } else {
        setSyncResult({ success: false, error: data.error });
      }
    } catch (error) {
      setSyncResult({ 
        success: false, 
        error: error.message 
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const response = await base44.functions.invoke('syncGHLContacts', {
        locationId: locationId || undefined,
        skipDuplicates: true
      });
      setSyncResult(response.data);
    } catch (error) {
      setSyncResult({ 
        success: false, 
        error: error.message 
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const webhookUrl = `https://${window.location.hostname}/api/functions/ghlWebhook`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const testWebhook = async () => {
    setIsTestingWebhook(true);
    setWebhookTest(null);
    try {
      const result = await base44.functions.invoke('testGHLWebhook');
      setWebhookTest(result.data);
    } catch (error) {
      setWebhookTest({
        success: false,
        error: error.message
      });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">GoHighLevel Integration</h1>
        <p className="text-gray-500 mt-1">Connect your GHL account to sync contacts and automate workflows</p>
      </div>

      <div className="space-y-6">
        {/* API Key Status */}
        <Card>
          <CardHeader>
            <CardTitle>Connection Status</CardTitle>
            <CardDescription>GHL API key configuration</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <div>
                <p className="font-medium text-gray-900">API Key Configured</p>
                <p className="text-sm text-gray-500">Your GHL_API_KEY is set and ready to use</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Webhook Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Webhook URL</CardTitle>
            <CardDescription>Configure this URL in your GoHighLevel account</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-300 border-2">
              <AlertDescription className="text-gray-900">
                <h3 className="font-bold text-lg mb-3">🎯 Simple Setup (3 Steps):</h3>
                
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-lg border-2 border-blue-400">
                    <p className="font-bold text-blue-900 mb-2">STEP 1: Copy Your Webhook URL</p>
                    <p className="text-sm">👇 Scroll down and click "Copy" on the webhook URL below (in the blue box)</p>
                  </div>

                  <div className="bg-white p-4 rounded-lg border-2 border-blue-400">
                    <p className="font-bold text-blue-900 mb-2">STEP 2: Open Your GHL Automation</p>
                    <p className="text-sm mb-2">In GoHighLevel, click <strong>Automation → Workflows</strong></p>
                    <p className="text-sm">Create a new workflow OR edit an existing one (like your "AI Booking bot")</p>
                  </div>

                  <div className="bg-white p-4 rounded-lg border-2 border-blue-400">
                    <p className="font-bold text-blue-900 mb-2">STEP 3: Add a Webhook Action</p>
                    <p className="text-sm mb-2">1. Click the <strong>+ button</strong> in your workflow</p>
                    <p className="text-sm mb-2">2. Search for and add <strong>"Webhook"</strong> or <strong>"HTTP Request"</strong></p>
                    <p className="text-sm mb-2">3. Paste the URL you copied from Step 1</p>
                    <p className="text-sm mb-2">4. Set method to <strong>POST</strong></p>
                    <p className="text-sm">5. Click Save → Activate workflow</p>
                  </div>

                  <div className="bg-green-100 p-3 rounded-lg mt-4">
                    <p className="text-sm font-semibold text-green-900">✅ That's it! Now when your GHL workflow runs, it will automatically send data to your CRM!</p>
                  </div>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Input
                value={webhookUrl}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                onClick={copyWebhookUrl}
                variant="outline"
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
              <Button
                onClick={testWebhook}
                variant="outline"
                disabled={isTestingWebhook}
                className="shrink-0"
              >
                {isTestingWebhook ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Test Connection
                  </>
                )}
              </Button>
            </div>

            {webhookTest && (
              <Alert className={webhookTest.success ? "bg-green-50 border-green-300 mt-4" : "bg-red-50 border-red-300 mt-4"}>
                <AlertDescription>
                  {webhookTest.success ? (
                    <div className="space-y-3">
                      <div className="font-semibold text-green-900">✅ Connection Test Successful</div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <strong>API Connection:</strong> {webhookTest.tests?.apiConnection?.status} - 
                          Found {webhookTest.tests?.apiConnection?.contacts} contacts
                        </div>
                        <div>
                          <strong>Webhook URL:</strong> <code className="bg-white px-2 py-1 rounded">{webhookTest.tests?.webhookUrl?.url}</code>
                        </div>
                        <div>
                          <strong>Location ID:</strong> {webhookTest.tests?.locationId?.status} ({webhookTest.tests?.locationId?.value})
                        </div>
                      </div>
                      <div className="mt-3 p-3 bg-white rounded border">
                        <strong>Next Steps:</strong>
                        <ol className="list-decimal ml-5 mt-2 space-y-1">
                          {webhookTest.nextSteps?.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  ) : (
                    <div className="text-red-900">
                      <strong>❌ Connection Test Failed:</strong> {webhookTest.error}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Automatic Sync Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              Automatic Sync
            </CardTitle>
            <CardDescription>Enable background syncing without webhooks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription>
                <strong>✨ How it works:</strong> When enabled, your CRM will automatically check for new GHL contacts every {syncInterval} minutes while you have the app open. No webhook setup required!
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex-1">
                <Label className="text-base font-semibold">Enable Automatic Sync</Label>
                <p className="text-sm text-gray-600 mt-1">
                  Polls GHL for new contacts every {syncInterval} minutes
                </p>
              </div>
              <Switch
                checked={autoSyncEnabled}
                onCheckedChange={setAutoSyncEnabled}
              />
            </div>

            {autoSyncEnabled && (
              <div>
                <Label>Sync Interval</Label>
                <Select value={syncInterval.toString()} onValueChange={(v) => setSyncInterval(parseInt(v))}>
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">Every 15 minutes</SelectItem>
                    <SelectItem value="30">Every 30 minutes</SelectItem>
                    <SelectItem value="60">Every 1 hour</SelectItem>
                    <SelectItem value="120">Every 2 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Location ID (Optional)</Label>
              <p className="text-xs text-gray-500 mb-2">
                Find this in GHL under Settings → Business Profile → Location ID
              </p>
              <Input
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                placeholder="e.g., ve9EPM428h8vShlRW1KT"
              />
            </div>

            <Button
              onClick={handleSaveSettings}
              disabled={saveSettingsMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saveSettingsMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </Button>

            {autoSyncEnabled && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-900">
                  <strong>✅ Auto-sync is active!</strong> Your CRM will check for new GHL contacts every {syncInterval} minutes while you have the app open.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Manual Sync */}
        <Card>
          <CardHeader>
            <CardTitle>Manual Sync</CardTitle>
            <CardDescription>Import contacts from GoHighLevel into your CRM</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertDescription>
                <strong>📊 How Sync Works:</strong>
                <ul className="list-disc list-inside mt-2 text-sm space-y-1">
                  <li>Fetches ALL contacts from your GHL account (paginated)</li>
                  <li>Matches by GHL ID, email, or phone to prevent duplicates</li>
                  <li>Creates new leads or updates existing ones</li>
                  <li>Includes conversation history, notes, and custom fields</li>
                </ul>
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button
                onClick={handleTestSync}
                disabled={isSyncing}
                variant="outline"
                className="border-blue-600 text-blue-600 hover:bg-blue-50"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 mr-2" />
                    Test Sync (1 Contact)
                  </>
                )}
              </Button>

              <Button
                onClick={handleSync}
                disabled={isSyncing}
                className="bg-green-600 hover:bg-green-700"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Sync All Contacts (No Duplicates)
                  </>
                )}
              </Button>
            </div>

            {syncResult && (
              <Alert className={syncResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}>
                <AlertDescription className={syncResult.success ? "text-green-800" : "text-red-800"}>
                  {syncResult.success ? (
                    <div>
                      {syncResult.isTest ? (
                        <>
                          <p className="font-semibold mb-2">✅ Test Sync Successful!</p>
                          <div className="text-sm space-y-2 bg-white p-3 rounded border border-green-300 mt-2">
                            <p><strong>Action:</strong> {syncResult.action === 'created' ? '✨ Created new lead' : '🔄 Updated existing lead'}</p>
                            <p><strong>Name:</strong> {syncResult.preview.name}</p>
                            <p><strong>Email:</strong> {syncResult.preview.email || 'N/A'}</p>
                            <p><strong>Phone:</strong> {syncResult.preview.phone || 'N/A'}</p>
                            <p><strong>Tags:</strong> {syncResult.preview.tags.join(', ') || 'None'}</p>
                            <p><strong>Custom Fields Found:</strong> {syncResult.preview.customFieldsFound}</p>
                            {syncResult.preview.customFieldNames.length > 0 && (
                              <p><strong>Field Names:</strong> {syncResult.preview.customFieldNames.join(', ')}</p>
                            )}
                            <p className="text-xs text-gray-600"><strong>Raw Fields in GHL:</strong> {syncResult.preview.rawFieldCount || 0}</p>
                            <details className="text-xs text-gray-600 mt-1">
                              <summary className="cursor-pointer font-semibold">Show All GHL Fields (Debug)</summary>
                              <pre className="mt-1 bg-gray-100 p-2 rounded">{syncResult.preview.rawFields && syncResult.preview.rawFields.length > 0 ? JSON.stringify(syncResult.preview.rawFields, null, 2) : '[]'}</pre>
                            </details>
                            <p className="text-xs text-gray-600"><strong>Has GHL Notes:</strong> {syncResult.preview.hasNotes ? 'Yes' : 'No'}</p>
                            <p className="text-xs text-gray-600"><strong>Has Conversations:</strong> {syncResult.preview.hasConversations ? `Yes (${syncResult.preview.conversationCount})` : 'No'}</p>
                            <p className="text-xs text-gray-600"><strong>Has Attribution:</strong> {syncResult.preview.hasAttribution ? 'Yes' : 'No'}</p>
                            <div className="mt-2 pt-2 border-t border-green-200">
                              <p className="font-semibold mb-1">Notes Preview:</p>
                              <pre className="text-xs whitespace-pre-wrap bg-gray-50 p-2 rounded">{syncResult.preview.notesPreview}</pre>
                            </div>
                          </div>
                          <p className="text-sm mt-3 font-medium">👍 If the notes look correct, click "Sync 50 Newest Contacts" to import more!</p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold mb-2">✅ Sync Completed Successfully!</p>
                          <ul className="text-sm space-y-1">
                            <li>📊 Total Contacts: {syncResult.total}</li>
                            <li>✨ New Leads Created: {syncResult.created}</li>
                            <li>🔄 Leads Updated: {syncResult.updated}</li>
                            <li>⏭️ Skipped (Duplicates): {syncResult.skipped}</li>
                            {syncResult.errors && (
                              <li className="text-red-600">⚠️ Errors: {syncResult.errors.length}</li>
                            )}
                          </ul>
                        </>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold mb-1">❌ Sync Failed</p>
                      <p className="text-sm">{syncResult.error}</p>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Features */}
        <Card>
          <CardHeader>
            <CardTitle>What's Synced?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">GHL → CRM: Contacts → Leads</p>
                  <p className="text-sm text-gray-600">New GHL contacts automatically become leads in your CRM</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">CRM → GHL: Leads → Contacts</p>
                  <p className="text-sm text-gray-600">New CRM leads can be pushed to GoHighLevel (enable in Workflows)</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">Opportunities → Tasks</p>
                  <p className="text-sm text-gray-600">GHL opportunities create tasks for follow-up</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">Messages & Notes</p>
                  <p className="text-sm text-gray-600">Communication history is logged in the CRM</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-medium">Real-time Updates</p>
                  <p className="text-sm text-gray-600">Changes in GHL trigger instant updates via webhooks</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Integration Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>🎯 Next Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal ml-5 space-y-2 text-sm">
              <li>Configure the webhook URL in your GoHighLevel account (see instructions above)</li>
              <li>Set your Location ID to enable proper syncing</li>
              <li>Click "Sync Now" to import existing GHL contacts</li>
              <li>Optional: Enable "Push to GHL" in your workflow automations to send new CRM leads to GoHighLevel</li>
            </ol>
            <Alert className="mt-4 bg-purple-50 border-purple-200">
              <AlertDescription className="text-purple-800">
                <strong>💡 Pro Tip:</strong> You can automate lead creation in GHL by adding the "Push to GoHighLevel" action in your workflow automations.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}