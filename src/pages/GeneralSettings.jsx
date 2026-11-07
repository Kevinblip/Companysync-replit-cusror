import React, { useState, useEffect, useRef } from "react";
import { normalizeDeductionTypes, sanitizePercent } from "@/utils/paymentDeductionTypes";
import { base44 } from "@/api/base44Client";
import { localDb } from "@/api/localSdk";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Calendar, CheckCircle2, RefreshCw, LinkIcon, XCircle, Clock, Edit, Save, X, Globe, User, Plus, Trash2, GripVertical, AlertTriangle, Bell, Lock, Eye, EyeOff, Smartphone, Shield, DollarSign, Banknote, ExternalLink, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { validateE164Phone, formatToE164, looksLikeFormattableUSPhone } from "@/utils";
import { safeFormat, toSafeDate } from "@/lib/safeDate";
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

const parseOptionalPercent = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { valid: true, percent: null };
  }
  const percent = sanitizePercent(value);
  return { valid: percent !== null, percent };
};

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
  const [microsoftAuthError, setMicrosoftAuthError] = useState(null);

  const [deductionsEnabled, setDeductionsEnabled] = useState(false);
  const [deductionTypes, setDeductionTypes] = useState([]);
  const [newDeductionType, setNewDeductionType] = useState('');
  const [newDeductionPercent, setNewDeductionPercent] = useState('');
  const [savingDeductions, setSavingDeductions] = useState(false);

  const [hapticEnabled, setHapticEnabled] = useState(() => {
    try { return localStorage.getItem('crewcam_haptic') !== '0'; } catch (_) { return true; }
  });
  const [hapticSaving, setHapticSaving] = useState(false);
  const [hapticSaved, setHapticSaved] = useState(false);
  const hapticPrefIdRef = useRef(null);

  const [facingMode, setFacingMode] = useState('environment');
  const [facingModeSaving, setFacingModeSaving] = useState(false);
  const [facingModeSaved, setFacingModeSaved] = useState(false);
  const facingModePrefIdRef = useRef(null);

  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [voiceModeSaving, setVoiceModeSaving] = useState(false);
  const [voiceModeSaved, setVoiceModeSaved] = useState(false);
  const voiceModePrefIdRef = useRef(null);
  const [quietHours, setQuietHours] = useState({ enabled: false, start: '22:00', end: '07:00' });
  const [savingQuietHours, setSavingQuietHours] = useState(false);
  // Prevents the staffProfiles refetch useEffect from clobbering unsaved edits.
  const isDirty = useRef(false);

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
    const msError = params.get('microsoft_error');
    if (msError) {
      setMicrosoftAuthError(decodeURIComponent(msError));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const userEmail = user?.email;

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_at"),
    enabled: !!userEmail,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-settings', userEmail],
    queryFn: () => userEmail ? base44.entities.StaffProfile.filter({ user_email: userEmail }) : [],
    enabled: !!userEmail,
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

  const isAdmin = myCompany?.created_by === user?.email ||
    staffProfiles[0]?.is_administrator === true ||
    staffProfiles[0]?.role === 'admin';

  useEffect(() => {
    const saved = myCompany?.settings?.notification_quiet_hours || {};
    setQuietHours({
      enabled: saved.enabled === true,
      start: saved.start || '22:00',
      end: saved.end || '07:00',
    });
  }, [myCompany?.id, myCompany?.settings?.notification_quiet_hours]);

  const { data: allCompanyStaff = [], refetch: refetchAllStaff } = useQuery({
    queryKey: ['all-staff-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id && isAdmin,
  });

  const [repPayoutsEnabled, setRepPayoutsEnabled] = useState(false);
  const [repPayoutSaving, setRepPayoutSaving] = useState(false);
  const [repPayoutSetupLoading, setRepPayoutSetupLoading] = useState({});
  const [repPayoutCheckLoading, setRepPayoutCheckLoading] = useState({});

  useEffect(() => {
    if (myCompany?.data) {
      setRepPayoutsEnabled(!!myCompany.data.rep_payouts_enabled);
    }
  }, [myCompany?.id]);

  const handleSaveRepPayouts = async () => {
    if (!myCompany?.id) return;
    setRepPayoutSaving(true);
    try {
      await base44.entities.Company.update(myCompany.id, {
        data: { ...(myCompany.data || {}), rep_payouts_enabled: repPayoutsEnabled }
      });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Rep Payout settings saved.');
    } catch (e) {
      toast.error('Failed to save: ' + e.message);
    } finally {
      setRepPayoutSaving(false);
    }
  };

  const handleSetupRepBank = async (sp) => {
    setRepPayoutSetupLoading(prev => ({ ...prev, [sp.id]: true }));
    try {
      const res = await base44.functions.invoke('createRepPayoutAccount', {
        staffProfileId: sp.id,
        companyId: myCompany.id,
      });
      if (res.data?.onboarding_url) {
        window.open(res.data.onboarding_url, '_blank');
        refetchAllStaff();
      } else {
        toast.error(res.data?.error || 'Could not create onboarding link.');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRepPayoutSetupLoading(prev => ({ ...prev, [sp.id]: false }));
    }
  };

  const handleCheckRepStatus = async (sp) => {
    setRepPayoutCheckLoading(prev => ({ ...prev, [sp.id]: true }));
    try {
      const res = await base44.functions.invoke('checkRepPayoutAccount', {
        staffProfileId: sp.id,
        companyId: myCompany.id,
      });
      if (res.data?.status) {
        refetchAllStaff();
        const label = res.data.payouts_enabled ? '✅ Active — ready to receive ACH payouts' : res.data.details_submitted ? '⏳ Under review by Stripe' : '⚠️ Setup incomplete';
        toast.info(label);
      } else {
        toast.error(res.data?.error || 'Could not check status.');
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRepPayoutCheckLoading(prev => ({ ...prev, [sp.id]: false }));
    }
  };

  useEffect(() => {
    if (myCompany?.data) {
      setDeductionsEnabled(!!myCompany.data.payment_deductions_enabled);
      setDeductionTypes(normalizeDeductionTypes(myCompany.data.payment_deduction_types));
    }
  }, [myCompany?.id]);

  const addDeductionType = () => {
    const name = newDeductionType.trim();
    if (!name) return;
    const parsedRate = parseOptionalPercent(newDeductionPercent);
    if (!parsedRate.valid) {
      toast.error('Rate must be greater than 0 and no more than 100, or left blank.');
      return;
    }
    setDeductionTypes(prev => [...prev, { name, percent: parsedRate.percent }]);
    setNewDeductionType('');
    setNewDeductionPercent('');
  };

  const handleSaveDeductions = async () => {
    if (!myCompany?.id) return;
    const validatedTypes = [];
    for (const deductionType of deductionTypes) {
      const name = String(deductionType?.name ?? '').trim();
      if (!name) {
        toast.error('Each deduction type must have a name.');
        return;
      }
      const parsedRate = parseOptionalPercent(deductionType?.percent);
      if (!parsedRate.valid) {
        toast.error(`Rate for "${name}" must be greater than 0 and no more than 100, or left blank.`);
        return;
      }
      validatedTypes.push({ name, percent: parsedRate.percent });
    }
    setSavingDeductions(true);
    try {
      await base44.entities.Company.update(myCompany.id, {
        data: {
          ...(myCompany.data || {}),
          payment_deductions_enabled: deductionsEnabled,
          payment_deduction_types: normalizeDeductionTypes(validatedTypes),
        }
      });
      setDeductionTypes(validatedTypes);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success('Payment deduction settings saved.');
    } catch (e) {
      toast.error('Failed to save: ' + e.message);
    } finally {
      setSavingDeductions(false);
    }
  };

  useEffect(() => {
    if (staffProfiles.length > 0 && !isDirty.current) {
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
  });

  const { data: notificationPrefs = [] } = useQuery({
    queryKey: ['notification-prefs', user?.email],
    queryFn: () => user ? base44.entities.NotificationPreference.filter({ user_email: user.email }) : [],
    enabled: !!user,
  });

  // Default values for every pref flag. Merging ensures legacy records that
  // predate a newly added field still render the correct default in the UI.
  const defaultPrefs = {
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
    notify_on_transcription_failure: true,
    notify_on_homeowner_photo_upload: true,
    notify_on_homeowner_photo_upload_sms: true,
    mute_all_notifications: false
  };
  // Spread stored prefs over defaults so any field not yet persisted falls
  // back to its default value (avoids unchecked toggles for legacy records).
  const myPrefs = { ...defaultPrefs, ...(notificationPrefs[0] || {}) };

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

  const loadUserPref = async (userEmail, companyId, prefKey) => {
    const filter = { user_email: userEmail, pref_key: prefKey };
    if (companyId) filter.company_id = companyId;
    let results = await localDb.entities.UserPreference.filter(filter).catch(() => []);
    if ((!results || results.length === 0) && companyId) {
      results = await localDb.entities.UserPreference.filter({
        user_email: userEmail, pref_key: prefKey
      }).catch(() => []);
    }
    if (results && results.length > 0) {
      return results.reduce((latest, row) =>
        (row.updated_date || row.created_date || '') > (latest.updated_date || latest.created_date || '')
          ? row : latest
      , results[0]);
    }
    return null;
  };

  useEffect(() => {
    if (!user?.email) return;
    const tryLoad = async () => {
      const pref = await loadUserPref(user.email, myCompany?.id, 'crewcam_haptic');
      if (pref) {
        hapticPrefIdRef.current = pref.id;
        const serverValue = pref.pref_value !== '0';
        setHapticEnabled(serverValue);
        try { localStorage.setItem('crewcam_haptic', serverValue ? '1' : '0'); } catch (_) {}
      }
    };
    tryLoad();
  }, [user?.email, myCompany?.id]);

  useEffect(() => {
    if (!user?.email) return;
    const tryLoad = async () => {
      const pref = await loadUserPref(user.email, myCompany?.id, 'crewcam_facing_mode');
      if (pref) {
        facingModePrefIdRef.current = pref.id;
        setFacingMode(pref.pref_value === 'user' ? 'user' : 'environment');
      }
    };
    tryLoad();
  }, [user?.email, myCompany?.id]);

  useEffect(() => {
    if (!user?.email) return;
    const tryLoad = async () => {
      const pref = await loadUserPref(user.email, myCompany?.id, 'crewcam_voice_mode');
      if (pref) {
        voiceModePrefIdRef.current = pref.id;
        setVoiceModeEnabled(pref.pref_value === '1');
      }
    };
    tryLoad();
  }, [user?.email, myCompany?.id]);

  const handleHapticToggle = async () => {
    const next = !hapticEnabled;
    setHapticEnabled(next);
    try { localStorage.setItem('crewcam_haptic', next ? '1' : '0'); } catch (_) {}
    setHapticSaving(true);
    setHapticSaved(false);
    try {
      const prefData = {
        user_email: user.email,
        company_id: myCompany?.id || null,
        pref_key: 'crewcam_haptic',
        pref_value: next ? '1' : '0',
      };
      if (hapticPrefIdRef.current) {
        await localDb.entities.UserPreference.update(hapticPrefIdRef.current, prefData);
      } else {
        const created = await localDb.entities.UserPreference.create(prefData);
        hapticPrefIdRef.current = created?.id || null;
      }
      setHapticSaved(true);
      toast.success('Preference saved');
      setTimeout(() => setHapticSaved(false), 2000);
    } catch (_) {
      toast.error('Failed to save preference');
    } finally {
      setHapticSaving(false);
    }
  };

  const handleFacingModeChange = async (next) => {
    setFacingMode(next);
    setFacingModeSaving(true);
    setFacingModeSaved(false);
    try {
      const prefData = {
        user_email: user.email,
        company_id: myCompany?.id || null,
        pref_key: 'crewcam_facing_mode',
        pref_value: next,
      };
      if (facingModePrefIdRef.current) {
        await localDb.entities.UserPreference.update(facingModePrefIdRef.current, prefData);
      } else {
        const created = await localDb.entities.UserPreference.create(prefData);
        facingModePrefIdRef.current = created?.id || null;
      }
      setFacingModeSaved(true);
      toast.success('Preference saved');
      setTimeout(() => setFacingModeSaved(false), 2000);
    } catch (_) {
      toast.error('Failed to save preference');
    } finally {
      setFacingModeSaving(false);
    }
  };

  const handleVoiceModeToggle = async () => {
    const next = !voiceModeEnabled;
    setVoiceModeEnabled(next);
    setVoiceModeSaving(true);
    setVoiceModeSaved(false);
    try {
      const prefData = {
        user_email: user.email,
        company_id: myCompany?.id || null,
        pref_key: 'crewcam_voice_mode',
        pref_value: next ? '1' : '0',
      };
      if (voiceModePrefIdRef.current) {
        await localDb.entities.UserPreference.update(voiceModePrefIdRef.current, prefData);
      } else {
        const created = await localDb.entities.UserPreference.create(prefData);
        voiceModePrefIdRef.current = created?.id || null;
      }
      setVoiceModeSaved(true);
      toast.success('Preference saved');
      setTimeout(() => setVoiceModeSaved(false), 2000);
    } catch (_) {
      toast.error('Failed to save preference');
    } finally {
      setVoiceModeSaving(false);
    }
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
      
      isDirty.current = false;
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
  const [phoneError, setPhoneError] = useState(null);
  
  const handleSaveAccount = () => {
    if (!accountForm.full_name.trim()) {
      alert('❌ Name is required');
      return;
    }

    const phoneErr = validateE164Phone(accountForm.phone);
    if (phoneErr) {
      setPhoneError(phoneErr);
      return;
    }
    setPhoneError(null);

    setIsSaving(true);
    handleSaveAccountAsync({
      full_name: accountForm.full_name,
      phone: accountForm.phone
    }).finally(() => setIsSaving(false));
  };

  const handleCancelEdit = () => {
    isDirty.current = false;
    setEditingAccount(false);
    setPhoneError(null);
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

  const handleSaveQuietHours = async () => {
    if (!myCompany?.id || !isAdmin) return;
    setSavingQuietHours(true);
    try {
      await base44.entities.Company.update(myCompany.id, {
        settings: {
          ...(myCompany.settings || {}),
          notification_quiet_hours: quietHours,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      toast.success(quietHours.enabled
        ? `Staff notifications silenced from ${quietHours.start} to ${quietHours.end}`
        : 'Company quiet hours turned off');
    } catch (error) {
      toast.error(`Could not save quiet hours: ${error.message}`);
    } finally {
      setSavingQuietHours(false);
    }
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
    <div className="p-3 sm:p-6 space-y-6 max-w-4xl">
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
                    {toSafeDate(lastSync) && (
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t.common.lastSynced || "Last synced"}: {safeFormat(lastSync, 'MMM d, h:mm a')}
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
                <code className="text-xs bg-red-100 px-2 py-1 rounded block mt-1 break-all">{window.location.origin}/api/google-calendar-callback</code>
                <p className="text-xs text-red-700 mt-2">Also verify that the Google Calendar API is enabled and the OAuth consent screen is published (not Testing mode).</p>
              </AlertDescription>
            </Alert>
          )}

          {microsoftAuthError && (
            <Alert className="bg-red-50 border-red-200">
              <XCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <div className="font-semibold mb-1">Microsoft / Outlook Calendar connection failed</div>
                <p className="text-sm mb-2">{microsoftAuthError}</p>
                <p className="text-xs text-red-700">To fix this, register the following redirect URI in your Azure App Registration (under Authentication → Redirect URIs, type Web):</p>
                <code className="text-xs bg-red-100 px-2 py-1 rounded block mt-1 break-all">{window.location.origin}/api/microsoft-calendar-callback</code>
                <p className="text-xs text-red-700 mt-2">Also add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to your Replit Secrets.</p>
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
                {toSafeDate(diagnosis.last_sync) && (
                  <p className="text-sm">Last synced: {safeFormat(diagnosis.last_sync, 'MMM d, yyyy, h:mm a')}</p>
                )}
                {toSafeDate(diagnosis.webhook_expiration) && !diagnosis.webhook_expired && (
                  <p className="text-sm">Instant sync expires: {safeFormat(diagnosis.webhook_expiration, 'MMM d, yyyy, h:mm a')}</p>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-indigo-600" />
            Company Notification Quiet Hours
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-lg bg-gray-50 p-4">
            <div>
              <Label htmlFor="company-quiet-hours" className="font-semibold">Silence staff notifications overnight</Label>
              <p className="mt-1 text-sm text-gray-500">
                Applies to all admins, office staff, and sales reps using the company timezone. Customer messages are not affected.
              </p>
            </div>
            <Switch
              id="company-quiet-hours"
              checked={quietHours.enabled}
              onCheckedChange={(enabled) => setQuietHours(current => ({ ...current, enabled }))}
              disabled={!isAdmin}
            />
          </div>
          <div className="grid max-w-md grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quiet-hours-start">Silence after</Label>
              <Input
                id="quiet-hours-start"
                type="time"
                value={quietHours.start}
                onChange={(event) => setQuietHours(current => ({ ...current, start: event.target.value }))}
                disabled={!quietHours.enabled || !isAdmin}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quiet-hours-end">Resume at</Label>
              <Input
                id="quiet-hours-end"
                type="time"
                value={quietHours.end}
                onChange={(event) => setQuietHours(current => ({ ...current, end: event.target.value }))}
                disabled={!quietHours.enabled || !isAdmin}
              />
            </div>
          </div>
          <Button onClick={handleSaveQuietHours} disabled={!isAdmin || savingQuietHours}>
            {savingQuietHours ? 'Saving…' : 'Save Quiet Hours'}
          </Button>
          {!isAdmin && <p className="text-xs text-amber-700">Only a company owner or admin can change company-wide quiet hours.</p>}
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

            <div>
              <h3 className="font-semibold mb-3 text-sm text-gray-900 uppercase tracking-wider">Voice & Calls</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="notify_on_transcription_failure" className="font-normal">Call Transcription Failed</Label>
                    <p className="text-xs text-gray-500 mt-0.5">Email me when a call recording cannot be transcribed</p>
                  </div>
                  <Switch
                    id="notify_on_transcription_failure"
                    data-testid="switch-notify-transcription-failure"
                    checked={myPrefs.notify_on_transcription_failure}
                    onCheckedChange={() => handleTogglePref('notify_on_transcription_failure')}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3 text-sm text-gray-900 uppercase tracking-wider">Portal & Projects</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="notify_on_homeowner_photo_upload" className="font-normal">Homeowner Photo Uploaded (Email)</Label>
                    <p className="text-xs text-gray-500 mt-0.5">Email me when a homeowner uploads a photo via the customer portal</p>
                  </div>
                  <Switch
                    id="notify_on_homeowner_photo_upload"
                    data-testid="switch-notify-homeowner-photo-upload"
                    checked={myPrefs.notify_on_homeowner_photo_upload}
                    onCheckedChange={() => handleTogglePref('notify_on_homeowner_photo_upload')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="notify_on_homeowner_photo_upload_sms" className="font-normal">Homeowner Photo Uploaded (SMS)</Label>
                    <p className="text-xs text-gray-500 mt-0.5">Text me when a homeowner uploads a photo via the customer portal</p>
                  </div>
                  <Switch
                    id="notify_on_homeowner_photo_upload_sms"
                    data-testid="switch-notify-homeowner-photo-upload-sms"
                    checked={myPrefs.notify_on_homeowner_photo_upload_sms}
                    onCheckedChange={() => handleTogglePref('notify_on_homeowner_photo_upload_sms')}
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
                  onChange={(e) => { isDirty.current = true; setAccountForm({ ...accountForm, full_name: e.target.value }); }}
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
                <div className="flex gap-2">
                  <Input
                    id="edit-phone"
                    data-testid="input-profile-phone"
                    type="tel"
                    value={accountForm.phone}
                    onChange={(e) => {
                      const val = e.target.value;
                      isDirty.current = true;
                      setAccountForm({ ...accountForm, phone: val });
                      setPhoneError(validateE164Phone(val));
                    }}
                    placeholder="+15551234567"
                    className={`flex-1 ${phoneError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                  />
                  {looksLikeFormattableUSPhone(accountForm.phone) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-testid="button-format-profile-phone"
                      onClick={() => {
                        const formatted = formatToE164(accountForm.phone);
                        if (formatted) {
                          isDirty.current = true;
                          setAccountForm({ ...accountForm, phone: formatted });
                          setPhoneError(validateE164Phone(formatted));
                        }
                      }}
                    >
                      Format
                    </Button>
                  )}
                </div>
                {phoneError ? (
                  <p data-testid="error-profile-phone" className="text-xs text-red-600 mt-1">{phoneError}</p>
                ) : (
                  <p className="text-xs text-gray-500 mt-1">
                    Use E.164 format (e.g. +15551234567). {t.settings.phoneDescription || "Used for call bridging and notifications"}
                  </p>
                )}
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

      {/* Payment Deductions — admin only, hidden by default */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              Payment Deductions
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Define custom deduction types for third-party fees that are withheld from payments before you receive them. When enabled, a "Record Fee Deduction" option appears on invoices with a remaining balance.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <Label className="text-base font-semibold">Enable Payment Deductions</Label>
                <p className="text-sm text-gray-500 mt-0.5">
                  Show the fee deduction option on invoices for this company.
                </p>
              </div>
              <Switch
                data-testid="switch-payment-deductions"
                checked={deductionsEnabled}
                onCheckedChange={setDeductionsEnabled}
                disabled={!myCompany?.id}
              />
            </div>

            {deductionsEnabled && (
              <div className="space-y-3">
                <Label className="text-sm font-semibold text-gray-700">Deduction Types</Label>
                <p className="text-xs text-gray-500">
                  These are the names your staff will choose from when recording a deduction. Set a rate to have the
                  fee amount calculated automatically on the invoice — leave it blank to type the dollar amount in each time.
                </p>
                <div className="space-y-2">
                  {deductionTypes.map((dt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={dt.name}
                        onChange={e => {
                          const name = e.target.value;
                          setDeductionTypes(prev => prev.map((row, idx) => (
                            idx === i ? { ...row, name } : row
                          )));
                        }}
                        className="flex-1 bg-white"
                        aria-label={`Deduction type ${i + 1} name`}
                        data-testid={`input-deduction-type-${i}`}
                      />
                      <div className="relative w-28">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="Rate"
                          value={dt.percent ?? ''}
                          onChange={e => {
                            const v = e.target.value;
                            setDeductionTypes(prev => prev.map((row, idx) => (
                              idx === i ? { ...row, percent: v === '' ? null : v } : row
                            )));
                          }}
                          className="pr-7 bg-white"
                          data-testid={`input-deduction-percent-${i}`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-gray-400 hover:text-red-500"
                        onClick={() => setDeductionTypes(prev => prev.filter((_, idx) => idx !== i))}
                        data-testid={`button-remove-deduction-type-${i}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. Processing Fee, Management Fee, Adjustment"
                    value={newDeductionType}
                    onChange={e => setNewDeductionType(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addDeductionType();
                    }}
                    data-testid="input-new-deduction-type"
                    className="flex-1"
                  />
                  <div className="relative w-28">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="Rate"
                      value={newDeductionPercent}
                      onChange={e => setNewDeductionPercent(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') addDeductionType();
                      }}
                      className="pr-7"
                      data-testid="input-new-deduction-percent"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={addDeductionType}
                    data-testid="button-add-deduction-type"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add
                  </Button>
                </div>
              </div>
            )}

            <Button
              onClick={handleSaveDeductions}
              disabled={savingDeductions || !myCompany?.id}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-save-deductions"
            >
              {savingDeductions ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving…</> : <><Save className="w-4 h-4 mr-2" />Save Deduction Settings</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Rep ACH Payouts — admin only add-on */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-blue-600" />
              Rep ACH Payouts
              <span className="ml-1 text-xs font-normal bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Add-on</span>
            </CardTitle>
            <p className="text-sm text-gray-500 mt-1">
              Pay your sales reps directly to their bank account via ACH. Reps complete a one-time secure bank setup through Stripe (takes ~5 min). After that, you can send commissions straight from the invoice — no paper checks, no manual transfers.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div>
                <Label className="text-base font-semibold">Enable Rep ACH Payouts</Label>
                <p className="text-sm text-gray-500 mt-0.5">
                  Shows the "Send via ACH" option on commission splits for reps who have completed bank setup.
                </p>
              </div>
              <Switch
                data-testid="switch-rep-payouts"
                checked={repPayoutsEnabled}
                onCheckedChange={setRepPayoutsEnabled}
                disabled={!myCompany?.id}
              />
            </div>

            {allCompanyStaff.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-gray-700">Staff Bank Account Status</Label>
                <p className="text-xs text-gray-500">Send each rep a bank setup link. They complete it once on Stripe's secure page — you never handle their account numbers.</p>
                <div className="divide-y rounded-lg border overflow-hidden">
                  {allCompanyStaff.filter(sp => sp.user_email).map(sp => {
                    const status = sp.data?.stripe_payout_status;
                    const hasAccount = !!sp.data?.stripe_express_account_id;
                    return (
                      <div key={sp.id} className="flex items-center justify-between p-3 bg-white">
                        <div>
                          <p className="text-sm font-medium">{sp.full_name || sp.name || sp.user_email}</p>
                          <p className="text-xs text-gray-500">{sp.user_email}</p>
                          {hasAccount && (
                            <span className={`inline-flex items-center gap-1 text-xs mt-0.5 font-medium ${status === 'active' ? 'text-green-600' : status === 'review' ? 'text-amber-600' : 'text-gray-400'}`}>
                              {status === 'active' ? <><CheckCircle className="w-3 h-3" />Ready</> : status === 'review' ? <>⏳ Under review</> : <>⚠️ Setup incomplete</>}
                            </span>
                          )}
                          {!hasAccount && <span className="text-xs text-gray-400">No bank account set up</span>}
                        </div>
                        <div className="flex gap-2">
                          {hasAccount && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs text-gray-500"
                              onClick={() => handleCheckRepStatus(sp)}
                              disabled={!!repPayoutCheckLoading[sp.id]}
                              data-testid={`button-check-rep-status-${sp.id}`}
                            >
                              {repPayoutCheckLoading[sp.id] ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Refresh'}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                            onClick={() => handleSetupRepBank(sp)}
                            disabled={!!repPayoutSetupLoading[sp.id]}
                            data-testid={`button-setup-rep-bank-${sp.id}`}
                          >
                            {repPayoutSetupLoading[sp.id] ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <ExternalLink className="w-3 h-3 mr-1" />}
                            {hasAccount ? 'Resend Link' : 'Send Bank Setup'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800 space-y-1">
              <p className="font-semibold">How it works</p>
              <p>1. Enable this add-on and click "Send Bank Setup" for each rep.</p>
              <p>2. Reps click the link and add their bank info on Stripe's secure page (~5 min).</p>
              <p>3. On any invoice with a commission split, choose "Send via ACH" to pay them directly.</p>
              <p className="text-blue-600 mt-1">Fees: $0 per transfer for standard ACH (2–5 business days). Funds must be available in your Stripe balance from customer payments.</p>
            </div>

            <Button
              onClick={handleSaveRepPayouts}
              disabled={repPayoutSaving || !myCompany?.id}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="button-save-rep-payouts"
            >
              {repPayoutSaving ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Saving…</> : <><Save className="w-4 h-4 mr-2" />Save Payout Settings</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* My Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-indigo-600" />
            My Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-500">
            Configure your personal device settings. These sync across all your sessions so you don't need to adjust them each time you open the camera.
          </p>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <Label className="text-base font-semibold">Haptic Feedback</Label>
              <p className="text-sm text-gray-500 mt-0.5">
                Vibrate the device when a photo is captured in PhotoSync. Supported on most Android devices.
              </p>
            </div>
            <Switch
              data-testid="switch-haptic-feedback"
              checked={hapticEnabled}
              onCheckedChange={handleHapticToggle}
              disabled={hapticSaving || !user}
            />
          </div>
          {(hapticSaving || hapticSaved) && (
            <p className={`text-xs flex items-center gap-1 ${hapticSaved ? 'text-green-600' : 'text-gray-400'}`}>
              {hapticSaved
                ? <><CheckCircle2 className="w-3 h-3" /> Saved</>
                : <><RefreshCw className="w-3 h-3 animate-spin" /> Saving…</>}
            </p>
          )}

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <Label className="text-base font-semibold">Default Camera Facing</Label>
              <p className="text-sm text-gray-500 mt-0.5">
                Which camera to open by default in PhotoSync. Back camera is typical for roof photos.
              </p>
            </div>
            <Select
              value={facingMode}
              onValueChange={handleFacingModeChange}
              disabled={facingModeSaving || !user}
            >
              <SelectTrigger data-testid="select-camera-facing" className="w-32 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="environment">Back</SelectItem>
                <SelectItem value="user">Front</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(facingModeSaving || facingModeSaved) && (
            <p className={`text-xs flex items-center gap-1 ${facingModeSaved ? 'text-green-600' : 'text-gray-400'}`}>
              {facingModeSaved
                ? <><CheckCircle2 className="w-3 h-3" /> Saved</>
                : <><RefreshCw className="w-3 h-3 animate-spin" /> Saving…</>}
            </p>
          )}

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div>
              <Label className="text-base font-semibold">Voice Mode</Label>
              <p className="text-sm text-gray-500 mt-0.5">
                Start PhotoSync with voice commands enabled by default. You'll be prompted to activate it when the camera opens.
              </p>
            </div>
            <Switch
              data-testid="switch-voice-mode"
              checked={voiceModeEnabled}
              onCheckedChange={handleVoiceModeToggle}
              disabled={voiceModeSaving || !user}
            />
          </div>
          {(voiceModeSaving || voiceModeSaved) && (
            <p className={`text-xs flex items-center gap-1 ${voiceModeSaved ? 'text-green-600' : 'text-gray-400'}`}>
              {voiceModeSaved
                ? <><CheckCircle2 className="w-3 h-3" /> Saved</>
                : <><RefreshCw className="w-3 h-3 animate-spin" /> Saving…</>}
            </p>
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

      <AccountAccessLog />
    </div>
  );
}

function AccountAccessLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/impersonation/logs?type=company');
      if (res.ok) setLogs(await res.json());
    } catch (_) {}
    setLoading(false);
    setLoaded(true);
  };

  useEffect(() => { loadLogs(); }, []);

  if (loaded && logs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="w-4 h-4 text-amber-600" />
            Recent Account Access
          </CardTitle>
          <p className="text-xs text-gray-500 mt-0.5">CompanySync support sessions for your account. Sessions allow our team to view and make changes on your behalf to resolve issues or assist with onboarding.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadLogs} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !loaded ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start justify-between text-sm border rounded-lg px-3 py-2">
                <div>
                  <p className="text-gray-700 font-medium">{log.reason}</p>
                  <p className="text-gray-400 text-xs">{log.admin_email} · {safeFormat(log.started_at, 'MMM d, yyyy, h:mm a', '—')}</p>
                </div>
                <span className={`ml-3 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${log.is_active ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                  {log.is_active ? 'Active' : 'Ended'}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}