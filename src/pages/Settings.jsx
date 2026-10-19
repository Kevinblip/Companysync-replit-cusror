import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
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
  Trash2,
  Pencil,
  Globe,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Clock,
  XCircle,
  Shield,
  Download,
  Wrench,
  Sparkles,
  Send,
  Video,
  Zap as ZapIcon,
  Link as LinkIcon2,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import ColorPaletteSettings from "../components/visualizer/ColorPaletteSettings";

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  // useRoleBasedData resolves the correct company and profile even when
  // created_by is empty (uses admin-profile preference logic).
  const { user, myCompany, myStaffProfile, isAdmin } = useRoleBasedData();
  const initialSearchParams = new URLSearchParams(window.location.search);
  const defaultTab = initialSearchParams.get('tab') || 'integrations';
  const initialTwilioOpen = initialSearchParams.get('twilio') === '1';
  const initialTwilioFocus = initialSearchParams.get('focus') || null;
  const [twilioFocusToggle, setTwilioFocusToggle] = useState(initialTwilioFocus);
  const [syncingCalendar, setSyncingCalendar] = useState(false);
  const REMINDER_INTERVALS = [
    { key: '1440', label: '24 hours before' },
    { key: '360',  label: '6 hours before' },
    { key: '240',  label: '4 hours before' },
    { key: '60',   label: '1 hour before' },
    { key: '30',   label: '30 minutes before' },
  ];
  const defaultReminderPrefs = () =>
    Object.fromEntries(REMINDER_INTERVALS.map(i => [i.key, { email: true, sms: i.key === '60' }]));
  const [reminderPrefs, setReminderPrefs] = useState(defaultReminderPrefs());
  const [savingReminderPrefs, setSavingReminderPrefs] = useState(false);

  // True once the staff member has explicitly saved their own reminder preferences.
  // Used to hide "company default" hints — once the staff member has their own
  // saved prefs, the hints are no longer actionable.
  const hasPersonalReminderPrefs = !!(
    myStaffProfile?.data?.reminder_preferences &&
    typeof myStaffProfile.data.reminder_preferences === 'object' &&
    Object.keys(myStaffProfile.data.reminder_preferences).length > 0
  );

  // Build a short human-readable summary of which channels company defaults enable.
  // Returns null when no company defaults are set.
  const buildCompanyDefaultSummary = (defaultPrefs) => {
    if (!defaultPrefs || typeof defaultPrefs !== 'object') return null;
    const emailOn = REMINDER_INTERVALS.filter(i => defaultPrefs[i.key]?.email !== false);
    const smsOn   = REMINDER_INTERVALS.filter(i => defaultPrefs[i.key]?.sms   !== false);
    if (emailOn.length === 0 && smsOn.length === 0) return 'All channels off';
    if (emailOn.length === REMINDER_INTERVALS.length && smsOn.length === REMINDER_INTERVALS.length) {
      return 'Email and SMS for all reminders (same as the built-in default)';
    }
    const parts = [];
    if (emailOn.length === REMINDER_INTERVALS.length) {
      parts.push('Email for all reminders');
    } else if (emailOn.length > 0) {
      parts.push(`Email for ${emailOn.map(i => i.label).join(', ')}`);
    }
    if (smsOn.length === REMINDER_INTERVALS.length) {
      parts.push('SMS for all reminders');
    } else if (smsOn.length > 0) {
      parts.push(`SMS for ${smsOn.map(i => i.label).join(', ')}`);
    }
    return parts.join(' · ') || null;
  };
  const [companyDefaultPrefsEdit, setCompanyDefaultPrefsEdit] = useState(() => defaultReminderPrefs());
  const [savingCompanyDefaults, setSavingCompanyDefaults] = useState(false);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [disconnectEmail, setDisconnectEmail] = useState('');
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState(null);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailAuthError, setGmailAuthError] = useState('');
  const [showTwilioSetup, setShowTwilioSetup] = useState(initialTwilioOpen);
  const [showThoughtlyDialog, setShowThoughtlyDialog] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [thoughtlyAgents, setThoughtlyAgents] = useState([]);
  
  // QuickBooks states
  const [qbConnected, setQbConnected] = useState(false);
  const [qbConnectionInfo, setQbConnectionInfo] = useState(null);
  const [qbConnecting, setQbConnecting] = useState(false);
  const [qbSyncStatus, setQbSyncStatus] = useState(null);
  const [showQBSyncLog, setShowQBSyncLog] = useState(false);
  const [qbBulkSyncing, setQbBulkSyncing] = useState(false);
  const [qbBulkResult, setQbBulkResult] = useState(null);
  const [qbMarkingManual, setQbMarkingManual] = useState(false);
  const [qbExpImporting, setQbExpImporting] = useState(false);
  const [qbExpResult, setQbExpResult] = useState(null);
  const [qbExpDays, setQbExpDays] = useState('this_year');
  // Connected Services
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [gcalCategorizing, setGcalCategorizing] = useState(false);
  const [gcalShowSetupDialog, setGcalShowSetupDialog] = useState(false);
  const [gcalSetupDiagnosis, setGcalSetupDiagnosis] = useState(null);

  // Webhook states
  const [webhooks, setWebhooks] = useState([]);
  const [webhookSupportedEvents, setWebhookSupportedEvents] = useState([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [showWebhookDialog, setShowWebhookDialog] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState(null);
  const [webhookForm, setWebhookForm] = useState({ name: '', url: '', events: [], secret: '' });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(null);
  const [testResult, setTestResult] = useState(null);

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
    const checkConnection = async () => {
      try {
        const response = await base44.functions.invoke('checkGoogleCalendarConnection', {});
        setGoogleCalendarConnected(response.data.connected);
      } catch (error) {
        setGoogleCalendarConnected(false);
      }
    };
    checkConnection();

    // Check Gmail connection
    base44.functions.invoke('checkGmailConnection', {}).then(res => {
      setGmailConnected(res.data?.connected || false);
      setGmailEmail(res.data?.gmail_email || null);
    }).catch(() => {});

    // Handle ?gmail_connected=true redirect from OAuth
    const searchParams = new URLSearchParams(window.location.search);
    const gmailError = searchParams.get('gmail_error');
    if (gmailError) {
      setGmailAuthError(gmailError);
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (searchParams.get('gmail_connected') === 'true') {
      base44.functions.invoke('checkGmailConnection', {}).then(res => {
        setGmailConnected(res.data?.connected || false);
        setGmailEmail(res.data?.gmail_email || null);
      }).catch(() => {});
    }

    // Load webhooks on mount (admin only, fails gracefully)
    base44.functions.invoke('listWebhookConfigs', {}).then(res => {
      setWebhooks(res.data?.webhooks || []);
      setWebhookSupportedEvents(res.data?.supportedEvents || []);
    }).catch(() => {});
  }, []);

  // Declared BEFORE the effects below that reference it in their dependency
  // arrays — a later `const` would hit the temporal dead zone during render
  // and crash the whole Settings page ("Cannot access ... before initialization").
  const { data: companyReminderSettings } = useQuery({
    queryKey: ['company-reminder-settings', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return null;
      const rows = await base44.entities.ReminderSettings.filter({ company_id: myCompany.id }, '-created_date', 1);
      return rows[0] || null;
    },
    enabled: !!myCompany,
  });

  useEffect(() => {
    if (!myStaffProfile) return;
    const saved = myStaffProfile.data?.reminder_preferences;
    if (saved && typeof saved === 'object' && Object.keys(saved).length > 0) {
      // Staff has personal prefs — use them as-is
      setReminderPrefs({ ...defaultReminderPrefs(), ...saved });
    } else if (companyReminderSettings?.default_staff_preferences) {
      // No personal prefs — pre-fill from company defaults so new staff start correctly
      setReminderPrefs({ ...defaultReminderPrefs(), ...companyReminderSettings.default_staff_preferences });
    } else {
      // No personal prefs and no company defaults — all-on
      setReminderPrefs(defaultReminderPrefs());
    }
  }, [myStaffProfile?.id, companyReminderSettings?.id]);

  useEffect(() => {
    const saved = companyReminderSettings?.default_staff_preferences;
    if (saved && typeof saved === 'object') {
      setCompanyDefaultPrefsEdit({ ...defaultReminderPrefs(), ...saved });
    } else {
      setCompanyDefaultPrefsEdit(defaultReminderPrefs());
    }
  }, [companyReminderSettings?.id]);

  const saveReminderPrefs = async () => {
    if (!myStaffProfile?.id) {
      alert('Staff profile not found. Please make sure your account is set up.');
      return;
    }
    setSavingReminderPrefs(true);
    try {
      await base44.entities.StaffProfile.update(myStaffProfile.id, {
        data: { ...(myStaffProfile.data || {}), reminder_preferences: reminderPrefs }
      });
      queryClient.invalidateQueries({ queryKey: ['my-staff-profile-settings'] });
      alert('✅ Reminder preferences saved!');
    } catch (err) {
      alert('❌ Failed to save: ' + err.message);
    } finally {
      setSavingReminderPrefs(false);
    }
  };

  const toggleReminderPref = (intervalKey, channel) => {
    setReminderPrefs(prev => ({
      ...prev,
      [intervalKey]: {
        ...prev[intervalKey],
        [channel]: !prev[intervalKey]?.[channel]
      }
    }));
  };

  const toggleCompanyDefaultPref = (intervalKey, channel) => {
    setCompanyDefaultPrefsEdit(prev => ({
      ...prev,
      [intervalKey]: {
        ...prev[intervalKey],
        [channel]: !prev[intervalKey]?.[channel]
      }
    }));
  };

  const saveCompanyDefaults = async () => {
    if (!myCompany?.id) return;
    setSavingCompanyDefaults(true);
    try {
      if (companyReminderSettings?.id) {
        await base44.entities.ReminderSettings.update(companyReminderSettings.id, {
          default_staff_preferences: companyDefaultPrefsEdit
        });
      } else {
        await base44.entities.ReminderSettings.create({
          company_id: myCompany.id,
          default_staff_preferences: companyDefaultPrefsEdit
        });
      }
      queryClient.invalidateQueries({ queryKey: ['company-reminder-settings', myCompany.id] });
      toast.success('✅ Company reminder defaults saved!');
    } catch (err) {
      toast.error('❌ Failed to save: ' + err.message);
    } finally {
      setSavingCompanyDefaults(false);
    }
  };

  const { data: twilioConfig } = useQuery({
      queryKey: ['twilio-settings'],
      queryFn: async () => {
        if (!myCompany) return null;
        const settings = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
        return settings[0] || null;
      },
      enabled: !!myCompany,
  });

  // Check QB connection on mount and after OAuth redirect
  useEffect(() => {
    const checkQb = async () => {
      try {
        const response = await base44.functions.invoke('checkQuickBooksConnection', {});
        setQbConnected(response.data?.connected || false);
        setQbConnectionInfo(response.data || null);
        if (response.data?.connected) {
          const statusResp = await base44.functions.invoke('getQuickBooksSyncStatus', {});
          if (statusResp.data?.connected) setQbSyncStatus(statusResp.data);
        }
      } catch (e) {
        setQbConnected(false);
      }
    };
    checkQb();
    const params = new URLSearchParams(window.location.search);
    if (params.get('qb_connected') === 'true') {
      checkQb();
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('qb_error')) {
      toast.error('QuickBooks connection failed: ' + decodeURIComponent(params.get('qb_error')));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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

  const handleConnectQuickBooks = async () => {
    setQbConnecting(true);
    try {
      const response = await base44.functions.invoke('connectQuickBooks', {});
      if (response.data?.authUrl) {
        window.location.href = response.data.authUrl;
      } else {
        alert('❌ ' + (response.data?.error || 'Failed to start QuickBooks connection'));
        setQbConnecting(false);
      }
    } catch (error) {
      alert('Failed to connect QuickBooks: ' + error.message);
      setQbConnecting(false);
    }
  };

  const handleDisconnectQuickBooks = async () => {
    if (!confirm('Disconnect QuickBooks? Invoices will no longer sync automatically.')) return;
    try {
      await base44.functions.invoke('disconnectQuickBooks', {});
      setQbConnected(false);
      setQbConnectionInfo(null);
      setQbSyncStatus(null);
      setQbBulkResult(null);
    } catch (error) {
      alert('Failed to disconnect: ' + error.message);
    }
  };

  const handleBulkSyncQB = async () => {
    setQbBulkSyncing(true);
    setQbBulkResult(null);
    try {
      const resp = await base44.functions.invoke('bulkSyncQuickBooks', { syncInvoices: true, syncPayments: true });
      const r = resp.data?.results;
      setQbBulkResult(r || null);
      const statusResp = await base44.functions.invoke('getQuickBooksSyncStatus', {});
      if (statusResp.data?.connected) setQbSyncStatus(statusResp.data);
    } catch (err) {
      alert('Bulk sync failed: ' + err.message);
    } finally {
      setQbBulkSyncing(false);
    }
  };

  const handleImportQBExpenses = async () => {
    setQbExpImporting(true);
    setQbExpResult(null);
    try {
      const today = new Date();
      const fmt = d => d.toISOString().split('T')[0];
      let start;
      if (qbExpDays === 'this_year') {
        start = new Date(today.getFullYear(), 0, 1);
      } else if (qbExpDays === 'last_year') {
        start = new Date(today.getFullYear() - 1, 0, 1);
        today.setFullYear(today.getFullYear() - 1, 11, 31);
      } else if (qbExpDays === 'all_time') {
        start = new Date('2010-01-01');
      } else {
        start = new Date(today);
        start.setDate(today.getDate() - parseInt(qbExpDays, 10));
      }
      const resp = await base44.functions.invoke('importQBExpenses', {
        startDate: fmt(start),
        endDate: fmt(today),
        maxResults: 1000,
      });
      if (resp.data?.error) throw new Error(resp.data.error);
      setQbExpResult(resp.data || {});
    } catch (err) {
      setQbExpResult({ error: err.message });
    } finally {
      setQbExpImporting(false);
    }
  };

  const handleSendTestEmail = async (userEmail) => {
    if (!userEmail) return;
    setIsSendingTestEmail(true);
    try {
      const resp = await base44.functions.invoke('sendEmailWithResend', {
        to: userEmail,
        companyId: myCompany?.id,
        subject: 'Test Email from CompanySync',
        html: '<h1>It Works!</h1><p>Your email integration is configured correctly.</p>',
        fromName: 'CompanySync Test',
        manualSend: true,
      });
      if (resp.data?.success) toast.success(`Test email sent to ${userEmail}!`);
      else toast.error('Failed to send: ' + (resp.data?.error || 'Unknown error'));
    } catch (e) { toast.error('Error: ' + e.message); }
    finally { setIsSendingTestEmail(false); }
  };

  const handleGcalAutoCategorize = async () => {
    if (!window.confirm('Auto-categorize all calendar events by type and color?\n\nExamples: "Inspection" → Green, "Call" → Purple, "Meeting" → Blue\n\nContinue?')) return;
    setGcalCategorizing(true);
    try {
      const result = await base44.functions.invoke('autoCategorizeEvents', {});
      if (result.data?.success) {
        toast.success(`Done! ${result.data.updated} events updated.`);
      }
    } catch (e) { toast.error('Failed: ' + e.message); }
    finally { setGcalCategorizing(false); }
  };

  const handleGcalShowSetup = async () => {
    setGcalShowSetupDialog(true);
    setGcalSetupDiagnosis(null);
    try {
      const result = await base44.functions.invoke('diagnoseGoogleCalendar', {});
      setGcalSetupDiagnosis(result.data);
    } catch (e) { setGcalSetupDiagnosis({ error: 'Failed to run diagnosis: ' + e.message }); }
  };

  const handleMarkAllQBManual = async () => {
    if (!myCompany?.id) return;
    const confirmed = window.confirm(
      'This will mark ALL "QB Pending" payments as already in QuickBooks — no duplicates will be created. ' +
      'Use this if your historical payments were entered manually in QB.\n\nProceed?'
    );
    if (!confirmed) return;
    setQbMarkingManual(true);
    try {
      const resp = await base44.functions.invoke('markPaymentQBManual', { companyId: myCompany.id });
      if (resp.data?.error) throw new Error(resp.data.error);
      const statusResp = await base44.functions.invoke('getQuickBooksSyncStatus', {});
      if (statusResp.data?.connected) setQbSyncStatus(statusResp.data);
      alert(`Done — ${resp.data?.updated ?? 0} payments marked as already in QB. They won't be pushed again.`);
    } catch (err) {
      alert('Failed: ' + err.message);
    } finally {
      setQbMarkingManual(false);
    }
  };

  const loadWebhooks = async () => {
    setLoadingWebhooks(true);
    try {
      const res = await base44.functions.invoke('listWebhookConfigs', {});
      setWebhooks(res.data?.webhooks || []);
      setWebhookSupportedEvents(res.data?.supportedEvents || []);
    } catch (err) {
      console.error('Failed to load webhooks', err);
    } finally {
      setLoadingWebhooks(false);
    }
  };

  const openNewWebhook = () => {
    setEditingWebhook(null);
    setWebhookForm({ name: '', url: '', events: [], secret: '' });
    setTestResult(null);
    setShowWebhookDialog(true);
  };

  const openEditWebhook = (wh) => {
    setEditingWebhook(wh);
    setWebhookForm({ name: wh.name, url: wh.url, events: wh.events || [], secret: wh.secret || '' });
    setTestResult(null);
    setShowWebhookDialog(true);
  };

  const handleSaveWebhook = async () => {
    if (!webhookForm.name.trim()) { alert('Please enter a name for this webhook.'); return; }
    if (!webhookForm.url.trim()) { alert('Please enter the webhook URL.'); return; }
    setSavingWebhook(true);
    try {
      const res = await base44.functions.invoke('saveWebhookConfig', {
        id: editingWebhook?.id,
        name: webhookForm.name.trim(),
        url: webhookForm.url.trim(),
        events: webhookForm.events,
        secret: webhookForm.secret.trim() || null,
        is_active: true,
      });
      if (res.data?.error) { alert('❌ ' + res.data.error); return; }
      setShowWebhookDialog(false);
      await loadWebhooks();
    } catch (err) {
      alert('Failed to save webhook: ' + err.message);
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleDeleteWebhook = async (id) => {
    if (!confirm('Delete this webhook? Events will stop being sent to it.')) return;
    try {
      await base44.functions.invoke('deleteWebhookConfig', { id });
      await loadWebhooks();
    } catch (err) {
      alert('Failed to delete webhook: ' + err.message);
    }
  };

  const handleTestWebhook = async (id) => {
    setTestingWebhook(id);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke('testWebhookConfig', { id });
      setTestResult({ id, ...res.data });
    } catch (err) {
      setTestResult({ id, success: false, message: err.message });
    } finally {
      setTestingWebhook(null);
    }
  };

  const toggleWebhookEvent = (event) => {
    setWebhookForm(f => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter(e => e !== event) : [...f.events, event]
    }));
  };

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

  const handleConnectGmail = async () => {
    setGmailConnecting(true);
    try {
      const response = await base44.functions.invoke('connectGmailForLexi', {});
      if (response.data?.authUrl) {
        window.location.href = response.data.authUrl;
      } else {
        alert('Failed to get Gmail auth URL: ' + (response.data?.error || 'Unknown error'));
        setGmailConnecting(false);
      }
    } catch (error) {
      alert('Failed to connect Gmail: ' + error.message);
      setGmailConnecting(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!confirm('Disconnect Gmail? Lexi will no longer be able to read or reply to emails.')) return;
    try {
      await base44.functions.invoke('disconnectGmailForLexi', {});
      setGmailConnected(false);
      setGmailEmail(null);
    } catch (error) {
      alert('Failed to disconnect Gmail: ' + error.message);
    }
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
    <div className="p-3 sm:p-6 space-y-6 max-w-5xl mx-auto">
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
          <TabsTrigger value="color-palettes">Color Palettes</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-gray-600" />
                {t.settings.companySetup}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 space-y-4">
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
            <CardContent className="p-3 sm:p-6 space-y-6">
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
              <Dialog open={showTwilioSetup} onOpenChange={(open) => { setShowTwilioSetup(open); if (!open) setTwilioFocusToggle(null); }}>
                <DialogTrigger asChild>
                  <Button variant="outline">Manage</Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Twilio Integration Setup</DialogTitle>
                  </DialogHeader>
                  <TwilioSetup focusToggle={twilioFocusToggle} />
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

          {/* QuickBooks Integration */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <Calculator className="w-6 h-6 text-green-700" />
                <div>
                  <CardTitle>QuickBooks Online</CardTitle>
                  <p className="text-sm text-gray-500">Two-way sync: invoices, payments, and customers.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {qbConnected && (
                  <Badge className="bg-green-100 text-green-700 border-green-300">✓ Connected</Badge>
                )}
                {qbConnected ? (
                  <Button variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={handleDisconnectQuickBooks}>
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    onClick={handleConnectQuickBooks}
                    disabled={qbConnecting}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {qbConnecting ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</>
                    ) : (
                      <><DollarSign className="w-4 h-4 mr-1" />Connect QuickBooks</>
                    )}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {qbConnected ? (
                <>
                  {/* Sandbox warning */}
                  {qbConnectionInfo?.sandbox && (
                    <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-300 rounded-lg" data-testid="banner-qb-sandbox-warning">
                      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 text-sm">
                        <p className="font-semibold text-amber-900">
                          Connected to a QuickBooks TEST company — not your real books
                        </p>
                        <p className="text-amber-800 mt-1">
                          This connection is linked to "{qbConnectionInfo?.company_name || 'a sandbox company'}", Intuit's practice/sandbox company.
                          Invoices and payments will sync into that test company, not your real QuickBooks account.
                        </p>
                        <p className="text-amber-800 mt-1">
                          To fix: your Intuit developer app needs <strong>Production keys</strong> (in the Intuit Developer portal under Keys &amp; credentials), then click Disconnect here and reconnect — choosing your real company when QuickBooks asks.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Connection Info */}
                  <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-green-900" data-testid="text-qb-company-name">
                        {qbConnectionInfo?.company_name || 'QuickBooks'} — Connected{qbConnectionInfo?.sandbox ? ' (Sandbox)' : ''}
                      </p>
                      <p className="text-xs text-green-700 mt-0.5">
                        New invoices and payments sync automatically · 
                        {qbSyncStatus?.last_sync
                          ? ` Last sync: ${new Date(qbSyncStatus.last_sync).toLocaleString()}`
                          : ' No sync run yet'}
                      </p>
                    </div>
                  </div>

                  {/* Sync Stats */}
                  {qbSyncStatus && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border rounded-lg bg-white">
                        <p className="text-xs text-gray-500 mb-1">Invoices in QuickBooks</p>
                        <div className="flex items-end gap-1">
                          <span className="text-2xl font-bold text-gray-900">{qbSyncStatus.invoices?.synced ?? '—'}</span>
                          <span className="text-sm text-gray-400 pb-0.5">/ {qbSyncStatus.invoices?.total ?? '—'}</span>
                        </div>
                        {(qbSyncStatus.invoices?.unsynced ?? 0) > 0 && (
                          <p className="text-xs text-amber-600 mt-1">{qbSyncStatus.invoices.unsynced} not yet synced</p>
                        )}
                      </div>
                      <div className="p-3 border rounded-lg bg-white">
                        <p className="text-xs text-gray-500 mb-1">Payments in QuickBooks</p>
                        <div className="flex items-end gap-1">
                          <span className="text-2xl font-bold text-gray-900">{qbSyncStatus.payments?.synced ?? '—'}</span>
                          <span className="text-sm text-gray-400 pb-0.5">/ {qbSyncStatus.payments?.total ?? '—'}</span>
                        </div>
                        {(qbSyncStatus.payments?.unsynced ?? 0) > 0 && (
                          <p className="text-xs text-amber-600 mt-1">{qbSyncStatus.payments.unsynced} not yet synced</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Bulk Sync */}
                  <div className="p-3 border rounded-lg bg-gray-50 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">Push to QuickBooks</p>
                        <p className="text-xs text-gray-500">Push invoices and payments that originated in this app to QuickBooks.</p>
                        <p className="text-xs text-amber-600 mt-0.5 font-medium">⚠️ Only use if those records don't already exist in QB — syncing duplicates doubles your revenue totals there.</p>
                      </div>
                      <Button
                        onClick={handleBulkSyncQB}
                        disabled={qbBulkSyncing || qbMarkingManual}
                        variant="outline"
                        className="shrink-0"
                      >
                        {qbBulkSyncing
                          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing...</>
                          : <><RefreshCw className="w-4 h-4 mr-2" />Sync Now</>
                        }
                      </Button>
                    </div>
                    <div className="flex items-start justify-between gap-4 pt-2 border-t">
                      <div>
                        <p className="text-sm font-medium">Payments already in QB</p>
                        <p className="text-xs text-gray-500">If your historical payments were entered manually in QuickBooks, mark them here so the app won't push duplicates.</p>
                      </div>
                      <Button
                        onClick={handleMarkAllQBManual}
                        disabled={qbMarkingManual || qbBulkSyncing}
                        variant="outline"
                        className="shrink-0 text-blue-700 border-blue-300 hover:bg-blue-50"
                      >
                        {qbMarkingManual
                          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Marking...</>
                          : 'Mark all as already in QB'
                        }
                      </Button>
                    </div>
                  </div>

                  {/* Bulk Sync Results */}
                  {qbBulkResult && (
                    <div className="p-3 border rounded-lg bg-white space-y-2">
                      <p className="text-sm font-medium text-gray-800">Last Sync Results</p>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                          <span>{qbBulkResult.invoices?.synced ?? 0} invoices synced</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                          <span>{qbBulkResult.payments?.synced ?? 0} payments synced</span>
                        </div>
                        {(qbBulkResult.invoices?.errors?.length ?? 0) > 0 && (
                          <div className="col-span-2">
                            <p className="text-xs text-red-600">{qbBulkResult.invoices.errors.length} invoice errors — check that QuickBooks is properly connected.</p>
                          </div>
                        )}
                        {(qbBulkResult.payments?.errors?.length ?? 0) > 0 && (
                          <div className="col-span-2">
                            <p className="text-xs text-red-600">{qbBulkResult.payments.errors.length} payment errors.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Import Expenses from QB */}
                  <div className="p-3 border rounded-lg bg-gray-50 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium">Import Expenses from QuickBooks</p>
                        <p className="text-xs text-gray-500 mt-0.5">Pull your QuickBooks expense transactions into CompanySync so your P&amp;L is complete. Duplicates are automatically skipped.</p>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <UiSelect value={qbExpDays} onValueChange={setQbExpDays}>
                          <UiSelectTrigger className="w-32 h-8 text-xs">
                            <UiSelectValue />
                          </UiSelectTrigger>
                          <UiSelectContent>
                            <UiSelectItem value="this_year">This year</UiSelectItem>
                            <UiSelectItem value="last_year">Last year</UiSelectItem>
                            <UiSelectItem value="all_time">All time</UiSelectItem>
                            <UiSelectItem value="90">Last 90 days</UiSelectItem>
                            <UiSelectItem value="30">Last 30 days</UiSelectItem>
                          </UiSelectContent>
                        </UiSelect>
                        <Button
                          onClick={handleImportQBExpenses}
                          disabled={qbExpImporting}
                          variant="outline"
                          className="h-8 text-xs"
                        >
                          {qbExpImporting
                            ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Importing...</>
                            : <><Download className="w-3 h-3 mr-1.5" />Import Now</>
                          }
                        </Button>
                      </div>
                    </div>
                    {qbExpResult && (
                      <div className={`p-2.5 rounded border text-xs ${qbExpResult.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-gray-200 text-gray-700'}`}>
                        {qbExpResult.error
                          ? <span>Import failed: {qbExpResult.error}</span>
                          : <span>
                              <span className="font-medium text-green-700">{qbExpResult.imported ?? 0} expenses imported</span>
                              {(qbExpResult.skipped ?? 0) > 0 && <span className="text-gray-400 ml-2">· {qbExpResult.skipped} already existed (skipped)</span>}
                              {(qbExpResult.errors?.length ?? 0) > 0 && <span className="text-amber-600 ml-2">· {qbExpResult.errors.length} errors</span>}
                              <span className="text-gray-400 ml-2">· View them in Expenses</span>
                            </span>
                        }
                      </div>
                    )}
                  </div>

                  {/* Auto-sync notice */}
                  <p className="text-xs text-gray-400">
                    Going forward, every new invoice and payment will sync to QuickBooks automatically within seconds of being saved.
                  </p>

                  {/* ── Super-admin sync activity log ── */}
                  {myStaffProfile?.is_super_admin && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setShowQBSyncLog(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <Shield className="w-4 h-4 text-gray-400" />
                          QB Sync Activity
                          <span className="text-xs font-normal text-gray-400">(super-admin only)</span>
                        </span>
                        <div className="flex items-center gap-3">
                          {qbSyncStatus?.last_sync && (
                            <span className="text-xs text-gray-400">
                              Last sync: {new Date(qbSyncStatus.last_sync).toLocaleString()}
                            </span>
                          )}
                          {showQBSyncLog ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                        </div>
                      </button>

                      {showQBSyncLog && (
                        <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                          {!qbSyncStatus?.sync_log?.length ? (
                            <div className="px-4 py-6 text-center text-sm text-gray-400">
                              No sync activity yet — activity is recorded when invoices or payments sync to QuickBooks.
                            </div>
                          ) : (
                            qbSyncStatus.sync_log.map((entry, i) => (
                              <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                                {entry.status === 'success'
                                  ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                                  : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                }
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium ${entry.status === 'success' ? 'text-gray-800' : 'text-red-700'}`}>
                                    {entry.label || (entry.type === 'invoice' ? 'Invoice' : 'Payment')}
                                    {entry.action && <span className="ml-1 text-xs font-normal text-gray-400">({entry.action})</span>}
                                  </p>
                                  {entry.error && (
                                    <p className="text-xs text-red-500 mt-0.5 truncate" title={entry.error}>{entry.error}</p>
                                  )}
                                </div>
                                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 flex items-center gap-1 mt-0.5">
                                  <Clock className="w-3 h-3" />
                                  {new Date(entry.ts).toLocaleString()}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                {qbConnectionInfo?.needs_reconnect && (
                  <Alert className="bg-red-50 border-red-300" data-testid="banner-qb-reconnect">
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                    <AlertDescription className="text-red-900">
                      <strong>QuickBooks connection needs attention</strong>
                      <p className="text-sm mt-1">{qbConnectionInfo.error || 'The saved connection is no longer working — please reconnect.'}</p>
                    </AlertDescription>
                  </Alert>
                )}
                <Alert className="bg-blue-50 border-blue-200">
                  <Calculator className="h-4 w-4 text-blue-600" />
                  <AlertDescription className="text-blue-900">
                    <strong>Connect QuickBooks Online</strong>
                    <p className="text-sm mt-1">Sign in with your QuickBooks account to enable automatic sync. All your invoices, payments, and customers will be kept in sync — both new data going forward and your existing history.</p>
                    <ul className="list-disc list-inside mt-2 text-sm space-y-1">
                      <li>New invoices sync automatically on save</li>
                      <li>Payments post to QuickBooks in real time</li>
                      <li>Customers created automatically in QB</li>
                      <li>Bulk sync pushes all existing history</li>
                    </ul>
                  </AlertDescription>
                </Alert>
                </>
              )}
            </CardContent>
          </Card>
            
          {/* ── Connected Services ── */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Connected Services</h2>
            <div className="space-y-4">

              {/* GoHighLevel */}
              <Card className="border-l-4 border-l-orange-500">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ZapIcon className="w-5 h-5 text-orange-600" />
                      GoHighLevel
                    </CardTitle>
                    <Button size="sm" onClick={() => navigate(createPageUrl('GoHighLevelSettings'))} className="bg-orange-600 hover:bg-orange-700">
                      <Wrench className="w-3.5 h-3.5 mr-1.5" /> Configure
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500">Two-way CRM sync — auto-import GHL contacts as leads and push new leads to GoHighLevel.</p>
                </CardHeader>
              </Card>

              {/* JobNimbus */}
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <LinkIcon2 className="w-5 h-5 text-blue-600" />
                      JobNimbus
                    </CardTitle>
                    <Button size="sm" onClick={() => navigate(createPageUrl('JobNimbusSettings'))} className="bg-blue-600 hover:bg-blue-700">
                      <Wrench className="w-3.5 h-3.5 mr-1.5" /> Configure
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500">Import contacts and jobs from JobNimbus into your CRM. Safe to re-run — updates instead of duplicating.</p>
                </CardHeader>
              </Card>

              {/* Email Service */}
              <Card className="border-l-4 border-l-green-500">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Mail className="w-5 h-5 text-green-600" />
                    Email Service
                    <Badge className="bg-green-100 text-green-700 text-xs ml-1">Configured</Badge>
                  </CardTitle>
                  <p className="text-sm text-gray-500">System email delivery for invoices, reminders, and notifications.</p>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <Button variant="outline" size="sm" onClick={() => handleSendTestEmail(user?.email || myStaffProfile?.user_email)} disabled={isSendingTestEmail}>
                    {isSendingTestEmail ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1.5" />}
                    Send Test Email
                  </Button>
                  <div className="bg-gray-50 rounded-lg border p-3">
                    <p className="text-xs font-medium text-gray-700 flex items-center gap-1.5 mb-2">
                      <Video className="w-3.5 h-3.5" /> Smart Glasses Setup (Inbound)
                    </p>
                    <p className="text-xs text-gray-500 mb-1">Add this webhook in your email provider dashboard → Webhooks:</p>
                    <code
                      className="text-xs bg-white px-2 py-1 rounded border cursor-pointer select-all block truncate"
                      onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/api/functions/smartGlassesEmailWebhook`); toast.success('Copied!'); }}
                    >
                      {window.location.origin}/api/functions/smartGlassesEmailWebhook
                    </code>
                  </div>
                </CardContent>
              </Card>

            </div>
          </div>

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

                    <div className="flex flex-wrap gap-3">
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
                        onClick={handleGcalAutoCategorize}
                        disabled={gcalCategorizing}
                        variant="outline"
                        className="border-purple-300 text-purple-700 hover:bg-purple-50"
                      >
                        {gcalCategorizing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        Auto-Color Events
                      </Button>
                      <Button
                        onClick={handleGcalShowSetup}
                        variant="outline"
                        className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      >
                        <Wrench className="w-4 h-4 mr-2" />
                        Setup Help
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

          {/* Google Calendar Setup Diagnostic Dialog */}
          <Dialog open={gcalShowSetupDialog} onOpenChange={setGcalShowSetupDialog}>
            <DialogContent className="max-w-2xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-orange-600" />
                  Google Calendar Setup Diagnostic
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="max-h-[60vh] pr-4">
                {gcalSetupDiagnosis ? (
                  <div className="space-y-4">
                    {gcalSetupDiagnosis.error ? (
                      <Alert className="bg-red-50 border-red-200">
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <AlertDescription className="text-red-900">{gcalSetupDiagnosis.error}</AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <div className="rounded-lg border p-4 text-sm space-y-1">
                          <p><strong>Connection:</strong> {gcalSetupDiagnosis.connection_status}</p>
                          <p><strong>Access Token:</strong> {gcalSetupDiagnosis.has_access_token ? 'Yes' : 'No'}</p>
                          <p><strong>Refresh Token:</strong> {gcalSetupDiagnosis.has_refresh_token ? 'Yes' : 'No'}</p>
                          <p><strong>Token Valid:</strong> {gcalSetupDiagnosis.token_expired === 'N/A' ? 'N/A' : (gcalSetupDiagnosis.token_expired ? 'Expired' : 'Valid')}</p>
                          <p><strong>API Test:</strong> {gcalSetupDiagnosis.api_access_test}</p>
                        </div>
                        {gcalSetupDiagnosis.required_steps?.length > 0 && (
                          <div className="bg-gray-50 p-4 rounded-lg font-mono text-xs whitespace-pre-wrap">
                            {gcalSetupDiagnosis.required_steps.join('\n')}
                          </div>
                        )}
                        <div className="space-y-1 text-sm">
                          <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener noreferrer" className="block text-blue-600 hover:underline">→ Enable Google Calendar API</a>
                          <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener noreferrer" className="block text-blue-600 hover:underline">→ Configure OAuth Consent Screen</a>
                          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="block text-blue-600 hover:underline">→ Fix Redirect URI</a>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600 mr-2" />
                    <span className="text-gray-500">Running diagnostic...</span>
                  </div>
                )}
              </ScrollArea>
            </DialogContent>
          </Dialog>

          {/* Lexi Gmail Integration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-red-500" />
                Lexi Gmail Integration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Connect yicnteam@gmail.com so Lexi can read that inbox and save drafts. She does not send mail from the phone. You send the draft from Gmail.
                Only the account owner's Gmail is used.
              </p>
              {gmailAuthError && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-900">
                    <strong>Gmail authorization failed.</strong> {gmailAuthError}
                  </AlertDescription>
                </Alert>
              )}

              {gmailConnected ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-green-900">Gmail Connected</p>
                      {gmailEmail && (
                        <p className="text-sm text-green-700 truncate">{gmailEmail}</p>
                      )}
                      <p className="text-xs text-green-600 mt-1">Lexi can read this inbox. A reply from the phone is saved as a draft.</p>
                    </div>
                  </div>
                  <Button
                    onClick={handleDisconnectGmail}
                    variant="outline"
                    className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                  >
                    Disconnect Gmail
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* One-time Google Cloud Console prerequisite steps */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                      <Wrench className="w-4 h-4 flex-shrink-0" />
                      One-time Google Cloud Console setup (required before connecting)
                    </p>
                    <ol className="text-sm text-amber-800 space-y-2 list-decimal list-inside">
                      <li>
                        <a
                          href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 underline hover:text-blue-900"
                        >
                          Enable the Gmail API
                        </a>
                        {' '}in your Google Cloud project (same project as Google Calendar).
                      </li>
                      <li>
                        Go to{' '}
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 underline hover:text-blue-900"
                        >
                          APIs &amp; Services → Credentials
                        </a>
                        , open OAuth client <strong>783326703651-7cked810oe2o1tvt0vdtrd3n6ai0q0tc</strong>, and add these under <strong>Authorized redirect URIs</strong>:
                        <div className="mt-1 space-y-1">
                          <code className="block bg-white border border-amber-300 rounded px-2 py-1 text-xs font-mono select-all text-gray-800">
                            https://getcompanysync.com/api/gmail-callback
                          </code>
                          <code className="block bg-white border border-amber-300 rounded px-2 py-1 text-xs font-mono select-all text-gray-800">
                            https://companysync-web-production.up.railway.app/api/gmail-callback
                          </code>
                          <code className="block bg-white border border-amber-300 rounded px-2 py-1 text-xs font-mono select-all text-gray-800">
                            https://companysync-web-production.up.railway.app/api/auth/google/callback
                          </code>
                        </div>
                      </li>
                      <li>
                        Go to{' '}
                        <a
                          href="https://console.cloud.google.com/apis/credentials/consent"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 underline hover:text-blue-900"
                        >
                          OAuth consent screen → Test users
                        </a>
                        {' '}and add <strong>yicnteam@gmail.com</strong> (required while the app is in Testing mode).
                      </li>
                    </ol>
                    <p className="text-xs text-amber-700">
                      Already done these steps? Click <strong>Connect Gmail</strong> below.
                    </p>
                  </div>

                  <Alert className="bg-blue-50 border-blue-200">
                    <Mail className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-900">
                      <strong>Not Connected.</strong> After the setup steps, click Connect Gmail and approve read and draft access. Sign in as yicnteam@gmail.com. A draft stays in Gmail until you send it.
                    </AlertDescription>
                  </Alert>
                  <Button
                    onClick={handleConnectGmail}
                    disabled={gmailConnecting}
                    className="bg-red-500 hover:bg-red-600 text-white"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    {gmailConnecting ? 'Redirecting to Google...' : 'Connect Gmail'}
                  </Button>
                </div>
              )}
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
                            placeholder="e.g. acme-roofing"
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
            <CardContent className="p-3 sm:p-6 space-y-6">
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

          {/* Outgoing Webhooks / Zapier */}
          {isAdmin && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="w-6 h-6 text-orange-500" />
                  <div>
                    <CardTitle>Outgoing Webhooks</CardTitle>
                    <p className="text-sm text-gray-500">Send real-time event data to Zapier, Make, or any custom URL.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={loadWebhooks} disabled={loadingWebhooks}>
                    {loadingWebhooks ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                  <Button onClick={openNewWebhook} size="sm">
                    <Plus className="w-4 h-4 mr-1" /> Add Webhook
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {webhooks.length === 0 && !loadingWebhooks && (
                  <div className="text-center py-8 text-gray-500 border-2 border-dashed rounded-lg">
                    <Globe className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No webhooks yet</p>
                    <p className="text-sm mt-1">Add a webhook URL to start sending events to Zapier, Make, or your own server.</p>
                    <Button className="mt-4" onClick={openNewWebhook}><Plus className="w-4 h-4 mr-1" /> Add Your First Webhook</Button>
                  </div>
                )}
                {webhooks.map(wh => (
                  <div key={wh.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${wh.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className="font-medium truncate">{wh.name}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {testResult?.id === wh.id && (
                          <Badge variant={testResult.success ? 'default' : 'destructive'} className="text-xs">
                            {testResult.success ? '✓ ' : '✗ '}{testResult.message}
                          </Badge>
                        )}
                        <Button variant="outline" size="sm" onClick={() => handleTestWebhook(wh.id)} disabled={testingWebhook === wh.id}>
                          {testingWebhook === wh.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEditWebhook(wh)}><Pencil className="w-3 h-3" /></Button>
                        <Button variant="outline" size="sm" onClick={() => handleDeleteWebhook(wh.id)} className="text-red-600 hover:text-red-700"><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 font-mono truncate">{wh.url}</p>
                    <div className="flex flex-wrap gap-1">
                      {(wh.events || []).length === 0
                        ? <Badge variant="secondary" className="text-xs">All events</Badge>
                        : (wh.events || []).map(e => <Badge key={e} variant="secondary" className="text-xs">{e}</Badge>)
                      }
                    </div>
                    {wh.last_triggered && (
                      <p className="text-xs text-gray-400">
                        Last delivery: {new Date(wh.last_triggered).toLocaleString()} — HTTP {wh.last_status || '?'}
                        {wh.failure_count > 0 && <span className="text-red-500 ml-1">({wh.failure_count} failures)</span>}
                      </p>
                    )}
                  </div>
                ))}

                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
                  <p className="font-semibold text-orange-800 mb-2">📡 How to connect Zapier</p>
                  <ol className="list-decimal list-inside space-y-1 text-orange-900">
                    <li>In Zapier, create a new Zap and pick <strong>Webhooks by Zapier</strong> → <strong>Catch Hook</strong></li>
                    <li>Copy the webhook URL Zapier gives you</li>
                    <li>Click <strong>Add Webhook</strong> above and paste that URL</li>
                    <li>Click <strong>Test</strong> next to the webhook — Zapier will detect the data</li>
                    <li>Build the rest of your Zap using CompanySync's event fields</li>
                  </ol>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Webhook Dialog */}
          <Dialog open={showWebhookDialog} onOpenChange={setShowWebhookDialog}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingWebhook ? 'Edit Webhook' : 'Add Webhook'}</DialogTitle>
                <DialogDescription>Configure a URL to receive real-time event notifications.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-2">
                <div>
                  <Label className="mb-1 block">Webhook Name</Label>
                  <Input placeholder="e.g. Zapier New Leads" value={webhookForm.name} onChange={e => setWebhookForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label className="mb-1 block">Webhook URL <span className="text-red-500">*</span></Label>
                  <Input placeholder="https://hooks.zapier.com/hooks/catch/..." value={webhookForm.url} onChange={e => setWebhookForm(f => ({ ...f, url: e.target.value }))} />
                  <p className="text-xs text-gray-500 mt-1">Must be a public HTTPS URL. Private/localhost URLs are rejected.</p>
                </div>
                <div>
                  <Label className="mb-2 block">Events to Send <span className="text-gray-400 font-normal">(leave all unchecked to send every event)</span></Label>
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded p-2">
                    {webhookSupportedEvents.map(ev => (
                      <label key={ev} className="flex items-center gap-2 text-sm cursor-pointer p-1 hover:bg-gray-50 rounded">
                        <Checkbox checked={webhookForm.events.includes(ev)} onCheckedChange={() => toggleWebhookEvent(ev)} />
                        <span>{ev.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="mb-1 block">Signing Secret <span className="text-gray-400 font-normal">(optional)</span></Label>
                  <Input type="password" placeholder="Leave blank to skip HMAC signing" value={webhookForm.secret} onChange={e => setWebhookForm(f => ({ ...f, secret: e.target.value }))} />
                  <p className="text-xs text-gray-500 mt-1">If set, each request includes an <code>X-CompanySync-Signature: sha256=…</code> header.</p>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setShowWebhookDialog(false)}>Cancel</Button>
                  <Button onClick={handleSaveWebhook} disabled={savingWebhook}>
                    {savingWebhook ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    {editingWebhook ? 'Save Changes' : 'Add Webhook'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          {isAdmin && (
            <Card>
              <CardHeader className="border-b bg-purple-50">
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-purple-600" />
                  Company-Wide Reminder Defaults
                </CardTitle>
                <p className="text-sm text-gray-500 mt-1">
                   Early reminders are email-only to control SMS costs. The 1-hour reminder can also use SMS.
                </p>
              </CardHeader>
              <CardContent className="p-3 sm:p-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-6 font-semibold text-gray-700">Reminder timing</th>
                        <th className="text-center py-2 px-4 font-semibold text-gray-700">
                          <span className="flex items-center justify-center gap-1">
                            <Mail className="w-4 h-4" /> Email
                          </span>
                        </th>
                        <th className="text-center py-2 px-4 font-semibold text-gray-700">
                          <span className="flex items-center justify-center gap-1">
                            <MessageSquare className="w-4 h-4" /> SMS
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {REMINDER_INTERVALS.map(({ key, label }) => (
                        <tr key={key} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-3 pr-6 text-gray-700">{label}</td>
                          <td className="py-3 px-4 text-center">
                            <Checkbox
                              id={`company-default-email-${key}`}
                              data-testid={`checkbox-company-default-email-${key}`}
                              checked={companyDefaultPrefsEdit[key]?.email !== false}
                              onCheckedChange={() => toggleCompanyDefaultPref(key, 'email')}
                            />
                          </td>
                          <td className="py-3 px-4 text-center">
                            <Checkbox
                              id={`company-default-sms-${key}`}
                              data-testid={`checkbox-company-default-sms-${key}`}
                              checked={key === '60' && companyDefaultPrefsEdit[key]?.sms !== false}
                              disabled={key !== '60'}
                              onCheckedChange={() => toggleCompanyDefaultPref(key, 'sms')}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button
                    data-testid="button-save-company-defaults"
                    onClick={saveCompanyDefaults}
                    disabled={savingCompanyDefaults}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    {savingCompanyDefaults ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                    ) : (
                      <><Building2 className="w-4 h-4 mr-2" />Save Company Defaults</>
                    )}
                  </Button>
                  <span className="text-xs text-gray-500">
                    Staff without personal preferences will use these defaults automatically.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                Appointment Reminder Preferences
              </CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                 Early reminders are email-only. SMS is reserved for the urgent 1-hour reminder.
                {companyReminderSettings?.default_staff_preferences
                  ? ' Defaults to company settings.'
                  : ' Defaults to all on.'}
              </p>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              {!myStaffProfile ? (
                <p className="text-sm text-gray-500">Loading your profile…</p>
              ) : (
                <>
                  {/* Company default notice — shown when the company has custom defaults
                      and this staff member hasn't saved their own preferences yet */}
                  {companyReminderSettings?.default_staff_preferences && !hasPersonalReminderPrefs && (() => {
                    const summary = buildCompanyDefaultSummary(companyReminderSettings.default_staff_preferences);
                    return summary ? (
                      <Alert className="mb-4 bg-blue-50 border-blue-200">
                        <Bell className="w-4 h-4 text-blue-600" />
                        <AlertDescription className="text-blue-900 text-sm">
                          <strong>Your company default:</strong> {summary}.{' '}
                          <span className="text-blue-700">You can override these below — or leave them as-is to inherit the company setting.</span>
                        </AlertDescription>
                      </Alert>
                    ) : null;
                  })()}
                  {/* Adapted notice once the staff member has their own saved prefs */}
                  {companyReminderSettings?.default_staff_preferences && hasPersonalReminderPrefs && (
                    <p className="text-xs text-gray-400 mb-3">
                      You have custom preferences saved. Company defaults no longer apply to you.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-6 font-semibold text-gray-700">Reminder timing</th>
                          <th className="text-center py-2 px-4 font-semibold text-gray-700">
                            <span className="flex items-center justify-center gap-1">
                              <Mail className="w-4 h-4" /> Email
                            </span>
                          </th>
                          <th className="text-center py-2 px-4 font-semibold text-gray-700">
                            <span className="flex items-center justify-center gap-1">
                              <MessageSquare className="w-4 h-4" /> SMS
                            </span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {REMINDER_INTERVALS.map(({ key, label }) => {
                          const companyDefault = companyReminderSettings?.default_staff_preferences?.[key];
                          return (
                          <tr key={key} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="py-3 pr-6">
                              <span className="text-gray-700">{label}</span>
                              {/* Per-row company default hint — only shown when staff hasn't
                                  saved their own prefs, so it remains actionable context */}
                              {companyDefault && !hasPersonalReminderPrefs && (
                                <div className="text-xs text-gray-400 mt-0.5">
                                  Company default: Email {companyDefault.email !== false ? '✓' : '✗'} · SMS {companyDefault.sms !== false ? '✓' : '✗'}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Checkbox
                                id={`reminder-email-${key}`}
                                data-testid={`checkbox-reminder-email-${key}`}
                                checked={reminderPrefs[key]?.email !== false}
                                onCheckedChange={() => toggleReminderPref(key, 'email')}
                              />
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Checkbox
                                id={`reminder-sms-${key}`}
                                data-testid={`checkbox-reminder-sms-${key}`}
                                checked={key === '60' && reminderPrefs[key]?.sms !== false}
                                disabled={key !== '60'}
                                onCheckedChange={() => toggleReminderPref(key, 'sms')}
                              />
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <Button
                      data-testid="button-save-reminder-prefs"
                      onClick={saveReminderPrefs}
                      disabled={savingReminderPrefs}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {savingReminderPrefs ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                      ) : (
                        <><CheckCircle2 className="w-4 h-4 mr-2" />Save Preferences</>
                      )}
                    </Button>
                    <span className="text-xs text-gray-500">
                      Changes take effect on the next scheduled reminder run.
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

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
                        manualSend: true,
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
                        alert('✅ Test email sent successfully!\n\nCheck your inbox at: ' + user?.email + '\n\nIf you don\'t see it in a few minutes, check your spam folder.');
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

        <TabsContent value="color-palettes">
          <Card className="bg-white shadow-md">
            <CardHeader className="border-b bg-gray-50">
              <CardTitle className="flex items-center gap-2 text-base">Color Palettes</CardTitle>
            </CardHeader>
            <CardContent className="p-3 sm:p-6">
              <ColorPaletteSettings />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}