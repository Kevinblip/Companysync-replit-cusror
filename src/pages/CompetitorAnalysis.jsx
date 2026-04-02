import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, XCircle, ArrowRight, Zap, Target, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function CompetitorAnalysis() {
  const [selectedTab, setSelectedTab] = useState("overview");

  const jobberFeatures = [
    { feature: "24/7 AI call answering", has: true, details: "Answers calls and texts when team is unavailable" },
    { feature: "Answer questions", has: true, details: "Provides info about services" },
    { feature: "Schedule visits", has: true, details: "Books appointments automatically" },
    { feature: "Create work requests", has: true, details: "Logs customer requests" },
    { feature: "Take messages", has: true, details: "Creates tasks with conversation summary" },
    { feature: "Transfer calls", has: true, details: "Detects urgency and transfers to staff" },
    { feature: "Emergency detection", has: true, details: "Identifies emergency calls and routes appropriately" },
    { feature: "Customizable greeting", has: true, details: "Professional, Casual, or Brief tone options" },
    { feature: "Real-time monitoring", has: true, details: "Live dashboard of all conversations" },
    { feature: "CRM integration", has: true, details: "Syncs with Jobber's native CRM" },
    { feature: "Call recording", has: true, details: "Every conversation saved" },
    { feature: "SMS handling", has: true, details: "Responds to text messages" },
  ];

  const jobNimbusFeatures = [
    { feature: "24/7 AI receptionist", has: true, details: "Never miss a call" },
    { feature: "95%+ answer rate", has: true, details: "Handles 95%+ of calls automatically" },
    { feature: "Direct calendar booking", has: true, details: "Books appointments into JobNimbus calendar" },
    { feature: "50-70% faster lead-to-job", has: true, details: "Accelerates conversion" },
    { feature: "$0.15/min cost", has: true, details: "Usage-based pricing" },
    { feature: "Zero staff overhead", has: true, details: "No hiring needed" },
    { feature: "Learns from business info", has: true, details: "Uses website, preferences" },
    { feature: "Lead capture", has: true, details: "Turns calls into leads automatically" },
    { feature: "Performance metrics", has: true, details: "Track answer rate, conversion rate" },
  ];

  const ourCurrentFeatures = [
    { feature: "24/7 AI call answering", has: true, status: "production", details: "Sarah AI handles incoming calls via Twilio" },
    { feature: "24/7 SMS handling", has: true, status: "production", details: "Sarah responds to text messages automatically" },
    { feature: "Answer questions", has: true, status: "production", details: "AI trained on company data, website, knowledge base" },
    { feature: "Schedule appointments", has: true, status: "production", details: "Books into Google Calendar automatically" },
    { feature: "Create leads", has: true, status: "production", details: "Auto-creates leads from conversations" },
    { feature: "Create tasks", has: true, status: "production", details: "Generates follow-up tasks for team" },
    { feature: "Real-time call monitoring", has: false, status: "missing", details: "No live dashboard for active calls" },
    { feature: "Call transfer to staff", has: false, status: "missing", details: "Cannot transfer live calls to team members" },
    { feature: "Emergency detection", has: false, status: "missing", details: "No priority routing for urgent calls" },
    { feature: "Customizable AI personality", has: true, status: "production", details: "Configurable system prompt and voice" },
    { feature: "Call recording", has: true, status: "production", details: "Twilio records all calls" },
    { feature: "Call transcription", has: true, status: "production", details: "Auto-transcribes voice to text" },
    { feature: "CRM integration", has: true, status: "production", details: "Native - IS the CRM" },
    { feature: "Workflow automation", has: true, status: "production", details: "Trigger workflows from AI conversations" },
    { feature: "Performance metrics", has: false, status: "partial", details: "Basic tracking, no dedicated dashboard" },
    { feature: "Sentiment analysis", has: false, status: "missing", details: "No emotion detection in conversations" },
    { feature: "Multi-language support", has: false, status: "missing", details: "English only currently" },
    { feature: "Proactive follow-ups", has: true, status: "production", details: "Automated reminders and outreach" },
  ];

  const proposedEnhancements = [
    {
      priority: "HIGH",
      feature: "Live Call Dashboard",
      description: "Real-time monitoring of active calls and SMS conversations with agent status, customer info, and conversation highlights",
      competitorGap: "Both competitors have this",
      impact: "High - essential for supervisor oversight"
    },
    {
      priority: "HIGH",
      feature: "Intelligent Call Transfer",
      description: "Detect when AI should transfer to human agent based on urgency, complexity, sentiment, or customer request. Include warm transfer with context.",
      competitorGap: "Jobber has basic transfer",
      impact: "High - critical for customer satisfaction"
    },
    {
      priority: "HIGH",
      feature: "Emergency Detection & Priority Routing",
      description: "Identify emergency keywords (fire, flood, injury, etc.) and immediately notify/transfer to on-call staff with SMS alert",
      competitorGap: "Jobber has this",
      impact: "High - safety and service quality"
    },
    {
      priority: "MEDIUM",
      feature: "AI Performance Dashboard",
      description: "Track answer rate, average handle time, conversion rate, customer satisfaction, call volume by hour/day",
      competitorGap: "JobNimbus highlights metrics prominently",
      impact: "Medium - business intelligence"
    },
    {
      priority: "MEDIUM",
      feature: "Sentiment Analysis",
      description: "Detect customer emotion (frustrated, happy, confused) and adjust AI response or escalate to human",
      competitorGap: "Neither competitor has this",
      impact: "Medium - differentiator, improves CX"
    },
    {
      priority: "MEDIUM",
      feature: "Smart Call Routing by Expertise",
      description: "Route calls to specific team members based on service type, customer history, staff availability, and skills",
      competitorGap: "Basic in competitors",
      impact: "Medium - efficiency and specialization"
    },
    {
      priority: "LOW",
      feature: "Multi-language Support",
      description: "Detect caller language and respond in Spanish, French, etc. using multilingual AI models",
      competitorGap: "Neither competitor has this",
      impact: "Low-Medium - market expansion"
    },
    {
      priority: "LOW",
      feature: "Voice Cloning for Owner",
      description: "Optional: Clone business owner's voice so AI sounds like them (requires consent and training)",
      competitorGap: "Neither competitor has this",
      impact: "Low - novelty, brand consistency"
    },
    {
      priority: "MEDIUM",
      feature: "Voicemail Transcription & Auto-Response",
      description: "If customer leaves voicemail, transcribe it, create lead/task, and send SMS confirmation",
      competitorGap: "Not explicitly mentioned by competitors",
      impact: "Medium - no missed opportunities"
    },
    {
      priority: "HIGH",
      feature: "Post-Call Automated Follow-Up",
      description: "After AI handles call, automatically send SMS with summary, appointment link, or next steps",
      competitorGap: "Neither competitor has automated follow-up",
      impact: "High - conversion booster"
    },
  ];

  const competitiveAdvantages = [
    {
      advantage: "Native CRM Integration",
      description: "We ARE the CRM - no data silos, instant sync, complete context. Competitors require separate platforms.",
      icon: "🎯"
    },
    {
      advantage: "Workflow Automation",
      description: "AI can trigger complex multi-step workflows (e.g., send estimate, schedule follow-up, notify team). Competitors can't do this.",
      icon: "⚡"
    },
    {
      advantage: "Unified Communication Hub",
      description: "Email, SMS, calls, and AI all in one place. Competitors require switching between tools.",
      icon: "💬"
    },
    {
      advantage: "Customizable AI Personas",
      description: "Lexi (internal) and Sarah (customer-facing) with different personalities and capabilities. Competitors have one AI.",
      icon: "🤖"
    },
    {
      advantage: "All-in-One Business Platform",
      description: "CRM + AI + invoicing + payments + projects + calendar. Competitors are just call handling add-ons.",
      icon: "🏢"
    },
    {
      advantage: "Transparent Pricing",
      description: "Can offer flat-rate or per-user pricing vs. per-minute charges. More predictable for customers.",
      icon: "💰"
    },
    {
      advantage: "Full Lead-to-Cash Lifecycle",
      description: "AI captures lead, books appointment, sends estimate, collects payment - end-to-end. Competitors stop at booking.",
      icon: "📈"
    },
  ];

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-blue-50 to-purple-50 min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AI Receptionist: Competitive Analysis</h1>
        <p className="text-gray-600 mt-1">Strategic analysis of Jobber & JobNimbus AI call handling vs. our platform</p>
      </div>

      <Alert className="bg-blue-50 border-blue-200">
        <Target className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <strong>Goal:</strong> Be hands-down better than Jobber Receptionist and JobNimbus AssistAI for incoming calls and SMS
        </AlertDescription>
      </Alert>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="features">Feature Comparison</TabsTrigger>
          <TabsTrigger value="enhancements">Enhancements Needed</TabsTrigger>
          <TabsTrigger value="advantages">Our Advantages</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">🟢</span>
                  </div>
                  Jobber Receptionist
                </CardTitle>
                <CardDescription>Home service software with AI receptionist add-on</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>24/7 call & text answering</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Bookings & work requests</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Call transfer with emergency detection</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Customizable greeting & tone</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    <span>Real-time monitoring dashboard</span>
                  </div>
                </div>
                <Badge className="bg-green-100 text-green-800">Mature Product</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">🔵</span>
                  </div>
                  JobNimbus AssistAI
                </CardTitle>
                <CardDescription>Contractor CRM with AI assistant</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>95%+ call answer rate 24/7</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>Direct calendar booking</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>50-70% faster lead-to-job conversion</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>$0.15/min pricing</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-600" />
                    <span>Performance metrics dashboard</span>
                  </div>
                </div>
                <Badge className="bg-blue-100 text-blue-800">Metrics Focused</Badge>
              </CardContent>
            </Card>

            <Card className="border-2 border-purple-300">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                    <span className="text-2xl">🟣</span>
                  </div>
                  Our Platform
                </CardTitle>
                <CardDescription>All-in-one AI CRM with native receptionist</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-purple-600" />
                    <span>24/7 AI call & SMS (Sarah AI)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-purple-600" />
                    <span>Auto-create leads, tasks, appointments</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-purple-600" />
                    <span>Workflow automation from AI</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span>No live call transfer (YET)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-600" />
                    <span>No emergency detection (YET)</span>
                  </div>
                </div>
                <Badge className="bg-purple-100 text-purple-800">Native CRM Advantage</Badge>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-gradient-to-r from-purple-600 to-blue-600 text-white">
            <CardHeader>
              <CardTitle className="text-white">Current Status Summary</CardTitle>
            </CardHeader>
            <CardContent className="text-white space-y-4">
              <div className="grid md:grid-cols-3 gap-4">
                <div>
                  <div className="text-3xl font-bold">85%</div>
                  <div className="text-blue-100 text-sm">Feature parity with competitors</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">3</div>
                  <div className="text-blue-100 text-sm">Critical features missing</div>
                </div>
                <div>
                  <div className="text-3xl font-bold">7</div>
                  <div className="text-blue-100 text-sm">Unique advantages we have</div>
                </div>
              </div>
              <Alert className="bg-white/10 border-white/20">
                <AlertDescription className="text-white">
                  <strong>Bottom Line:</strong> We're 85% there. Adding live call transfer, emergency detection, and performance dashboard will make us definitively better.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="space-y-6">
          <div className="grid md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Jobber Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {jobberFeatures.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium">{item.feature}</div>
                        <div className="text-xs text-gray-500">{item.details}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">JobNimbus Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {jobNimbusFeatures.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium">{item.feature}</div>
                        <div className="text-xs text-gray-500">{item.details}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-purple-300">
              <CardHeader>
                <CardTitle className="text-sm">Our Current Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {ourCurrentFeatures.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      {item.has ? (
                        <CheckCircle2 className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-medium">{item.feature}</div>
                        <div className="text-xs text-gray-500">{item.details}</div>
                        {item.status && (
                          <Badge 
                            className={`text-xs mt-1 ${
                              item.status === 'production' ? 'bg-green-100 text-green-800' :
                              item.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }`}
                          >
                            {item.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="enhancements" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Proposed Enhancements to Beat Competitors</CardTitle>
              <CardDescription>Prioritized roadmap to achieve feature dominance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {proposedEnhancements
                  .sort((a, b) => {
                    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                    return order[a.priority] - order[b.priority];
                  })
                  .map((enhancement, idx) => (
                    <div key={idx} className="p-4 border rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold">{enhancement.feature}</h4>
                            <Badge 
                              className={
                                enhancement.priority === 'HIGH' ? 'bg-red-100 text-red-800' :
                                enhancement.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                'bg-blue-100 text-blue-800'
                              }
                            >
                              {enhancement.priority} PRIORITY
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{enhancement.description}</p>
                        </div>
                      </div>
                      <div className="grid md:grid-cols-2 gap-3 mt-3 text-sm">
                        <div className="bg-gray-50 p-2 rounded">
                          <div className="font-medium text-gray-700">Competitor Gap:</div>
                          <div className="text-gray-600">{enhancement.competitorGap}</div>
                        </div>
                        <div className="bg-gray-50 p-2 rounded">
                          <div className="font-medium text-gray-700">Business Impact:</div>
                          <div className="text-gray-600">{enhancement.impact}</div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-green-600 to-emerald-600 text-white">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="w-6 h-6" />
                Quick Wins (30 days or less)
              </CardTitle>
            </CardHeader>
            <CardContent className="text-white space-y-2">
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                <span>Live Call Dashboard - use existing Communication entity</span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                <span>Emergency keyword detection - add to Sarah's prompt</span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                <span>Post-call SMS follow-up - trigger workflow after call ends</span>
              </div>
              <div className="flex items-center gap-2">
                <ArrowRight className="w-4 h-4" />
                <span>Basic performance dashboard - aggregate Communication data</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advantages" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Our Competitive Advantages</CardTitle>
              <CardDescription>Things we can do that competitors cannot</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {competitiveAdvantages.map((item, idx) => (
                  <div key={idx} className="p-4 border rounded-lg bg-gradient-to-br from-white to-purple-50">
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{item.icon}</div>
                      <div>
                        <h4 className="font-semibold text-lg mb-1">{item.advantage}</h4>
                        <p className="text-sm text-gray-600">{item.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-300 bg-green-50">
            <CardHeader>
              <CardTitle className="text-green-900 flex items-center gap-2">
                <TrendingUp className="w-6 h-6" />
                The Winning Strategy
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-green-900">
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">1</div>
                  <div>
                    <div className="font-semibold">Close Feature Gaps (Month 1)</div>
                    <div className="text-sm text-green-700">Add live call transfer, emergency detection, and performance dashboard</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">2</div>
                  <div>
                    <div className="font-semibold">Leverage Native Advantages (Ongoing)</div>
                    <div className="text-sm text-green-700">Emphasize CRM integration, workflow automation, and end-to-end business management</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">3</div>
                  <div>
                    <div className="font-semibold">Add Differentiators (Month 2-3)</div>
                    <div className="text-sm text-green-700">Sentiment analysis, multi-language, intelligent routing by expertise</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 bg-green-600 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-sm">4</div>
                  <div>
                    <div className="font-semibold">Market Position</div>
                    <div className="text-sm text-green-700">"The only AI receptionist built INTO your CRM, not bolted ON"</div>
                  </div>
                </div>
              </div>

              <Alert className="bg-white border-green-300">
                <AlertDescription className="text-green-900">
                  <strong>Key Insight:</strong> Competitors sell call handling as an add-on. We offer it as part of a complete business platform. That's the real advantage.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}