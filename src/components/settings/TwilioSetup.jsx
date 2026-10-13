import { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Phone, MessageSquare, CheckCircle2, AlertCircle, Loader2, Plus, Trash2, Wifi, WifiOff, Shield, Monitor, Sparkles } from "lucide-react";
import { validateE164Phone, formatToE164, looksLikeFormattableUSPhone } from "@/utils";
import { prepareTwilioSettingsSave } from "@/utils/twilioSettingsSave";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function TwilioSetup({ focusToggle = null } = {}) {
  const transcriptionRowRef = useRef(null);
  const aiSummaryRowRef = useRef(null);
  const smsSummaryRowRef = useRef(null);
  const [highlightedToggle, setHighlightedToggle] = useState(null);

  useEffect(() => {
    if (!focusToggle) return;
    const refMap = {
      transcription: transcriptionRowRef,
      ai_summary: aiSummaryRowRef,
      sms_summary: smsSummaryRowRef,
    };
    const target = refMap[focusToggle]?.current;
    if (!target) return;
    const timer = setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedToggle(focusToggle);
      setTimeout(() => setHighlightedToggle(null), 2500);
    }, 250);
    return () => clearTimeout(timer);
  }, [focusToggle]);

  const highlightClass = (key) =>
    highlightedToggle === key
      ? 'ring-2 ring-purple-400 ring-offset-2 rounded-md transition-shadow'
      : '';

  const [user, setUser] = useState(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [mainPhoneNumber, setMainPhoneNumber] = useState("");
  const [enableSMS, setEnableSMS] = useState(true);
  const [enableCalling, setEnableCalling] = useState(true);
  const [enableRecording, setEnableRecording] = useState(true);
  const [enableTranscription, setEnableTranscription] = useState(true);
  const [enableAiSummary, setEnableAiSummary] = useState(true);
  const [enableSmsAutoSummary, setEnableSmsAutoSummary] = useState(true);
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [mainPhoneError, setMainPhoneError] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | 'error'
  const [saveError, setSaveError] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [provisionResult, setProvisionResult] = useState(null);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [apiKeySid, setApiKeySid] = useState("");
  const [apiKeySecret, setApiKeySecret] = useState("");
  const [twimlAppSid, setTwimlAppSid] = useState("");

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies', user?.email],
    queryFn: () => base44.entities.Company.list("-created_date"),
    enabled: !!user,
  });

  const { data: myMemberships = [] } = useQuery({
    queryKey: ['twilio-setup-membership', user?.email],
    queryFn: () => user?.email
      ? base44.entities.StaffProfile.filter({ user_email: user.email })
      : [],
    enabled: !!user?.email,
  });

  const activeMembership = myMemberships.find(profile => profile?.is_active !== false && profile?.company_id);
  const myCompany = companies.find(company => company.id === activeMembership?.company_id) || null;

  const { data: twilioSettings } = useQuery({
    queryKey: ['twilio-settings', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return null;
      const settings = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
      return settings[0] || null;
    },
    enabled: !!myCompany,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      return await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
    },
    enabled: !!myCompany,
  });

  const myStaffProfile = staffProfiles.find(s => s.user_email === user?.email);

  useEffect(() => {
    if (twilioSettings) {
      setAccountSid(twilioSettings.account_sid || "");
      setAuthToken(twilioSettings.auth_token || "");
      setMainPhoneNumber(twilioSettings.main_phone_number || "");
      setEnableSMS(twilioSettings.enable_sms !== false);
      setEnableCalling(twilioSettings.enable_calling !== false);
      setEnableRecording(twilioSettings.enable_recording !== false);
      setEnableTranscription(twilioSettings.enable_transcription !== false);
      setEnableAiSummary(twilioSettings.enable_ai_summary !== false);
      setEnableSmsAutoSummary(twilioSettings.enable_sms_auto_summary !== false);
      setAvailableNumbers(twilioSettings.available_numbers || []);
      setApiKeySid(twilioSettings.api_key_sid || "");
      setApiKeySecret(twilioSettings.api_key_secret || "");
      setTwimlAppSid(twilioSettings.twiml_app_sid || "");
    }
  }, [twilioSettings]);

  const validStaffProfiles = useMemo(() => {
    return staffProfiles.filter(staff =>
      staff.user_email &&
      typeof staff.user_email === 'string' &&
      staff.user_email.trim().length > 0
    );
  }, [staffProfiles]);

  const formatPhoneNumber = (num) => {
    if (!num) return '';
    let formatted = num.replace(/\D/g, '');
    if (formatted.length === 10) {
      formatted = '+1' + formatted;
    } else if (!formatted.startsWith('+')) {
      formatted = '+' + formatted;
    }
    return formatted;
  };

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (twilioSettings) {
        return await base44.entities.TwilioSettings.update(twilioSettings.id, data.twilioData);
      } else {
        return await base44.entities.TwilioSettings.create({
          ...data.twilioData,
          company_id: myCompany.id
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
    },
    onError: (error) => {
      setSaveStatus('error');
      setSaveError(error.message);
    }
  });

  const handleSave = async () => {
    if (!accountSid || !authToken) {
      setValidationError("Please enter your Account SID and Auth Token.");
      return;
    }
    if (!mainPhoneNumber) {
      setValidationError("Please enter your main phone number.");
      return;
    }
    setValidationError(null);

    const phoneErr = validateE164Phone(mainPhoneNumber);
    if (phoneErr) {
      setMainPhoneError(phoneErr);
      return;
    }
    setMainPhoneError(null);

    let formattedMain = mainPhoneNumber.replace(/\D/g, '');
    if (formattedMain.length === 10) {
      formattedMain = '+1' + formattedMain;
    } else if (!formattedMain.startsWith('+')) {
      formattedMain = '+' + formattedMain;
    }

    const twilioData = {
      account_sid: accountSid.trim(),
      auth_token: authToken.trim(),
      main_phone_number: formattedMain,
      enable_sms: enableSMS,
      enable_calling: enableCalling,
      enable_recording: enableRecording,
      enable_transcription: enableTranscription,
      enable_ai_summary: enableAiSummary,
      enable_sms_auto_summary: enableSmsAutoSummary,
      available_numbers: availableNumbers.map(n => ({
        ...n,
        phone_number: n.phone_number.startsWith('+') ? n.phone_number : '+1' + n.phone_number.replace(/\D/g, '')
      })),
      ...(apiKeySid && { api_key_sid: apiKeySid }),
      ...(apiKeySecret && { api_key_secret: apiKeySecret }),
      ...(twimlAppSid && { twiml_app_sid: twimlAppSid }),
    };
    const savePlan = prepareTwilioSettingsSave(twilioSettings, twilioData);

    try {
      setSaveStatus(null);
      setSaveError(null);
      setValidationError(null);

      if (savePlan.mode === 'connection') {
        const validationResponse = await fetch('/api/twilio/update-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            validate_only: true,
            phone_number: formattedMain,
            company_id: myCompany.id,
            company_name: myCompany.name || myCompany.brand_short_name || '',
            rep_name: myStaffProfile?.full_name || user?.name || '',
            rep_email: user?.email || '',
            cell_phone: myStaffProfile?.phone || '',
            routing_mode: myStaffProfile?.call_routing_mode || 'sarah_answers',
            twilio_sid: accountSid.trim(),
            twilio_token: authToken.trim(),
            availability_status: myStaffProfile?.availability_status || 'available',
          })
        });
        const validation = await validationResponse.json();
        if (!validationResponse.ok) throw new Error(validation.error || 'Twilio settings are not authorized for this company');
      }

      await saveMutation.mutateAsync({ twilioData: savePlan.data });

      if (savePlan.mode === 'connection') {
        const cacheResponse = await fetch('/api/twilio/update-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_number: formattedMain,
            company_id: myCompany.id,
            company_name: myCompany.company_name || myCompany.brand_short_name || '',
            rep_name: myStaffProfile?.full_name || user?.name || '',
            rep_email: user?.email || '',
            cell_phone: myStaffProfile?.phone || '',
            routing_mode: myStaffProfile?.call_routing_mode || 'sarah_answers',
            twilio_sid: accountSid.trim(),
            twilio_token: authToken.trim(),
            availability_status: myStaffProfile?.availability_status || 'available',
          })
        });
        if (!cacheResponse.ok) {
          const result = await cacheResponse.json();
          throw new Error(result.error || 'Twilio routing cache could not be updated');
        }
      }
      setSaveStatus('saved');
      setSaveError(null);
      setTimeout(() => setSaveStatus(null), 4000);
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e.message);
    }
  };

  const handleAutoProvision = async () => {
    if (!accountSid || !authToken || !mainPhoneNumber) {
      setValidationError("Please fill in your Account SID, Auth Token, and Phone Number first.");
      return;
    }

    const phoneErr = validateE164Phone(mainPhoneNumber);
    if (phoneErr) {
      setMainPhoneError(phoneErr);
      return;
    }
    setMainPhoneError(null);

    setIsProvisioning(true);
    setProvisionResult(null);

    let formattedPhone = mainPhoneNumber.replace(/\D/g, '');
    if (formattedPhone.length === 10) formattedPhone = '+1' + formattedPhone;
    else if (!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;

    try {
      let data;
      const isBase44Host = false;

      if (isBase44Host) {
        const response = await base44.functions.invoke('sarahBridgeAPI', {
          action: 'autoProvisionTwilio',
          companyId: myCompany?.id || '',
          data: {
            account_sid: accountSid.trim(),
            auth_token: authToken.trim(),
            phone_number: formattedPhone,
            production_server_url: window.__PRODUCTION_SERVER_URL || 'https://companysync.replit.app',
          }
        });
        data = response.data || response;
      } else {
        const resp = await fetch('/api/twilio/auto-provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_sid: accountSid.trim(),
            auth_token: authToken.trim(),
            phone_number: formattedPhone,
            company_id: myCompany?.id || '',
            company_name: myCompany?.name || myCompany?.brand_short_name || '',
            rep_name: myStaffProfile?.full_name || user?.name || '',
            rep_email: user?.email || '',
            cell_phone: myStaffProfile?.phone || '',
            routing_mode: myStaffProfile?.call_routing_mode || 'sarah_answers',
          })
        });
        data = await resp.json();
      }

      if (data.success) {
        const newApiKeySid = data.api_key_sid || apiKeySid;
        const newApiKeySecret = data.api_key_secret || apiKeySecret;
        const newTwimlAppSid = data.twiml_app_sid || twimlAppSid;
        if (data.api_key_sid) setApiKeySid(data.api_key_sid);
        if (data.api_key_secret) setApiKeySecret(data.api_key_secret);
        if (data.twiml_app_sid) setTwimlAppSid(data.twiml_app_sid);
        setProvisionResult({ success: true, message: data.message, details: data, webrtcReady: data.webrtc_ready });

        // Save immediately with the just-returned credentials (bypasses stale state closure)
        let formattedMain = mainPhoneNumber.replace(/\D/g, '');
        if (formattedMain.length === 10) formattedMain = '+1' + formattedMain;
        else if (!formattedMain.startsWith('+')) formattedMain = '+' + formattedMain;

        const twilioData = {
          account_sid: accountSid.trim(),
          auth_token: authToken.trim(),
          main_phone_number: formattedMain,
          enable_sms: enableSMS,
          enable_calling: enableCalling,
          enable_recording: enableRecording,
          enable_transcription: enableTranscription,
          enable_ai_summary: enableAiSummary,
          enable_sms_auto_summary: enableSmsAutoSummary,
          available_numbers: availableNumbers,
          ...(newApiKeySid && { api_key_sid: newApiKeySid }),
          ...(newApiKeySecret && { api_key_secret: newApiKeySecret }),
          ...(newTwimlAppSid && { twiml_app_sid: newTwimlAppSid }),
        };

        if (twilioSettings) {
          await base44.entities.TwilioSettings.update(twilioSettings.id, twilioData);
        } else {
          await base44.entities.TwilioSettings.create({ ...twilioData, company_id: myCompany.id });
        }
        queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
      } else {
        setProvisionResult({ success: false, message: data.error || 'Auto-configuration failed' });
      }
    } catch (err) {
      setProvisionResult({ success: false, message: 'Connection failed: ' + err.message });
    } finally {
      setIsProvisioning(false);
    }
  };

  const addPhoneNumber = () => {
    setAvailableNumbers([...availableNumbers, { phone_number: "", assigned_to: "unassigned", label: "" }]);
  };

  const removePhoneNumber = (index) => {
    setAvailableNumbers(availableNumbers.filter((_, i) => i !== index));
  };

  const updatePhoneNumber = (index, field, value) => {
    const updated = [...availableNumbers];
    updated[index] = { ...updated[index], [field]: value };
    setAvailableNumbers(updated);
  };

  const testConnection = async () => {
    if (!accountSid || !authToken) {
      setValidationError("Please enter your Account SID and Auth Token first.");
      return;
    }
    setTestResult({ testing: true });
    try {
      const response = await base44.functions.invoke('testTwilioCredentials', {
        accountSid: accountSid.trim(),
        authToken: authToken.trim()
      });
      if (response.data.success) {
        setTestResult({ success: true, message: response.data.message });
      } else {
        setTestResult({ success: false, message: response.data.message || "Invalid credentials." });
      }
    } catch (error) {
      setTestResult({ success: false, message: "Connection failed: " + error.message });
    }
  };

  if (!myCompany) {
    return (
      <div className="p-6 space-y-4">
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            No company profile found. Please complete company setup first.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const isConnected = !!(twilioSettings?.account_sid && twilioSettings?.main_phone_number);

  return (
    <div className="space-y-6 max-h-[calc(90vh-100px)] overflow-y-auto p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-twilio-title">Twilio Integration Setup</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your Twilio account so Alex can answer and make calls on your behalf
          </p>
        </div>
        {isConnected && (
          <Badge variant="outline" className="border-green-300 text-green-700 gap-1" data-testid="badge-connected">
            <Wifi className="w-3 h-3" /> Connected
          </Badge>
        )}
        {!isConnected && (
          <Badge variant="outline" className="border-muted text-muted-foreground gap-1" data-testid="badge-disconnected">
            <WifiOff className="w-3 h-3" /> Not Connected
          </Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-sm">
              1
            </div>
            Your Twilio Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Shield className="w-4 h-4" />
            <AlertDescription>
              You pay Twilio directly for your own usage. Get your credentials from{" "}
              <a href="https://console.twilio.com/" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                Twilio Console
              </a>. Your credentials are stored securely and only used to configure webhooks.
            </AlertDescription>
          </Alert>

          <div>
            <Label htmlFor="account-sid">Account SID</Label>
            <Input
              id="account-sid"
              data-testid="input-account-sid"
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="auth-token">Auth Token</Label>
            <Input
              id="auth-token"
              data-testid="input-auth-token"
              type="password"
              placeholder="Your Twilio Auth Token"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          </div>

          <Button onClick={testConnection} variant="outline" className="w-full" data-testid="button-test-connection">
            {testResult?.testing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing Connection...</>
            ) : (
              "Test Connection"
            )}
          </Button>

          {testResult && !testResult.testing && (
            <Alert className={testResult.success ? "border-green-300" : "border-red-300"}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600" />
              )}
              <AlertDescription>{testResult.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-sm">
              2
            </div>
            Phone Numbers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Phone className="w-4 h-4" />
            <AlertDescription>
              You need a phone number from Twilio.{" "}
              <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noopener noreferrer" className="underline font-medium">
                Buy a Number
              </a>{" "}
              if you don't have one yet.
            </AlertDescription>
          </Alert>

          <div>
            <Label htmlFor="main-phone">Main Phone Number (for Alex)</Label>
            <div className="flex gap-2">
              <Input
                id="main-phone"
                data-testid="input-main-phone"
                placeholder="+15551234567"
                value={mainPhoneNumber}
                onChange={(e) => {
                  const val = e.target.value;
                  setMainPhoneNumber(val);
                  setMainPhoneError(validateE164Phone(val));
                }}
                className={`flex-1 ${mainPhoneError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              />
              {looksLikeFormattableUSPhone(mainPhoneNumber) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="button-format-main-phone"
                  onClick={() => {
                    const formatted = formatToE164(mainPhoneNumber);
                    if (formatted) {
                      setMainPhoneNumber(formatted);
                      setMainPhoneError(validateE164Phone(formatted));
                    }
                  }}
                >
                  Format
                </Button>
              )}
            </div>
            {mainPhoneError ? (
              <p data-testid="error-main-phone" className="text-xs text-red-600 mt-1">{mainPhoneError}</p>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">
                Use E.164 format (e.g. +15551234567). This is the number Alex will answer.
              </p>
            )}
          </div>

          <Alert className="bg-green-50 dark:bg-green-950 border-green-200">
            <Monitor className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 dark:text-green-100 text-sm">
              <strong>Browser Dialer:</strong> Outbound calls use your computer microphone directly — no cell phone needed. After clicking "Connect Alex to This Number", the browser dialer is automatically configured.
            </AlertDescription>
          </Alert>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <Label>Additional Numbers (Optional)</Label>
              <Button onClick={addPhoneNumber} size="sm" variant="outline" data-testid="button-add-number">
                <Plus className="w-4 h-4 mr-1" />
                Add Number
              </Button>
            </div>

            {availableNumbers.map((number, index) => {
              const assignedValue = number.assigned_to && typeof number.assigned_to === 'string' && number.assigned_to.trim() !== ''
                ? number.assigned_to
                : 'unassigned';

              return (
                <div key={index} className="grid grid-cols-12 gap-2 mb-3 p-3 bg-muted/50 rounded-md">
                  <div className="col-span-4">
                    <Input
                      placeholder="+1 (555) 123-4567"
                      value={number.phone_number || ""}
                      onChange={(e) => updatePhoneNumber(index, 'phone_number', e.target.value)}
                      data-testid={`input-extra-number-${index}`}
                    />
                  </div>
                  <div className="col-span-3">
                    <Select
                      value={assignedValue}
                      onValueChange={(value) => updatePhoneNumber(index, 'assigned_to', value === "unassigned" ? "" : value)}
                    >
                      <SelectTrigger data-testid={`select-assign-${index}`}>
                        <SelectValue placeholder="Assign to..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {validStaffProfiles.map((staff) => (
                          <SelectItem key={staff.id || staff.user_email} value={staff.user_email}>
                            {staff.full_name || staff.user_email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Input
                      placeholder="Label (e.g., Sales Line)"
                      value={number.label || ""}
                      onChange={(e) => updatePhoneNumber(index, 'label', e.target.value)}
                      data-testid={`input-label-${index}`}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button variant="ghost" size="icon" onClick={() => removePhoneNumber(index)} data-testid={`button-remove-number-${index}`}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {availableNumbers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No additional numbers added
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center text-orange-600 dark:text-orange-300 font-bold text-sm">
              3
            </div>
            Connect Alex & Browser Dialer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-orange-50 dark:bg-orange-950 border-orange-200">
            <Sparkles className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-orange-900 dark:text-orange-100">
              Click the button below to automatically configure your Twilio number. This will set up Alex's AI voice and the <strong>Browser Dialer</strong> for your agents.
            </AlertDescription>
          </Alert>

          <Button
            onClick={handleAutoProvision}
            disabled={isProvisioning || !accountSid || !authToken || !mainPhoneNumber}
            className="w-full"
            data-testid="button-auto-provision"
          >
            {isProvisioning ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Configuring Your Number...</>
            ) : isConnected || (twimlAppSid && apiKeySid) ? (
              <><Wifi className="w-4 h-4 mr-2" /> Re-Configure Webhooks & Dialer</>
            ) : (
              <><Wifi className="w-4 h-4 mr-2" /> Connect Alex to This Number</>
            )}
          </Button>

          {provisionResult && (
            <Alert className={provisionResult.success ? "border-green-300" : "border-red-300"}>
              {provisionResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600" />
              )}
              <AlertDescription>{provisionResult.message}</AlertDescription>
            </Alert>
          )}

          {provisionResult?.success && provisionResult.details && (
            <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/50 rounded-md">
              <p>Voice webhook: {provisionResult.details.voice_webhook}</p>
              <p>SMS webhook: {provisionResult.details.sms_webhook}</p>
              {provisionResult.details.twiml_app_sid && (
                <p className="text-green-700 dark:text-green-400">
                  ✓ Browser Dialer configured (TwiML App: {provisionResult.details.twiml_app_sid})
                </p>
              )}
              {provisionResult.details.api_key_sid && (
                <p className="text-green-700 dark:text-green-400">
                  ✓ API Key created: {provisionResult.details.api_key_sid}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 dark:text-green-300 font-bold text-sm">
              4
            </div>
            Browser Dialer Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Monitor className={`w-5 h-5 ${twimlAppSid ? 'text-green-600' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">TwiML App</p>
                <p className="text-xs text-muted-foreground">{twimlAppSid || 'Not configured — run "Connect Alex" to set up'}</p>
              </div>
            </div>
            {twimlAppSid ? (
              <Badge variant="outline" className="border-green-300 text-green-700 gap-1 shrink-0"><CheckCircle2 className="w-3 h-3" /> Ready</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground shrink-0">Not set</Badge>
            )}
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Shield className={`w-5 h-5 ${apiKeySid ? 'text-green-600' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">API Key</p>
                <p className="text-xs text-muted-foreground">{apiKeySid || 'Not configured — run "Connect Alex" to set up'}</p>
              </div>
            </div>
            {apiKeySid ? (
              <Badge variant="outline" className="border-green-300 text-green-700 gap-1 shrink-0"><CheckCircle2 className="w-3 h-3" /> Ready</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground shrink-0">Not set</Badge>
            )}
          </div>
          {twimlAppSid && apiKeySid && (
            <Alert className="bg-green-50 dark:bg-green-950 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900 dark:text-green-100 text-sm">
                Browser dialer is active. Agents can call directly from their computer — no cell phone required. Calls are dual-channel recorded and automatically transcribed.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-sm">
              5
            </div>
            Features
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-600" />
              <div>
                <Label>Enable SMS</Label>
                <p className="text-xs text-muted-foreground">Send and receive text messages</p>
              </div>
            </div>
            <Switch checked={enableSMS} onCheckedChange={setEnableSMS} data-testid="switch-sms" />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-green-600" />
              <div>
                <Label>Enable Calling</Label>
                <p className="text-xs text-muted-foreground">Make and receive phone calls</p>
              </div>
            </div>
            <Switch checked={enableCalling} onCheckedChange={setEnableCalling} data-testid="switch-calling" />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-blue-600" />
              <div>
                <Label>Enable Call Recording</Label>
                <p className="text-xs text-muted-foreground">Automatically record all calls</p>
              </div>
            </div>
            <Switch checked={enableRecording} onCheckedChange={setEnableRecording} data-testid="switch-recording" />
          </div>

          <div ref={transcriptionRowRef} className={`flex items-center justify-between flex-wrap gap-2 p-2 ${highlightClass('transcription')}`}>
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-purple-600" />
              <div>
                <Label>Auto-Transcribe Calls</Label>
                <p className="text-xs text-muted-foreground">Run OpenAI Whisper on every recording</p>
              </div>
            </div>
            <Switch checked={enableTranscription} onCheckedChange={setEnableTranscription} data-testid="switch-transcription" />
          </div>

          <div ref={aiSummaryRowRef} className={`flex items-center justify-between flex-wrap gap-2 p-2 ${highlightClass('ai_summary')}`}>
            <div className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-purple-600" />
              <div>
                <Label>Auto-Summarize with Alex</Label>
                <p className="text-xs text-muted-foreground">Generate Alex's synopsis after every transcript</p>
              </div>
            </div>
            <Switch checked={enableAiSummary} onCheckedChange={setEnableAiSummary} data-testid="switch-ai-summary" />
          </div>

          <div ref={smsSummaryRowRef} className={`flex items-center justify-between flex-wrap gap-2 p-2 ${highlightClass('sms_summary')}`}>
            <div className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-600" />
              <div>
                <Label>Auto-Summarize SMS Threads</Label>
                <p className="text-xs text-muted-foreground">Allow Alex to summarize entire SMS conversations</p>
              </div>
            </div>
            <Switch checked={enableSmsAutoSummary} onCheckedChange={setEnableSmsAutoSummary} data-testid="switch-sms-auto-summary" />
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 bg-background pt-4 border-t space-y-2">
        {validationError && (
          <Alert className="border-red-300">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <AlertDescription className="text-red-700 ml-2">{validationError}</AlertDescription>
          </Alert>
        )}
        {saveStatus === 'error' && saveError && (
          <Alert className="border-red-300">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <AlertDescription className="text-red-700 ml-2">Failed to save: {saveError}</AlertDescription>
          </Alert>
        )}
        {saveStatus === 'saved' && (
          <Alert className="border-green-300 bg-green-50">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 ml-2">Settings saved successfully!</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            data-testid="button-save-settings"
            className={saveStatus === 'saved' ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {saveMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
            ) : saveStatus === 'saved' ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Saved!</>
            ) : (
              "Save Settings"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
