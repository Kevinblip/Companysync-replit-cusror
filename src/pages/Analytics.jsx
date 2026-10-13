import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  Target,
  Zap,
  Award,
  AlertCircle,
  Calendar
} from "lucide-react";
import { format } from "date-fns";
import { buildCollectionsAnalytics } from "@/utils/collectionsForecast";

const money = value => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(value);
const reportQueryOptions = { staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true };

export default function Analytics() {
  const [forecastLoading, setForecastLoading] = useState(false);
  const [showForecast, setShowForecast] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date());
  const [forecastError, setForecastError] = useState('');

  const { myCompany, staffProfiles, isPermissionsReady, filterCustomers, filterLeads, filterInvoices, filterEstimates, filterPayments } = useRoleBasedData();

  const invoicesQuery = useQuery({
    ...reportQueryOptions,
    queryKey: ['analytics', 'invoices', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Invoice.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });
  const { data: allInvoices = [] } = invoicesQuery;

  const leadsQuery = useQuery({
    ...reportQueryOptions,
    queryKey: ['analytics', 'leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });
  const { data: allLeads = [] } = leadsQuery;

  const customersQuery = useQuery({
    ...reportQueryOptions,
    queryKey: ['analytics', 'customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });
  const { data: allCustomers = [] } = customersQuery;

  const estimatesQuery = useQuery({
    ...reportQueryOptions,
    queryKey: ['analytics', 'estimates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Estimate.filter({ company_id: myCompany.id }, "-created_date", 10000) : [],
    enabled: !!myCompany,
  });
  const { data: allEstimates = [] } = estimatesQuery;

  const paymentsQuery = useQuery({
    ...reportQueryOptions,
    queryKey: ['analytics', 'payments', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Payment.filter({ company_id: myCompany.id }, "-payment_date", 10000) : [],
    enabled: !!myCompany,
  });
  const { data: allPayments = [] } = paymentsQuery;

  const customers = useMemo(() => filterCustomers(allCustomers), [allCustomers, filterCustomers]);
  const leads = useMemo(() => filterLeads(allLeads), [allLeads, filterLeads]);
  const invoices = useMemo(() => filterInvoices(allInvoices, customers), [allInvoices, customers, filterInvoices]);
  const estimates = useMemo(() => filterEstimates(allEstimates, customers), [allEstimates, customers, filterEstimates]);
  const payments = useMemo(() => filterPayments(allPayments, customers), [allPayments, customers, filterPayments]);

  const goalsQuery = useQuery({
    ...reportQueryOptions,
    queryKey: ['analytics', 'revenue-goals', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.RevenueGoal.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });
  const { data: goals = [] } = goalsQuery;

  const report = useMemo(() => buildCollectionsAnalytics({
    payments, invoices, goals, now: asOf, timeZone: myCompany?.timezone || 'America/New_York',
  }), [payments, invoices, goals, asOf, myCompany?.timezone]);
  const queries = [invoicesQuery, leadsQuery, customersQuery, estimatesQuery, paymentsQuery, goalsQuery];
  const dataError = queries.some(query => query.isError);
  const dataReady = !!myCompany?.id && isPermissionsReady && queries.every(query => query.isSuccess);
  const cappedData = [allInvoices, allLeads, allCustomers, allEstimates, allPayments].some(rows => rows.length >= 10000);
  const forecast = showForecast && dataReady && !cappedData ? report.forecast : null;

  // These are separate record counts, not a measured lead-to-customer funnel.
  const getFunnelData = () => {
    const totalLeads = leads.length;
    const qualifiedLeads = leads.filter(l => ['qualified', 'proposal', 'proposal_sent', 'negotiation', 'won'].includes(l.status)).length;
    const proposalsSent = estimates.length;
    const proposalsAccepted = estimates.filter(e => e.status === 'accepted').length;
    return [
      { stage: 'Leads', count: totalLeads },
      { stage: 'Qualified or later-stage leads', count: qualifiedLeads },
      { stage: 'Estimate records', count: proposalsSent },
      { stage: 'Accepted estimates', count: proposalsAccepted },
      { stage: 'Customers', count: customers.length },
      { stage: 'All-time collections', count: money(report.totalCollections) },
    ];
  };

  // Team performance - Sales team with commission rates or revenue
  const getTeamPerformance = () => {
    const members = new Map((staffProfiles || []).filter(profile => profile.user_email)
      .map(profile => [profile.user_email.toLowerCase(), profile]));
    return [...members.entries()].map(([email, profile]) => {
        const collected = report.linkedPayments.filter(row => row.invoice.created_by?.toLowerCase() === email);
        const revenue = collected.reduce((sum, row) => sum + row.amountCents, 0) / 100;
        const dealsCount = new Set(collected.map(row => row.invoice.id)).size;
        return {
          name: profile.full_name || email,
          email,
          revenue,
          deals: dealsCount,
          avgDealSize: dealsCount > 0 ? revenue / dealsCount : 0
        };
      }).filter(member => member.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  };

  // Refresh real records before calculating; no model-generated money or confidence scores.
  const generateForecast = async () => {
    setForecastLoading(true);
    setForecastError('');
    setShowForecast(false);
    try {
      const refreshed = await Promise.all(queries.map(query => query.refetch()));
      if (refreshed.some(result => result.isError)) throw new Error('Could not refresh all records. No forecast was generated.');
      setAsOf(new Date());
      setShowForecast(true);
    } catch (error) {
      console.error('Forecast error:', error);
      setForecastError(error.message);
    }
    setForecastLoading(false);
  };

  const revenueData = report.history;
  const funnelData = getFunnelData();
  const teamPerformance = getTeamPerformance();

  // KPIs
  const thisYearRevenue = report.thisYearCollections;
  const lastMonthRevenue = report.lastMonthCollections;
  const revenueGrowth = report.growthPercent;
  const avgPayment = report.averagePayment;

  const currentMonthGoal = goals.find(g => 
    g.goal_type === 'monthly' && 
    Number(g.year) === report.today.getFullYear() &&
    Number(g.month) === report.today.getMonth() + 1
  );

  const goalProgress = Number(currentMonthGoal?.target_amount) > 0
    ? (report.thisMonthCollections / Number(currentMonthGoal.target_amount) * 100).toFixed(1) : null;

  if (dataError) return (
    <div className="p-6 space-y-3" role="alert">
      <h1 className="text-2xl font-bold">Analytics data could not be loaded</h1>
      <p>No forecast is shown from incomplete data.</p>
      <Button onClick={() => queries.forEach(query => query.refetch())}>Retry loading</Button>
    </div>
  );
  if (!dataReady) return <div className="p-6 text-gray-600" role="status">Loading collections and invoice records…</div>;
  if (cappedData) return <div className="p-6" role="alert">The analytics record limit was reached. Totals and forecasts are hidden to avoid reporting incomplete data.</div>;

  return (
    <div className="min-w-0 p-3 pb-28 sm:p-6 sm:pb-28 lg:pb-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex flex-col gap-4 xl:flex-row xl:justify-between xl:items-start">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-gray-900">Advanced Analytics</h1>
          <p className="text-gray-500 mt-1">Actual cash collections and transparent forecasting</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600">
            <span className="font-medium text-gray-800">Historical window:</span> Last 12 months
          </div>
          <Button 
            onClick={generateForecast}
            disabled={forecastLoading}
            className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            {forecastLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Forecasting...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Generate Forecast
              </>
            )}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 opacity-80" />
              {revenueGrowth !== null && <Badge className="bg-white/20 text-white border-0">
                {revenueGrowth > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                {Math.abs(revenueGrowth).toFixed(1)}%
              </Badge>}
            </div>
            <h3 className="text-2xl font-bold">{money(lastMonthRevenue)}</h3>
            <p className="text-sm opacity-80">Last Month Collections</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8 opacity-80" />
            </div>
            <h3 className="text-2xl font-bold">{money(avgPayment)}</h3>
            <p className="text-sm opacity-80">Average Received Payment</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 opacity-80" />
              <Badge className="bg-white/20 text-white border-0">
                {customers.filter(customer => customer.is_active).length} active
              </Badge>
            </div>
            <h3 className="text-2xl font-bold">{customers.length}</h3>
            <p className="text-sm opacity-80">Customers</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <CardContent className="p-3 sm:p-6">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-8 h-8 opacity-80" />
              <Badge className="bg-white/20 text-white border-0">
                YTD
              </Badge>
            </div>
            <h3 className="text-2xl font-bold">{money(thisYearRevenue)}</h3>
            <p className="text-sm opacity-80">This Year Collections</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-sm text-gray-600">
        This month to date: <strong>{money(report.thisMonthCollections)}</strong> as of {format(report.today, 'MMM d, yyyy')}.
        {goalProgress !== null && ` ${goalProgress}% of this month's ${money(currentMonthGoal.target_amount)} collection goal.`}
      </p>
      {forecastError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{forecastError}</p>}
      {report.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <p className="font-semibold">Records needing attention</p>
          <ul className="list-disc pl-5">{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}

      {/* Transparent, read-only collections forecast */}
      {forecast && (
        <Card className="bg-gradient-to-br from-purple-50 to-blue-50 border-2 border-purple-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-purple-600" />
              Collections Forecast — Next 3 Months
            </CardTitle>
            <p className="text-sm text-gray-600">
              A recent-collections baseline, not guaranteed revenue. Invoice balances due are shown separately and are not added to the baseline.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {forecast.predictions.map((pred) => (
                <div key={pred.key} className="bg-white p-4 rounded-lg shadow-sm">
                  <p className="text-sm font-medium text-gray-600 mb-1">{pred.month}</p>
                  <p className="text-xl sm:text-2xl font-bold text-purple-600">
                    {pred.baseline === null ? 'Not enough history' : money(pred.baseline)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Recent monthly average · no seasonal adjustment</p>
                  <div className="mt-3 border-t pt-3 text-sm text-gray-600">
                    <p>Open invoices due: <strong>{money(forecast.dueMonths[pred.key].amount)}</strong></p>
                    <p className="text-xs">{forecast.dueMonths[pred.key].count} invoice(s) · due dates are not guaranteed collection dates</p>
                  </div>
                </div>
                ))}
              </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-lg">
                <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  How the baseline is calculated
                </h4>
                {forecast.sufficientHistory ? (
                  <div className="space-y-2 text-sm text-gray-600">
                    <p>Average of the last 3 completed calendar months:</p>
                    {forecast.sourceMonths.map(month => <p key={month.key}>{month.month}: <strong>{money(month.revenue)}</strong></p>)}
                    <p>Recent monthly range: {money(forecast.range[0])}–{money(forecast.range[1])}. This is observed variation, not a confidence interval.</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">At least 3 completed calendar months of recorded payment history are required. No amount is guessed when history is insufficient.</p>
                )}
                <p className="mt-3 text-xs text-gray-500">The current partial month is excluded. Missing imports can affect this baseline; months before the first recorded payment are shown as gaps. Scheduled work, unsigned estimates, and weather seasonality are not assumed to be received cash.</p>
              </div>

              <div className="bg-white p-4 rounded-lg">
                <h4 className="font-semibold text-gray-700 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-600" />
                  Balances outside these future months
                </h4>
                <div className="space-y-2 text-sm text-gray-600">
                  <p>Past due: <strong>{money(forecast.buckets.overdue)}</strong></p>
                  <p>Due later this month: <strong>{money(forecast.buckets.thisMonth)}</strong></p>
                  <p>No valid due date: <strong>{money(forecast.buckets.undated)}</strong></p>
                  <p>Due after the forecast window: <strong>{money(forecast.buckets.later)}</strong></p>
                  <p className="text-xs">These are remaining balances after recorded payments and withheld credits. Draft/cancelled invoices and balances needing payment-link review are excluded. No overdue or undated balance is assigned a guessed collection date.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Historical Revenue (Actuals)</CardTitle>
          <p className="text-sm text-gray-600">
            Actual cash received for the trailing 12 calendar months; the current month is marked MTD (month to date).
            This chart does not include forecast amounts or invoice face values.
          </p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => money(value)} />
              <Legend />
              <Area type="monotone" dataKey="revenue" stroke="#10b981" fill="url(#colorRevenue)" name="Actual Collections" connectNulls={false} />
              {goals.length > 0 && <Line type="monotone" dataKey="goal" stroke="#f59e0b" strokeDasharray="5 5" name="Saved Goal" />}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Conversion Funnel */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Activity (Recorded)</CardTitle>
          <p className="text-sm text-gray-600">Separate record counts, not a measured conversion funnel. Customers are not inferred from leads marked “won”.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {funnelData.map((stage, idx) => (
              <div key={idx} className="border-b border-gray-100 last:border-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-gray-700">{stage.stage}</span>
                  <span className="text-sm text-gray-600">
                    {stage.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Team Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-500" />
            Team Performance Leaderboard
          </CardTitle>
          <p className="text-sm text-gray-600">Recorded collections attributed to invoice creators. Unlinked payments are not assigned to a staff member.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {teamPerformance.map((member, idx) => (
              <div key={idx} className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 text-white font-bold text-lg">
                  {idx + 1}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{member.name}</p>
                  <p className="text-sm text-gray-500">{member.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-green-600">
                    {money(member.revenue)}
                  </p>
                  <p className="text-sm text-gray-500">
                    {member.deals} invoice(s) with receipts • {money(member.avgDealSize)} average collected
                  </p>
                </div>
                {idx === 0 && (
                  <Award className="w-8 h-8 text-yellow-500" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}