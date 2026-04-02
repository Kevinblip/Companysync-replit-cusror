import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings as SettingsIcon,
  Building2,
  CreditCard,
  Zap,
  Mail,
  MessageSquare,
  AlertCircle,
  Calendar,
  Link as LinkIcon,
  RefreshCw,
  CheckCircle2,
  Phone,
  Bell,
  Bot,
  Loader2,
  Plus,
  ExternalLink,
  DollarSign,
  Calculator,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select as UiSelect,
  SelectContent as UiSelectContent,
  SelectItem as UiSelectItem,
  SelectTrigger as UiSelectTrigger,
  SelectValue as UiSelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

import TwilioSetup from "../components/settings/TwilioSetup";
import CommunicationDashboard from "./CommunicationDashboard";

export default function Settings() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const defaultTab = new URLSearchParams(window.location.search).get('tab') || 'integrations';
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [showTwilioSetup, setShowTwilioSetup] = useState(false);
  const [showThoughtlyDialog, setShowThoughtlyDialog] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [thoughtlyAgents, setThoughtlyAgents] = useState([]);
  
  // QuickBooks states
  const [showQuickBooksDialog, setShowQuickBooksDialog] = useState(false);
  const [disconnectEmail, setDisconnectEmail] = useState('');
  const [qbClientId, setQbClientId] = useState('');
  const [qbClientSecret, setQbClientSecret] = useState('');
  const [qbRealmId, setQbRealmId] = useState('');

  // Financing states
  const [showFinancingDialog, setShowFinancingDialog] = useState(false);
  const [financingEnabled, setFinancingEnabled] = useState(false);
  const [financingProvider, setFinancingProvider] = useState('hearth');
  const [hearthPartnerId, setHearthPartnerId] = useState('');
  const [financingTerms, setFinancingTerms] = useState([12, 24, 36, 60, 120]);
  const [financingAprRange, setFinancingAprRange] = useState('6.99% – 24.99%');
  const [financingCustomUrl, setFinancingCustomUrl] = useState('');

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await base44.functions.invoke('checkGoogleCalendarConnection', {});
        setGoogleCalendarConnected(response.data.connected);
      } catch (error) {
        setGoogleCalendarConnected(false);
      }
    };
    checkConnection();
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"), // Fetch all companies to find the user's company
    initialData: [],
    enabled: !!user, // Only run this query if user is available
  });

  const myCompany = companies.find(c => c.created_by === user?.email);

  const { data: myStaffProfile } = useQuery({
    queryKey: ['my-staff-profile-settings', myCompany?.id, user?.email],
    queryFn: async () => {
      if (!myCompany || !user?.email) return null;
      const results = await base44.entities.StaffProfile.filter({ company_id: myCompany.id, user_email: user.email });
      return results[0] || null;
    },
    enabled: !!myCompany && !!user?.email,
  });

  const isAdmin = user?.email === myCompany?.created_by || myStaffProfile?.is_administrator === true;

  const { data: twilioConfig } = useQuery({
      queryKey: ['twilio-settings'],
      queryFn: async () => {
        if (!myCompany) return null;
        const settings = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
        return settings[0] || null;
      },
      enabled: !!myCompany,
  });

  const { data: quickbooksConfig } = useQuery({
    queryKey: ['quickbooks-settings'],
    queryFn: async () => {
      if (!myCompany) return null;
      const settings = await base44.entities.QuickBooksSettings.filter({ company_id: myCompany.id });
      return settings[0] || null;
    },
    enabled: !!myCompany,
  });

  // Set form values when quickbooksConfig loads
  useEffect(() => {
    if (quickbooksConfig) {
      setQbClientId(quickbooksConfig.client_id || '');
      setQbClientSecret(quickbooksConfig.client_secret || '');
      setQbRealmId(quickbooksConfig.realm_id || '');
    }
  }, [quickbooksConfig]);

  // Sync financing settings from company
  useEffect(() => {
    if (myCompany?.settings?.financing) {
      const f = myCompany.settings.financing;
      setFinancingEnabled(f.enabled ?? false);
      setFinancingProvider(f.provider || 'hearth');
      setHearthPartnerId(f.hearth_partner_id || '');
      setFinancingTerms(f.terms || [12, 24, 36, 60, 120]);
      setFinancingAprRange(f.apr_range || '6.99% – 24.99%');
      setFinancingCustomUrl(f.custom_url || '');
    }
  }, [myCompany?.id]);

  const saveFinancingMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany?.id) throw new Error('Company not found');
      const financingData = {
        enabled: financingEnabled,
        provider: financingProvider,
        hearth_partner_id: hearthPartnerId.trim(),
        terms: financingTerms,
        apr_range: financingAprRange.trim(),
        custom_url: financingCustomUrl.trim(),
      };
      return await base44.entities.Company.update(myCompany.id, {
        settings: { ...(myCompany.settings || {}), financing: financingData }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['current-company-list'] });
      setShowFinancingDialog(false);
      alert('✅ Financing settings saved!');
    },
    onError: (err) => {
      alert('❌ Failed to save: ' + err.message);
    }
  });

  const saveQuickBooksMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany?.id) throw new Error('Company not found');

      const data = {
        company_id: myCompany.id,
        client_id: qbClientId,
        client_secret: qbClientSecret,
        realm_id: qbRealmId,
        is_connected: true,
        sync_invoices: true,
        sync_payments: true,
        sync_customers: true,
      };

      if (quickbooksConfig?.id) {
        return await base44.entities.QuickBooksSettings.update(quickbooksConfig.id, data);
      } else {
        return await base44.entities.QuickBooksSettings.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quickbooks-settings'] });
      setShowQuickBooksDialog(false);
      alert('✅ QuickBooks connected successfully!');
    },
    onError: (error) => {
      alert(`❌ Failed to save QuickBooks settings: ${error.message}`);
    }
  });

  const handleConnectGoogleCalendar = async () => {
    setSyncingCalendar(true);
    try {
      const response = await base44.functions.invoke('connectGoogleCalendar', {});
      if (response.data.authUrl) {
        window.location.href = response.data.authUrl;
      }
    } catch (error) {
      alert("Failed to connect Google Calendar: " + error.message);
      setSyncingCalendar(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!confirm("Disconnect Google Calendar? Events will no longer sync.")) return;
    try {
      await base44.functions.invoke('disconnectGoogleCalendar', {});
      setGoogleCalendarConnected(false);
      alert("✅ Google Calendar disconnected");
    } catch (error) {
      alert("Failed to disconnect: " + error.message);
    }
  };

  const handleSyncNow = async () => {
    setSyncingCalendar(true);
    try {
      await base44.functions.invoke('syncGoogleCalendar', {});
      alert("✅ Calendar synced successfully!");
    } catch (error) {
      alert("Sync failed: " + error.message);
    }
    setSyncingCalendar(false);
  };

  const handleCreateThoughtlyAgent = async () => {
    if (!myCompany?.id) {
      alert('Please complete company setup first');
      return;
    }

    setIsCreatingAgent(true);
    try {
      const response = await base44.functions.invoke('createThoughtlyAgent', {
        companyId: myCompany.id
      });

      alert('✅ Thoughtly AI agent created successfully! Your AI phone receptionist is ready.');
      setShowThoughtlyDialog(false);
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
    } catch (error) {
      alert(`Failed to create agent: ${error.message}`);
    }
    setIsCreatingAgent(false);
  };

  const handleListThoughtlyAgents = async () => {
    setIsLoadingAgents(true);
    try {
      const response = await base44.functions.invoke('listThoughtlyAgents', {});
      setThoughtlyAgents(response.data.agents || []);
    } catch (error) {
      alert(`Failed to load agents: ${error.message}`);
    }
    setIsLoadingAgents(false);
  };

  useEffect(() => {
    if (showThoughtlyDialog) {
      handleListThoughtlyAgents();
    }
  }, [showThoughtlyDialog]);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
          <SettingsIcon className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.settings.title}</h1>
          <p className="text-gray-500 mt-1">Configure your CRM integrations and preferences</p>
        </div>
      </div>

      <Tabs defaultValue={defaultTab} className="space-y-6">
        <TabsList className="w-full justify-start md:justify-center flex-wrap">
          <TabsTrigger value="general">{t.settings.generalSettings}</TabsTrigger>
          <TabsTrigger value="integrations">{t.settings.integrations}</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="notifications">{t.sidebar.notifications}</TabsTrigger>
          {isAdmin && <TabsTrigger value="communications">Communications</TabsTrigger>}
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-gray-600" />
                {t.settings.companySetup}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <Alert className="bg-purple-50 border-purple-200">
                <Building2 className="w-4 h-4 text-purple-600" />
                <AlertDescription>
                  Company profile settings have moved to the <strong>{t.settings.companySetup}</strong> page.
                </AlertDescription>
              </Alert>
              <Button onClick={() => window.open('/company-setup', '_blank')}>Go to {t.settings.companySetup}</Button>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-gray-600" />
                {t.settings.generalSettings}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label>Decimal Separator</Label>
                  <Input placeholder="." defaultValue="." />
                </div>
                <div>
                  <Label>Thousand Separator</Label>
                  <Input placeholder="," defaultValue="," />
                </div>
              </div>

              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label className="text-base font-semibold">Automatically assign logged-in staff as sales agent</Label>
                    <p className="text-sm text-gray-500 mt-1">New leads/customers will be auto-assigned to the staff member who created them</p>
                  </div>
                  <Switch defaultChecked={true} />
                </div>
                
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label className="text-base font-semibold">Show tax per item on estimates/invoices</Label>
                    <p className="text-sm text-gray-500 mt-1">Display tax breakdown for each line item</p>
                  </div>
                  <Switch defaultChecked={false} />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-base font-semibold">Remove decimals on numbers/money with zero decimals</Label>
                    <p className="text-sm text-gray-500 mt-1">Display $100 instead of $100.00</p>
                  </div>
                  <Switch defaultChecked={false} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-gray-600" />
                Billing & Subscription
              </CardTitle>
            </CardHeader>
            <CardContent className="p-12 text-center text-gray-500">
              <CreditCard className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold mb-2">Billing & Subscription</h3>
              <p>Billing settings coming soon</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          {/* Twilio Communication */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <Phone className="w-6 h-6 text-blue-600" />
                <div>
                  <CardTitle>Twilio Communication</CardTitle>
                  <p className="text-sm text-gray-500">Enable calling and SMS features for your team.</p>
                </div>
              </div>
              <Dialog open={showTwilioSetup} onOpenChange={setShowTwilioSetup}>
                <DialogTrigger asChild>
                  <Button variant="outline">Manage</Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl h-[90vh]">
                  <DialogHeader>
                    <DialogTitle>Twilio Integration Setup</DialogTitle>
                  </DialogHeader>
                  <TwilioSetup />
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {twilioConfig && twilioConfig.account_sid ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    Twilio is connected. Click 'Manage' to configure numbers and features.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Twilio is not connected. Click 'Manage' to enter your credentials and set up the integration.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* SOFT-HIDDEN: Thoughtly AI Phone Receptionist - disabled platform-wide */}

          {/* Stripe Payment Processing - UPDATED */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <CreditCard className="w-6 h-6 text-green-600" />
                <div>
                  <CardTitle>Stripe Payment Processing</CardTitle>
                  <p className="text-sm text-gray-500">Accept online payments via credit card, ACH, Cash App, and more.</p>
                </div>
              </div>
              <Button 
                variant="outline"
                onClick={() => window.open('https://dashboard.stripe.com', '_blank')}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Stripe Dashboard
              </Button>
            </CardHeader>
            <CardContent>
              <Alert className="bg-blue-50 border-blue-200">
                <DollarSign className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <strong>Stripe Payment Ready!</strong>
                  <p className="text-sm mt-1">Payment options are available on every invoice. Customers can pay via Stripe payment links.</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <p>✓ Credit/Debit Cards</p>
                    <p>✓ Debit & ACH (0.8% fee)</p>
                    <p>✓ Cash App (2.9% + $0.30)</p>
                  </div>
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* QuickBooks Integration - NEW! */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <Calculator className="w-6 h-6 text-green-700" />
                <div>
                  <CardTitle>QuickBooks Online</CardTitle>
                  <p className="text-sm text-gray-500">Sync invoices, payments, and customers with QuickBooks.</p>
                </div>
              </div>
              <Dialog open={showQuickBooksDialog} onOpenChange={setShowQuickBooksDialog}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    {quickbooksConfig?.is_connected ? 'Manage' : 'Connect'}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>QuickBooks Online Setup</DialogTitle>
                    <DialogDescription>
                      Connect your QuickBooks Online account to automatically sync invoices and payments
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <Alert className="bg-blue-50 border-blue-200">
                      <Calculator className="w-4 h-4 text-blue-600" />
                      <AlertDescription>
                        <strong>📚 How to Get QuickBooks Credentials:</strong>
                        <ol className="list-decimal list-inside mt-2 text-sm space-y-1">
                          <li>Go to <a href="https://developer.intuit.com/" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">QuickBooks Developer Portal</a></li>
                          <li>Create an app (or use existing one)</li>
                          <li>Get Client ID & Client Secret from "Keys & credentials"</li>
                          <li>Find your Company ID (Realm ID) - see instructions below</li>
                          <li>Enter all three credentials below</li>
                        </ol>
                      </AlertDescription>
                    </Alert>

                    <Alert className="bg-yellow-50 border-yellow-200">
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                      <AlertDescription>
                        <strong>🔍 How to Find Your Company ID (Realm ID):</strong>
                        <ol className="list-decimal list-inside mt-2 text-sm space-y-1">
                          <li><strong>Easiest Method:</strong> Open QuickBooks Online, click on any page (like Invoices or Dashboard), then look at the URL bar. You'll see <code className="bg-white px-1 rounded">realmId=1234567890</code> - copy those numbers!</li>
                          <li><strong>Alternative:</strong> Use the API Explorer at <a href="https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/companyinfo" target="_blank" rel="noopener noreferrer" className="underline text-yellow-700">developer.intuit.com</a> → Click "Try it now" → Sign in → Your Company ID will show in the URL</li>
                        </ol>
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-4 py-4">
                      <div>
                        <Label htmlFor="qb-client-id">Client ID *</Label>
                        <Input
                          id="qb-client-id"
                          placeholder="Enter QuickBooks Client ID"
                          value={qbClientId}
                          onChange={(e) => setQbClientId(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">From QuickBooks Developer Portal → Keys & credentials</p>
                      </div>
                      
                      <div>
                        <Label htmlFor="qb-client-secret">Client Secret *</Label>
                        <Input
                          id="qb-client-secret"
                          type="password"
                          placeholder="Enter QuickBooks Client Secret"
                          value={qbClientSecret}
                          onChange={(e) => setQbClientSecret(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">From QuickBooks Developer Portal → Keys & credentials</p>
                      </div>
                      
                      <div>
                        <Label htmlFor="qb-realm-id">Company ID (Realm ID) *</Label>
                        <Input
                          id="qb-realm-id"
                          placeholder="e.g., 1516350941597087"
                          value={qbRealmId}
                          onChange={(e) => setQbRealmId(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Look in your QuickBooks URL: <code className="bg-gray-100 px-1 rounded">realmId=1234567890</code>
                        </p>
                      </div>

                      <Alert>
                        <AlertCircle className="w-4 h-4" />
                        <AlertDescription className="text-xs">
                          <strong>What will be synced:</strong>
                          <ul className="list-disc list-inside mt-1 space-y-1">
                            <li>{t.sidebar.invoices} → QuickBooks Invoices</li>
                            <li>{t.sidebar.payments} → QuickBooks Payments</li>
                            <li>{t.sidebar.customers} → QuickBooks Customers</li>
                          </ul>
                        </AlertDescription>
                      </Alert>

                      <div className="flex justify-end gap-3 pt-4 border-t">
                        <Button variant="outline" onClick={() => setShowQuickBooksDialog(false)}>
                          {t.common.cancel}
                        </Button>
                        <Button
                          onClick={() => saveQuickBooksMutation.mutate()}
                          disabled={!qbClientId || !qbClientSecret || !qbRealmId || saveQuickBooksMutation.isPending}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          {saveQuickBooksMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Connect QuickBooks
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {quickbooksConfig?.is_connected ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    <strong>✅ QuickBooks Connected</strong>
                    <p className="text-sm mt-1">{t.common.companyName} ID: {quickbooksConfig.realm_id}</p>
                    <p className="text-sm mt-1">{t.sidebar.invoices} and {t.sidebar.payments} will sync automatically.</p>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="bg-blue-50 border-blue-200">
                  <Calculator className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-900">
                    <strong>Connect QuickBooks Online</strong>
                    <p className="text-sm mt-1">Automatically sync your {t.sidebar.invoices.toLowerCase()}, {t.sidebar.payments.toLowerCase()}, and {t.sidebar.customers.toLowerCase()} with QuickBooks Online.</p>
                    <ul className="list-disc list-inside mt-2 text-sm space-y-1">
                      <li>Two-way invoice sync</li>
                      <li>Automatic payment recording</li>
                      <li>Customer data sync</li>
                      <li>Real-time financial reports</li>
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
            
          {/* Google Calendar Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                Google Calendar Integration (Admin Only)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-yellow-50 border-yellow-200">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <AlertDescription>
                  <strong>Admin Tool:</strong> Disconnect Google Calendar for any user in your organization
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <Label>Disconnect User Calendar</Label>
                <div className="flex gap-2">
                  <Input 
                    placeholder="Enter user email (e.g., virgil@example.com)" 
                    className="flex-1"
                    value={disconnectEmail}
                    onChange={(e) => setDisconnectEmail(e.target.value)}
                  />
                  <Button
                    onClick={async () => {
                      if (!disconnectEmail) {
                        alert('Please enter a user email');
                        return;
                      }
                      if (!confirm(`Disconnect Google Calendar for ${disconnectEmail}?`)) return;
                      
                      try {
                        await base44.functions.invoke('adminDisconnectUserCalendar', { 
                          targetUserEmail: disconnectEmail 
                        });
                        alert(`Google Calendar disconnected for ${disconnectEmail}`);
                        setDisconnectEmail('');
                      } catch (error) {
                        alert(`Error: ${error.message}`);
                      }
                    }}
                    variant="destructive"
                  >
                    Disconnect
                  </Button>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <Label className="font-semibold mb-2 block">Your Personal Calendar</Label>
                <p className="text-sm text-gray-600 mb-4">
                  Connect your Google Calendar to automatically sync all CRM events with your Google Calendar. 
                  Two-way sync keeps everything up to date.
                </p>

                {googleCalendarConnected ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                      <div className="flex-1">
                        <p className="font-semibold text-green-900">Connected to Google Calendar</p>
                        <p className="text-sm text-green-700">Your events are syncing automatically</p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <Button
                        onClick={handleSyncNow}
                        disabled={syncingCalendar}
                        variant="outline"
                      >
                        {syncingCalendar ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Syncing...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2" />
                            Sync Now
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={handleDisconnectGoogleCalendar}
                        variant="outline"
                        className="text-red-600 hover:text-red-700"
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Alert className="bg-blue-50 border-blue-200">
                      <LinkIcon className="w-4 h-4 text-blue-600" />
                      <AlertDescription className="text-blue-900">
                        <strong>Not Connected.</strong> Click below to connect your Google Calendar for automatic two-way sync.
                      </AlertDescription>
                    </Alert>

                    <Button
                      onClick={handleConnectGoogleCalendar}
                      disabled={syncingCalendar}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Calendar className="w-4 h-4 mr-2" />
                      Connect Google Calendar
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Financing / Hearth Integration */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <DollarSign className="w-6 h-6 text-green-600" />
                <div>
                  <CardTitle>Financing Integration</CardTitle>
                  <p className="text-sm text-gray-500">Offer homeowners monthly payment options on estimates via Hearth or another lender.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {myCompany?.settings?.financing?.enabled && myCompany?.settings?.financing?.hearth_partner_id ? (
                  <Badge className="bg-green-100 text-green-700">Connected</Badge>
                ) : (
                  <Badge className="bg-gray-100 text-gray-600">Not Configured</Badge>
                )}
                <Dialog open={showFinancingDialog} onOpenChange={setShowFinancingDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline" data-testid="button-financing-manage">Manage</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Financing Integration Setup</DialogTitle>
                      <DialogDescription>
                        Configure financing options offered to customers on estimates.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5 py-2">
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <p className="font-medium text-gray-900">Enable Financing</p>
                          <p className="text-sm text-gray-500">Show financing options on estimates when toggled on</p>
                        </div>
                        <Switch
                          checked={financingEnabled}
                          onCheckedChange={setFinancingEnabled}
                          data-testid="switch-financing-enabled"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Financing Provider</Label>
                        <UiSelect value={financingProvider} onValueChange={setFinancingProvider}>
                          <UiSelectTrigger data-testid="select-financing-provider">
                            <UiSelectValue />
                          </UiSelectTrigger>
                          <UiSelectContent>
                            <UiSelectItem value="hearth">Hearth (Recommended)</UiSelectItem>
                            <UiSelectItem value="greensky">GreenSky</UiSelectItem>
                            <UiSelectItem value="wisetack">Wisetack</UiSelectItem>
                            <UiSelectItem value="custom">Custom URL</UiSelectItem>
                          </UiSelectContent>
                        </UiSelect>
                      </div>

                      {financingProvider === 'hearth' && (
                        <div className="space-y-2">
                          <Label>Hearth Partner ID</Label>
                          <Input
                            placeholder="e.g. yicn-roofing"
                            value={hearthPartnerId}
                            onChange={e => setHearthPartnerId(e.target.value)}
                            data-testid="input-hearth-partner-id"
                          />
                          <p className="text-xs text-gray-500">
                            Find your Partner ID in your{' '}
                            <a href="https://app.gethearth.com" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">Hearth dashboard</a>.
                            Don't have an account?{' '}
                            <a href="https://www.gethearth.com/" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">Sign up free</a>.
                          </p>
                        </div>
                      )}

                      {financingProvider === 'custom' && (
                        <div className="space-y-2">
                          <Label>Custom Financing URL</Label>
                          <Input
                            placeholder="https://your-lender.com/apply?amount={amount}"
                            value={financingCustomUrl}
                            onChange={e => setFinancingCustomUrl(e.target.value)}
                            data-testid="input-financing-custom-url"
                          />
                          <p className="text-xs text-gray-500">Use <code>{"{amount}"}</code> as a placeholder for the estimate total.</p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label>APR Range (shown to customers)</Label>
                        <Input
                          placeholder="6.99% – 24.99%"
                          value={financingAprRange}
                          onChange={e => setFinancingAprRange(e.target.value)}
                          data-testid="input-financing-apr"
                        />
                        <p className="text-xs text-gray-500">Displayed as informational only. Actual rates determined at underwriting.</p>
                      </div>

                      <div className="space-y-2">
                        <Label>Loan Terms to Offer</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {[12, 24, 36, 60, 84, 120].map(term => (
                            <label key={term} className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-gray-50">
                              <Checkbox
                                checked={financingTerms.includes(term)}
                                onCheckedChange={checked => {
                                  setFinancingTerms(prev =>
                                    checked ? [...prev, term].sort((a, b) => a - b) : prev.filter(t => t !== term)
                                  );
                                }}
                              />
                              <span className="text-sm font-medium">{term} mo</span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end gap-3 pt-2 border-t">
                        <Button variant="outline" onClick={() => setShowFinancingDialog(false)}>Cancel</Button>
                        <Button
                          onClick={() => saveFinancingMutation.mutate()}
                          disabled={saveFinancingMutation.isPending}
                          data-testid="button-save-financing"
                        >
                          {saveFinancingMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                          Save Settings
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {myCompany?.settings?.financing?.enabled ? (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    Financing is <strong>active</strong>. Provider: <strong>{myCompany.settings.financing.provider || 'Hearth'}</strong>.
                    Use the "Offer Financing" toggle inside each estimate to show options to customers.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Financing is not enabled. Click <strong>Manage</strong> to configure your provider and enable this feature.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-gray-600" />
                {t.settings.integrations}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-12 text-center text-gray-500">
              <Mail className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold mb-2">{t.settings.integrations}</h3>
              <p>Email settings coming soon</p>
            </CardContent>
          </Card>

        </TabsContent>

        <TabsContent value="automations" className="space-y-6">
          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-purple-600" />
                Automated Background Jobs (Cron Setup)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <Alert className="bg-blue-50 border-blue-200">
                <AlertCircle className="w-4 h-4 text-blue-600" />
                <AlertDescription>
                  <strong>🔥 IMPORTANT:</strong> These background jobs need to run automatically for reminders and workflows to work!
                  <br />
                  <strong>Set them up once using a free service like <a href="https://cron-job.org" target="_blank" rel="noopener noreferrer" className="underline font-semibold">cron-job.org</a></strong>
                </AlertDescription>
              </Alert>

              {/* Show current app URL */}
              {typeof window !== 'undefined' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-green-900 mb-2">✅ Your App URL:</p>
                  <code className="block bg-white p-3 rounded text-sm font-mono border border-green-300">
                    {window.location.origin}
                  </code>
                  <p className="text-xs text-green-700 mt-2">
                    👆 This is your unique app URL. Use it in the cron job URLs below.
                  </p>
                </div>
              )}
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  ⏰ Job #1: Reminder Notifications
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>What it does:</strong> Checks every minute for upcoming calendar events and sends email/SMS reminders
                  <br />
                  <strong>Without this:</strong> Reminders created by you or Lexi will NOT send notifications
                </p>
                <div className="bg-white border border-gray-300 rounded p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1">🔗 URL to Call:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-100 p-2 rounded text-xs break-all font-mono">
                        {typeof window !== 'undefined' ? `${window.location.origin}/api/functions/checkReminders` : 'https://getcompanysync.com/api/functions/checkReminders'}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const url = typeof window !== 'undefined' ? `${window.location.origin}/api/functions/checkReminders` : 'https://getcompanysync.com/api/functions/checkReminders';
                          navigator.clipboard.writeText(url);
                          alert('✅ ' + t.settings.saved);
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-1">⏱️ Schedule (Cron Expression):</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-100 p-2 rounded text-xs font-mono">
                        * * * * *
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          navigator.clipboard.writeText('* * * * *');
                          alert('✅ ' + t.settings.saved);
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">(Every 1 minute)</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  🔄 Job #2: Workflow Queue Processor
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  <strong>What it does:</strong> Processes delayed workflow actions (e.g., "send email 1 day after estimate created")
                  <br />
                  <strong>Without this:</strong> Automated workflows with delays won't run
                </p>
                 <div className="bg-white border border-gray-300 rounded p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-1">🔗 URL to Call:</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-gray-100 p-2 rounded text-xs break-all font-mono">
                          {typeof window !== 'undefined' ? `${window.location.origin}/api/functions/processWorkflowQueue` : 'https://getcompanysync.com/api/functions/processWorkflowQueue'}
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                          const url = typeof window !== 'undefined' ? `${window.location.origin}/api/functions/processWorkflowQueue` : 'https://getcompanysync.com/api/functions/processWorkflowQueue';
                          navigator.clipboard.writeText(url);
                          alert('✅ ' + t.settings.saved);
                        }}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-1">⏱️ Schedule (Cron Expression):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-gray-100 p-2 rounded text-xs font-mono">
                          */5 * * * *
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                          navigator.clipboard.writeText('*/5 * * * *');
                          alert('✅ ' + t.settings.saved);
                        }}
                        >
                          Copy
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">(Every 5 minutes)</p>
                    </div>
                  </div>
              </div>

              {/* Step-by-step instructions */}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  📝 How to Set Up (5 minutes)
                </h3>
                <ol className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-purple-600">1.</span>
                    <div>
                      <strong>Go to <a href="https://cron-job.org" target="_blank" rel="noopener noreferrer" className="underline text-purple-700">cron-job.org</a></strong> and create a free account
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-purple-600">2.</span>
                    <div>
                      <strong>Create First Cron Job:</strong>
                      <ul className="list-disc list-inside ml-4 mt-1 text-xs text-gray-700">
                        <li>Click "Create cronjob"</li>
                        <li>Title: "AI CRM - Check Reminders"</li>
                        <li>URL: Copy the URL from Job #1 above</li>
                        <li>Schedule: <code>* * * * *</code> (every minute)</li>
                        <li>Click "Create cronjob"</li>
                      </ul>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-purple-600">3.</span>
                    <div>
                      <strong>Create Second Cron Job:</strong>
                      <ul className="list-disc list-inside ml-4 mt-1 text-xs text-gray-700">
                        <li>Click "Create cronjob" again</li>
                        <li>Title: "AI CRM - Process Workflows"</li>
                        <li>URL: Copy the URL from Job #2 above</li>
                        <li>Schedule: <code>*/5 * * * *</code> (every 5 minutes)</li>
                        <li>Click "Create cronjob"</li>
                      </ul>
                    </div>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-bold text-purple-600">4.</span>
                    <div>
                      <strong>Done! 🎉</strong> Your notifications will now work automatically
                    </div>
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                {t.sidebar.notifications}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">
                Get notified when important events happen in your CRM
              </p>

              <Button 
                onClick={async () => {
                  if (!myCompany?.id) {
                    alert('Error: Company ID not found. Please ensure your company profile is set up.');
                    return;
                  }
                  try {
                    const response = await base44.functions.invoke('setupDefaultWorkflows', { companyId: myCompany.id });
                    console.log('Setup workflows response:', response);
                    
                    if (response.data?.success) {
                      alert(`✅ Email notifications enabled! Created ${response.data.workflows?.length || 0} workflows.\n\nYou will now receive emails for:\n• New leads\n• Estimates created/accepted\n• Payments received\n• New customers\n• And more!`);
                      queryClient.invalidateQueries({ queryKey: ['workflows'] });
                    } else {
                      alert('⚠️ Setup completed with issues. Check console for details.');
                      console.error('Setup response:', response);
                    }
                  } catch (error) {
                    console.error('Setup error:', error);
                    alert('Error: ' + error.message);
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={!myCompany?.id}
              >
                <Bell className="w-4 h-4 mr-2" />
                Enable Email Notifications
              </Button>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
                <p className="font-semibold text-blue-900 mb-2">📧 You'll receive emails for:</p>
                <ul className="space-y-1 text-blue-800">
                  <li>• New leads created</li>
                  <li>• Estimates created and accepted</li>
                  <li>• Invoices created and paid</li>
                  <li>• New customers added</li>
                  <li>• Tasks assigned to you</li>
                  <li>• Appointments and reminders</li>
                  <li>• Payments received</li>
                  <li>• Projects started</li>
                </ul>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Bell className="w-4 h-4" />
                  Test Notifications
                </h4>
                <p className="text-sm text-gray-600 mb-3">
                  Send a test email to verify notifications are working
                </p>
                <Button 
                  variant="outline"
                  onClick={async () => {
                    try {
                      console.log('🧪 Sending test email to:', user?.email);
                      
                      const response = await base44.functions.invoke('sendEmailFromCRM', {
                        to: user?.email,
                        subject: '✅ Test Notification - AI CRM Pro',
                        message: `
Great news! Your email notifications are configured correctly.

**User:** ${user?.full_name}
**Email:** ${user?.email}
**Company:** ${myCompany?.company_name || 'Your Company'}
**Time:** ${new Date().toLocaleString()}

You will now receive notifications for all important events in your CRM!
                        `,
                        contactName: user?.full_name,
                        companyId: myCompany?.id
                      });
                      
                      console.log('Test email response:', response);
                      
                      if (response.data?.success) {
                        alert('✅ Test email sent successfully via Resend!\n\nCheck your inbox at: ' + user?.email + '\n\nIf you don\'t see it in a few minutes, check your spam folder.');
                      } else {
                        alert('⚠️ Email sent but status unclear. Check: ' + user?.email);
                      }
                    } catch (error) {
                      console.error('Test email error:', error);
                      alert('❌ Failed to send test email: ' + error.message);
                    }
                  }}
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Send Test Email
                </Button>
              </div>

              <Button 
                variant="outline"
                onClick={() => window.location.href = '/workflows'}
              >
                Customize Notifications
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="space-y-4">
          <CommunicationDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}