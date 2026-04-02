import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Calendar, CheckCircle2, RefreshCw, LinkIcon, XCircle, Clock, Edit, Save, X, Globe, User, Plus, Trash2, GripVertical, AlertTriangle, Bell, Lock, Eye, EyeOff } from "lucide-react";
import { format } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// List of common timezones
const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' },
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
];

export default function GeneralSettings() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState({
    full_name: '',
    email: '',
    phone: ''
  });
  const [newSourceName, setNewSourceName] = useState('');
  const [diagnosis, setDiagnosis] = useState(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const queryClient = useQueryClient();

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [isSavingPw, setIsSavingPw] = useState(false);
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });

  const [googleAuthError, setGoogleAuthError] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setAccountForm({
        full_name: u?.full_name || u?.name || '',
        email: u?.email || '',
        phone: u?.phone || ''
      });
    }).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('google_error');
    if (googleError) {
      setGoogleAuthError(decodeURIComponent(googleError));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const userEmail = user?.email;

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_at"),
    initialData: [],
    enabled: !!userEmail,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-settings', userEmail],
    queryFn: () => userEmail ? base44.entities.StaffProfile.filter({ user_email: userEmail }) : [],
    enabled: !!userEmail,
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;

    // Priority 1: Impersonation
    const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
    if (impersonatedId) {
      const target = companies.find(c => c.id === impersonatedId);
      if (target) return target;
    }

    // Priority 2: Staff profile company
    const staffProfile = staffProfiles[0];
    if (staffProfile?.company_id) {
      const profileCompany = companies.find(c => c.id === staffProfile.company_id);
      if (profileCompany) return profileCompany;
    }
    
    // Priority 3: Owned company
    const ownedCompany = companies.find(c => c.created_by === user.email);
    if (ownedCompany) return ownedCompany;
    
    return null;
  }, [user, companies, staffProfiles]);

  useEffect(() => {
    if (staffProfiles.length > 0) {
      const sp = staffProfiles[0];
      const displayName = sp.full_name || sp.name || '';
      const displayPhone = sp.phone || '';
      const displayEmail = sp.email || sp.user_email || '';
      setAccountForm(prev => ({
        ...prev,
        full_name: displayName || prev.full_name,
        phone: displayPhone || prev.phone,
        email: displayEmail || prev.email
      }));
    }
  }, [staffProfiles]);

  const { data: leadSources = [] } = useQuery({
    queryKey: ['lead-sources', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.LeadSource.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: notificationPrefs = [] } = useQuery({
    queryKey: ['notification-prefs', user?.email],
    queryFn: () => user ? base44.entities.NotificationPreference.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  const myPrefs = notificationPrefs[0] || {
    notify_on_lead_created: true,
    notify_on_lead_created_by_others_only: false,
    notify_on_customer_created: true,
    notify_on_customer_created_by_others_only: false,
    notify_on_estimate_created: true,
    notify_on_estimate_accepted: true,
    notify_on_invoice_created: true,
    notify_on_invoice_paid: true,
    notify_on_task_assigned: true,
    notify_on_task_completed: true,
    notify_on_payment_received: true,
    mute_all_notifications: false
  };

  const updatePrefsMutation = useMutation({
    mutationFn: (newPrefs) => {
      if (notificationPrefs[0]) {
        return base44.entities.NotificationPreference.update(notificationPrefs[0].id, newPrefs);
      } else {
        return base44.entities.NotificationPreference.create({
          ...newPrefs,
          company_id: myCompany?.id,
          user_email: user.email
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
    }
  });

  const handleTogglePref = (key) => {
    updatePrefsMutation.mutate({
      [key]: !myPrefs[key]
    });
  };

  const handleSaveAccountAsync = async (data) => {
    try {
      // Use backend function with service role to update StaffProfile (works for all users)
      const result = await base44.functions.invoke('updateMyProfile', {
        full_name: data.full_name,
        phone: data.phone
      });
      
      if (result.data?.error) {
        throw new Error(result.data.error);
      }
      
      // Refresh user data
      const updatedUser = await base44.auth.me();
      setUser(updatedUser);
      
      setAccountForm({
        full_name: data.full_name,
        email: updatedUser.email || '',
        phone: data.phone || updatedUser.phone || ''
      });
      setEditingAccount(false);
      queryClient.invalidateQueries({ queryKey: ['staff-profiles-settings'] });
      alert('✅ Account updated successfully!');
    } catch (error) {
      console.error('Update failed:', error);
      alert('Failed to update account: ' + (error?.response?.data?.message || error?.message || JSON.stringify(error)));
    }
  };

  const updateCompanyMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Company.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['translation-company'] });
      alert('✅ Company settings updated!');
    },
  });

  const [calendarConnected, setCalendarConnected] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  useEffect(() => {
    base44.functions.invoke('checkUserGoogleCalendarConnection', {})
      .then(res => {
        setCalendarConnected(res.data?.connected === true);
        setLastSync(res.data?.last_sync || null);
      })
      .catch(() => setCalendarConnected(false));
  }, []);

  const handleGoogleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('connectUserGoogleCalendar', {});
      if (result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      } else if (result.data?.error) {
        alert('❌ ' + result.data.error);
      }
    } catch (error) {
      alert('Failed to connect: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDiagnoseSync = async () => {
    try {
      setDiagnosing(true);
      const res = await base44.functions.invoke('checkUserGoogleCalendarConnection', {});
      const connected = res.data?.connected === true;
      setCalendarConnected(connected);
      setLastSync(res.data?.last_sync || null);
      if (!connected) {
        setDiagnosis({ issues: ['Google Calendar is not connected. Please click "Connect Google Calendar" to authorize.'], recommendations: ['Click the "Connect Google Calendar" button to link your Google account.'] });
      } else {
        setDiagnosis({ status: 'healthy', last_sync: res.data?.last_sync });
      }
    } catch (error) {
      setDiagnosis({ issues: ['Could not check status: ' + error.message], recommendations: ['Try reconnecting your Google Calendar.'] });
    } finally {
      setDiagnosing(false);
    }
  };

  const handleGoogleSync = async () => {
    setIsConnecting(true);
    try {
      const result = await base44.functions.invoke('syncUserGoogleCalendar', {});
      if (result.data?.needsReconnect || result.data?.error) {
        const msg = result.data?.error || 'Google Calendar is not connected.';
        alert('❌ ' + msg + '\n\nPlease click "Connect Google Calendar" to authorize access.');
        setCalendarConnected(false);
        return;
      }
      const fg = result.data?.fromGoogle || {};
      const tg = result.data?.toGoogle || {};
      alert(`✅ Sync complete!\n\nFrom Google: ${fg.created || 0} created, ${fg.updated || 0} updated, ${fg.deleted || 0} deleted\nTo Google: ${tg.created || 0} created, ${tg.updated || 0} updated`);
      setLastSync(new Date().toISOString());
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    } catch (error) {
      alert('Sync failed: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleGoogleDisconnect = async () => {
    if (!confirm('Disconnect your Google Calendar? Your CRM events will remain.')) return;

    setIsConnecting(true);
    try {
      await base44.functions.invoke('disconnectUserGoogleCalendar', {});
      const updatedUser = await base44.auth.me();
      setUser(updatedUser);
      alert('✅ Disconnected!');
    } catch (error) {
      alert('Failed: ' + error.message);
    } finally {
      setIsConnecting(false);
    }
  };

  const [isSaving, setIsSaving] = useState(false);
  
  const handleSaveAccount = () => {
    if (!accountForm.full_name.trim()) {
      alert('❌ Name is required');
      return;
    }

    setIsSaving(true);
    handleSaveAccountAsync({
      full_name: accountForm.full_name,
      phone: accountForm.phone
    }).finally(() => setIsSaving(false));
  };

  const handleCancelEdit = () => {
    setEditingAccount(false);
    setAccountForm({
      full_name: user?.full_name || '',
      email: user?.email || '',
      phone: user?.phone || ''
    });
  };

  const handleChangePassword = async () => {
    setPwError('');
    setPwSuccess('');
    if (!pwForm.current) { setPwError('Please enter your current password.'); return; }
    if (!pwForm.next || pwForm.next.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match.'); return; }
    setIsSavingPw(true);
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setPwError(data.error || 'Incorrect current password.');
      } else {
        setPwSuccess('Password changed successfully!');
        setPwForm({ current: '', next: '', confirm: '' });
      }
    } catch {
      setPwError('Something went wrong. Please try again.');
    } finally {
      setIsSavingPw(false);
    }
  };

  const handleTimezoneChange = (timezone) => {
    if (!myCompany?.id) {
      alert('❌ Please complete company setup first');
      return;
    }

    updateCompanyMutation.mutate({
      id: myCompany.id,
      data: { timezone: timezone }
    });
  };

  const handleLanguageChange = (lang) => {
    if (!myCompany?.id) {
      alert('❌ Please complete company setup first');
      return;
    }
    try { localStorage.setItem('crewcam_language', lang); } catch {}
    window.dispatchEvent(new StorageEvent('storage', { key: 'crewcam_language', newValue: lang }));
    queryClient.setQueriesData({ queryKey: ['translation-company'] }, (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(c => c.id === myCompany.id ? { ...c, preferred_language: lang } : c);
    });
    queryClient.setQueriesData({ queryKey: ['translation-staff-profile'] }, (old) => {
      if (!Array.isArray(old)) return old;
      return old.map(sp => ({ ...sp, preferred_language: lang }));
    });
    updateCompanyMutation.mutate({
      id: myCompany.id,
      data: { preferred_language: lang }
    });
    const myStaffProfile = staffProfiles[0];
    if (myStaffProfile?.id) {
      queryClient.setQueriesData({ queryKey: ['translation-staff-profile'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(sp => ({ ...sp, preferred_language: null }));
      });
      base44.entities.StaffProfile.update(myStaffProfile.id, { preferred_language: null })
        .then(() => queryClient.invalidateQueries({ queryKey: ['translation-staff-profile'] }))
        .catch(() => {});
    }
  };

  const addLeadSourceMutation = useMutation({
    mutationFn: (sourceName) => base44.entities.LeadSource.create({
      company_id: myCompany.id,
      source_name: sourceName,
      is_active: true,
      display_order: leadSources.length
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-sources'] });
      setNewSourceName('');
      alert('✅ Lead source added!');
    },
    onError: (error) => {
      alert('❌ Failed to add: ' + error.message);
    }
  });

  const deleteLeadSourceMutation = useMutation({
    mutationFn: (id) => base44.entities.LeadSource.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-sources'] });
      alert('✅ Lead source deleted!');
    },
    onError: (error) => {
      alert('❌ Failed to delete: ' + error.message);
    }
  });

  const handleAddLeadSource = () => {
    if (!newSourceName.trim()) {
      alert('❌ Please enter a source name');
      return;
    }
    if (!myCompany?.id) {
      alert('❌ Please complete company setup first');
      return;
    }
    addLeadSourceMutation.mutate(newSourceName.trim());
  };

  const handleDeleteLeadSource = (source) => {
    if (!confirm(`Delete "${source.source_name}"? This cannot be undone.`)) return;
    deleteLeadSourceMutation.mutate(source.id);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.settings.title}</h1>
        <p className="text-gray-500 mt-1">{t.settings.generalSettingsDescription || t.settings.description || "Manage your personal preferences and integrations"}</p>
      </div>

      {/* Google Calendar Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            {t.settings.googleCalendarIntegration || "Google Calendar Integration"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              {calendarConnected === null ? (
                <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
              ) : calendarConnected ? (
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              ) : (
                <XCircle className="w-8 h-8 text-red-500" />
              )}
              <div>
                {calendarConnected === null ? (
                  <p className="font-semibold text-gray-500">{t.common.checking || "Checking connection..."}</p>
                ) : calendarConnected ? (
                  <>
                    <p className="font-semibold text-green-700">{t.common.connected || "Connected"}</p>
                    <p className="text-sm text-gray-500">{t.settings.googleCalendarActive || "Google Calendar sync is active"}</p>
                    {lastSync && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t.common.lastSynced || "Last synced"}: {format(new Date(lastSync), 'MMM d, h:mm a')}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-semibold text-red-600">{t.common.notConnected || "Not Connected"}</p>
                    <p className="text-sm text-gray-500">{t.settings.googleCalendarConnectDescription || "Click \"Connect Google Calendar\" to link your account"}</p>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              {calendarConnected === false && (
                <Button
                  onClick={handleGoogleConnect}
                  disabled={isConnecting}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {isConnecting ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <LinkIcon className="w-4 h-4 mr-2" />}
                  {t.settings.connectGoogleCalendar || "Connect Google Calendar"}
                </Button>
              )}
              {calendarConnected && (
                <>
                  <Button
                    onClick={handleDiagnoseSync}
                    disabled={diagnosing}
                    variant="outline"
                    size="sm"
                  >
                    {diagnosing ? (t.common.checking || 'Checking...') : (t.common.checkStatus || 'Check Status')}
                  </Button>
                  <Button
                    onClick={handleGoogleSync}
                    disabled={isConnecting}
                    variant="outline"
                    size="sm"
                  >
                    {isConnecting ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    {t.common.syncNow || "Sync Now"}
                  </Button>
                </>
              )}
            </div>
          </div>

          {googleAuthError && (
            <Alert className="bg-red-50 border-red-200">
              <XCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <div className="font-semibold mb-1">Google Calendar connection failed</div>
                <p className="text-sm mb-2">{googleAuthError}</p>
                <p className="text-xs text-red-700">To fix this, make sure the following redirect URI is added in your Google Cloud Console under OAuth 2.0 credentials:</p>
                <code className="text-xs bg-red-100 px-2 py-1 rounded block mt-1 break-all">https://getcompanysync.com/api/google-calendar-callback</code>
                <p className="text-xs text-red-700 mt-2">Also verify that the Google Calendar API is enabled in your project.</p>
              </AlertDescription>
            </Alert>
          )}

          {diagnosis && diagnosis.issues && diagnosis.issues.length > 0 && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
              <AlertDescription className="text-yellow-900">
                <div className="font-semibold mb-2">Sync Issues Detected:</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {diagnosis.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
                <div className="font-semibold mt-3 mb-2">Recommendations:</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  {diagnosis.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {diagnosis && diagnosis.status === 'healthy' && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                <div className="font-semibold mb-2">✅ Sync Status: Healthy</div>
                {diagnosis.last_sync && (
                  <p className="text-sm">Last synced: {new Date(diagnosis.last_sync).toLocaleString()}</p>
                )}
                {diagnosis.webhook_expiration && !diagnosis.webhook_expired && (
                  <p className="text-sm">Instant sync expires: {new Date(diagnosis.webhook_expiration).toLocaleString()}</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <AlertDescription>
              <strong>{t.settings.howItWorks || "How it works"}:</strong> {t.settings.googleCalendarHowItWorks || "Once connected, events sync between CRM and Google Calendar. Click \"Setup Instant Sync\" for automatic syncing, or use \"Sync Now\" to manually sync. Each team member connects their own calendar."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Company Timezone Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-purple-600" />
            {t.settings.timezone}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex-1">
              <Label htmlFor="timezone-select" className="font-semibold mb-2 block">{t.settings.defaultTimezone || "Default Timezone"}</Label>
              <p className="text-sm text-gray-500 mb-3">
                {t.settings.timezoneDescription || "Sets the timezone for all calendar events, reminders, and reports"}
              </p>
              <Select 
                value={myCompany?.timezone || 'America/New_York'}
                onValueChange={handleTimezoneChange}
                disabled={!myCompany?.id}
              >
                <SelectTrigger id="timezone-select" className="max-w-sm">
                  <SelectValue placeholder={t.common.select || "Select timezone"} />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!myCompany?.id && (
                <p className="text-xs text-orange-600 mt-2">
                  {t.settings.completeSetupFirst || "Please complete company setup first"}
                </p>
              )}
            </div>
          </div>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900">
              <strong>{t.common.tip || "Tip"}:</strong> {t.settings.timezoneTip || "Setting the correct timezone ensures:"}
              <ul className="list-disc list-inside mt-2 text-sm">
                <li>{t.settings.timezoneTip1 || "Calendar events show at the right time"}</li>
                <li>{t.settings.timezoneTip2 || "Reminders trigger at correct hours"}</li>
                <li>{t.settings.timezoneTip3 || "Daily reports generate at end of business day"}</li>
                <li>{t.settings.timezoneTip4 || "No more midnight notifications for yesterday's events!"}</li>
              </ul>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Platform Language */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-purple-600" />
            {t.settings.language}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex-1">
              <Label htmlFor="language-select" className="font-semibold mb-2 block">{t.settings.preferredLanguage}</Label>
              <p className="text-sm text-gray-500 mb-3">
                {t.settings.languageDescription}
              </p>
              <Select
                value={myCompany?.preferred_language || 'en'}
                onValueChange={handleLanguageChange}
                disabled={!myCompany?.id}
              >
                <SelectTrigger id="language-select" className="max-w-sm" data-testid="select-platform-language">
                  <SelectValue placeholder={t.common.select || "Select language"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t.settings.english}</SelectItem>
                  <SelectItem value="es">{t.settings.spanish}</SelectItem>
                </SelectContent>
              </Select>
              {!myCompany?.id && (
                <p className="text-xs text-orange-600 mt-2">
                  {t.settings.completeSetupFirst || "Please complete company setup first"}
                </p>
              )}
            </div>
          </div>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900">
              <strong>{t.common.note || "Note"}:</strong> {t.settings.languageNote || "This sets the company-wide default. Individual staff members can go to their own profile and choose their preferred language independently — so your bilingual team is fully supported."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Lead Sources Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-green-600" />
            {t.customers.source || "Lead Sources"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-500">
            {t.settings.leadSourcesDescription || "Manage custom lead sources for your organization. These will appear in lead creation dropdowns."}
          </p>

          <div className="flex gap-2">
            <Input
              placeholder={t.settings.enterLeadSourcePlaceholder || t.settings.leadSourcePlaceholder || "Enter new lead source (e.g., Door Knocking, Facebook Ads)"}
              value={newSourceName}
              onChange={(e) => setNewSourceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleAddLeadSource();
                }
              }}
            />
            <Button
              onClick={handleAddLeadSource}
              disabled={!newSourceName.trim() || addLeadSourceMutation.isPending}
              className="bg-green-600 hover:bg-green-700 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t.common.add}
            </Button>
          </div>

          {leadSources.length === 0 ? (
            <Alert>
              <AlertDescription>
                {t.settings.noLeadSources || "No custom lead sources yet. Add your first one above!"}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              {leadSources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-gray-400" />
                    <span className="font-medium">{source.source_name}</span>
                    {!source.is_active && (
                      <Badge variant="secondary">{t.common.inactive}</Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteLeadSource(source)}
                    disabled={deleteLeadSourceMutation.isPending}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900 text-sm">
              <strong>{t.settings.defaultSources || "Default sources"}:</strong> Website, Referral, Social Media, Storm Tracker, Property Importer, and others are always available.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-orange-600" />
            {t.settings.notificationPreferences || "Notification Preferences"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <Label className="text-base font-semibold">{t.settings.muteAllNotifications || "Mute All Notifications"}</Label>
              <p className="text-sm text-gray-500">{t.settings.muteAllDescription || "Temporarily disable all email and push notifications"}</p>
            </div>
            <Switch
              checked={myPrefs.mute_all_notifications}
              onCheckedChange={() => handleTogglePref('mute_all_notifications')}
            />
          </div>

          <div className={`space-y-4 ${myPrefs.mute_all_notifications ? 'opacity-50 pointer-events-none' : ''}`}>
            <div>
              <h3 className="font-semibold mb-3 text-sm text-gray-900 uppercase tracking-wider">{t.settings.leadsAndCustomers || "Leads & Customers"}</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_lead_created" className="font-normal">{t.notifications.leadCreated || "New Lead Created"}</Label>
                  <Switch
                    id="notify_on_lead_created"
                    checked={myPrefs.notify_on_lead_created}
                    onCheckedChange={() => handleTogglePref('notify_on_lead_created')}
                  />
                </div>
                {myPrefs.notify_on_lead_created && (
                  <div className="flex items-center justify-between pl-4 border-l-2 border-gray-200 ml-1">
                    <Label htmlFor="notify_on_lead_created_by_others_only" className="font-normal text-sm text-gray-600">{t.settings.onlyByOthers || "Only when created by others"}</Label>
                    <Switch
                      id="notify_on_lead_created_by_others_only"
                      checked={myPrefs.notify_on_lead_created_by_others_only}
                      onCheckedChange={() => handleTogglePref('notify_on_lead_created_by_others_only')}
                    />
                  </div>
                )}
                
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_customer_created" className="font-normal">{t.notifications.customerCreated || "New Customer Created"}</Label>
                  <Switch
                    id="notify_on_customer_created"
                    checked={myPrefs.notify_on_customer_created}
                    onCheckedChange={() => handleTogglePref('notify_on_customer_created')}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3 text-sm text-gray-900 uppercase tracking-wider">{t.settings.salesAndFinance || "Sales & Finance"}</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_estimate_created" className="font-normal">{t.notifications.estimateCreated || "New Estimate Created"}</Label>
                  <Switch
                    id="notify_on_estimate_created"
                    checked={myPrefs.notify_on_estimate_created}
                    onCheckedChange={() => handleTogglePref('notify_on_estimate_created')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_invoice_created" className="font-normal">{t.notifications.invoiceCreated || "New Invoice Created"}</Label>
                  <Switch
                    id="notify_on_invoice_created"
                    checked={myPrefs.notify_on_invoice_created}
                    onCheckedChange={() => handleTogglePref('notify_on_invoice_created')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_payment_received" className="font-normal">{t.notifications.paymentReceived || "Payment Received"}</Label>
                  <Switch
                    id="notify_on_payment_received"
                    checked={myPrefs.notify_on_payment_received}
                    onCheckedChange={() => handleTogglePref('notify_on_payment_received')}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3 text-sm text-gray-900 uppercase tracking-wider">{t.tasks.title}</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_task_assigned" className="font-normal">{t.settings.taskAssignedToMe || "Task Assigned to Me"}</Label>
                  <Switch
                    id="notify_on_task_assigned"
                    checked={myPrefs.notify_on_task_assigned}
                    onCheckedChange={() => handleTogglePref('notify_on_task_assigned')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify_on_task_completed" className="font-normal">{t.notifications.taskCompleted || "Task Completed"}</Label>
                  <Switch
                    id="notify_on_task_completed"
                    checked={myPrefs.notify_on_task_completed}
                    onCheckedChange={() => handleTogglePref('notify_on_task_completed')}
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Account Section - Editable */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-gray-600" />
              {t.settings.yourAccount || "Your Account"}
            </div>
            {!editingAccount && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingAccount(true)}
              >
                <Edit className="w-4 h-4 mr-2" />
                {t.common.edit}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {editingAccount ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-full-name">{t.common.name} *</Label>
                <Input
                  id="edit-full-name"
                  value={accountForm.full_name}
                  onChange={(e) => setAccountForm({ ...accountForm, full_name: e.target.value })}
                  placeholder={t.settings.namePlaceholder || "John Doe"}
                />
              </div>

              <div>
                <Label htmlFor="edit-email">{t.common.email}</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={accountForm.email}
                  disabled
                  className="bg-gray-100"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.settings.emailCannotBeChanged || "Email cannot be changed"}
                </p>
              </div>

              <div>
                <Label htmlFor="edit-phone">{t.common.phone}</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  value={accountForm.phone}
                  onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t.settings.phoneDescription || "Used for call bridging and notifications"}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  onClick={handleSaveAccount}
                  disabled={isSaving}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      {t.settings.saving}
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      {t.settings.saveChanges}
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                >
                  <X className="w-4 h-4 mr-2" />
                  {t.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <span className="text-sm text-gray-500">{t.common.name}:</span>
                <p className="font-medium">{staffProfiles[0]?.full_name || staffProfiles[0]?.name || user?.full_name || user?.name || (t.common.notSet || 'Not set')}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">{t.common.email}:</span>
                <p className="font-medium">{staffProfiles[0]?.email || staffProfiles[0]?.user_email || user?.email || (t.common.notSet || 'Not set')}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">{t.common.phone}:</span>
                <p className="font-medium">{staffProfiles[0]?.phone || user?.phone || (t.common.notSet || 'Not set')}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">{t.settings.role || "Role"}:</span>
                <Badge>{staffProfiles[0]?.role || user?.role || 'user'}</Badge>
              </div>
              <div className="pt-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setEditingAccount(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  {t.settings.editDetails || "Edit Details"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-gray-600" />
            {t.settings.changePassword || "Change Password"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pwError && (
            <Alert variant="destructive">
              <AlertDescription>{pwError}</AlertDescription>
            </Alert>
          )}
          {pwSuccess && (
            <Alert className="border-green-200 bg-green-50 text-green-800">
              <CheckCircle2 className="w-4 h-4 inline mr-2" />
              <AlertDescription>{pwSuccess}</AlertDescription>
            </Alert>
          )}
          <div>
            <Label htmlFor="pw-current">{t.settings.currentPassword || "Current Password"}</Label>
            <div className="relative">
              <Input
                id="pw-current"
                data-testid="input-current-password"
                type={showPw.current ? 'text' : 'password'}
                value={pwForm.current}
                onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
                placeholder={t.settings.currentPasswordPlaceholder || "Your current password"}
                className="pr-10"
              />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPw(p => ({ ...p, current: !p.current }))}>
                {showPw.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="pw-new">{t.settings.newPassword || "New Password"}</Label>
            <div className="relative">
              <Input
                id="pw-new"
                data-testid="input-new-password"
                type={showPw.next ? 'text' : 'password'}
                value={pwForm.next}
                onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
                placeholder={t.settings.newPasswordPlaceholder || "At least 8 characters"}
                className="pr-10"
              />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPw(p => ({ ...p, next: !p.next }))}>
                {showPw.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <Label htmlFor="pw-confirm">{t.settings.confirmNewPassword || "Confirm New Password"}</Label>
            <div className="relative">
              <Input
                id="pw-confirm"
                data-testid="input-confirm-password"
                type={showPw.confirm ? 'text' : 'password'}
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                placeholder={t.settings.repeatNewPasswordPlaceholder || "Repeat new password"}
                className="pr-10"
              />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPw(p => ({ ...p, confirm: !p.confirm }))}>
                {showPw.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Button
            data-testid="button-change-password"
            onClick={handleChangePassword}
            disabled={isSavingPw}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSavingPw ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />{t.settings.saving}</>
            ) : (
              <><Lock className="w-4 h-4 mr-2" />{t.settings.changePassword || "Change Password"}</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}