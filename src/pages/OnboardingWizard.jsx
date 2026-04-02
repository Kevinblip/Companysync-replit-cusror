import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft, 
  ArrowRight, 
  Sparkles, 
  Building2, 
  User, 
  MapPin, 
  Users,
  Loader2,
  CheckCircle2
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

const STEPS = [
  { id: 'company', title: 'Company Info', icon: Building2 },
  { id: 'details', title: 'Your Details', icon: User },
  { id: 'address', title: 'Company Address', icon: MapPin },
  { id: 'team', title: 'Team Size', icon: Users }
];

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  
  // Get plan from URL
  const urlParams = new URLSearchParams(window.location.search);
  const selectedPlan = urlParams.get('plan') || 'professional';
  
  // Check if user is already logged in
  useEffect(() => {
    base44.auth.isAuthenticated().then(authenticated => {
      setIsLoggedIn(authenticated);
    });
  }, []);
  
  // Form data
  const [formData, setFormData] = useState({
    company_name: "",
    industry: "Roofing",
    full_name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    team_size: "1-5"
  });

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return formData.company_name.trim().length > 0;
      case 1:
        return formData.full_name.trim().length > 0 && 
               formData.email.includes('@');
      case 2:
        return true; // Address is optional
      case 3:
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      // Store form data in sessionStorage for QuickSetup to use after login
      sessionStorage.setItem('onboarding_data', JSON.stringify({
        ...formData,
        selected_plan: selectedPlan
      }));
      
      if (isLoggedIn) {
        // Already logged in - go directly to QuickSetup
        setIsComplete(true);
        setTimeout(() => {
          navigate(createPageUrl('QuickSetup') + `?plan=${selectedPlan}&new_signup=true`);
        }, 2000);
      } else {
        // Not logged in - call backend function to invite user (using service role)
        try {
          const response = await base44.functions.invoke('publicSignupInvite', {
            email: formData.email,
            full_name: formData.full_name,
            selected_plan: selectedPlan,
            onboarding_data: formData
          });
          
          if (response.data?.success) {
            // Show success - email sent
            setIsComplete(true);
          } else if (response.data?.error === 'already_exists') {
            // User exists - redirect to login
            alert('This email is already registered. Redirecting to login...');
            setTimeout(() => {
              const appUrl = window.location.origin;
              base44.auth.redirectToLogin(`${appUrl}/QuickSetup?plan=${selectedPlan}&new_signup=true`);
            }, 2000);
          } else {
            alert(response.data?.message || response.data?.error || 'Failed to send invitation. Please try again.');
            setIsSubmitting(false);
          }
          
        } catch (inviteErr) {
          console.error('Invite error:', inviteErr);
          alert(inviteErr.message || 'Failed to send invitation. Please try again.');
          setIsSubmitting(false);
        }
      }
      
    } catch (error) {
      console.error('Onboarding error:', error);
      setInviteError('Something went wrong. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleBackToWebsite = () => {
    window.location.href = 'https://companysync.io';
  };

  if (isComplete) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center max-w-lg"
        >
          <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Check Your Email! 📧</h1>
          <p className="text-gray-600 mb-2">
            We've sent a verification email to:
          </p>
          <p className="text-lg font-semibold text-blue-600 mb-6">
            {formData.email}
          </p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-left">
            <h3 className="font-semibold text-blue-900 mb-2">📬 Verify Your Email</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Check your inbox for the verification email</li>
              <li>• Click the link to set your password and activate your account</li>
              <li>• The link will expire in 24 hours</li>
              <li>• Don't forget to check your spam/junk folder</li>
            </ul>
          </div>
          
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-left">
            <h3 className="font-semibold text-green-900 mb-2">🚀 Your Free Trial Awaits</h3>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• 14 days of full access to all features</li>
              <li>• No credit card required</li>
              <li>• Cancel anytime with no charges</li>
              <li>• Full customer support included</li>
            </ul>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        {/* Back to website */}
        <div className="mb-8">
          <button 
            onClick={handleBackToWebsite}
            className="text-gray-600 hover:text-gray-900 flex items-center gap-2 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to website
          </button>
          
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-xl flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-gray-900">CompanySync</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Start Your Free Trial</h1>
            <p className="text-gray-600">14 days free • No credit card required • Cancel anytime</p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, idx) => {
              const Icon = step.icon;
              const isActive = idx === currentStep;
              const isComplete = idx < currentStep;
              
              return (
                <React.Fragment key={step.id}>
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                      isComplete ? 'bg-blue-600 text-white' : 
                      isActive ? 'bg-blue-600 text-white' : 
                      'bg-gray-200 text-gray-500'
                    }`}>
                      {idx + 1}
                    </div>
                    <span className="text-xs mt-2 text-gray-600">{step.title}</span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className={`flex-1 h-1 mx-2 rounded-full transition-all ${
                      idx < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                    }`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Form Card */}
        <Card className="shadow-lg">
          <CardContent className="p-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
              >
                {/* Step 0: Company Info */}
                {currentStep === 0 && (
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="company_name">Company Name *</Label>
                      <Input
                        id="company_name"
                        placeholder="Enter your company name"
                        value={formData.company_name}
                        onChange={(e) => updateField('company_name', e.target.value)}
                        className="mt-2"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="industry">Industry *</Label>
                      <select
                        id="industry"
                        value={formData.industry}
                        onChange={(e) => updateField('industry', e.target.value)}
                        className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="Roofing">Roofing</option>
                        <option value="Construction">Construction</option>
                        <option value="Storm Restoration">Storm Restoration</option>
                        <option value="HVAC">HVAC</option>
                        <option value="Plumbing">Plumbing</option>
                        <option value="Electrical">Electrical</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Step 1: Your Details */}
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="full_name">Your Full Name *</Label>
                      <Input
                        id="full_name"
                        placeholder="John Smith"
                        value={formData.full_name}
                        onChange={(e) => updateField('full_name', e.target.value)}
                        className="mt-2"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="email">Email Address *</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="john@yourcompany.com"
                        value={formData.email}
                        onChange={(e) => updateField('email', e.target.value)}
                        className="mt-2"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="(555) 123-4567"
                        value={formData.phone}
                        onChange={(e) => updateField('phone', e.target.value)}
                        className="mt-2"
                      />
                    </div>
                  </div>
                )}

                {/* Step 2: Company Address */}
                {currentStep === 2 && (
                  <div className="space-y-6">
                    <div>
                      <Label htmlFor="address">Street Address</Label>
                      <Input
                        id="address"
                        placeholder="123 Main Street"
                        value={formData.address}
                        onChange={(e) => updateField('address', e.target.value)}
                        className="mt-2"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="city">City</Label>
                        <Input
                          id="city"
                          placeholder="Dallas"
                          value={formData.city}
                          onChange={(e) => updateField('city', e.target.value)}
                          className="mt-2"
                        />
                      </div>
                      <div>
                        <Label htmlFor="state">State</Label>
                        <Input
                          id="state"
                          placeholder="TX"
                          value={formData.state}
                          onChange={(e) => updateField('state', e.target.value)}
                          className="mt-2"
                          maxLength={2}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="zip">ZIP Code</Label>
                      <Input
                        id="zip"
                        placeholder="75001"
                        value={formData.zip}
                        onChange={(e) => updateField('zip', e.target.value)}
                        className="mt-2"
                      />
                    </div>
                  </div>
                )}

                {/* Step 3: Team Size */}
                {currentStep === 3 && (
                  <div className="space-y-6">
                    <div>
                      <Label>How big is your team?</Label>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        {['1-5', '6-10', '11-25', '25+'].map(size => (
                          <button
                            key={size}
                            onClick={() => updateField('team_size', size)}
                            className={`p-4 rounded-lg border-2 transition-all ${
                              formData.team_size === size 
                                ? 'border-blue-600 bg-blue-50 text-blue-700' 
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <Users className="w-6 h-6 mx-auto mb-2" />
                            <span className="font-medium">{size} people</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-4 mt-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <Sparkles className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">
                            {selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan Selected
                          </p>
                          <p className="text-sm text-gray-600">14-day free trial, then monthly billing</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t">
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={currentStep === 0}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Button>
              
              <Button
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
                className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending Invitation...
                  </>
                ) : currentStep === STEPS.length - 1 ? (
                  <>
                    Start Free Trial
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-500 mt-6">
          By signing up, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
}