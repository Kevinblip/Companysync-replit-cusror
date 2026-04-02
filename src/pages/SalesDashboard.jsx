import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  DollarSign, 
  TrendingUp, 
  Users, 
  Target,
  Award,
  Sparkles,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Zap,
  Brain,
  RefreshCw,
  BarChart3 // Changed from Activity to BarChart3
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';

export default function SalesDashboard() {
  const [aiInsights, setAiInsights] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const { myCompany, isAdmin, effectiveUserEmail, filterLeads, filterCustomers, filterInvoices, filterEstimates, filterPayments, filterCommunications } = useRoleBasedData();

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allEstimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const customers = useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const leads = useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);
  const invoices = useMemo(() => filterInvoices(allInvoices, customers), [allInvoices, customers, filterInvoices]);
  const estimates = useMemo(() => filterEstimates(allEstimates, customers), [allEstimates, customers, filterEstimates]);
  const payments = useMemo(() => filterPayments(allPayments, customers), [allPayments, customers, filterPayments]);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-sales', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: allCommunications = [] } = useQuery({
    queryKey: ['communications', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter communications using hook's canonical filter
  const communications = useMemo(() => filterCommunications(allCommunications), [allCommunications, filterCommunications]);

  const { data: allLeadScores = [] } = useQuery({
    queryKey: ['lead-scores', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.LeadScore.filter({ company_id: myCompany.id }, "-total_score", 500) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter leadScores to match visible leads only
  const leadScores = useMemo(() => {
    if (!effectiveUserEmail) return allLeadScores;
    if (isAdmin) return allLeadScores;
    // Only show lead scores for leads the user can see
    const visibleLeadIds = new Set(leads.map(l => l.id));
    return allLeadScores.filter(s => visibleLeadIds.has(s.lead_id) || !s.lead_id);
  }, [allLeadScores, leads, effectiveUserEmail, isAdmin]);

  // Revenue comes from actual payments received, not from paid invoices
  const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const wonDeals = leads.filter(l => l.status === 'won').length;
  const conversionRate = leads.length > 0 ? ((wonDeals / leads.length) * 100).toFixed(1) : 0;
  const avgDealSize = wonDeals > 0 ? (totalRevenue / wonDeals).toFixed(2) : 0;

  // Pipeline analysis
  const pipelineValue = estimates.filter(e => e.status === 'sent' || e.status === 'viewed').reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const hotLeads = leadScores.filter(s => s.temperature === 'hot').length;

  // Communication insights
  const aiAnalyzedCalls = communications.filter(c => c.ai_analyzed && c.communication_type === 'call').length;
  const positiveSentiment = communications.filter(c => c.sentiment === 'positive').length;
  const quoteRequests = communications.filter(c => c.intent === 'get_quote' || c.intent === 'pricing').length;

  const leadsByStatus = [
    { name: 'New', value: leads.filter(l => l.status === 'new').length, color: '#3b82f6' },
    { name: 'Contacted', value: leads.filter(l => l.status === 'contacted').length, color: '#10b981' },
    { name: 'Qualified', value: leads.filter(l => l.status === 'qualified').length, color: '#f59e0b' },
    { name: 'Proposal', value: leads.filter(l => l.status === 'proposal').length, color: '#8b5cf6' },
    { name: 'Won', value: wonDeals, color: '#22c55e' },
    { name: 'Lost', value: leads.filter(l => l.status === 'lost').length, color: '#ef4444' },
  ];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444'];

  // Monthly trends
  const last6Months = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    const monthRevenue = payments
      .filter(p => p.payment_date && p.payment_date.toString().startsWith(monthKey))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    
    const monthLeads = leads.filter(l => l.created_date && l.created_date.startsWith(monthKey)).length;
    
    last6Months.push({
      month: date.toLocaleDateString('en-US', { month: 'short' }),
      revenue: monthRevenue,
      leads: monthLeads
    });
  }

  // AI Analysis Function
  const runAIAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      // Prepare data for AI analysis
      const analysisData = {
        total_leads: leads.length,
        won_deals: wonDeals,
        conversion_rate: conversionRate,
        total_revenue: totalRevenue,
        avg_deal_size: avgDealSize,
        pipeline_value: pipelineValue,
        hot_leads: hotLeads,
        ai_analyzed_calls: aiAnalyzedCalls,
        positive_sentiment_calls: positiveSentiment,
        quote_requests: quoteRequests,
        lead_sources: leads.reduce((acc, l) => {
          acc[l.source] = (acc[l.source] || 0) + 1;
          return acc;
        }, {}),
        top_hot_leads: leadScores.filter(s => s.temperature === 'hot').slice(0, 5).map(s => ({
          name: s.lead_name,
          score: s.total_score
        })),
        recent_communications: communications.slice(0, 20).map(c => ({
          type: c.communication_type,
          sentiment: c.sentiment,
          intent: c.intent,
          contact: c.contact_name
        })),
        monthly_trends: last6Months
      };

      const prompt = `You are an AI sales analyst. Analyze the following sales data and provide actionable insights:

${JSON.stringify(analysisData, null, 2)}

Provide insights in the following JSON format:
{
  "conversion_predictions": {
    "next_30_days_estimated_deals": number,
    "confidence": "high" | "medium" | "low",
    "reasoning": "brief explanation"
  },
  "hot_opportunities": [
    {
      "lead_name": "string",
      "opportunity": "string (what to focus on)",
      "action": "string (recommended action)",
      "priority": "high" | "medium" | "low"
    }
  ],
  "cross_sell_upsell": [
    {
      "customer_segment": "string",
      "opportunity": "string",
      "estimated_value": number
    }
  ],
  "key_trends": [
    {
      "trend": "string",
      "impact": "positive" | "negative" | "neutral",
      "action": "string (what to do about it)"
    }
  ],
  "performance_insights": {
    "strengths": ["string"],
    "areas_for_improvement": ["string"],
    "quick_wins": ["string"]
  }
}

Be specific, actionable, and data-driven.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            conversion_predictions: {
              type: "object",
              properties: {
                next_30_days_estimated_deals: { type: "number" },
                confidence: { type: "string" },
                reasoning: { type: "string" }
              }
            },
            hot_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  lead_name: { type: "string" },
                  opportunity: { type: "string" },
                  action: { type: "string" },
                  priority: { type: "string" }
                }
              }
            },
            cross_sell_upsell: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  customer_segment: { type: "string" },
                  opportunity: { type: "string" },
                  estimated_value: { type: "number" }
                }
              }
            },
            key_trends: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  trend: { type: "string" },
                  impact: { type: "string" },
                  action: { type: "string" }
                }
              }
            },
            performance_insights: {
              type: "object",
              properties: {
                strengths: { type: "array", items: { type: "string" } },
                areas_for_improvement: { type: "array", items: { type: "string" } },
                quick_wins: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      });

      setAiInsights(response);
    } catch (error) {
      console.error('AI Analysis Error:', error);
      alert('Failed to generate AI insights. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="w-8 h-8 text-purple-600" />
            AI Sales Intelligence
          </h1>
          <p className="text-gray-500 mt-1">AI-powered insights and predictive analytics</p>
        </div>
        <Button 
          onClick={runAIAnalysis}
          disabled={isAnalyzing}
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          {isAnalyzing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate AI Insights
            </>
          )}
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8" />
              <span className="text-sm opacity-80">Total Revenue</span>
            </div>
            <h3 className="text-3xl font-bold">${totalRevenue.toFixed(2)}</h3>
            <p className="text-sm opacity-80 mt-1">{wonDeals} deals closed</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8" />
              <span className="text-sm opacity-80">Conversion Rate</span>
            </div>
            <h3 className="text-3xl font-bold">{conversionRate}%</h3>
            <p className="text-sm opacity-80 mt-1">{leads.length} total leads</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8" />
              <span className="text-sm opacity-80">Pipeline Value</span>
            </div>
            <h3 className="text-3xl font-bold">${pipelineValue.toFixed(0)}</h3>
            <p className="text-sm opacity-80 mt-1">In active proposals</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-8 h-8" />
              <span className="text-sm opacity-80">Hot Leads</span>
            </div>
            <h3 className="text-3xl font-bold">{hotLeads}</h3>
            <p className="text-sm opacity-80 mt-1">High conversion probability</p>
          </CardContent>
        </Card>
      </div>

      {/* AI Insights Section */}
      {aiInsights && (
        <div className="space-y-4">
          {/* Conversion Predictions */}
          <Card className="border-l-4 border-l-purple-600 bg-gradient-to-r from-purple-50 to-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-600" />
                AI Conversion Predictions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-gray-600">Next 30 Days Forecast</p>
                  <p className="text-3xl font-bold text-purple-600">
                    {aiInsights.conversion_predictions?.next_30_days_estimated_deals || 0} Deals
                  </p>
                </div>
                <Badge className={
                  aiInsights.conversion_predictions?.confidence === 'high' ? 'bg-green-100 text-green-700' :
                  aiInsights.conversion_predictions?.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-700'
                }>
                  {aiInsights.conversion_predictions?.confidence || 'N/A'} confidence
                </Badge>
              </div>
              <p className="text-sm text-gray-600">
                <strong>Analysis:</strong> {aiInsights.conversion_predictions?.reasoning}
              </p>
            </CardContent>
          </Card>

          {/* Hot Opportunities */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-orange-600" />
                High-Priority Opportunities
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {aiInsights.hot_opportunities?.map((opp, index) => (
                  <div key={index} className={`p-4 rounded-lg border-l-4 ${
                    opp.priority === 'high' ? 'border-l-red-500 bg-red-50' :
                    opp.priority === 'medium' ? 'border-l-yellow-500 bg-yellow-50' :
                    'border-l-blue-500 bg-blue-50'
                  }`}>
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-gray-900">{opp.lead_name}</h4>
                      <Badge className={
                        opp.priority === 'high' ? 'bg-red-100 text-red-700' :
                        opp.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-blue-100 text-blue-700'
                      }>
                        {opp.priority} priority
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">
                      <strong>Opportunity:</strong> {opp.opportunity}
                    </p>
                    <p className="text-sm text-gray-600">
                      <strong>Recommended Action:</strong> {opp.action}
                    </p>
                  </div>
                ))}
                {(!aiInsights.hot_opportunities || aiInsights.hot_opportunities.length === 0) && (
                  <p className="text-center text-gray-500 py-4">No high-priority opportunities identified</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Cross-sell/Upsell Opportunities */}
          {aiInsights.cross_sell_upsell && aiInsights.cross_sell_upsell.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  Cross-Sell & Up-Sell Opportunities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {aiInsights.cross_sell_upsell.map((opp, index) => (
                    <div key={index} className="p-4 bg-green-50 rounded-lg border-l-4 border-l-green-500">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-semibold text-gray-900">{opp.customer_segment}</h4>
                        <span className="text-green-600 font-bold">
                          ${opp.estimated_value?.toLocaleString() || 0}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{opp.opportunity}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Key Trends */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                Key Trends & Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {aiInsights.key_trends?.map((trend, index) => (
                  <div key={index} className={`p-4 rounded-lg border-l-4 ${
                    trend.impact === 'positive' ? 'border-l-green-500 bg-green-50' :
                    trend.impact === 'negative' ? 'border-l-red-500 bg-red-50' :
                    'border-l-blue-500 bg-blue-50'
                  }`}>
                    <div className="flex items-start gap-3">
                      {trend.impact === 'positive' ? (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : trend.impact === 'negative' ? (
                        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <TrendingUp className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="font-semibold text-gray-900 mb-1">{trend.trend}</p>
                        <p className="text-sm text-gray-600">{trend.action}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Performance Insights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  Strengths
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {aiInsights.performance_insights?.strengths?.map((strength, index) => (
                    <li key={index} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-green-600">✓</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-600" />
                  Areas for Improvement
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {aiInsights.performance_insights?.areas_for_improvement?.map((area, index) => (
                    <li key={index} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-orange-600">→</span>
                      {area}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-purple-600" />
                  Quick Wins
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {aiInsights.performance_insights?.quick_wins?.map((win, index) => (
                    <li key={index} className="text-sm text-gray-700 flex items-start gap-2">
                      <span className="text-purple-600">⚡</span>
                      {win}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-white shadow-md">
          <CardHeader>
            <CardTitle>Lead Pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={leadsByStatus}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={entry => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {leadsByStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-md">
          <CardHeader>
            <CardTitle>Revenue & Lead Trends (6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={last6Months}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#8b5cf6" name="Revenue ($)" />
                <Line yAxisId="right" type="monotone" dataKey="leads" stroke="#3b82f6" name="Leads" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* AI Communication Insights */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            AI Communication Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-sm text-gray-600">AI-Analyzed Calls</p>
              <p className="text-3xl font-bold text-blue-600">{aiAnalyzedCalls}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-600">Positive Sentiment</p>
              <p className="text-3xl font-bold text-green-600">{positiveSentiment}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-600">Quote Requests Detected</p>
              <p className="text-3xl font-bold text-orange-600">{quoteRequests}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Records & Commission Report */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-white shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Payment Records</CardTitle>
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/payments'}>
                Full Report
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={last6Months}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Bar dataKey="revenue" fill="#10b981" name="Payments" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">Total Payments (6 months)</p>
              <p className="text-2xl font-bold text-green-600">
                ${payments.reduce((sum, p) => sum + Number(p.amount || 0), 0).toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white shadow-md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                Commission Report
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => window.location.href = '/commissionreport'}>
                Full Report
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {staffProfiles
                .filter(staff => staff.commission_rate > 0 && (staff.total_commissions_earned > 0 || staff.current_period_sales > 0))
                .sort((a, b) => (b.total_commissions_earned || 0) - (a.total_commissions_earned || 0))
                .slice(0, 5)
                .map((staff, index) => (
                  <div key={staff.user_email} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center text-white font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-semibold">{staff.full_name}</p>
                        <p className="text-xs text-gray-500">{staff.user_email}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-green-600">${Number(staff.total_commissions_earned || 0).toFixed(2)}</p>
                      <p className="text-xs text-gray-500">${Number(staff.current_period_sales || 0).toFixed(2)} - ${Number(staff.total_commissions_earned || 0).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              {staffProfiles.filter(s => s.commission_rate > 0).length === 0 && (
                <p className="text-center text-gray-500 py-6">No commission earners yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-400 to-orange-500 text-white col-span-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="w-6 h-6" />
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {staffProfiles
                .filter(staff => staff.commission_rate > 0)
                .sort((a, b) => (b.total_commissions_earned || 0) - (a.total_commissions_earned || 0))
                .slice(0, 3)
                .map((staff, index) => (
                  <div key={staff.user_email} className="bg-white/20 backdrop-blur-sm rounded-lg p-4 text-center">
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-2">
                      <span className="text-2xl">
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                      </span>
                    </div>
                    <p className="font-bold text-lg">{staff.full_name}</p>
                    <p className="text-sm opacity-90 mt-1">${Number(staff.total_commissions_earned || 0).toFixed(2)} net</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}