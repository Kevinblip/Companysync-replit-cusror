import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  Zap, 
  Building2, 
  Phone, 
  Calendar, 
  Bot,
  ArrowRight,
  AlertCircle,
  Sparkles,
  ExternalLink
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

export default function SetupWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [autoSetupRunning, setAutoSetupRunning] = useState(false);

  // Form state
  const [companyName, setCompanyName] = useState("");
  const [companyEmail, setCompanyEmail] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [industry, setIndustry] = useState("roofing");
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioPhone, setTwilioPhone] = useState("");
  const [skipTwilio, setSkipTwilio] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;
    const owned = companies.find(c => c.created_by === user.email);
    if (owned) return owned;
    const staff = staffProfiles[0];
    if (staff?.company_id) {
      return companies.find(c => c.id === staff.company_id);
    }
    return null;
  }, [user, companies, staffProfiles]);

  const { data: twilioSettings = [] } = useQuery({
    queryKey: ['twilio-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TwilioSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: assistantSettings = [] } = useQuery({
    queryKey: ['assistant-settings', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.AssistantSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // Auto-fill form if company exists
  useEffect(() => {
    if (myCompany) {
      setCompanyName(myCompany.company_name || "");
      setCompanyEmail(myCompany.email || "");
      setCompanyPhone(myCompany.phone || "");
      setIndustry(myCompany.industry || "roofing");
    }
  }, [myCompany]);

  useEffect(() => {
    if (twilioSettings[0]) {
      setTwilioSid(twilioSettings[0].account_sid || "");
      setTwilioPhone(twilioSettings[0].main_phone_number || "");
    }
  }, [twilioSettings]);

  const autoSetupMutation = useMutation({
    mutationFn: (data) => base44.functions.invoke('autoSetupCompany', data),
    onSuccess: (response) => {
      console.log('✅ Auto setup completed:', response.data);
      queryClient.invalidateQueries({ queryKey: ['companies'] });
      queryClient.invalidateQueries({ queryKey: ['twilio-settings'] });
      queryClient.invalidateQueries({ queryKey: ['assistant-settings'] });
      
      setAutoSetupRunning(false);
      setCurrentStep(5); // Success step
    },
    onError: (error) => {
      console.error('❌ Auto setup failed:', error);
      setAutoSetupRunning(false);
      alert('Setup failed: ' + error.message);
    }
  });

  const handleQuickSetup = () => {
    if (!companyName || !companyEmail) {
      alert('❌ Please enter company name and email');
      return;
    }

    if (!skipTwilio && (!twilioSid || !twilioToken || !twilioPhone)) {
      alert('❌ Please enter Twilio credentials or check "Skip Twilio"');
      return;
    }

    setAutoSetupRunning(true);
    autoSetupMutation.mutate({
      companyName,
      companyEmail,
      companyPhone,
      industry,
      twilioAccountSid: skipTwilio ? null : twilioSid,
      twilioAuthToken: skipTwilio ? null : twilioToken,
      twilioPhoneNumber: skipTwilio ? null : twilioPhone,
      skipTwilio,
      skipCalendar: true // User connects manually
    });
  };

  const handleGoogleConnect = async () => {
    try {
      const result = await base44.functions.invoke('connectUserGoogleCalendar', {});
      if (result.data?.authUrl) {
        window.location.href = result.data.authUrl;
      }
    } catch (error) {
      alert('Failed to connect: ' + error.message);
    }
  };

  // Calculate completion
  const hasCompany = !!myCompany?.company_name;
  const hasTwilio = twilioSettings.length > 0 && twilioSettings[0].account_sid;
  const hasCalendar = user?.google_calendar_connected === true;
  const hasAI = assistantSettings.length > 0;

  const completedSteps = [hasCompany, hasTwilio || skipTwilio, hasAI, hasCalendar].filter(Boolean).length;
  const totalSteps = 4;
  const progressPercent = (completedSteps / totalSteps) * 100;

  const steps = [
    { 
      num: 1, 
      title: "Company Profile", 
      icon: Building2, 
      completed: hasCompany,
      required: true,
      description: "Basic company information"
    },
    { 
      num: 2, 
      title: "Twilio (Phone & SMS)", 
      icon: Phone, 
      completed: hasTwilio || skipTwilio,
      required: false,
      description: "Enable calling and texting"
    },
    { 
      num: 3, 
      title: "AI Assistants", 
      icon: Bot, 
      completed: hasAI,
      required: false,
      description: "Lexi & Sarah ready to help"
    },
    { 
      num: 4, 
      title: "Google Calendar", 
      icon: Calendar, 
      completed: hasCalendar,
      required: false,
      description: "Sync your schedule"
    }
  ];

  if (currentStep === 5 || progressPercent === 100) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-purple-50 flex items-center justify-center p-6">
        <Card className="max-w-2xl w-full shadow-2xl">
          <CardContent className="p-12 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-12 h-12 text-green-600" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-4">🎉 You're All Set!</h1>
            <p className="text-lg text-gray-600 mb-8">
              Your CRM is configured and ready to use. Time to grow your business!
            </p>
            
            <div className="grid grid-cols-2 gap-4 mb-8">
              {steps.map(step => (
                <div key={step.num} className={`p-4 rounded-lg border-2 ${step.completed ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <step.icon className={`w-5 h-5 ${step.completed ? 'text-green-600' : 'text-gray-400'}`} />
                    <span className="font-semibold text-sm">{step.title}</span>
                  </div>
                  <Badge variant={step.completed ? "default" : "secondary"} className="text-xs">
                    {step.completed ? '✓ Complete' : step.required ? 'Required' : 'Optional'}
                  </Badge>
                </div>
              ))}
            </div>

            <Button 
              onClick={() => navigate(createPageUrl('Dashboard'))}
              size="lg"
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8"
            >
              Go to Dashboard
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Sparkles className="w-10 h-10 text-purple-600" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Quick Setup Wizard
            </h1>
          </div>
          <p className="text-gray-600 text-lg">Get up and running in under 30 minutes</p>
        </div>

        {/* Progress Bar */}
        <Card className="bg-white shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-700">Setup Progress</span>
              <span className="text-sm font-bold text-purple-600">{completedSteps}/{totalSteps} Complete</span>
            </div>
            <Progress value={progressPercent} className="h-3" />
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
              {steps.map(step => (
                <div key={step.num} className="text-center">
                  <div className={`w-12 h-12 rounded-full mx-auto mb-2 flex items-center justify-center ${
                    step.completed ? 'bg-green-100' : 'bg-gray-100'
                  }`}>
                    {step.completed ? (
                      <CheckCircle2 className="w-6 h-6 text-green-600" />
                    ) : (
                      <step.icon className="w-6 h-6 text-gray-400" />
                    )}
                  </div>
                  <p className="text-xs font-medium text-gray-700">{step.title}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Setup Card */}
        <Card className="bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-2xl">
          <CardContent className="p-8">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold mb-2">One-Click Auto Setup</h2>
                <p className="text-blue-100 mb-6">
                  Let AI configure your CRM automatically. Just enter your details below and we'll handle the rest!
                </p>

                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-white">Company Name *</Label>
                      <Input
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="ABC Roofing"
                        className="bg-white/90 text-gray-900"
                      />
                    </div>
                    <div>
                      <Label className="text-white">Industry</Label>
                      <select
                        value={industry}
                        onChange={(e) => setIndustry(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-white/90 text-gray-900"
                      >
                        <option value="roofing">Roofing</option>
                        <option value="construction">Construction</option>
                        <option value="hvac">HVAC</option>
                        <option value="plumbing">Plumbing</option>
                        <option value="electrical">Electrical</option>
                        <option value="general_contractor">General Contractor</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-white">Email *</Label>
                      <Input
                        type="email"
                        value={companyEmail}
                        onChange={(e) => setCompanyEmail(e.target.value)}
                        placeholder="info@abcroofing.com"
                        className="bg-white/90 text-gray-900"
                      />
                    </div>
                    <div>
                      <Label className="text-white">Phone</Label>
                      <Input
                        value={companyPhone}
                        onChange={(e) => setCompanyPhone(e.target.value)}
                        placeholder="(555) 123-4567"
                        className="bg-white/90 text-gray-900"
                      />
                    </div>
                  </div>

                  <div className="border-t border-white/20 pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <input
                        type="checkbox"
                        id="skip-twilio"
                        checked={skipTwilio}
                        onChange={(e) => setSkipTwilio(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="skip-twilio" className="text-white cursor-pointer">
                        Skip Twilio (set up later)
                      </Label>
                    </div>

                    {!skipTwilio && (
                      <>
                        <Alert className="bg-white/20 border-white/30 mb-4">
                          <Phone className="w-4 h-4 text-white" />
                          <AlertDescription className="text-white text-sm">
                            Get your Twilio credentials from{" "}
                            <a
                              href="https://console.twilio.com/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline font-semibold"
                            >
                              console.twilio.com
                              <ExternalLink className="w-3 h-3 inline ml-1" />
                            </a>
                          </AlertDescription>
                        </Alert>

                        <div className="grid grid-cols-1 gap-4">
                          <div>
                            <Label className="text-white">Twilio Account SID</Label>
                            <Input
                              value={twilioSid}
                              onChange={(e) => setTwilioSid(e.target.value)}
                              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                              className="bg-white/90 text-gray-900"
                            />
                          </div>
                          <div>
                            <Label className="text-white">Twilio Auth Token</Label>
                            <Input
                              type="password"
                              value={twilioToken}
                              onChange={(e) => setTwilioToken(e.target.value)}
                              placeholder="Your auth token"
                              className="bg-white/90 text-gray-900"
                            />
                          </div>
                          <div>
                            <Label className="text-white">Twilio Phone Number</Label>
                            <Input
                              value={twilioPhone}
                              onChange={(e) => setTwilioPhone(e.target.value)}
                              placeholder="+1 (555) 123-4567"
                              className="bg-white/90 text-gray-900"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <Button
                    onClick={handleQuickSetup}
                    disabled={autoSetupRunning || !companyName || !companyEmail}
                    size="lg"
                    className="w-full bg-white text-purple-600 hover:bg-gray-100 font-bold text-lg h-14"
                  >
                    {autoSetupRunning ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Setting Up Your CRM...
                      </>
                    ) : (
                      <>
                        <Zap className="w-5 h-5 mr-2" />
                        Auto Setup Everything
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Manual Setup Options */}
        <div className="text-center">
          <p className="text-gray-500 mb-4">Or configure manually step-by-step:</p>
        </div>

        <div className="grid gap-4">
          {/* Step 1: Company */}
          <Card className={hasCompany ? "border-green-200 bg-green-50" : "border-gray-200"}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {hasCompany ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  ) : (
                    <Circle className="w-6 h-6 text-gray-400" />
                  )}
                  <span>1. Company Profile</span>
                  <Badge variant={hasCompany ? "default" : "secondary"}>
                    {hasCompany ? 'Complete' : 'Required'}
                  </Badge>
                </div>
                {!hasCompany && (
                  <Button
                    onClick={() => navigate(createPageUrl('CompanySetup'))}
                    variant="outline"
                  >
                    Setup Now
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {hasCompany && (
              <CardContent className="text-sm text-gray-600">
                ✓ {myCompany.company_name} · {myCompany.email}
              </CardContent>
            )}
          </Card>

          {/* Step 2: Twilio */}
          <Card className={hasTwilio ? "border-green-200 bg-green-50" : "border-gray-200"}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {hasTwilio ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  ) : (
                    <Circle className="w-6 h-6 text-gray-400" />
                  )}
                  <span>2. Twilio Integration</span>
                  <Badge variant="secondary">Optional</Badge>
                </div>
                {!hasTwilio && (
                  <Button
                    onClick={() => navigate(createPageUrl('IntegrationManager'))}
                    variant="outline"
                  >
                    Setup Now
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {hasTwilio && (
              <CardContent className="text-sm text-gray-600">
                ✓ Phone: {twilioSettings[0].main_phone_number}
              </CardContent>
            )}
          </Card>

          {/* Step 3: AI */}
          <Card className={hasAI ? "border-green-200 bg-green-50" : "border-gray-200"}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {hasAI ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  ) : (
                    <Circle className="w-6 h-6 text-gray-400" />
                  )}
                  <span>3. AI Assistants</span>
                  <Badge variant="secondary">Auto-Configured</Badge>
                </div>
                <Button
                  onClick={() => navigate(createPageUrl('LexiSettings'))}
                  variant="outline"
                  size="sm"
                >
                  Customize
                </Button>
              </CardTitle>
            </CardHeader>
            {hasAI && (
              <CardContent className="text-sm text-gray-600">
                ✓ Lexi & Sarah ready for chat, voice, and SMS
              </CardContent>
            )}
          </Card>

          {/* Step 4: Google Calendar */}
          <Card className={hasCalendar ? "border-green-200 bg-green-50" : "border-gray-200"}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {hasCalendar ? (
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  ) : (
                    <Circle className="w-6 h-6 text-gray-400" />
                  )}
                  <span>4. Google Calendar</span>
                  <Badge variant="secondary">Optional</Badge>
                </div>
                {!hasCalendar && (
                  <Button
                    onClick={handleGoogleConnect}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Connect Now
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            {hasCalendar && (
              <CardContent className="text-sm text-gray-600">
                ✓ Calendar syncing enabled
              </CardContent>
            )}
          </Card>
        </div>

        {/* Skip Setup */}
        <div className="text-center pt-6">
          <Button
            onClick={() => navigate(createPageUrl('Dashboard'))}
            variant="ghost"
            className="text-gray-500 hover:text-gray-700"
          >
            I'll finish this later
          </Button>
        </div>
      </div>
    </div>
  );
}