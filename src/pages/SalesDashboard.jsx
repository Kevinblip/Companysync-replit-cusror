import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

const currentYear = new Date().getFullYear();

const PERIOD_OPTIONS = [
  { value: 'last_3_months', label: 'Last 3 Months' },
  { value: 'last_6_months', label: 'Last 6 Months' },
  { value: 'this_year',     label: `This Year (${currentYear})` },
  { value: String(currentYear - 1), label: String(currentYear - 1) },
  { value: String(currentYear - 2), label: String(currentYear - 2) },
  { value: 'all_time',      label: 'All Time' },
];

function getPeriodBounds(period) {
  const now = new Date();
  if (period === 'last_3_months') {
    const start = new Date(); start.setMonth(start.getMonth() - 3); start.setDate(1); start.setHours(0,0,0,0);
    return { start, end: now, label: 'Last 3 Months' };
  }
  if (period === 'last_6_months') {
    const start = new Date(); start.setMonth(start.getMonth() - 6); start.setDate(1); start.setHours(0,0,0,0);
    return { start, end: now, label: 'Last 6 Months' };
  }
  if (period === 'this_year') {
    return { start: new Date(currentYear, 0, 1), end: now, label: `${currentYear} YTD` };
  }
  if (/^\d{4}$/.test(period)) {
    const yr = parseInt(period);
    return { start: new Date(yr, 0, 1), end: new Date(yr, 11, 31, 23, 59, 59), label: String(yr) };
  }
  return { start: null, end: null, label: 'All Time' };
}

export default function SalesDashboard() {
  const [aiInsights, setAiInsights] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState('this_year');

  const { myCompany, isAdmin, effectiveUserEmail, filterLeads, filterCustomers, filterInvoices, filterEstimates, filterPayments, filterCommunications } = useRoleBasedData();

  const { data: allPayments = [] } = useQuery({
    queryKey: ['payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: allInvoices = [] } = useQuery({
    queryKey: ['invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: allEstimates = [] } = useQuery({
    queryKey: ['estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });

  const { data: allCustomers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
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
  });

  const { data: allCommunications = [] } = useQuery({
    queryKey: ['communications', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 1000) : [],
    enabled: !!myCompany,
  });

  // 🔐 Filter communications using hook's canonical filter
  const communications = useMemo(() => filterCommunications(allCommunications), [allCommunications, filterCommunications]);

  const { data: allLeadScores = [] } = useQuery({
    queryKey: ['lead-scores', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.LeadScore.filter({ company_id: myCompany.id }, "-total_score", 500) : [],
    enabled: !!myCompany,
  });

  // 🔐 Filter leadScores to match visible leads only
  const leadScores = useMemo(() => {
    if (!effectiveUserEmail) return allLeadScores;
    if (isAdmin) return allLeadScores;
    // Only show lead scores for leads the user can see
    const visibleLeadIds = new Set(leads.map(l => l.id));
    return allLeadScores.filter(s => visibleLeadIds.has(s.lead_id) || !s.lead_id);
  }, [allLeadScores, leads, effectiveUserEmail, isAdmin]);

  // ── Period filtering ────────────────────────────────────────────────────────
  const periodBounds = useMemo(() => getPeriodBounds(selectedPeriod), [selectedPeriod]);

  const filterByPeriod = (arr, dateField) => {
    if (!periodBounds.start) return arr;
    return arr.filter(item => {
      const val = item[dateField];
      if (!val) return false;
      const d = new Date(val);
      return d >= periodBounds.start && d <= periodBounds.end;
    });
  };

  const periodPayments      = useMemo(() => filterByPeriod(payments, 'payment_date'),       [payments, periodBounds]);
  const periodLeads         = useMemo(() => filterByPeriod(leads, 'created_date'),           [leads, periodBounds]);
  const periodInvoices      = useMemo(() => filterByPeriod(invoices, 'created_date'),        [invoices, periodBounds]);
  const periodEstimates     = useMemo(() => filterByPeriod(estimates, 'created_date'),       [estimates, periodBounds]);
  const periodCommunications = useMemo(() => filterByPeriod(communications, 'created_date'), [communications, periodBounds]);

  // ── Metrics (all scoped to selected period) ─────────────────────────────────
  const totalRevenue = periodPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const wonDeals = periodLeads.filter(l => l.status === 'won').length;
  const paidInvoicesCount = periodInvoices.filter(i => i.status === 'paid').length;
  const conversionRate = periodLeads.length > 0 ? ((wonDeals / periodLeads.length) * 100).toFixed(1) : 0;
  const paidInvoiceTotal = periodInvoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + Number(i.total_amount || i.amount || 0), 0);
  const avgInvoiceValue = paidInvoicesCount > 0 ? (paidInvoiceTotal / paidInvoicesCount).toFixed(0) : 0;
  const avgDealSize = avgInvoiceValue;

  // Pipeline — active open estimates (all time; pipeline is forward-looking)
  const activeEstimates = estimates.filter(e => e.status === 'sent' || e.status === 'viewed');
  const pipelineValue = activeEstimates.reduce((sum, e) => sum + Number(e.total_amount || e.amount || 0), 0);
  const openEstimatesCount = activeEstimates.length;

  const hotLeads = leadScores.filter(s => s.temperature === 'hot').length;

  // Communication insights (period-scoped)
  const aiAnalyzedCalls = periodCommunications.filter(c => c.ai_analyzed && c.communication_type === 'call').length;
  const positiveSentiment = periodCommunications.filter(c => c.sentiment === 'positive').length;
  const quoteRequests = periodCommunications.filter(c => c.intent === 'get_quote' || c.intent === 'pricing').length;

  const leadsByStatus = [
    { name: 'New',       value: periodLeads.filter(l => l.status === 'new').length,       color: '#3b82f6' },
    { name: 'Contacted', value: periodLeads.filter(l => l.status === 'contacted').length, color: '#10b981' },
    { name: 'Qualified', value: periodLeads.filter(l => l.status === 'qualified').length, color: '#f59e0b' },
    { name: 'Proposal',  value: periodLeads.filter(l => l.status === 'proposal').length,  color: '#8b5cf6' },
    { name: 'Won',       value: wonDeals,                                                  color: '#22c55e' },
    { name: 'Lost',      value: periodLeads.filter(l => l.status === 'lost').length,      color: '#ef4444' },
  ];

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#22c55e', '#ef4444'];

  // ── Monthly chart buckets (adapts to selected period) ───────────────────────
  const toMonthKey = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val).slice(0, 7);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } catch { return ''; }
  };

  const chartMonths = useMemo(() => {
    const buckets = [];
    let startDate, count;
    if (selectedPeriod === 'last_3_months') { count = 3; startDate = new Date(); startDate.setMonth(startDate.getMonth() - 2); }
    else if (selectedPeriod === 'last_6_months') { count = 6; startDate = new Date(); startDate.setMonth(startDate.getMonth() - 5); }
    else if (/^\d{4}$/.test(selectedPeriod)) { count = 12; startDate = new Date(parseInt(selectedPeriod), 0, 1); }
    else if (selectedPeriod === 'this_year') { count = new Date().getMonth() + 1; startDate = new Date(currentYear, 0, 1); }
    else { count = 12; startDate = new Date(); startDate.setMonth(startDate.getMonth() - 11); }

    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    for (let i = 0; i < count; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const rev = payments.filter(p => toMonthKey(p.payment_date) === key).reduce((s, p) => s + Number(p.amount || 0), 0);
      const lds = leads.filter(l => toMonthKey(l.created_date) === key).length;
      buckets.push({ month: d.toLocaleDateString('en-US', { month: 'short', year: count > 6 ? '2-digit' : undefined }), revenue: rev, leads: lds });
    }
    return buckets;
  }, [selectedPeriod, payments, leads]);

  // AI Analysis Function
  const runAIAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      // Prepare data for AI analysis
      const analysisData = {
        period: periodBounds.label,
        total_leads: periodLeads.length,
        won_deals: wonDeals,
        conversion_rate: conversionRate,
        total_revenue: totalRevenue,
        avg_deal_size: avgDealSize,
        pipeline_value: pipelineValue,
        hot_leads: hotLeads,
        ai_analyzed_calls: aiAnalyzedCalls,
        positive_sentiment_calls: positiveSentiment,
        quote_requests: quoteRequests,
        lead_sources: periodLeads.reduce((acc, l) => {
          acc[l.source] = (acc[l.source] || 0) + 1;
          return acc;
        }, {}),
        top_hot_leads: leadScores.filter(s => s.temperature === 'hot').slice(0, 5).map(s => ({
          name: s.lead_name,
          score: s.total_score
        })),
        recent_communications: periodCommunications.slice(0, 20).map(c => ({
          type: c.communication_type,
          sentiment: c.sentiment,
          intent: c.intent,
          contact: c.contact_name
        })),
        monthly_trends: chartMonths
      };

      const prompt = `You are an AI sales analyst. Analyze the following sales data for the period "${periodBounds.label}" and provide actionable insights:

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
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Brain className="w-8 h-8 text-purple-600" />
            AI Sales Intelligence
          </h1>
          <p className="text-gray-500 mt-1">AI-powered insights and predictive analytics</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedPeriod} onValueChange={(v) => { setSelectedPeriod(v); setAiInsights(null); }}>
            <SelectTrigger className="w-44" data-testid="select-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button 
            onClick={runAIAnalysis}
            disabled={isAnalyzing}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
            data-testid="button-generate-insights"
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
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8" />
              <span className="text-sm opacity-80">Total Revenue</span>
            </div>
            <h3 className="text-3xl font-bold">${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3>
            <p className="text-sm opacity-80 mt-1">{periodPayments.length} payment{periodPayments.length !== 1 ? 's' : ''} · {periodBounds.label}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8" />
              <span className="text-sm opacity-80">Lead Conversion</span>
            </div>
            <h3 className="text-3xl font-bold">{conversionRate}%</h3>
            <p className="text-sm opacity-80 mt-1">{wonDeals} won of {periodLeads.length} leads</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-8 h-8" />
              <span className="text-sm opacity-80">Pipeline Value</span>
            </div>
            <h3 className="text-3xl font-bold">${pipelineValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</h3>
            <p className="text-sm opacity-80 mt-1">{openEstimatesCount} open estimate{openEstimatesCount !== 1 ? 's' : ''}</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Award className="w-8 h-8" />
              <span className="text-sm opacity-80">Avg Invoice Value</span>
            </div>
            <h3 className="text-3xl font-bold">${Number(avgInvoiceValue).toLocaleString('en-US', { maximumFractionDigits: 0 })}</h3>
            <p className="text-sm opacity-80 mt-1">{paidInvoicesCount} paid invoice{paidInvoicesCount !== 1 ? 's' : ''}</p>
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
            <CardTitle>Revenue & Lead Trends — {periodBounds.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartMonths}>
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
              <BarChart data={chartMonths}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Bar dataKey="revenue" fill="#10b981" name="Payments" />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 flex justify-between items-end">
              <div className="text-center">
                <p className="text-sm text-gray-600">{periodBounds.label}</p>
                <p className="text-2xl font-bold text-green-600">
                  ${totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600">All Time</p>
                <p className="text-2xl font-bold text-gray-700">
                  ${payments.reduce((s, p) => s + Number(p.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
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