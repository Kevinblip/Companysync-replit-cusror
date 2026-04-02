import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Loader2, Building2, Wrench, Zap } from "lucide-react";

const CURRENT_TOOLS = [
  "AccuLynx", "JobNimbus", "Leap", "RoofSnap", "EagleView",
  "CompanyCam", "Jobber", "ServiceTitan", "Housecall Pro",
  "GoHighLevel", "Spreadsheets/Google Sheets", "Pen & Paper"
];

const PAIN_POINTS = [
  "Too many apps that don't talk to each other",
  "Missed or slow follow-ups on estimates",
  "Job photos, notes & customer info scattered everywhere",
  "Hard to track crew schedules & job progress",
  "Invoicing & payment collection is a hassle",
  "No good way to manage insurance claims",
  "Can't easily generate estimates in the field",
  "Difficult to train new staff on the system"
];

const WANTED_FEATURES = [
  "All-in-one CRM + job management",
  "AI-powered estimate generation",
  "Built-in calling, texting & email",
  "Photo documentation & inspection reports",
  "Automated follow-ups & reminders",
  "Customer portal for approvals & payments",
  "Commission & payout tracking",
  "Storm tracking & lead generation",
  "Field rep mobile app",
  "Insurance claim management"
];

export default function BetaQuestionnaire() {
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", phone: "", company_name: "",
    company_size: "", years_in_business: "",
    current_tools: [], current_tools_other: "",
    biggest_pain_points: [], pain_points_other: "",
    most_wanted_features: [], features_other: "",
    monthly_budget: "", beta_availability: "", additional_comments: ""
  });

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const toggleArrayItem = (field, item) => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].includes(item)
        ? prev[field].filter(i => i !== item)
        : [...prev[field], item]
    }));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await base44.entities.BetaQuestionnaire.create({
      ...form,
      status: "new"
    });
    setIsSubmitting(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full text-center border-0 shadow-2xl">
          <CardContent className="p-10">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">You're In!</h2>
            <p className="text-gray-600 mb-2">Thanks for signing up for the CompanySync beta.</p>
            <p className="text-gray-500 text-sm">We'll review your responses and reach out shortly with next steps. Keep an eye on your inbox!</p>
            <div className="mt-8 pt-6 border-t">
              <p className="text-xs text-gray-400">— Alexa Stone, Sales & Marketing | CompanySync.io</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur px-4 py-2 rounded-full mb-6">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-white/90 text-sm font-medium">Beta Program — Limited Spots</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
            Help Us Build the CRM<br />Roofers Actually Need
          </h1>
          <p className="text-blue-200/80 text-lg max-w-xl mx-auto">
            Quick questionnaire — takes about 2 minutes. Your answers directly shape what we build.
          </p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-6 max-w-xs mx-auto">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-blue-400' : 'bg-white/20'}`} />
          ))}
        </div>

        <Card className="border-0 shadow-2xl">
          <CardContent className="p-6 md:p-8">
            {step === 1 && (
              <div className="space-y-5">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">About You & Your Company</h2>
                    <p className="text-sm text-gray-500">Step 1 of 3</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>First Name *</Label>
                    <Input value={form.first_name} onChange={e => updateField("first_name", e.target.value)} placeholder="John" />
                  </div>
                  <div>
                    <Label>Last Name</Label>
                    <Input value={form.last_name} onChange={e => updateField("last_name", e.target.value)} placeholder="Smith" />
                  </div>
                </div>
                <div>
                  <Label>Email *</Label>
                  <Input type="email" value={form.email} onChange={e => updateField("email", e.target.value)} placeholder="john@example.com" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input type="tel" value={form.phone} onChange={e => updateField("phone", e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <div>
                  <Label>Company Name *</Label>
                  <Input value={form.company_name} onChange={e => updateField("company_name", e.target.value)} placeholder="Smith Roofing LLC" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Company Size</Label>
                    <Select value={form.company_size} onValueChange={v => updateField("company_size", v)}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="just_me">Just Me</SelectItem>
                        <SelectItem value="2_5">2–5 employees</SelectItem>
                        <SelectItem value="6_15">6–15 employees</SelectItem>
                        <SelectItem value="16_plus">16+ employees</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Years in Business</Label>
                    <Select value={form.years_in_business} onValueChange={v => updateField("years_in_business", v)}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="less_than_1">Less than 1 year</SelectItem>
                        <SelectItem value="1_3">1–3 years</SelectItem>
                        <SelectItem value="4_10">4–10 years</SelectItem>
                        <SelectItem value="10_plus">10+ years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-base"
                  onClick={() => setStep(2)}
                  disabled={!form.first_name || !form.email || !form.company_name}
                >
                  Continue →
                </Button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <Wrench className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">Your Current Setup & Pain Points</h2>
                    <p className="text-sm text-gray-500">Step 2 of 3</p>
                  </div>
                </div>

                <div>
                  <Label className="text-base font-semibold mb-3 block">What tools/apps do you currently use? <span className="text-gray-400 font-normal text-sm">(select all that apply)</span></Label>
                  <div className="grid grid-cols-2 gap-2">
                    {CURRENT_TOOLS.map(tool => (
                      <label key={tool} className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${form.current_tools.includes(tool) ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                        <Checkbox checked={form.current_tools.includes(tool)} onCheckedChange={() => toggleArrayItem("current_tools", tool)} />
                        <span className="text-sm">{tool}</span>
                      </label>
                    ))}
                  </div>
                  <Input className="mt-2" value={form.current_tools_other} onChange={e => updateField("current_tools_other", e.target.value)} placeholder="Other tools..." />
                </div>

                <div>
                  <Label className="text-base font-semibold mb-3 block">What are your biggest pain points? <span className="text-gray-400 font-normal text-sm">(select all that apply)</span></Label>
                  <div className="space-y-2">
                    {PAIN_POINTS.map(point => (
                      <label key={point} className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${form.biggest_pain_points.includes(point) ? 'bg-orange-50 border-orange-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                        <Checkbox className="mt-0.5" checked={form.biggest_pain_points.includes(point)} onCheckedChange={() => toggleArrayItem("biggest_pain_points", point)} />
                        <span className="text-sm">{point}</span>
                      </label>
                    ))}
                  </div>
                  <Input className="mt-2" value={form.pain_points_other} onChange={e => updateField("pain_points_other", e.target.value)} placeholder="Other pain points..." />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1 h-12">← Back</Button>
                  <Button className="flex-1 bg-blue-600 hover:bg-blue-700 h-12 text-base" onClick={() => setStep(3)}>Continue →</Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <Zap className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">What Would Help You Most?</h2>
                    <p className="text-sm text-gray-500">Step 3 of 3 — Almost done!</p>
                  </div>
                </div>

                <div>
                  <Label className="text-base font-semibold mb-3 block">Which features matter most to you? <span className="text-gray-400 font-normal text-sm">(select all that apply)</span></Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {WANTED_FEATURES.map(feature => (
                      <label key={feature} className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-all ${form.most_wanted_features.includes(feature) ? 'bg-green-50 border-green-300' : 'hover:bg-gray-50 border-gray-200'}`}>
                        <Checkbox checked={form.most_wanted_features.includes(feature)} onCheckedChange={() => toggleArrayItem("most_wanted_features", feature)} />
                        <span className="text-sm">{feature}</span>
                      </label>
                    ))}
                  </div>
                  <Input className="mt-2" value={form.features_other} onChange={e => updateField("features_other", e.target.value)} placeholder="Other features..." />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Monthly Software Budget</Label>
                    <Select value={form.monthly_budget} onValueChange={v => updateField("monthly_budget", v)}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="under_50">Under $50/mo</SelectItem>
                        <SelectItem value="50_100">$50–$100/mo</SelectItem>
                        <SelectItem value="100_200">$100–$200/mo</SelectItem>
                        <SelectItem value="200_plus">$200+/mo</SelectItem>
                        <SelectItem value="not_sure">Not sure yet</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>When could you start testing?</Label>
                    <Select value={form.beta_availability} onValueChange={v => updateField("beta_availability", v)}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asap">ASAP — I'm ready</SelectItem>
                        <SelectItem value="few_weeks">In a few weeks</SelectItem>
                        <SelectItem value="next_month">Next month</SelectItem>
                        <SelectItem value="just_curious">Just curious for now</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Anything else you'd like us to know?</Label>
                  <Textarea value={form.additional_comments} onChange={e => updateField("additional_comments", e.target.value)} placeholder="What frustrates you most about your current setup? What would your dream system look like?" rows={3} />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1 h-12">← Back</Button>
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 h-12 text-base"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</> : "Submit Questionnaire ✓"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-white/40 text-xs mt-6">CompanySync.io — Built for roofers, by roofers.</p>
      </div>
    </div>
  );
}