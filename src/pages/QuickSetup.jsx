import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { setLastUsedCompanyId } from "@/lib/activeCompanySelection";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  Building2, 
  Phone, 
  Calendar, 
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Upload,
  Zap,
  MessageSquare,
  DollarSign,
  CreditCard,
  Mail
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import SmartSetupPanel from "@/components/setup/SmartSetupPanel";
import useTranslation from "@/hooks/useTranslation";

const STEPS = [
  { id: 'company', title: 'Company Info', icon: Building2 },
  { id: 'smart', title: 'Smart Fill (AI)', icon: Sparkles },
  { id: 'ai', title: 'AI Assistants', icon: MessageSquare },
  { id: 'integrations', title: 'Integrations', icon: Zap },
  { id: 'done', title: 'Ready!', icon: CheckCircle2 }
];

const asArray = (value) => Array.isArray(value) ? value : [];

export default function QuickSetup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const setupSteps = [
    { ...STEPS[0], title: t.quickSetup.companyInfo },
    { ...STEPS[1], title: t.quickSetup.smartFill },
    { ...STEPS[2], title: t.quickSetup.aiAssistants },
    { ...STEPS[3], title: t.quickSetup.integrations },
    { ...STEPS[4], title: t.quickSetup.ready },
  ];
  const [currentStep, setCurrentStep] = useState(0);
  const [user, setUser] = useState(null);
  
  // Read plan from URL params (from onboarding wizard) or sessionStorage
  const urlParams = new URLSearchParams(window.location.search);
  const urlPlan = urlParams.get('plan');
  const isNewSignup = urlParams.get('new_signup') === 'true';
  const storedPlan = sessionStorage.getItem('selected_plan');
  let storedPlanName = '';
  try {
    storedPlanName = storedPlan ? JSON.parse(storedPlan)?.name?.toLowerCase() : '';
  } catch {
    sessionStorage.removeItem('selected_plan');
  }
  const selectedPlan = ['basic', 'business', 'enterprise', 'professional', 'starter'].includes((urlPlan || '').toLowerCase())
    ? urlPlan.toLowerCase()
    : (['basic', 'business', 'enterprise', 'professional', 'starter'].includes(storedPlanName) ? storedPlanName : 'basic');
  
  // Company step
  const [companyData, setCompanyData] = useState({
    company_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    logo_url: ""
  });
  
  // Twilio step
  const [twilioData, setTwilioData] = useState({
    account_sid: "",
    auth_token: "",
    main_phone_number: ""
  });
  
  // Email step
  const [emailData, setEmailData] = useState({ resend_api_key: '', from_name: '' });
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);

  // AI step
  const [isCompletingSetup, setIsCompletingSetup] = useState(false);
  const [setupError, setSetupError] = useState('');

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date", 100),
    select: asArray,
  });

  const { data: myStaffProfiles = [], isFetched: staffProfilesFetched } = useQuery({
    queryKey: ['quick-setup-staff-profile', user?.email],
    queryFn: () => user?.email
      ? base44.entities.StaffProfile.filter({ user_email: user.email })
      : [],
    enabled: !!user?.email,
    select: asArray,
  });

  const myCompany = useMemo(() => {
    const activeProfile = myStaffProfiles.find(profile => profile?.is_active !== false && profile?.company_id);
    if (!activeProfile) return null;
    return companies.find(company => company.id === activeProfile.company_id) || null;
  }, [myStaffProfiles, companies]);

  const { data: twilioSettings = [] } = useQuery({
    queryKey: ['twilio-settings', myCompany?.id],
    queryFn: async () => {
      if (!myCompany?.id) return [];

      // Quick Setup may only read this member-selected company's own row. Never
      // substitute platform environment credentials or a row from another tenant.
      const rows = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
      return (Array.isArray(rows) ? rows : [])
        .filter(setting => setting?.company_id === myCompany.id)
        .map(setting => {
          const accountSid = String(setting?.account_sid || '').trim();
          const hasRealAccountSid = accountSid.startsWith('AC');
          return {
            ...setting,
            account_sid: hasRealAccountSid ? accountSid : '',
            auth_token: hasRealAccountSid ? String(setting?.auth_token || '') : '',
            main_phone_number: hasRealAccountSid ? String(setting?.main_phone_number || '') : ''
          };
        });
    },
    enabled: !!myCompany,
    select: asArray,
  });

  const { data: assistantSettings = [] } = useQuery({
    queryKey: ['assistant-settings', myCompany?.id],
    queryFn: () => myCompany ? (base44.entities.AssistantSettings?.filter ? base44.entities.AssistantSettings.filter({ company_id: myCompany.id }) : Promise.resolve([])) : [],
    enabled: !!myCompany,
    select: asArray,
  });

  const { data: companyApiKeys = [] } = useQuery({
    queryKey: ['company-api-keys', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CompanyApiKeys.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    select: asArray,
  });

  // Open the wizard on the Smart Fill (AI) step once we know a company already
  // exists (typical: it was created at signup). One-shot — after that the user
  // navigates freely (Back reaches Company Info). Brand-new users with no
  // company still start on Company Info so there's a company to apply to.
  const openedOnSmartRef = useRef(false);
  useEffect(() => {
    if (openedOnSmartRef.current) return;
    if (!user || !myCompany) return;
    openedOnSmartRef.current = true;
    setCurrentStep(s => (s === 0 ? 1 : s));
  }, [user, myCompany]);

  const { data: googleCalendarStatus } = useQuery({
    queryKey: ['quick-setup-google-calendar-status', user?.email],
    queryFn: async () => {
      const result = await base44.functions.invoke('checkUserGoogleCalendarConnection', {});
      return result?.data || { connected: false };
    },
    enabled: !!user?.email,
    retry: false,
  });

  const { data: stripeStatus } = useQuery({
    queryKey: ['quick-setup-stripe-status', myCompany?.id],
    queryFn: async () => {
      const result = await base44.functions.invoke('checkStripeAccountStatus', {});
      return result?.data || { connected: false, onboarding_complete: false };
    },
    enabled: !!myCompany?.stripe_account_id,
    retry: false,
  });

  // Setup can always be accessed (no auto-redirect). Every completion flag is
  // factual; merely visiting or skipping a step never turns it green.
  const hasCompanyInfo = !!(
    String(myCompany?.company_name || '').trim() &&
    String(myCompany?.email || '').trim()
  );
  const hasTwilio = twilioSettings.some(setting =>
    setting?.company_id === myCompany?.id &&
    String(setting?.account_sid || '').trim().startsWith('AC') &&
    !!String(setting?.main_phone_number || '').trim()
  );
  const hasAI = ['lexi', 'sarah'].every(name =>
    assistantSettings.some(setting =>
      setting?.company_id === myCompany?.id &&
      String(setting?.assistant_name || '').toLowerCase() === name
    )
  );
  const hasGoogleCalendar = googleCalendarStatus?.connected === true;
  const hasStripeConnected = stripeStatus
    ? stripeStatus.onboarding_complete === true
    : myCompany?.stripe_onboarding_status === 'complete';

  // Every exit from QuickSetup must update the server and the cache used by
  // Layout/usePageGuard before navigating. Otherwise the next Dashboard render
  // can see the old `false` value and immediately send the user back here.
  const completeSetupAndNavigate = async (destination = 'Dashboard') => {
    if (isCompletingSetup) return;
    if (!user?.email) {
      setSetupError(t.quickSetup.signInRequired);
      return;
    }
    setIsCompletingSetup(true);
    setSetupError('');

    try {
      if (!myCompany?.id || !hasCompanyInfo) {
        throw new Error('Save your company name and email before completing setup.');
      }
      const completedCompany = await base44.entities.Company.update(myCompany.id, {
        setup_completed: true,
        setup_completed_at: new Date().toISOString(),
        onboarding_completed: true
      });

      const completedId = completedCompany?.id || myCompany?.id;
      if (!completedId) throw new Error('Could not determine the company being completed.');

      setLastUsedCompanyId(completedId, user?.email);
      localStorage.setItem('quickSetupCompleted', 'true');

      const patchCompany = (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(company => company.id === completedId
          ? { ...company, onboarding_completed: true, setup_completed: true, setup_completed_at: completedCompany.setup_completed_at }
          : company);
      };
      queryClient.setQueriesData({ queryKey: ['layout-companies-list'] }, patchCompany);
      queryClient.setQueriesData({ queryKey: ['companies'] }, patchCompany);
      queryClient.setQueriesData({ queryKey: ['owned-companies'] }, patchCompany);
      queryClient.setQueriesData({ queryKey: ['owned-companies-hook'] }, patchCompany);
      queryClient.setQueriesData({ queryKey: ['current-company-list'] }, patchCompany);
      queryClient.setQueriesData({ queryKey: ['target-company', completedId] }, (old) =>
        Array.isArray(old) && old.length
          ? [{ ...old[0], onboarding_completed: true, setup_completed: true, setup_completed_at: completedCompany.setup_completed_at }]
          : old);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['layout-companies-list'] }),
        queryClient.invalidateQueries({ queryKey: ['companies'] }),
        queryClient.invalidateQueries({ queryKey: ['owned-companies'] }),
        queryClient.invalidateQueries({ queryKey: ['owned-companies-hook'] }),
        queryClient.invalidateQueries({ queryKey: ['current-company-list'] }),
        queryClient.invalidateQueries({ queryKey: ['current-company-staff'] }),
        queryClient.invalidateQueries({ queryKey: ['target-company', completedId] }),
        queryClient.invalidateQueries({ queryKey: ['my-staff-profile'] }),
      ]);

      navigate(createPageUrl(destination), { replace: true });
    } catch (error) {
      console.error('Could not complete Quick Setup:', error);
      setSetupError(error?.message || 'Setup could not be skipped. Please try again.');
    } finally {
      setIsCompletingSetup(false);
    }
  };
  const hasEmail = emailSaved || (companyApiKeys.length > 0 && !!(companyApiKeys[0]?.resend_api_key || companyApiKeys[0]?.smtp_host));

  // Auto-create company for users coming from onboarding wizard who have no company
  useEffect(() => {
    const autoCreateCompany = async () => {
      if (!user || !staffProfilesFetched) return;
      if (myCompany) return; // Already has a company
      
      const onboardingData = sessionStorage.getItem('onboarding_data');
      if (!onboardingData) return;
      
      try {
        const data = JSON.parse(onboardingData);
        if (!data.company_name) return;
        
        console.log('Auto-creating company from onboarding data:', data);
        
        // Plan the owner picked during onboarding. Subscription/trial fields are
        // NOT written on the company record here — the entity API strips them for
        // tenants. The guarded startCompanyTrial action (called once the owner's
        // staff profile exists) is the only path allowed to set plan/status/trial.
        const plan = data.selected_plan || selectedPlan || 'basic';
        
        // Create the company — stamp browser timezone so cron jobs fire at the right local time.
        const newCompany = await base44.entities.Company.create({
          company_name: data.company_name,
          email: data.email || user.email,
          phone: data.phone || "",
          address: data.address || "",
          city: data.city || "",
          state: data.state || "",
          zip: data.zip || "",
           timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
           settings: { time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York' },
          setup_completed: false
        });
        
        // Create staff profile for owner
        await base44.entities.StaffProfile.create({
          company_id: newCompany.id,
          user_email: user.email,
          full_name: data.full_name || user.full_name || user.email,
          position: 'Owner',
          is_administrator: true,
          is_super_admin: true,
          is_active: true,
          commission_rate: 10,
          can_access_accounting: true
        });
        
        // Start the free trial via the guarded server action (sets plan/status/
        // trial window server-side; direct tenant writes to those fields are stripped).
        const trialRes = await base44.functions.invoke('startCompanyTrial', { companyId: newCompany.id, plan });
        if (trialRes?.error) throw new Error(trialRes.error);
        
        // Clear onboarding data
        sessionStorage.removeItem('onboarding_data');
        
        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['companies'] });
        queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
        
        // Move to next step
        setCurrentStep(1);
        
      } catch (e) {
        console.error('Failed to auto-create company:', e);
      }
    };
    
    autoCreateCompany();
  }, [user, myCompany, staffProfilesFetched, queryClient, selectedPlan]);

  useEffect(() => {
    if (myCompany) {
      setCompanyData({
        company_name: myCompany.company_name || "",
        email: myCompany.email || "",
        phone: myCompany.phone || "",
        address: myCompany.address || "",
        city: myCompany.city || "",
        state: myCompany.state || "",
        zip: myCompany.zip || "",
        logo_url: myCompany.logo_url || ""
      });
    } else if (isNewSignup || sessionStorage.getItem('onboarding_data')) {
      // Pre-fill from onboarding wizard data
      const onboardingData = sessionStorage.getItem('onboarding_data');
      if (onboardingData) {
        try {
          const data = JSON.parse(onboardingData);
          setCompanyData({
            company_name: data.company_name || "",
            email: data.email || user?.email || "",
            phone: data.phone || "",
            address: data.address || "",
            city: data.city || "",
            state: data.state || "",
            zip: data.zip || "",
            logo_url: ""
          });
        } catch (e) {
          console.error('Failed to parse onboarding data', e);
        }
      }
    }
  }, [myCompany, isNewSignup, user]);

  const uploadLogoMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
    onSuccess: (url) => {
      setCompanyData({ ...companyData, logo_url: url });
    }
  });

  const saveCompanyMutation = useMutation({
    mutationFn: async (data) => {
      if (myCompany) {
        return base44.entities.Company.update(myCompany.id, data);
      } else {
        // New company signup. Subscription/trial fields are set server-side by the
        // guarded startCompanyTrial action (direct tenant writes to them are stripped).
        const plan = selectedPlan || 'professional';
        
        const newCompany = await base44.entities.Company.create({
          ...data,
          timezone: (data.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
          setup_completed: false
        });

        // ✅ Create admin staff profile for company owner
        await base44.entities.StaffProfile.create({
          company_id: newCompany.id,
          user_email: user.email,
          full_name: user.full_name || user.email,
          position: 'Owner',
          is_administrator: true,
          is_super_admin: true,
          is_active: true,
          commission_rate: 10,
          can_access_accounting: true
        });

        // Start the free trial via the guarded server action.
        const trialRes = await base44.functions.invoke('startCompanyTrial', { companyId: newCompany.id, plan });
        if (trialRes?.error) throw new Error(trialRes.error);

        return newCompany;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['staff-profiles'] });
      setCurrentStep(1);
    }
  });

  const saveTwilioMutation = useMutation({
    mutationFn: async (data) => {
      if (!String(data.account_sid || '').trim().startsWith('AC')) {
        throw new Error('Enter a valid Twilio Account SID beginning with AC');
      }
      const result = await base44.functions.invoke('autoConfigureTwilioWebhook', {
        companyId: myCompany.id,
        accountSid: data.account_sid,
        authToken: data.auth_token,
        phoneNumber: data.main_phone_number
      });
      if (result?.error || result?.data?.error) {
        throw new Error(result?.data?.error || result?.error);
      }

      // Save settings
      if (twilioSettings[0]) {
        return base44.entities.TwilioSettings.update(twilioSettings[0].id, {
          ...data,
          company_id: myCompany.id
        });
      } else {
        return base44.entities.TwilioSettings.create({
          ...data,
          company_id: myCompany.id,
          enable_sms: true,
          enable_calling: true
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
    },
    onError: (error) => {
      alert('❌ Twilio setup failed: ' + error.message);
    }
  });

  const saveEmailMutation = useMutation({
    mutationFn: async (data) => {
      if (!myCompany) throw new Error('No company found');
      const resp = await fetch('/api/local/save-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'email',
          keys: { mode: 'resend', resend_api_key: data.resend_api_key },
          company_id: myCompany.id
        })
      });
      const result = await resp.json();
      if (!result.success) throw new Error(result.error || 'Failed to save email settings');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-api-keys'] });
      setEmailSaved(true);
    },
    onError: (error) => {
      alert('❌ Email setup failed: ' + error.message);
    }
  });

  const setupAIMutation = useMutation({
    mutationFn: async () => {
      if (!myCompany?.id) throw new Error('Your company is still loading. Please try again.');
      const companyId = myCompany.id;

      // If Smart Fill parsed business hours before the assistants existed, pick
      // them up now so after-hours AI behavior starts correct from day one.
      let smartHours = null;
      try {
        const raw = sessionStorage.getItem('smart_setup_hours');
        if (raw) smartHours = JSON.parse(raw);
      } catch { /* ignore bad JSON */ }
      const schedulingDefaults = smartHours ? { scheduling_defaults: smartHours } : {};

      const assistantFor = (name) => assistantSettings.find(
      setting => String(setting?.assistant_name || '').toLowerCase() === name
      );

      // Setup may be retried after a partial network failure. Preserve existing
      // rows exactly and only create the assistant that is still missing.
      if (!assistantFor('lexi')) {
        await base44.entities.AssistantSettings.create({
          company_id: companyId,
          assistant_name: 'lexi',
          engine: 'gemini-2.0-flash-exp',
          voice_enabled: true,
          google_voice_name: 'en-US-Neural2-F',
          voice_speaking_rate: 1.05,
          system_prompt: `You are Lexi, a helpful AI assistant for ${companyData.company_name || 'the company'}. Be friendly, professional, and efficient.`,
          ...schedulingDefaults
        });
      }

      // Create Alex settings with smart defaults
      const sarahPrompt = `Role: You are Alex, the Lead Qualifier and Office Manager for ${companyData.company_name || 'the company'}. You help our team manage customer inquiries and scheduling.

Personality: Professional, empathetic, and responsive. Customers often have concerns about their needs; acknowledge their situation before asking for details. Never say "I am an AI."

Voice Guidelines:
• Be Human: Use phrases like "I'd be happy to help with that" or "I understand your concern."
• Be Concise: Keep spoken responses under 25 words so it feels natural over the phone.
• Be Professional: Represent the company with warmth and confidence.

The Goal: Understand the customer's needs, establish urgency when relevant, and offer scheduling.

The Qualification Process:
• Listen for the main issue and acknowledge it
• Ask clarifying questions to understand their situation
• Once you have the key details, say: "I'm sending a link to your phone now so you can grab a time on our calendar for a free consultation."`;

      if (!assistantFor('sarah')) {
        await base44.entities.AssistantSettings.create({
          company_id: companyId,
          assistant_name: 'sarah',
          engine: 'gemini-2.0-flash-exp',
          voice_enabled: true,
          google_voice_name: 'en-US-Neural2-H',
          voice_speaking_rate: 1.0,
          brand_short_name: companyData.company_name || 'our company',
          calendly_booking_url: '',
          system_prompt: sarahPrompt,
          ...schedulingDefaults
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assistant-settings'] });
      setCurrentStep(3);
    }
  });

  const handleGoogleConnect = async () => {
    try {
      const result = await base44.functions.invoke('connectUserGoogleCalendar', { return_to: '/QuickSetup' });
      if (result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      } else if (result.data?.error) {
        alert('❌ ' + result.data.error);
      } else {
        alert('❌ Connection failed. Please make sure the Google Calendar app connector is authorized.');
      }
    } catch (error) {
      console.error('Connection error:', error);
      alert('❌ Failed to connect: ' + error.message);
    }
  };

  // QuickBooks connection status (for the Integrations step)
  const { data: qbStatus } = useQuery({
    queryKey: ['quickbooks-status', myCompany?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkQuickBooksConnection', {});
      return res?.data || { connected: false };
    },
    enabled: !!myCompany,
  });
  const hasQuickBooks = qbStatus?.connected === true;

  const handleQuickBooksConnect = async () => {
    try {
      const result = await base44.functions.invoke('connectQuickBooks', {});
      if (result?.data?.authUrl) {
        window.location.href = result.data.authUrl;
      } else {
        alert('❌ ' + (result?.data?.error || result?.error || 'QuickBooks connection is not available right now.'));
      }
    } catch (error) {
      alert('❌ Failed to connect QuickBooks: ' + error.message);
    }
  };

  const progress = ((currentStep + 1) / STEPS.length) * 100;
  const stepCompletion = [
    hasCompanyInfo,
    currentStep > 1,
    hasAI,
    hasTwilio && hasGoogleCalendar && hasStripeConnected,
    hasCompanyInfo && myCompany?.setup_completed === true,
  ];

  const handleNext = () => {
    if (currentStep === 0) {
      if (!companyData.company_name || !companyData.email) {
        alert(t.quickSetup.companyRequired);
        return;
      }
      saveCompanyMutation.mutate(companyData);
    } else if (currentStep === 1) {
      // Smart Fill is optional — applying happens inside the panel itself.
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (hasAI) {
        setCurrentStep(3);
      } else {
        setupAIMutation.mutate();
      }
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep(step => Math.max(0, step - 1));
  };

  const handleSkip = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Zap className="w-8 h-8 text-white" />
          </div>
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">{isNewSignup ? `🎉 ${t.quickSetup.welcome}` : t.quickSetup.title}</h1>
        <p className="text-gray-600">{isNewSignup ? t.quickSetup.trialStarted : t.quickSetup.subtitle}</p>
          {isNewSignup && (
            <div className="mt-4 inline-flex items-center gap-2 bg-green-100 border border-green-300 text-green-800 rounded-full px-4 py-1.5 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> {t.quickSetup.accountCreated}
            </div>
          )}
          
          <Button
            variant="outline"
              onClick={() => {
                if (hasCompanyInfo) {
                  completeSetupAndNavigate();
                } else {
                  navigate(createPageUrl('Dashboard'));
                }
              }}
             disabled={isCompletingSetup}
             data-testid="button-skip-setup"
             className="mt-4"
          >
             {t.quickSetup.finishLater}
          </Button>
           {setupError && (
             <Alert variant="destructive" className="mt-4 text-left">
               <AlertDescription>{setupError}</AlertDescription>
             </Alert>
           )}
          
          {/* Show selected plan */}
          {myCompany?.subscription_plan && 
           myCompany.subscription_status === 'trial' && 
           myCompany.id !== 'companysync_master_001' &&
           
           !myCompany.company_name?.includes('Insurance Claims Network') && (
            <div className="mt-4">
              <Badge className="text-lg px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white">
                 ✨ {myCompany.subscription_plan.charAt(0).toUpperCase() + myCompany.subscription_plan.slice(1)} {t.quickSetup.plan} - {t.quickSetup.freeTrial}
              </Badge>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-3">
             {setupSteps.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx === currentStep;
              const isComplete = stepCompletion[idx];
              
              return (
                <div key={step.id} className="flex flex-col items-center flex-1">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-all ${
                    isComplete ? 'bg-green-500 text-white' : 
                    isActive ? 'bg-blue-600 text-white ring-4 ring-blue-200' : 
                    'bg-gray-200 text-gray-400'
                  }`}>
                    {isComplete ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <p className={`text-xs font-medium ${isActive ? 'text-blue-600' : isComplete ? 'text-green-600' : 'text-gray-400'}`}>
                    {step.title}
                  </p>
                </div>
              );
            })}
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Step Content */}
        <Card className="shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              {(() => {
                 const Icon = setupSteps[currentStep].icon;
                return <Icon className="w-6 h-6 text-blue-600" />;
              })()}
               {setupSteps[currentStep].title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 0: Company Info */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>5 {t.quickSetup.minutes}</strong> - {t.quickSetup.basicCompanyInfo}
                  </AlertDescription>
                </Alert>

                <div>
                  <Label>{t.quickSetup.companyName} *</Label>
                  <Input
                    placeholder="ABC Roofing Company"
                    value={companyData.company_name}
                    onChange={(e) => setCompanyData({ ...companyData, company_name: e.target.value })}
                  />
                </div>

                <div>
                  <Label>{t.quickSetup.email} *</Label>
                  <Input
                    type="email"
                    placeholder="info@yourcompany.com"
                    value={companyData.email}
                    onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                  />
                </div>

                <div>
                  <Label>{t.quickSetup.phoneNumber}</Label>
                  <Input
                    placeholder="(555) 123-4567"
                    value={companyData.phone}
                    onChange={(e) => setCompanyData({ ...companyData, phone: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t.quickSetup.city}</Label>
                    <Input
                      placeholder="Dallas"
                      value={companyData.city}
                      onChange={(e) => setCompanyData({ ...companyData, city: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t.quickSetup.state}</Label>
                    <Input
                      placeholder="TX"
                      value={companyData.state}
                      onChange={(e) => setCompanyData({ ...companyData, state: e.target.value })}
                      maxLength={2}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t.quickSetup.companyLogoOptional}</Label>
                  <div className="mt-2 flex items-center gap-4">
                    {companyData.logo_url && (
                      <img src={companyData.logo_url} alt="Logo" className="w-20 h-20 object-contain border rounded" />
                    )}
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const url = await uploadLogoMutation.mutateAsync(file);
                          }
                        }}
                        className="hidden"
                        id="logo-upload"
                      />
                      <label htmlFor="logo-upload">
                        <Button type="button" variant="outline" asChild disabled={uploadLogoMutation.isPending}>
                          <span className="cursor-pointer">
                            <Upload className="w-4 h-4 mr-2" />
                            {uploadLogoMutation.isPending ? t.quickSetup.uploading : t.quickSetup.uploadLogo}
                          </span>
                        </Button>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: Smart Fill with AI */}
            {currentStep >= 1 && (
              <div hidden={currentStep !== 1}>
                <SmartSetupPanel
                  user={user}
                  myCompany={myCompany}
                  assistantSettings={assistantSettings}
                  onApplied={() => setCurrentStep(2)}
                />
              </div>
            )}

            {/* Step 3: Integrations (consolidated, all optional) */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    🔌 {t.quickSetup.connectAccounts}
                  </AlertDescription>
                </Alert>

                {/* Twilio */}
                <details className="border rounded-lg bg-white" data-testid="card-integration-twilio" autoComplete="off">
                  <summary className="cursor-pointer select-none p-4 flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Phone className="w-4 h-4 text-purple-600" /> {t.quickSetup.phoneSms}</span>
                    {hasTwilio
                      ? <Badge className="bg-green-100 text-green-700 border-green-300">✓ {t.quickSetup.connected}</Badge>
                      : <Badge variant="outline" className="text-gray-500">{t.quickSetup.notConnected}</Badge>}
                  </summary>
                  <div className="px-4 pb-4 space-y-4">
                {hasTwilio ? (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      ✅ Twilio is already configured! You can skip this step.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <form
                    autoComplete="off"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveTwilioMutation.mutate(twilioData);
                    }}
                    className="space-y-4"
                  >
                    <Alert className="bg-purple-50 border-purple-200">
                      <Phone className="w-4 h-4 text-purple-600" />
                      <AlertDescription className="text-purple-900">
                        <strong>Need a Twilio account?</strong>{" "}
                        <a href="https://www.twilio.com/try-twilio" target="_blank" className="underline font-medium">
                          Sign up for free
                        </a>
                        {" "}(you'll get $15 trial credit)
                      </AlertDescription>
                    </Alert>

                    <div>
                      <Label>Account SID *</Label>
                      <Input
                        name="twilio_account_sid"
                        autoComplete="off"
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={twilioData.account_sid}
                        onChange={(e) => setTwilioData({ ...twilioData, account_sid: e.target.value })}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Find this in your{" "}
                        <a href="https://console.twilio.com/" target="_blank" className="underline">
                          Twilio Console
                        </a>
                      </p>
                    </div>

                    <div>
                      <Label>Auth Token *</Label>
                      <Input
                        name="twilio_auth_token"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Your Auth Token"
                        value={twilioData.auth_token}
                        onChange={(e) => setTwilioData({ ...twilioData, auth_token: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label>Phone Number *</Label>
                      <Input
                        name="twilio_phone_number"
                        autoComplete="off"
                        placeholder="+1 (555) 123-4567"
                        value={twilioData.main_phone_number}
                        onChange={(e) => setTwilioData({ ...twilioData, main_phone_number: e.target.value })}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Purchase a number from{" "}
                        <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" className="underline">
                          Twilio Phone Numbers
                        </a>
                      </p>
                    </div>

                    <Alert className="bg-green-50 border-green-200">
                      <Zap className="w-4 h-4 text-green-600" />
                      <AlertDescription className="text-green-900">
                        <strong>✨ Auto-Configuration:</strong> When you click "Next", we'll automatically configure your Twilio webhooks. No manual setup required!
                      </AlertDescription>
                    </Alert>

                    <Alert className="bg-yellow-50 border-yellow-200">
                      <MessageSquare className="w-4 h-4 text-yellow-600" />
                      <AlertDescription className="text-yellow-900">
                        <strong>⚠️ SMS Approval Required:</strong> To send SMS messages, you'll need to register your business with Twilio's A2P 10DLC program. The video below walks you through this process.
                      </AlertDescription>
                    </Alert>

                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                        🎬 Video Tutorial: Complete Twilio Setup
                      </h4>
                      <p className="text-xs text-gray-600 mb-3">
                        Watch this step-by-step guide covering account creation, phone number purchase, webhook configuration, and A2P SMS approval.
                      </p>
                      <div className="w-full rounded-lg overflow-hidden mb-3 bg-black" style={{ aspectRatio: '16/9' }}>
                        <video
                          width="100%"
                          height="100%"
                          controls
                          preload="metadata"
                          style={{ width: '100%', height: '100%', display: 'block' }}
                        >
                          <source
                            src="/uploads/twilio-tutorial-f829fe1f-9d67-4240-97b4-ab6fb00e94e0.mp4"
                            type="video/mp4"
                          />
                          Your browser does not support video playback.
                        </video>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => window.open('https://www.twilio.com/en-us/sms/features/a2p-10dlc', '_blank')}
                      >
                        📋 Learn More About A2P 10DLC on Twilio's Site
                      </Button>
                    </div>

                    <Button
                      type="submit"
                      disabled={!twilioData.account_sid || !twilioData.auth_token || !twilioData.main_phone_number || saveTwilioMutation.isPending}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      data-testid="button-save-twilio"
                    >
                      {saveTwilioMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Connecting…</> : 'Save & Connect Twilio'}
                    </Button>
                  </form>
                )}
                  </div>
                </details>

                {/* Custom email delivery */}
                <details className="border rounded-lg bg-white" data-testid="card-integration-email">
                  <summary className="cursor-pointer select-none p-4 flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Mail className="w-4 h-4 text-blue-600" /> Custom email delivery</span>
                    {hasEmail
                      ? <Badge className="bg-green-100 text-green-700 border-green-300">✓ Your domain connected</Badge>
                      : <Badge variant="outline" className="text-blue-600 border-blue-300">Available · custom domain optional</Badge>}
                  </summary>
                  <div className="px-4 pb-4 space-y-4">
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-900">
                    ✅ <strong>Email already works!</strong> During your trial, estimates, invoices, and follow-ups are sent automatically through CompanySync — no setup needed.
                  </AlertDescription>
                </Alert>

                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span>Estimates & invoices emailed to customers</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span>Automated follow-up sequences</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                    <span>Payment receipts and reminders</span>
                  </div>
                </div>

                {!hasEmail && (
                  <details className="border rounded-lg p-4">
                    <summary className="cursor-pointer font-medium text-sm text-gray-700 select-none">
                      ⚙️ Optional: Use your own email domain (sends as <em>you@yourcompany.com</em>)
                    </summary>
                    <div className="mt-4 space-y-3">
                      <p className="text-sm text-gray-600">
                        Connect the email provider configured for your account to send from your own branded domain instead of CompanySync&apos;s address.
                      </p>
                      <div>
                        <Label>Email Provider API Key</Label>
                        <Input
                          type="password"
                          placeholder="Your provider API key"
                          value={emailData.resend_api_key}
                          onChange={(e) => setEmailData({ ...emailData, resend_api_key: e.target.value })}
                        />
                      </div>
                      {emailData.resend_api_key && (
                        <button
                          type="button"
                          disabled={emailTesting}
                          onClick={async () => {
                            if (!user?.email) return;
                            setEmailTesting(true);
                            try {
                              const resp = await fetch('/api/local/test-api-key', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ service: 'email', keys: { mode: 'resend', resend_api_key: emailData.resend_api_key }, company_id: myCompany?.id })
                              });
                              const result = await resp.json();
                              if (result.success) {
                                alert(`✅ Email test passed! Check ${user.email} for a test message.`);
                              } else {
                                alert('❌ Test failed: ' + (result.message || result.error || 'Unknown error'));
                              }
                            } catch (e) {
                              alert('❌ Test error: ' + e.message);
                            } finally {
                              setEmailTesting(false);
                            }
                          }}
                          className="text-sm text-blue-600 underline disabled:opacity-50"
                        >
                          {emailTesting ? 'Testing...' : 'Send a test email to verify'}
                        </button>
                      )}
                    </div>
                  </details>
                )}

                {!hasEmail && emailData.resend_api_key && (
                  <Button
                    onClick={() => saveEmailMutation.mutate(emailData)}
                    disabled={saveEmailMutation.isPending}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    data-testid="button-save-email"
                  >
                    {saveEmailMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : 'Save Email Settings'}
                  </Button>
                )}

                {hasEmail && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-blue-900">
                      🎉 Your custom email provider is connected — emails go out from your domain.
                    </AlertDescription>
                  </Alert>
                )}
                  </div>
                </details>

                {/* Google Calendar */}
                <details className="border rounded-lg bg-white" data-testid="card-integration-calendar">
                  <summary className="cursor-pointer select-none p-4 flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><Calendar className="w-4 h-4 text-blue-600" /> Google Calendar</span>
                    {hasGoogleCalendar
                      ? <Badge className="bg-green-100 text-green-700 border-green-300">✓ Connected</Badge>
                      : <Badge variant="outline" className="text-gray-500">Not connected</Badge>}
                  </summary>
                  <div className="px-4 pb-4 space-y-4">
                {hasGoogleCalendar ? (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      ✅ Google Calendar is connected! Events will sync automatically.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="text-center py-8">
                      <Calendar className="w-16 h-16 text-blue-600 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Sync with Google Calendar</h3>
                      <p className="text-gray-600 mb-6">
                        Two-way sync keeps your CRM and Google Calendar in perfect sync
                      </p>
                      <Button onClick={handleGoogleConnect} className="bg-blue-600 hover:bg-blue-700">
                        <Calendar className="w-4 h-4 mr-2" />
                        Connect Google Calendar
                      </Button>
                    </div>

                    <Alert>
                      <AlertDescription>
                        <strong>What happens next:</strong> Your calendar will be connected instantly using the app connector.
                      </AlertDescription>
                    </Alert>
                  </>
                )}
                  </div>
                </details>

                {/* Stripe Payments */}
                <details className="border rounded-lg bg-white" data-testid="card-integration-stripe">
                  <summary className="cursor-pointer select-none p-4 flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-green-600" /> Accept Payments (Stripe)</span>
                    {hasStripeConnected
                      ? <Badge className="bg-green-100 text-green-700 border-green-300">✓ Connected</Badge>
                      : <Badge variant="outline" className="text-gray-500">Not connected</Badge>}
                  </summary>
                  <div className="px-4 pb-4 space-y-4">
                {hasStripeConnected ? (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      ✅ Payment processing is enabled! You can accept credit cards, Apple Pay, and ACH.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="text-center py-8">
                      <CreditCard className="w-16 h-16 text-green-600 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold mb-2">Accept Instant Payments</h3>
                      <p className="text-gray-600 mb-6">
                        Get paid automatically when crews upload completion photos
                      </p>
                      <Button 
                        onClick={async () => {
                          const result = await base44.functions.invoke('createConnectedAccount', { return_to: '/QuickSetup' });
                          if (result.data?.onboarding_url) {
                            window.location.href = result.data.onboarding_url;
                          }
                        }} 
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CreditCard className="w-4 h-4 mr-2" />
                        Connect Stripe Account
                      </Button>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span>Auto-invoice with completion photos</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span>Next-day funding to your bank</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span>2.5% platform fee + Stripe fees</span>
                      </div>
                    </div>
                  </>
                )}
                  </div>
                </details>

                {/* QuickBooks */}
                <details className="border rounded-lg bg-white" data-testid="card-integration-quickbooks">
                  <summary className="cursor-pointer select-none p-4 flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4 text-emerald-600" /> QuickBooks Accounting</span>
                    {hasQuickBooks
                      ? <Badge className="bg-green-100 text-green-700 border-green-300">✓ Connected</Badge>
                      : <Badge variant="outline" className="text-gray-500">Not connected</Badge>}
                  </summary>
                  <div className="px-4 pb-4 space-y-4">
                    {hasQuickBooks ? (
                      <Alert className="bg-green-50 border-green-200">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <AlertDescription className="text-green-900">
                          ✅ QuickBooks is connected{qbStatus?.company_name ? ` to ${qbStatus.company_name}` : ''}! Invoices and payments will sync automatically.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <div className="text-center py-6">
                          <DollarSign className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
                          <h3 className="text-lg font-semibold mb-2">Sync with QuickBooks</h3>
                          <p className="text-gray-600 mb-6">
                            Keep your books current — invoices and payments sync to QuickBooks Online automatically
                          </p>
                          <Button onClick={handleQuickBooksConnect} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-connect-quickbooks">
                            <DollarSign className="w-4 h-4 mr-2" />
                            Connect QuickBooks
                          </Button>
                        </div>
                        <Alert>
                          <AlertDescription>
                            <strong>What happens next:</strong> You'll sign in to Intuit, approve access, and land right back here.
                          </AlertDescription>
                        </Alert>
                      </>
                    )}
                  </div>
                </details>
              </div>
            )}

            {/* Step 2: AI Assistants */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>3 minutes</strong> - Activate your AI assistants with recommended settings
                  </AlertDescription>
                </Alert>

                {hasAI ? (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      ✅ AI Assistants are already configured!
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Card className="bg-gradient-to-br from-purple-50 to-blue-50 border-purple-200">
                        <CardContent className="p-4">
                          <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-3">
                            <Sparkles className="w-6 h-6 text-purple-600" />
                          </div>
                          <h3 className="font-bold text-lg mb-2">Lexi AI</h3>
                          <p className="text-sm text-gray-600">
                            Internal assistant for your team. Helps with CRM tasks, data lookup, and automation.
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="bg-gradient-to-br from-pink-50 to-purple-50 border-pink-200">
                        <CardContent className="p-4">
                          <div className="w-12 h-12 rounded-full bg-pink-100 flex items-center justify-center mb-3">
                            <MessageSquare className="w-6 h-6 text-pink-600" />
                          </div>
                          <h3 className="font-bold text-lg mb-2">Alex AI</h3>
                          <p className="text-sm text-gray-600">
                            Customer-facing assistant. Handles SMS/calls, qualifies leads, books appointments.
                          </p>
                        </CardContent>
                      </Card>
                    </div>

                    <Alert className="bg-green-50 border-green-200">
                      <Zap className="w-4 h-4 text-green-600" />
                      <AlertDescription className="text-green-900">
                        <strong>✨ Smart Defaults:</strong> We'll configure both assistants with recommended settings. You can customize them later in Settings.
                      </AlertDescription>
                    </Alert>

                  </>
                )}
              </div>
            )}

            {/* Step 4: Done */}
            {currentStep === 4 && (
              <div className="space-y-4 text-center py-8">
                <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">🎉 You're All Set!</h2>
                <p className="text-gray-600 max-w-md mx-auto mb-2">
                  Your CRM is ready to use. Start adding customers, creating estimates, and managing your business!
                </p>
                <Badge className="bg-green-100 text-green-800 border-green-300">
                  ✨ 14-Day Free Trial Active
                </Badge>

                <div className="grid md:grid-cols-3 gap-4 mt-8 text-left">
                  <Card className="bg-blue-50 border-blue-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(createPageUrl('Customers'))}>
                    <CardContent className="p-4">
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-blue-600" />
                        Add Customers
                      </h3>
                      <p className="text-sm text-gray-600">Import or create your first customer</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-purple-50 border-purple-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(createPageUrl('StaffManagement'))}>
                    <CardContent className="p-4">
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-purple-600" />
                        Invite Team
                      </h3>
                      <p className="text-sm text-gray-600">Add your staff members</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-green-50 border-green-200 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(createPageUrl('AIAssistant'))}>
                    <CardContent className="p-4">
                      <h3 className="font-semibold mb-2 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-green-600" />
                        Try Lexi AI
                      </h3>
                      <p className="text-sm text-gray-600">Chat with your AI assistant</p>
                    </CardContent>
                  </Card>
                </div>

                <Button
                  onClick={() => completeSetupAndNavigate()}
                  disabled={isCompletingSetup}
                  data-testid="button-go-dashboard"
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 mt-6"
                >
                  {isCompletingSetup ? 'Saving...' : 'Go to Dashboard'}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button
                  onClick={() => completeSetupAndNavigate('AIEstimator')}
                  disabled={isCompletingSetup}
                  data-testid="button-go-ai-estimator"
                  size="lg"
                  variant="outline"
                  className="mt-3"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Open AI Estimator
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
            data-testid="button-quick-setup-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t.quickSetup.back}
          </Button>

          <div className="flex gap-2">
            {currentStep < STEPS.length - 1 && currentStep !== 2 && (
                <Button
                  variant="ghost"
                  onClick={handleSkip}
                >
                  {t.quickSetup.skip}
                </Button>
              )}
            {currentStep < STEPS.length - 1 && (
              <Button
                onClick={handleNext}
                disabled={saveCompanyMutation.isPending || saveTwilioMutation.isPending || setupAIMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
                data-testid={currentStep === 2 ? "button-activate-ai-continue" : undefined}
              >
                {saveCompanyMutation.isPending || saveTwilioMutation.isPending || setupAIMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t.quickSetup.settingUp}
                  </>
                ) : (
                  <>
                    {currentStep === 2
                      ? (hasAI ? t.quickSetup.continue : t.quickSetup.activateAIContinue)
                      : t.quickSetup.next}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Setup Summary */}
        <div className="mt-8 p-4 bg-white/60 rounded-lg">
          <h3 className="font-semibold mb-3 text-sm text-gray-700">{t.quickSetup.setupProgress}</h3>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-xs">
            <div className={`p-2 rounded ${hasCompanyInfo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasCompanyInfo ? '✅' : '○'} {t.quickSetup.company}
            </div>
            <div className={`p-2 rounded ${hasTwilio ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasTwilio ? '✅' : '○'} {t.quickSetup.phone}
            </div>
            <div className={`p-2 rounded ${hasEmail ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasEmail ? '✅' : '○'} {t.quickSetup.email}
            </div>
            <div className={`p-2 rounded ${hasGoogleCalendar ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasGoogleCalendar ? '✅' : '○'} {t.quickSetup.calendar}
            </div>
            <div className={`p-2 rounded ${hasStripeConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasStripeConnected ? '✅' : '○'} {t.quickSetup.payments}
            </div>
            <div className={`p-2 rounded ${hasAI ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasAI ? '✅' : '○'} {t.quickSetup.ai}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}