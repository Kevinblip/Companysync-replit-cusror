import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
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
  Cloud,
  ArrowRight,
  ArrowLeft,
  Upload,
  Zap,
  MessageSquare,
  DollarSign,
  CreditCard
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

const STEPS = [
  { id: 'company', title: 'Company Info', icon: Building2 },
  { id: 'twilio', title: 'Phone & SMS', icon: Phone },
  { id: 'calendar', title: 'Google Calendar', icon: Calendar },
  { id: 'payments', title: 'Accept Payments', icon: DollarSign },
  { id: 'ai', title: 'AI Assistants', icon: Sparkles },
  { id: 'done', title: 'Ready!', icon: CheckCircle2 }
];

export default function QuickSetup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [user, setUser] = useState(null);
  
  // Read plan from URL params (from onboarding wizard) or sessionStorage
  const urlParams = new URLSearchParams(window.location.search);
  const urlPlan = urlParams.get('plan');
  const isNewSignup = urlParams.get('new_signup') === 'true';
  const storedPlan = sessionStorage.getItem('selected_plan');
  const selectedPlan = urlPlan || (storedPlan ? JSON.parse(storedPlan)?.name?.toLowerCase() : 'professional');
  
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
  
  // AI step
  const [skipAI, setSkipAI] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date", 100),
    initialData: [],
  });

  const myCompany = useMemo(() => {
    if (!user) return null;
    return companies.find(c => c.created_by === user.email);
  }, [user, companies]);

  const { data: twilioSettings = [] } = useQuery({
    queryKey: ['twilio-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TwilioSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: assistantSettings = [] } = useQuery({
    queryKey: ['assistant-settings', myCompany?.id],
    queryFn: () => myCompany ? (base44.entities.AssistantSettings?.filter ? base44.entities.AssistantSettings.filter({ company_id: myCompany.id }) : Promise.resolve([])) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Setup can always be accessed (no auto-redirect)
  const hasTwilio = twilioSettings.length > 0;
  const hasAI = assistantSettings.length > 0;
  const hasGoogleCalendar = user?.google_calendar_connected === true;
  const hasStripeConnected = myCompany?.stripe_onboarding_status === 'complete';

  // Auto-create company for users coming from onboarding wizard who have no company
  useEffect(() => {
    const autoCreateCompany = async () => {
      if (!user) return;
      if (myCompany) return; // Already has a company
      
      const onboardingData = sessionStorage.getItem('onboarding_data');
      if (!onboardingData) return;
      
      try {
        const data = JSON.parse(onboardingData);
        if (!data.company_name) return;
        
        console.log('Auto-creating company from onboarding data:', data);
        
        // Calculate trial end date
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14);
        
        // Get plan limits - MUST match Pricing page: Basic=$59, Business=$149, Enterprise=$299
        const plan = data.selected_plan || selectedPlan || 'basic';
        const planLimits = {
          basic:        { max_users: 5,  max_customers: 100 },
          business:     { max_users: 10, max_customers: 1000 },
          enterprise:   { max_users: 25, max_customers: 999999 },
          // Legacy aliases
          freelance:    { max_users: 5,  max_customers: 100 },
          starter:      { max_users: 5,  max_customers: 100 },
          professional: { max_users: 10, max_customers: 1000 },
        };
        const limits = planLimits[plan] || planLimits.basic;
        
        // Create the company
        const newCompany = await base44.entities.Company.create({
          company_name: data.company_name,
          email: data.email || user.email,
          phone: data.phone || "",
          address: data.address || "",
          city: data.city || "",
          state: data.state || "",
          zip: data.zip || "",
          subscription_plan: plan,
          subscription_status: 'trial',
          trial_ends_at: trialEndDate.toISOString().split('T')[0],
          max_users: limits.max_users,
          max_customers: limits.max_customers,
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
  }, [user, myCompany, queryClient, selectedPlan]);

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
        // New company signup - start 14-day free trial with selected plan
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14);
        
        // Calculate limits based on selected plan - MUST match Pricing page
        const planLimits = {
          basic:        { max_users: 5,  max_customers: 100 },
          business:     { max_users: 10, max_customers: 1000 },
          enterprise:   { max_users: 25, max_customers: 999999 },
          freelance:    { max_users: 5,  max_customers: 100 },
          starter:      { max_users: 5,  max_customers: 100 },
          professional: { max_users: 10, max_customers: 1000 },
        };
        const limits = planLimits[selectedPlan] || planLimits.basic;
        
        const newCompany = await base44.entities.Company.create({
          ...data,
          subscription_plan: selectedPlan || 'professional',
          subscription_status: 'trial',
          trial_ends_at: trialEndDate.toISOString().split('T')[0],
          max_users: limits.max_users,
          max_customers: limits.max_customers,
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
      // Auto-configure webhooks
      const result = await base44.functions.invoke('autoConfigureTwilioWebhook', {
        accountSid: data.account_sid,
        authToken: data.auth_token,
        phoneNumber: data.main_phone_number
      });

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
      setCurrentStep(2);
    },
    onError: (error) => {
      alert('❌ Twilio setup failed: ' + error.message);
    }
  });

  const setupAIMutation = useMutation({
    mutationFn: async () => {
      const companyId = myCompany.id;
      
      // Create Lexi settings with smart defaults
      await base44.entities.AssistantSettings.create({
        company_id: companyId,
        assistant_name: 'lexi',
        engine: 'gemini-2.0-flash-exp',
        voice_enabled: true,
        google_voice_name: 'en-US-Neural2-F',
        voice_speaking_rate: 1.05,
        system_prompt: `You are Lexi, a helpful AI assistant for ${companyData.company_name || 'the company'}. Be friendly, professional, and efficient.`
      });

      // Create Sarah settings with smart defaults
      const isCompanySync = companyData.company_name?.toUpperCase().includes('COMPANYSYNC');
      
      const sarahPrompt = isCompanySync 
        ? `Role: You are Sarah, the Lead Qualifier and Office Manager for ${companyData.company_name}. You help manage property inspections and customer inquiries.

Personality: Professional, empathetic, and urgent. Customers are often stressed; acknowledge their situation before asking for data. Never say "I am an AI."

Voice Guidelines:
• Be Human: Use phrases like "I'd be happy to help with that" or "I'm so sorry to hear about that."
• Be Concise: Keep spoken responses under 25 words so it feels natural over the phone.

The Goal: Qualify the lead and offer a free consultation.

The Triage Process:
• If they mention a leak, ask: "Is water getting inside the home right now?"
• If it's storm damage, ask: "When did the storm hit, and have you called your insurance yet?"
• Once urgency is established, say: "I'm sending a link to your phone now so you can grab a time on Kevin's calendar for a free inspection."`
        : isCompanySync
        ? `Role: You are Sarah, the Lead Qualifier and Office Manager for CompanySync. You help teams manage customer inquiries, support tickets, and scheduling through our platform.

Personality: Professional, helpful, and efficient. Customers are using CompanySync to manage their business; help them succeed. Never say "I am an AI."

Voice Guidelines:
• Be Human: Use phrases like "I'd be happy to help with that" or "Let me assist you with that."
• Be Concise: Keep spoken responses under 25 words so it feels natural over the phone.
• Be Knowledgeable: Understand our platform features and guide users effectively.

The Goal: Understand customer needs and connect them with the right resources.

The Support Process:
• Listen to their inquiry and acknowledge it
• Ask clarifying questions to understand their situation
• If it's a sales inquiry, say: "I'm sending you a link to schedule a demo with our team."
• If it's support, say: "I'm connecting you with our support team who can help right away."`
        : `Role: You are Sarah, the Lead Qualifier and Office Manager for ${companyData.company_name || 'the company'}. You help our team manage customer inquiries and scheduling.

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

      await base44.entities.AssistantSettings.create({
        company_id: companyId,
        assistant_name: 'sarah',
        engine: 'gemini-2.0-flash-exp',
        voice_enabled: true,
        google_voice_name: 'en-US-Neural2-H',
        voice_speaking_rate: 1.0,
        brand_short_name: companyData.company_name || 'our company',
        calendly_booking_url: '',
        system_prompt: sarahPrompt
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assistant-settings'] });
      setCurrentStep(4);
    }
  });

  const handleGoogleConnect = async () => {
    try {
      const result = await base44.functions.invoke('connectUserGoogleCalendar', {});
      if (result.data?.success) {
        // Successfully connected
        const updatedUser = await base44.auth.me();
        setUser(updatedUser);
        queryClient.invalidateQueries();
      } else {
        alert('❌ Connection failed. Please make sure the Google Calendar app connector is authorized.');
      }
    } catch (error) {
      console.error('Connection error:', error);
      alert('❌ Failed to connect: ' + error.message);
    }
  };

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (currentStep === 0) {
      if (!companyData.company_name || !companyData.email) {
        alert('Please fill in company name and email');
        return;
      }
      saveCompanyMutation.mutate(companyData);
    } else if (currentStep === 1) {
      if (!twilioData.account_sid || !twilioData.auth_token || !twilioData.main_phone_number) {
        if (confirm('Skip Twilio setup for now? You can configure it later in Settings.')) {
          setCurrentStep(2);
        }
        return;
      }
      saveTwilioMutation.mutate(twilioData);
    } else if (currentStep === 2) {
      if (!hasGoogleCalendar) {
        if (confirm('Skip Google Calendar? You can connect it later in General Settings.')) {
          setCurrentStep(3);
        }
        return;
      }
      setCurrentStep(3);
    } else if (currentStep === 3) {
      if (!hasStripeConnected) {
        if (confirm('Skip payment setup? You can enable it later in Settings.')) {
          setCurrentStep(4);
        }
        return;
      }
      setCurrentStep(4);
    } else if (currentStep === 4) {
      // If AI already configured, skip ahead
      if (hasAI || skipAI) {
        setCurrentStep(5);
      } else {
        setupAIMutation.mutate();
      }
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
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
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">{isNewSignup ? '🎉 Welcome to CompanySync!' : 'Quick Setup'}</h1>
          <p className="text-gray-600">{isNewSignup ? 'Your 14-day free trial has started — let\'s get you set up in under 30 minutes.' : 'Get your CRM up and running in under 30 minutes'}</p>
          {isNewSignup && (
            <div className="mt-4 inline-flex items-center gap-2 bg-green-100 border border-green-300 text-green-800 rounded-full px-4 py-1.5 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" /> Account created · 14-day free trial active · No credit card needed
            </div>
          )}
          
          <Button
            variant="outline"
            onClick={async () => {
              if (!myCompany) {
                const trialEndDate = new Date();
                trialEndDate.setDate(trialEndDate.getDate() + 14);
                
                const newCompany = await base44.entities.Company.create({
                  company_name: user?.full_name ? `${user.full_name}'s Company` : 'My Company',
                  email: user?.email || '',
                  subscription_plan: 'trial',
                  subscription_status: 'trial',
                  trial_ends_at: trialEndDate.toISOString().split('T')[0],
                  setup_completed: true
                });

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

                queryClient.invalidateQueries();
              } else {
                // Mark existing company setup as completed
                await base44.entities.Company.update(myCompany.id, {
                  setup_completed: true,
                  setup_completed_at: new Date().toISOString()
                });
              }
              navigate(createPageUrl('Dashboard'));
            }}
            className="mt-4"
          >
            Skip Setup - Go to Dashboard
          </Button>
          
          {/* Show selected plan */}
          {myCompany?.subscription_plan && 
           myCompany.subscription_status === 'trial' && 
           myCompany.id !== 'companysync_master_001' &&
           
           !myCompany.company_name?.includes('Insurance Claims Network') && (
            <div className="mt-4">
              <Badge className="text-lg px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white">
                ✨ {myCompany.subscription_plan.charAt(0).toUpperCase() + myCompany.subscription_plan.slice(1)} Plan - 14 Days Free Trial
              </Badge>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-3">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx === currentStep;
              const isComplete = idx < currentStep;
              
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
                const Icon = STEPS[currentStep].icon;
                return <Icon className="w-6 h-6 text-blue-600" />;
              })()}
              {STEPS[currentStep].title}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 0: Company Info */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>5 minutes</strong> - Basic company information for your CRM
                  </AlertDescription>
                </Alert>

                <div>
                  <Label>Company Name *</Label>
                  <Input
                    placeholder="ABC Roofing Company"
                    value={companyData.company_name}
                    onChange={(e) => setCompanyData({ ...companyData, company_name: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    placeholder="info@yourcompany.com"
                    value={companyData.email}
                    onChange={(e) => setCompanyData({ ...companyData, email: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Phone Number</Label>
                  <Input
                    placeholder="(555) 123-4567"
                    value={companyData.phone}
                    onChange={(e) => setCompanyData({ ...companyData, phone: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>City</Label>
                    <Input
                      placeholder="Dallas"
                      value={companyData.city}
                      onChange={(e) => setCompanyData({ ...companyData, city: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>State</Label>
                    <Input
                      placeholder="TX"
                      value={companyData.state}
                      onChange={(e) => setCompanyData({ ...companyData, state: e.target.value })}
                      maxLength={2}
                    />
                  </div>
                </div>

                <div>
                  <Label>Company Logo (Optional)</Label>
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
                            {uploadLogoMutation.isPending ? 'Uploading...' : 'Upload Logo'}
                          </span>
                        </Button>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 1: Twilio */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>5 minutes</strong> - Enable calling & texting with Twilio
                  </AlertDescription>
                </Alert>

                {hasTwilio ? (
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-900">
                      ✅ Twilio is already configured! You can skip this step.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
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
                        type="password"
                        placeholder="Your Auth Token"
                        value={twilioData.auth_token}
                        onChange={(e) => setTwilioData({ ...twilioData, auth_token: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label>Phone Number *</Label>
                      <Input
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
                      <Button
                        variant="outline"
                        className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => {
                          const videoUrl = `${window.location.origin}${createPageUrl('TrainingVideoPlayer')}?id=698fa638135ab302c8aeaa73`;
                          window.open(videoUrl, '_blank');
                        }}
                      >
                        <Cloud className="w-4 h-4 mr-2" />
                        ▶️ Watch Twilio Setup Tutorial
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Google Calendar */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>2 minutes</strong> - Sync your calendar (optional but recommended)
                  </AlertDescription>
                </Alert>

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
            )}

            {/* Step 3: Accept Payments */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>2 minutes</strong> - Enable instant payments (optional but recommended)
                  </AlertDescription>
                </Alert>

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
                          const result = await base44.functions.invoke('createConnectedAccount', {});
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
            )}

            {/* Step 4: AI Assistants */}
            {currentStep === 4 && (
              <div className="space-y-4">
                <Alert className="bg-blue-50 border-blue-200">
                  <AlertDescription className="text-blue-900">
                    ⏱️ <strong>3 minutes</strong> - Activate AI assistants (optional)
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
                          <h3 className="font-bold text-lg mb-2">Sarah AI</h3>
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

                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                      <Label>Skip AI setup for now</Label>
                      <input
                        type="checkbox"
                        checked={skipAI}
                        onChange={(e) => setSkipAI(e.target.checked)}
                        className="w-5 h-5"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 5: Done */}
            {currentStep === 5 && (
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
                  onClick={async () => {
                    // Mark setup as completed
                    if (myCompany) {
                      await base44.entities.Company.update(myCompany.id, {
                        setup_completed: true,
                        setup_completed_at: new Date().toISOString()
                      });
                    }
                    localStorage.setItem('quickSetupCompleted', 'true');
                    navigate(createPageUrl('Dashboard'));
                  }}
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 mt-6"
                >
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        {currentStep < 5 && (
          <div className="flex justify-between mt-6">
            <Button
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 0}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={handleSkip}
              >
                Skip
              </Button>
              <Button
                onClick={handleNext}
                disabled={saveCompanyMutation.isPending || saveTwilioMutation.isPending || setupAIMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {saveCompanyMutation.isPending || saveTwilioMutation.isPending || setupAIMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Setup Summary */}
        <div className="mt-8 p-4 bg-white/60 rounded-lg">
          <h3 className="font-semibold mb-3 text-sm text-gray-700">Setup Progress:</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div className={`p-2 rounded ${myCompany ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {myCompany ? '✅' : '○'} Company
            </div>
            <div className={`p-2 rounded ${hasTwilio ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasTwilio ? '✅' : '○'} Twilio
            </div>
            <div className={`p-2 rounded ${hasGoogleCalendar ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasGoogleCalendar ? '✅' : '○'} Calendar
            </div>
            <div className={`p-2 rounded ${hasStripeConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasStripeConnected ? '✅' : '○'} Payments
            </div>
            <div className={`p-2 rounded ${hasAI ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {hasAI ? '✅' : '○'} AI
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}