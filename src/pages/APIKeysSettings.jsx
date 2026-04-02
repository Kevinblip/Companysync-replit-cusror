import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  KeyRound,
  Sparkles,
  Mail,
  Phone,
  ExternalLink,
  Loader2,
  Eye,
  EyeOff,
  RefreshCw,
  Info,
  Zap,
  Star,
} from "lucide-react";

export default function APIKeysSettings() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => setUser(u)).catch(() => {});
  }, []);

  const userEmail = user?.email;

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_at"),
    initialData: [],
    enabled: !!userEmail,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-apikeys', userEmail],
    queryFn: () => userEmail ? base44.entities.StaffProfile.filter({ user_email: userEmail }) : [],
    enabled: !!userEmail,
    initialData: [],
  });

  const myCompany = useMemo(() => {
    if (!user) return null;
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) return companies.find(c => c.id === impersonatedId) || null;
    const lastUsedId = localStorage.getItem('last_used_company_id');
    if (lastUsedId) {
      const found = companies.find(c => c.id === lastUsedId);
      if (found) return found;
    }
    const owned = companies.filter(c => c.created_by === user.email);
    if (owned.length > 0) return owned[0];
    if (staffProfiles.length > 0 && staffProfiles[0]?.company_id) {
      return companies.find(c => c.id === staffProfiles[0].company_id) || null;
    }
    return null;
  }, [user, companies, staffProfiles]);

  const companyId = myCompany?.id;
  const subscriptionPlan = myCompany?.subscription_plan || 'trial';
  const isTrial = subscriptionPlan === 'trial';

  const { data: apiKeysData, isLoading: isLoadingKeys, refetch: refetchKeys } = useQuery({
    queryKey: ['company-api-keys', companyId],
    queryFn: async () => {
      const resp = await fetch(`/api/local/company-api-keys/${companyId}`);
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: !!companyId,
  });

  const { data: dailyAIUsage, refetch: refetchDailyUsage } = useQuery({
    queryKey: ['daily-ai-usage', companyId],
    queryFn: async () => {
      const resp = await fetch(`/api/local/daily-ai-usage/${companyId}`);
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: !!companyId && isTrial,
    refetchInterval: 60000,
  });

  const [geminiKey, setGeminiKey] = useState('');
  const [geminiSaved, setGeminiSaved] = useState(false);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState(null);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [emailAddress, setEmailAddress] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpEncryption, setSmtpEncryption] = useState('TLS');
  const [useResend, setUseResend] = useState(false);
  const [resendKey, setResendKey] = useState('');
  const [emailDetecting, setEmailDetecting] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState(null);
  const [emailSaving, setEmailSaving] = useState(false);
  const [showEmailPassword, setShowEmailPassword] = useState(false);
  const [showResendKey, setShowResendKey] = useState(false);

  const [twilioSid, setTwilioSid] = useState('');
  const [twilioToken, setTwilioToken] = useState('');
  const [twilioPhone, setTwilioPhone] = useState('');
  const [twilioTesting, setTwilioTesting] = useState(false);
  const [twilioTestResult, setTwilioTestResult] = useState(null);
  const [twilioSaving, setTwilioSaving] = useState(false);
  const [showTwilioToken, setShowTwilioToken] = useState(false);

  useEffect(() => {
    if (apiKeysData) {
      if (apiKeysData.gemini?.masked) {
        setGeminiKey(apiKeysData.gemini.masked);
        setGeminiSaved(true);
      }
      if (apiKeysData.email) {
        if (apiKeysData.email.email_address) setEmailAddress(apiKeysData.email.email_address);
        if (apiKeysData.email.smtp_host) setSmtpHost(apiKeysData.email.smtp_host);
        if (apiKeysData.email.smtp_port) setSmtpPort(String(apiKeysData.email.smtp_port));
        if (apiKeysData.email.smtp_encryption) setSmtpEncryption(apiKeysData.email.smtp_encryption);
        if (apiKeysData.email.use_resend) setUseResend(true);
        if (apiKeysData.email.resend_masked) setResendKey(apiKeysData.email.resend_masked);
      }
      if (apiKeysData.twilio) {
        if (apiKeysData.twilio.account_sid_masked) setTwilioSid(apiKeysData.twilio.account_sid_masked);
        if (apiKeysData.twilio.phone_number) setTwilioPhone(apiKeysData.twilio.phone_number);
      }
    }
  }, [apiKeysData]);

  const handleDetectSMTP = async () => {
    if (!emailAddress) return;
    setEmailDetecting(true);
    try {
      const resp = await fetch('/api/local/detect-smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailAddress }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.host) setSmtpHost(data.host);
        if (data.port) setSmtpPort(String(data.port));
        if (data.encryption) setSmtpEncryption(data.encryption);
      }
    } catch (err) {
      console.error('SMTP detection failed:', err);
    } finally {
      setEmailDetecting(false);
    }
  };

  const handleSaveGemini = async () => {
    if (!companyId || !geminiKey || geminiSaved) return;
    setGeminiSaving(true);
    try {
      const resp = await fetch('/api/local/company-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, service: 'gemini', gemini_api_key: geminiKey }),
      });
      if (resp.ok) {
        setGeminiSaved(true);
        setGeminiTestResult(null);
        refetchKeys();
      }
    } catch (err) {
      console.error('Save Gemini key failed:', err);
    } finally {
      setGeminiSaving(false);
    }
  };

  const handleTestGemini = async () => {
    if (!geminiKey) return;
    setGeminiTesting(true);
    setGeminiTestResult(null);
    try {
      const resp = await fetch('/api/local/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          service: 'gemini',
          keys: { api_key: geminiSaved ? undefined : geminiKey },
        }),
      });
      const data = await resp.json();
      setGeminiTestResult(data.success ? 'success' : 'error');
    } catch {
      setGeminiTestResult('error');
    } finally {
      setGeminiTesting(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!companyId) return;
    setEmailSaving(true);
    try {
      const payload = { company_id: companyId, service: 'email', use_resend: useResend };
      if (useResend) {
        payload.resend_api_key = resendKey;
      } else {
        payload.email_address = emailAddress;
        payload.email_password = emailPassword;
        payload.smtp_host = smtpHost;
        payload.smtp_port = parseInt(smtpPort, 10) || 587;
        payload.smtp_encryption = smtpEncryption;
      }
      const resp = await fetch('/api/local/company-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        setEmailTestResult(null);
        refetchKeys();
      }
    } catch (err) {
      console.error('Save email config failed:', err);
    } finally {
      setEmailSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setEmailTesting(true);
    setEmailTestResult(null);
    try {
      const payload = { company_id: companyId, service: useResend ? 'resend' : 'smtp' };
      if (!useResend) {
        payload.smtp_host = smtpHost;
        payload.smtp_port = parseInt(smtpPort, 10) || 587;
        payload.smtp_encryption = smtpEncryption;
        payload.email_address = emailAddress;
        payload.email_password = emailPassword;
      } else {
        payload.api_key = resendKey;
      }
      const resp = await fetch('/api/local/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      setEmailTestResult(data.success ? 'success' : 'error');
    } catch {
      setEmailTestResult('error');
    } finally {
      setEmailTesting(false);
    }
  };

  const handleSaveTwilio = async () => {
    if (!companyId) return;
    setTwilioSaving(true);
    try {
      const resp = await fetch('/api/local/company-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          service: 'twilio',
          twilio_account_sid: twilioSid,
          twilio_auth_token: twilioToken,
          twilio_phone_number: twilioPhone,
        }),
      });
      if (resp.ok) {
        setTwilioTestResult(null);
        refetchKeys();
      }
    } catch (err) {
      console.error('Save Twilio config failed:', err);
    } finally {
      setTwilioSaving(false);
    }
  };

  const handleTestTwilio = async () => {
    setTwilioTesting(true);
    setTwilioTestResult(null);
    try {
      const resp = await fetch('/api/local/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          service: 'twilio',
          keys: { account_sid: twilioSid, auth_token: twilioToken },
        }),
      });
      const data = await resp.json();
      setTwilioTestResult(data.success ? 'success' : 'error');
    } catch {
      setTwilioTestResult('error');
    } finally {
      setTwilioTesting(false);
    }
  };

  const aiConnected = apiKeysData?.gemini?.connected || false;
  const emailConnected = apiKeysData?.email?.connected || false;
  const voiceConnected = apiKeysData?.twilio?.connected || false;

  const usingOwnGeminiKey = aiConnected;
  const usingOwnEmail = emailConnected;
  const usingOwnVoice = voiceConnected;

  if (isLoadingKeys && companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6" data-testid="page-api-keys-settings">

      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <KeyRound className="w-7 h-7 text-blue-500 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">API Keys & Connections</h1>
            <p className="text-sm text-muted-foreground">Advanced settings — your plan already includes AI with no setup needed.</p>
          </div>
        </div>
        {companyId && (
          <div className="shrink-0 text-right border rounded-md px-3 py-2 bg-muted/40" data-testid="card-company-id">
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Your Company ID</p>
            <p className="text-sm font-mono font-semibold text-foreground" data-testid="text-company-id">{companyId}</p>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 p-4 flex gap-3" data-testid="alert-plan-includes-ai">
        <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-800 dark:text-blue-200">
          <span className="font-semibold">Your plan already includes AI interactions.</span>{" "}
          Lexi, Sarah, and all AI features work out of the box — no API keys required. This page is for advanced users who want to connect their own Google Gemini, Twilio, or email accounts. A small platform fee still applies even with your own keys.
        </div>
      </div>

      <Card data-testid="card-status-summary">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Connection Status</CardTitle>
          <Button variant="ghost" size="icon" onClick={() => refetchKeys()} data-testid="button-refresh-status">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <ConnectionStatusBadge
              label="AI (Gemini)"
              mode={usingOwnGeminiKey ? 'connected' : 'managed'}
              testId="status-ai"
            />
            <ConnectionStatusBadge
              label="Voice & SMS"
              mode={usingOwnVoice ? 'connected' : 'plan-default'}
              testId="status-voice"
            />
            <ConnectionStatusBadge
              label="Email"
              mode={usingOwnEmail ? 'connected' : 'plan-default'}
              testId="status-email"
            />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-gemini-section">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            <CardTitle className="text-base">AI — Google Gemini</CardTitle>
            <p className="text-xs text-muted-foreground ml-1">Powers the reasoning and logic for Lexi, Sarah, and the AI Estimator</p>
            {!usingOwnGeminiKey && (
              <Badge variant="outline" className="ml-auto text-purple-600 border-purple-300 text-xs" data-testid="badge-companysync-managed">
                CompanySync managed
              </Badge>
            )}
            {usingOwnGeminiKey && (
              <Badge variant="outline" className="ml-auto text-green-600 border-green-300 text-xs" data-testid="badge-own-key-active">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Your key active
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div
              className={`rounded-lg border p-4 space-y-4 transition-colors ${
                usingOwnGeminiKey
                  ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-border bg-background'
              }`}
              data-testid="panel-own-key"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold text-sm">Use My Own API Key</span>
                </div>
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">
                  Save on platform fees
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Enter your Google Gemini API key. You pay Google directly at their published rates.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                A small platform fee applies even with your own key.
              </p>

              <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground text-xs">How to get your key (3 steps):</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>
                    Click{" "}
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 underline inline-flex items-center gap-0.5"
                      data-testid="link-gemini-console"
                    >
                      Get your key <ExternalLink className="w-3 h-3" />
                    </a>
                  </li>
                  <li>Create a new API Key (or select existing)</li>
                  <li>Copy and paste it below</li>
                </ol>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gemini-key" className="text-xs">API Key</Label>
                <div className="relative">
                  <Input
                    id="gemini-key"
                    type={showGeminiKey ? 'text' : 'password'}
                    placeholder="AIza..."
                    value={geminiKey}
                    onChange={(e) => {
                      setGeminiKey(e.target.value);
                      setGeminiSaved(false);
                      setGeminiTestResult(null);
                    }}
                    data-testid="input-gemini-key"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setShowGeminiKey(!showGeminiKey)}
                    type="button"
                    data-testid="button-toggle-gemini-visibility"
                  >
                    {showGeminiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleTestGemini}
                  variant="outline"
                  size="sm"
                  disabled={geminiTesting || !geminiKey}
                  data-testid="button-test-gemini"
                >
                  {geminiTesting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Test Connection
                </Button>
                <Button
                  onClick={handleSaveGemini}
                  size="sm"
                  disabled={geminiSaving || !geminiKey || geminiSaved}
                  data-testid="button-save-gemini"
                >
                  {geminiSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Save Key
                </Button>
                {geminiTestResult === 'success' && (
                  <Badge variant="outline" className="text-green-600 border-green-300 text-xs" data-testid="badge-gemini-test-success">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                )}
                {geminiTestResult === 'error' && (
                  <Badge variant="outline" className="text-red-600 border-red-300 text-xs" data-testid="badge-gemini-test-error">
                    <XCircle className="w-3 h-3 mr-1" /> Failed
                  </Badge>
                )}
              </div>
            </div>

            <div
              className={`rounded-lg border-2 p-4 space-y-3 transition-colors ${
                !usingOwnGeminiKey
                  ? 'border-purple-400 bg-purple-50/50 dark:bg-purple-950/20'
                  : 'border-border bg-muted/30'
              }`}
              data-testid="panel-companysync-service"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-purple-500" />
                  <span className="font-semibold text-sm">Use CompanySync's AI Service</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className="text-xs bg-purple-600 hover:bg-purple-600" data-testid="badge-recommended">
                    Recommended
                  </Badge>
                  {!usingOwnGeminiKey && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-400" data-testid="badge-no-setup">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> No setup required
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                We provide the AI infrastructure. Billed per use through your subscription.
              </p>

              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-foreground">CompanySync rates:</p>
                <div className="space-y-1" data-testid="table-pricing">
                  {[
                    { label: 'AI Estimator', price: '$0.08/run' },
                    { label: 'AI SMS assistant', price: '$0.02/msg' },
                    { label: 'CrewCam analysis', price: '$0.12/photo' },
                  ].map(({ label, price }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium text-foreground">{price}</span>
                    </div>
                  ))}
                </div>
              </div>

              {isTrial && dailyAIUsage && (
                <div className="pt-2 border-t space-y-2" data-testid="section-trial-usage-inline">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Zap className={`w-3.5 h-3.5 ${
                        dailyAIUsage.used >= dailyAIUsage.limit ? 'text-red-500' :
                        dailyAIUsage.used >= Math.floor(dailyAIUsage.limit * 0.75) ? 'text-orange-500' :
                        'text-blue-500'
                      }`} />
                      <span className="text-xs font-medium" data-testid="text-ai-usage-label">Free AI calls today</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`text-xs font-mono font-semibold ${
                        dailyAIUsage.used >= dailyAIUsage.limit ? 'text-red-600' :
                        dailyAIUsage.used >= Math.floor(dailyAIUsage.limit * 0.75) ? 'text-orange-600' :
                        'text-blue-600'
                      }`} data-testid="badge-ai-usage-count">
                        {dailyAIUsage.used} / {dailyAIUsage.limit}
                      </span>
                      <button onClick={() => refetchDailyUsage()} className="text-muted-foreground hover:text-foreground" data-testid="button-refresh-ai-usage">
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <Progress
                    value={Math.min(100, (dailyAIUsage.used / dailyAIUsage.limit) * 100)}
                    className="h-1.5"
                    data-testid="progress-ai-usage"
                  />
                  <p className={`text-xs ${dailyAIUsage.used >= dailyAIUsage.limit ? 'text-red-600' : 'text-muted-foreground'}`} data-testid="text-ai-usage-remaining">
                    {dailyAIUsage.used >= dailyAIUsage.limit
                      ? '⛔ Limit reached — resets at midnight. Connect your own key to restore access now.'
                      : `${dailyAIUsage.remaining} calls remaining today — resets at midnight`}
                  </p>
                </div>
              )}

              {!usingOwnGeminiKey && (
                <div className="pt-1">
                  <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 font-medium" data-testid="text-currently-active">
                    <CheckCircle2 className="w-4 h-4" />
                    Currently active — no action needed
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-email-section">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-500" />
            <CardTitle className="text-base">Email</CardTitle>
            <p className="text-xs text-muted-foreground ml-1">Outbound emails, estimates, invoices &amp; campaigns</p>
            {emailConnected
              ? <Badge variant="outline" className="ml-auto text-green-600 border-green-300 text-xs">Your setup active</Badge>
              : <Badge variant="outline" className="ml-auto text-green-600 border-green-300 text-xs">CompanySync managed</Badge>
            }
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Left: Use My Own Email */}
            <div
              className={`rounded-lg border p-4 space-y-4 transition-colors ${
                emailConnected
                  ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-border bg-background'
              }`}
              data-testid="panel-own-email"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold text-sm">Use My Own Email Account</span>
                </div>
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">More control</Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Emails come from your own address — personal and on-brand. Choose Standard SMTP (Gmail/Outlook) for small crews or Resend for high-volume sending.
              </p>

              {/* SMTP / Resend toggle */}
              <div className="flex items-center gap-2 border rounded-md p-1 bg-muted/30 w-fit">
                <button
                  onClick={() => setUseResend(false)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${!useResend ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="tab-smtp"
                >
                  SMTP
                </button>
                <button
                  onClick={() => setUseResend(true)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors ${useResend ? 'bg-background shadow-sm font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  data-testid="tab-resend"
                >
                  Resend API
                </button>
              </div>

              {!useResend ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="email-address" className="text-xs">Business Email Address</Label>
                    <div className="flex gap-2">
                      <Input
                        id="email-address"
                        type="email"
                        placeholder="you@yourcompany.com"
                        value={emailAddress}
                        onChange={(e) => setEmailAddress(e.target.value)}
                        data-testid="input-email-address"
                      />
                      <Button variant="outline" size="sm" onClick={handleDetectSMTP} disabled={emailDetecting || !emailAddress} data-testid="button-detect-smtp">
                        {emailDetecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                        Auto-Detect
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-host" className="text-xs">SMTP Host</Label>
                      <Input id="smtp-host" placeholder="smtp.gmail.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} data-testid="input-smtp-host" className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-port" className="text-xs">Port</Label>
                      <Input id="smtp-port" placeholder="587" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} data-testid="input-smtp-port" className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="smtp-encryption" className="text-xs">Encryption</Label>
                      <Input id="smtp-encryption" placeholder="TLS" value={smtpEncryption} onChange={(e) => setSmtpEncryption(e.target.value)} data-testid="input-smtp-encryption" className="text-xs" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="email-password" className="text-xs">App Password</Label>
                    <div className="relative">
                      <Input id="email-password" type={showEmailPassword ? 'text' : 'password'} placeholder="Enter your app password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} data-testid="input-email-password" />
                      <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setShowEmailPassword(!showEmailPassword)} type="button" data-testid="button-toggle-email-password-visibility">
                        {showEmailPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">High-volume sending. Won't get flagged as spam. Free tier: 3,000 emails/month.</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="resend-key" className="text-xs">Resend API Key</Label>
                    <div className="relative">
                      <Input id="resend-key" type={showResendKey ? 'text' : 'password'} placeholder="re_..." value={resendKey} onChange={(e) => setResendKey(e.target.value)} data-testid="input-resend-key" />
                      <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setShowResendKey(!showResendKey)} type="button" data-testid="button-toggle-resend-visibility">
                        {showResendKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                    <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline inline-flex items-center gap-1 text-xs" data-testid="link-resend-console">
                      Get your Resend API key <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleTestEmail} disabled={emailTesting} data-testid="button-test-email">
                  {emailTesting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Test
                </Button>
                <Button size="sm" onClick={handleSaveEmail} disabled={emailSaving} data-testid="button-save-email">
                  {emailSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Save Email Config
                </Button>
                {emailTestResult === 'success' && (
                  <Badge variant="outline" className="text-green-600 border-green-300 text-xs" data-testid="badge-email-test-success">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                )}
                {emailTestResult === 'error' && (
                  <Badge variant="outline" className="text-red-600 border-red-300 text-xs" data-testid="badge-email-test-error">
                    <XCircle className="w-3 h-3 mr-1" /> Failed
                  </Badge>
                )}
              </div>
            </div>

            {/* Right: CompanySync Managed Email */}
            <div
              className={`rounded-lg border-2 p-4 space-y-3 transition-colors ${
                !emailConnected
                  ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-border bg-muted/30'
              }`}
              data-testid="panel-managed-email"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-sm">Use CompanySync's Email Service</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className="text-xs bg-blue-600 hover:bg-blue-600" data-testid="badge-email-recommended">Recommended</Badge>
                  {!emailConnected && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-400" data-testid="badge-email-no-setup">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> No setup required
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                We handle email delivery through CompanySync's infrastructure. Works out of the box — no SMTP settings or API keys needed.
              </p>

              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Instant setup — ready immediately</span></div>
                <div className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Managed deliverability &amp; bounce handling</span></div>
                <div className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Estimates, invoices, and alerts just work</span></div>
              </div>

              <div className="space-y-1 pt-1 border-t">
                <p className="text-xs font-semibold text-foreground">Included in your plan:</p>
                {[
                  { label: 'Transactional emails (invoices, estimates)', price: 'Included' },
                  { label: 'Automated follow-up emails', price: 'Included' },
                  { label: 'Marketing campaigns', price: '$0.001/email' },
                ].map(({ label, price }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-mono font-medium ${price === 'Included' ? 'text-green-600' : 'text-foreground'}`}>{price}</span>
                  </div>
                ))}
              </div>

              {!emailConnected && (
                <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 font-medium pt-1" data-testid="text-email-currently-active">
                  <CheckCircle2 className="w-4 h-4" />
                  Currently active — no action needed
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-twilio-section">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-green-500" />
            <CardTitle className="text-base">Voice &amp; SMS — Twilio</CardTitle>
            <p className="text-xs text-muted-foreground ml-1">Infrastructure for Sarah's voice calls, automated SMS, and team outbound dialing</p>
            {voiceConnected
              ? <Badge variant="outline" className="ml-auto text-green-600 border-green-300 text-xs">Your account active</Badge>
              : <Badge variant="outline" className="ml-auto text-green-600 border-green-300 text-xs">CompanySync managed</Badge>
            }
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div
              className={`rounded-lg border p-4 space-y-4 transition-colors ${
                voiceConnected
                  ? 'border-blue-400 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-border bg-background'
              }`}
              data-testid="panel-byo-twilio"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-500" />
                  <span className="font-semibold text-sm">Use My Own Twilio Account</span>
                </div>
                <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">Own your number</Badge>
              </div>

              <p className="text-xs text-muted-foreground">
                Enter your own Account SID, Auth Token, and phone number. You own the number and reputation — if you ever leave CompanySync, you take them with you.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                A small platform connection fee still applies.
              </p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="twilio-sid" className="text-xs">Account SID</Label>
                  <Input id="twilio-sid" placeholder="AC..." value={twilioSid} onChange={(e) => setTwilioSid(e.target.value)} data-testid="input-twilio-sid" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="twilio-token" className="text-xs">Auth Token</Label>
                  <div className="relative">
                    <Input
                      id="twilio-token"
                      type={showTwilioToken ? 'text' : 'password'}
                      placeholder="Enter your Twilio Auth Token"
                      value={twilioToken}
                      onChange={(e) => setTwilioToken(e.target.value)}
                      data-testid="input-twilio-token"
                    />
                    <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setShowTwilioToken(!showTwilioToken)} type="button" data-testid="button-toggle-twilio-token-visibility">
                      {showTwilioToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="twilio-phone" className="text-xs">Phone Number</Label>
                  <Input id="twilio-phone" placeholder="+1234567890" value={twilioPhone} onChange={(e) => setTwilioPhone(e.target.value)} data-testid="input-twilio-phone" />
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleTestTwilio} disabled={twilioTesting || !twilioSid || !twilioToken} data-testid="button-test-twilio">
                  {twilioTesting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Test Connection
                </Button>
                <Button size="sm" onClick={handleSaveTwilio} disabled={twilioSaving || !twilioSid || !twilioToken} data-testid="button-save-twilio">
                  {twilioSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                  Save Twilio Config
                </Button>
                {twilioTestResult === 'success' && (
                  <Badge variant="outline" className="text-green-600 border-green-300 text-xs" data-testid="badge-twilio-test-success">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
                  </Badge>
                )}
                {twilioTestResult === 'error' && (
                  <Badge variant="outline" className="text-red-600 border-red-300 text-xs" data-testid="badge-twilio-test-error">
                    <XCircle className="w-3 h-3 mr-1" /> Failed
                  </Badge>
                )}
              </div>

              <a href="https://www.twilio.com/console" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline inline-flex items-center gap-1 text-xs" data-testid="link-twilio-console">
                Go to Twilio Console <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div
              className={`rounded-lg border-2 p-4 space-y-3 transition-colors ${
                !voiceConnected
                  ? 'border-green-400 bg-green-50/50 dark:bg-green-950/20'
                  : 'border-border bg-muted/30'
              }`}
              data-testid="panel-managed-twilio"
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-green-600" />
                  <span className="font-semibold text-sm">Use CompanySync's Voice &amp; SMS</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge className="text-xs bg-green-600 hover:bg-green-600" data-testid="badge-twilio-recommended">Recommended</Badge>
                  {!voiceConnected && (
                    <Badge variant="outline" className="text-xs text-green-600 border-green-400" data-testid="badge-twilio-no-setup">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> No setup required
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                We handle A2P 10DLC registration, number provisioning, and carrier compliance. You don't need to buy numbers or deal with Twilio directly.
              </p>

              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>No A2P 10DLC registration headaches</span></div>
                <div className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>Shared number pool — ready in minutes</span></div>
                <div className="flex items-start gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" /><span>CompanySync handles all carrier compliance</span></div>
              </div>

              <div className="space-y-1.5 pt-1 border-t">
                <p className="text-xs font-semibold text-foreground">CompanySync rates:</p>
                <div className="space-y-1">
                  {[
                    { label: 'Sarah AI Voice Calls', price: '$0.10/min' },
                    { label: 'Outbound Dialing', price: '$0.05/min' },
                    { label: 'Standard SMS', price: '$0.02/msg' },
                  ].map(({ label, price }) => (
                    <div key={label} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono font-medium text-foreground">{price}</span>
                    </div>
                  ))}
                </div>
              </div>

              {!voiceConnected && (
                <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 font-medium pt-1" data-testid="text-twilio-currently-active">
                  <CheckCircle2 className="w-4 h-4" />
                  Currently active — no action needed
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectionStatusBadge({ label, mode, testId }) {
  const config = {
    connected: {
      icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
      badgeClass: 'text-green-600 border-green-300',
      text: 'Connected',
    },
    managed: {
      icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
      badgeClass: 'text-green-600 border-green-300',
      text: 'Managed',
    },
    'plan-default': {
      icon: <CheckCircle2 className="w-4 h-4 text-green-500" />,
      badgeClass: 'text-green-600 border-green-300',
      text: 'Plan default',
    },
  };

  const { icon, badgeClass, text } = config[mode] || config['plan-default'];

  return (
    <div className="flex items-center gap-2" data-testid={testId}>
      {icon}
      <span className="text-sm">{label}</span>
      <Badge variant="outline" className={badgeClass}>
        {text}
      </Badge>
    </div>
  );
}
