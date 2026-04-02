import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Download, CheckCircle2, Bug, TrendingUp, Filter, Search, ChevronDown, ChevronUp, FileText, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import useTranslation from "@/hooks/useTranslation";

export default function BugTrackerReport() {
  const { t } = useTranslation();
  const [expandedBugs, setExpandedBugs] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  const reportData = {
    generated: '2026-02-09T15:25:58.010Z',
    summary: {
      critical: 6,
      high: 3,
      medium: 4,
      low: 2,
      totalOpen: 15,
      working: 20
    },
    bugs: [
      {
        id: 'BUG-001',
        title: 'Lexi Live Voice - Interruption Not Working',
        category: 'AI / Voice',
        severity: 'CRITICAL',
        status: 'open',
        description: 'User CANNOT interrupt Lexi while she is speaking. Two-way conversation is impossible - must wait for Lexi to finish completely before speaking.',
        technical: 'GeminiLiveClient has interruption logic (lines 671-709) but VAD threshold is too high, audio queue clearing isn\'t fast enough, and WebSocket interrupt signal may not be processed by Gemini. Requires WebRTC-based real-time streaming to fix properly.',
        files: ['components/ai/GeminiLiveClient', 'functions/generateLexiVoiceToken'],
        steps: [
          'Go to AI Assistant → Live Voice mode',
          'Start speaking',
          'Try to interrupt while Lexi is talking',
          'Notice she keeps talking'
        ],
        workaround: 'Use text chat mode instead of live voice.'
      },
      {
        id: 'BUG-002',
        title: 'Lexi Live Voice - Connection Instability',
        category: 'AI / Voice',
        severity: 'CRITICAL',
        status: 'open',
        description: 'Live voice WebSocket drops frequently, audio playback issues, and inconsistent AI responses. Feature is essentially non-functional.',
        technical: 'Railway-hosted bridge has timeout issues. AudioContext unlocking on mobile is fragile. The entire architecture needs redesign for production use.',
        files: ['components/ai/GeminiLiveClient', 'pages/GeminiLiveMode'],
        steps: [
          'Start Live Voice session',
          'Wait 30-60 seconds',
          'Connection often drops or audio stops playing'
        ],
        workaround: 'Use text chat mode.'
      },
      {
        id: 'BUG-003',
        title: 'Google Calendar Two-Way Sync NOT Working',
        category: 'Integrations',
        severity: 'CRITICAL',
        status: 'open',
        description: 'Events created in Google Calendar do NOT sync back to CompanySync. Only one-way sync works (CompanySync → Google).',
        technical: 'Google Calendar webhooks require domain verification in Google Cloud Console. The setupGoogleCalendarWatch function attempts to create a watch but Google rejects the webhook URL. Error: \'Channel id not unique\' or domain not verified.',
        files: ['functions/googleCalendarWebhook', 'functions/setupGoogleCalendarWatch', 'functions/syncGoogleCalendar'],
        steps: [
          'Connect Google Calendar',
          'Create an event in Google Calendar',
          'Check CompanySync calendar - event doesn\'t appear'
        ],
        workaround: 'Manually click \'Sync Now\' button on Calendar page, or create events in CompanySync only.'
      },
      {
        id: 'BUG-013',
        title: 'Sarah - Twilio Inbound Calls Not Working',
        category: 'AI / Voice',
        severity: 'CRITICAL',
        status: 'open',
        description: 'Sarah does not answer inbound phone calls via Twilio. Calls may ring but no AI response.',
        technical: 'sarahVoiceCallHandler uses Twilio TwiML with Polly.Joanna voice. Issue could be: 1) Twilio webhook URL not configured correctly, 2) Function not deployed, 3) TwiML response format issues, 4) Twilio credentials misconfigured.',
        files: ['functions/sarahVoiceCallHandler', 'functions/incomingCall'],
        steps: [
          'Call the Twilio phone number',
          'Expect Sarah to answer',
          'No response or call fails'
        ],
        workaround: 'None - feature non-functional.'
      },
      {
        id: 'BUG-014',
        title: 'Sarah - SMS Responses Not Working',
        category: 'AI / Voice',
        severity: 'CRITICAL',
        status: 'open',
        description: 'Sarah does not respond to incoming SMS messages from customers.',
        technical: 'incomingSMS function handles SMS but may not be triggering correctly. Possible issues: 1) Twilio SMS webhook not pointing to correct endpoint, 2) Function errors preventing response, 3) Company/settings lookup failing.',
        files: ['functions/incomingSMS', 'functions/incomingSMSWebhook', 'pages/SarahSettings'],
        steps: [
          'Send SMS to Twilio number',
          'Expect Sarah to reply',
          'No response received'
        ],
        workaround: 'None - feature non-functional.'
      },
      {
        id: 'BUG-015',
        title: 'Sarah - Gemini Live Voice Mode Not Working',
        category: 'AI / Voice',
        severity: 'CRITICAL',
        status: 'open',
        description: 'Sarah\'s real-time Gemini voice mode (similar to Lexi Live) is completely non-functional.',
        technical: 'Same architectural issues as Lexi Live Voice - WebSocket instability, AudioContext problems, interruption not working. The \'Live Mode\' toggle in Sarah Settings enables this but it doesn\'t function.',
        files: ['pages/SarahSettings', 'components/ai/GeminiLiveClient'],
        steps: [
          'Enable Live Mode in Sarah Settings',
          'Attempt real-time voice conversation',
          'Feature doesn\'t work'
        ],
        workaround: 'Disable Live Mode - use standard Twilio TwiML flow instead (also broken).'
      },
      {
        id: 'BUG-004',
        title: 'Duplicate Company Records Created',
        category: 'Data',
        severity: 'HIGH',
        status: 'open',
        description: 'Some users end up with multiple company records, causing data to split between them and visibility issues.',
        technical: 'Race condition during signup when multiple browser tabs are open, or when refreshing during company creation. No deduplication check on create.',
        files: ['functions/autoSetupCompany', 'pages/QuickSetup'],
        steps: [
          'Open multiple tabs during signup',
          'Complete setup in one tab',
          'Refresh other tabs - may create duplicate companies'
        ],
        workaround: 'Use Utilities → Company Cleanup to merge/delete duplicates.'
      },
      {
        id: 'BUG-005',
        title: 'Missing company_id on Legacy Records',
        category: 'Data',
        severity: 'HIGH',
        status: 'open',
        description: 'Some older leads, customers, and other records are missing company_id, making them invisible in filtered views.',
        technical: 'Data created before multi-tenancy was implemented doesn\'t have company_id. Backfill scripts exist but may not have run on all records.',
        files: ['functions/backfillAllCompanyIds', 'functions/populateCompanyIds'],
        steps: [
          'Check old records',
          'Some may be missing from list views despite existing in database'
        ],
        workaround: 'Run backfill from Utilities page, or manually update records.'
      },
      {
        id: 'BUG-006',
        title: 'Invoice Status Not Updating After Payment',
        category: 'Invoices',
        severity: 'HIGH',
        status: 'open',
        description: 'When a payment is recorded, invoice status sometimes doesn\'t update to \'paid\' or \'partially_paid\' correctly.',
        technical: 'The payment recording flow doesn\'t always trigger the invoice status recalculation. Manual \'Fix Statuses\' button exists but shouldn\'t be needed.',
        files: ['pages/Payments', 'pages/Invoices', 'functions/recalculateInvoicePayments'],
        steps: [
          'Create invoice',
          'Record full payment',
          'Check invoice - may still show \'sent\' instead of \'paid\''
        ],
        workaround: 'Click \'Fix Statuses\' button on Invoices page.'
      },
      {
        id: 'BUG-007',
        title: 'Twilio Calling Needs Verification',
        category: 'Communication',
        severity: 'MEDIUM',
        status: 'needs_verification',
        description: 'Outbound calling via Twilio dialer may not work correctly - needs testing and verification.',
        technical: 'Twilio credentials are configured but actual call flow hasn\'t been thoroughly tested. May have issues with call recording, status callbacks.',
        files: ['components/communication/Dialer', 'functions/makeCall', 'functions/callStatusWebhook'],
        steps: [
          'Open Dialer',
          'Attempt to make a call',
          'Verify call connects and recording works'
        ],
        workaround: 'Use external phone for calls until verified.'
      },
      {
        id: 'BUG-008',
        title: 'Google Calendar Watch Channels Expire',
        category: 'Calendar',
        severity: 'MEDIUM',
        status: 'open',
        description: 'Watch channels expire after 7 days and aren\'t automatically renewed, causing sync to stop working.',
        technical: 'No scheduled job to renew watch channels. After 7 days, Google stops sending webhook notifications.',
        files: ['functions/setupGoogleCalendarWatch'],
        steps: [
          'Set up calendar sync',
          'Wait 7+ days',
          'Sync stops working'
        ],
        workaround: 'Re-run setupGoogleCalendarWatch manually every week.'
      },
      {
        id: 'BUG-009',
        title: 'Estimate Customer Linking Inconsistent',
        category: 'Estimates',
        severity: 'MEDIUM',
        status: 'open',
        description: 'Some estimates don\'t properly link to customer records, making them hard to find in customer profiles.',
        technical: 'customer_id field not always populated when estimate is created from AI Estimator or quick flows.',
        files: ['pages/CreateEstimate', 'functions/linkEstimatesToCustomers'],
        steps: [
          'Create estimate without selecting existing customer',
          'Check customer profile - estimate may not appear'
        ],
        workaround: 'Manually link estimate to customer, or run linkEstimatesToCustomers function.'
      },
      {
        id: 'BUG-010',
        title: 'Workflow Triggers Inconsistent',
        category: 'Workflows',
        severity: 'MEDIUM',
        status: 'open',
        description: 'Automated workflows sometimes don\'t trigger when expected, or trigger multiple times.',
        technical: 'Race conditions in autoTriggerWorkflows function. Entity mutations may not always reach the trigger check.',
        files: ['functions/autoTriggerWorkflows', 'functions/executeWorkflow'],
        steps: [
          'Set up workflow trigger on lead creation',
          'Create leads rapidly',
          'Some triggers may be missed'
        ],
        workaround: 'Use manual workflow execution as backup.'
      },
      {
        id: 'BUG-011',
        title: 'Mobile Sidebar Doesn\'t Always Close',
        category: 'UI',
        severity: 'LOW',
        status: 'open',
        description: 'On mobile, tapping a menu item sometimes doesn\'t close the sidebar properly.',
        technical: 'Race condition between navigation and sidebar close animation.',
        files: ['layout'],
        steps: [
          'Open app on mobile',
          'Open sidebar',
          'Tap menu item quickly',
          'Sidebar may stay open'
        ],
        workaround: 'Tap outside sidebar to close it.'
      },
      {
        id: 'BUG-012',
        title: 'Report Builder Preview Sometimes Blank',
        category: 'Reports',
        severity: 'LOW',
        status: 'open',
        description: 'When building custom reports, the preview panel occasionally shows blank instead of data.',
        technical: 'React Query caching issue with report preview data.',
        files: ['pages/ReportBuilder'],
        steps: [
          'Open Report Builder',
          'Configure report',
          'Preview may be blank on first load'
        ],
        workaround: 'Click \'Refresh Preview\' button or wait a moment.'
      }
    ],
    workingFeatures: [
      { name: 'Lexi AI Text Chat', category: 'AI', description: 'Full CRM tool calling works in text mode' },
      { name: 'AI Estimator', category: 'AI', description: 'Satellite measurements and document extraction functional' },
      { name: 'Lexi Memory', category: 'AI', description: 'Personal preferences save correctly' },
      { name: 'Calendar Events (One-Way)', category: 'Calendar', description: 'CompanySync → Google works, reminders work' },
      { name: 'Email Reminders', category: 'Communication', description: 'Scheduled automation sends reminders' },
      { name: 'SMS Reminders', category: 'Communication', description: 'Twilio SMS working for notifications' },
      { name: 'Lead Management', category: 'CRM', description: 'CRUD operations, scoring, temperature tracking' },
      { name: 'Customer Management', category: 'CRM', description: 'Full CRUD with multi-assignment' },
      { name: 'Estimates', category: 'Sales', description: 'Creation, merging, PDF generation' },
      { name: 'Invoices', category: 'Sales', description: 'Creation, PDF, payment links (status sync has issues)' },
      { name: 'Payments', category: 'Sales', description: 'Recording payments, linking to invoices' },
      { name: 'CrewCam Integration', category: 'Operations', description: 'Job sync, photo upload, assignments' },
      { name: 'Email Sending', category: 'Communication', description: 'Resend API functional' },
      { name: 'SMS Sending', category: 'Communication', description: 'Twilio API functional' },
      { name: 'In-App Notifications', category: 'Notifications', description: 'Bell notifications, real-time updates' },
      { name: 'Role-Based Access', category: 'Security', description: 'Permissions, admin vs user views' },
      { name: 'Multi-Tenancy', category: 'Security', description: 'Company isolation working (except legacy data)' },
      { name: 'Stripe Payments', category: 'Billing', description: 'Customer payments, subscription billing' },
      { name: 'Document Storage', category: 'Documents', description: 'Upload, view, categorization' },
      { name: 'Task Management', category: 'Operations', description: 'Kanban boards, assignments, reminders' }
    ]
  };

  const toggleBug = (bugId) => {
    setExpandedBugs(prev => ({
      ...prev,
      [bugId]: !prev[bugId]
    }));
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'CRITICAL': return 'bg-red-100 text-red-800 border-red-300';
      case 'HIGH': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'LOW': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'CRITICAL': return '🔴';
      case 'HIGH': return '🟠';
      case 'MEDIUM': return '🟡';
      case 'LOW': return '🔵';
      default: return '⚪';
    }
  };

  const categories = ['all', ...new Set(reportData.bugs.map(b => b.category))];
  const severities = ['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

  const filteredBugs = reportData.bugs.filter(bug => {
    const matchesSearch = bug.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         bug.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         bug.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || bug.category === categoryFilter;
    const matchesSeverity = severityFilter === 'all' || bug.severity === severityFilter;
    
    return matchesSearch && matchesCategory && matchesSeverity;
  });

  const handleExport = () => {
    const textReport = `COMPANYSYNC CRM - BUG TRACKER REPORT
Generated: ${new Date(reportData.generated).toLocaleString()}

SUMMARY:
- Critical Issues: ${reportData.summary.critical}
- High Priority: ${reportData.summary.high}
- Total Open: ${reportData.summary.totalOpen}
- Working Features: ${reportData.summary.working}

KNOWN BUGS
${reportData.bugs.map(bug => `
[${bug.id}] ${bug.title}
Category: ${bug.category} | Severity: ${bug.severity}
Description: ${bug.description}
Technical: ${bug.technical}
Files: ${bug.files.join(', ')}
Steps: ${bug.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}
Workaround: ${bug.workaround}
`).join('\n' + '='.repeat(60) + '\n')}

WORKING FEATURES
${reportData.workingFeatures.map(f => `✅ ${f.name} (${f.category}): ${f.description}`).join('\n')}`;

    const blob = new Blob([textReport], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bug-report-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-orange-50 to-yellow-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 to-orange-600 rounded-2xl shadow-2xl p-8 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold flex items-center gap-3 mb-2">
                <Bug className="w-10 h-10" />
                {t.sidebar.bugTracker || "CRM Bug Tracker & System Audit"}
              </h1>
              <p className="text-white/90 text-lg">
                Known issues and working features as of {new Date(reportData.generated).toLocaleDateString()}
              </p>
            </div>
            <Button 
              onClick={handleExport}
              className="bg-white text-red-600 hover:bg-red-50"
              data-testid="button-export-report"
            >
              <Download className="w-4 h-4 mr-2" />
              {t.common.export || "Export Report"}
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="border-2 border-red-200 bg-red-50">
            <CardContent className="p-6 text-center">
              <div className="text-5xl font-bold text-red-600 mb-2">{reportData.summary.critical}</div>
              <div className="flex items-center justify-center gap-2 text-red-700 font-semibold">
                <AlertTriangle className="w-5 h-5" />
                {t.inspections.severity === 'Severity' ? 'Critical' : t.inspections.severity}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-orange-200 bg-orange-50">
            <CardContent className="p-6 text-center">
              <div className="text-5xl font-bold text-orange-600 mb-2">{reportData.summary.high}</div>
              <div className="flex items-center justify-center gap-2 text-orange-700 font-semibold">
                <TrendingUp className="w-5 h-5" />
                {t.tasks.high}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-yellow-200 bg-yellow-50">
            <CardContent className="p-6 text-center">
              <div className="text-5xl font-bold text-yellow-600 mb-2">{reportData.summary.totalOpen}</div>
              <div className="flex items-center justify-center gap-2 text-yellow-700 font-semibold">
                <FileText className="w-5 h-5" />
                {t.common.total} {t.common.new}
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-200 bg-green-50">
            <CardContent className="p-6 text-center">
              <div className="text-5xl font-bold text-green-600 mb-2">{reportData.summary.working}</div>
              <div className="flex items-center justify-center gap-2 text-green-700 font-semibold">
                <CheckCircle2 className="w-5 h-5" />
                {t.common.completed}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder={t.common.search + "..."}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search-bugs"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-48" data-testid="select-category-filter">
                    <SelectValue placeholder={t.accounting.category || "All Categories"} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>
                        {cat === 'all' ? (t.common.all + " " + (t.accounting.category || "Categories")) : cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="w-48" data-testid="select-severity-filter">
                    <SelectValue placeholder={t.inspections.severity || "All Severities"} />
                  </SelectTrigger>
                  <SelectContent>
                    {severities.map(sev => (
                      <SelectItem key={sev} value={sev}>
                        {sev === 'all' ? (t.common.all + " " + (t.inspections.severity || "Severities")) : (t.tasks[sev.toLowerCase()] || sev)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="bugs" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 bg-white">
            <TabsTrigger value="bugs" className="flex items-center gap-2" data-testid="tabs-trigger-bugs">
              <Bug className="w-4 h-4" />
              {t.sidebar.bugTracker || "Known Bugs"} ({filteredBugs.length})
            </TabsTrigger>
            <TabsTrigger value="working" className="flex items-center gap-2" data-testid="tabs-trigger-working">
              <CheckCircle2 className="w-4 h-4" />
              {t.common.completed || "Working Features"} ({reportData.workingFeatures.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bugs" className="space-y-4">
            {/* Critical Issues */}
            {filteredBugs.filter(b => b.severity === 'CRITICAL').length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                  {t.tasks.high}
                </h2>
                <div className="space-y-4">
                  {filteredBugs.filter(b => b.severity === 'CRITICAL').map(bug => (
                    <Card key={bug.id} className="border-2 border-red-200 bg-red-50 hover:shadow-lg transition-shadow" data-testid={`card-bug-${bug.id}`}>
                      <CardHeader className="cursor-pointer" onClick={() => toggleBug(bug.id)} data-testid={`button-toggle-bug-${bug.id}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge className="bg-gray-800 text-white" data-testid={`text-bug-id-${bug.id}`}>{bug.id}</Badge>
                              <Badge className={getSeverityColor(bug.severity)} data-testid={`text-bug-severity-${bug.id}`}>
                                {getSeverityIcon(bug.severity)} {t.tasks[bug.severity.toLowerCase()] || bug.severity}
                              </Badge>
                              <Badge variant="outline" className="border-blue-300" data-testid={`text-bug-category-${bug.id}`}>{bug.category}</Badge>
                            </div>
                            <CardTitle className="text-xl text-gray-900" data-testid={`text-bug-title-${bug.id}`}>{bug.title}</CardTitle>
                            <p className="text-gray-700 mt-2" data-testid={`text-bug-description-${bug.id}`}>{bug.description}</p>
                          </div>
                          <Button variant="ghost" size="sm">
                            {expandedBugs[bug.id] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </Button>
                        </div>
                      </CardHeader>
                      
                      {expandedBugs[bug.id] && (
                        <CardContent className="space-y-4 bg-white rounded-b-lg border-t-2 border-red-200">
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              {t.common.description}
                            </h4>
                            <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded border" data-testid={`text-bug-technical-${bug.id}`}>{bug.technical}</p>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">📂 Affected Files</h4>
                            <div className="flex flex-wrap gap-2">
                              {bug.files.map((file, idx) => (
                                <Badge key={idx} variant="outline" className="font-mono text-xs" data-testid={`badge-bug-file-${bug.id}-${idx}`}>
                                  {file}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">🔄 Steps to Reproduce</h4>
                            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                              {bug.steps.map((step, idx) => (
                                <li key={idx} data-testid={`text-bug-step-${bug.id}-${idx}`}>{step}</li>
                              ))}
                            </ol>
                          </div>

                          <div className="bg-blue-50 border border-blue-200 rounded p-3" data-testid={`container-bug-workaround-${bug.id}`}>
                            <h4 className="font-semibold text-blue-900 mb-1">💡 Workaround</h4>
                            <p className="text-sm text-blue-800" data-testid={`text-bug-workaround-${bug.id}`}>{bug.workaround}</p>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* High Priority Issues */}
            {filteredBugs.filter(b => b.severity === 'HIGH').length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <TrendingUp className="w-6 h-6 text-orange-600" />
                  {t.tasks.high}
                </h2>
                <div className="space-y-4">
                  {filteredBugs.filter(b => b.severity === 'HIGH').map(bug => (
                    <Card key={bug.id} className="border-2 border-orange-200 bg-orange-50 hover:shadow-lg transition-shadow" data-testid={`card-bug-${bug.id}`}>
                      <CardHeader className="cursor-pointer" onClick={() => toggleBug(bug.id)} data-testid={`button-toggle-bug-${bug.id}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge className="bg-gray-800 text-white" data-testid={`text-bug-id-${bug.id}`}>{bug.id}</Badge>
                              <Badge className={getSeverityColor(bug.severity)} data-testid={`text-bug-severity-${bug.id}`}>
                                {getSeverityIcon(bug.severity)} {t.tasks[bug.severity.toLowerCase()] || bug.severity}
                              </Badge>
                              <Badge variant="outline" className="border-blue-300" data-testid={`text-bug-category-${bug.id}`}>{bug.category}</Badge>
                            </div>
                            <CardTitle className="text-xl text-gray-900" data-testid={`text-bug-title-${bug.id}`}>{bug.title}</CardTitle>
                            <p className="text-gray-700 mt-2" data-testid={`text-bug-description-${bug.id}`}>{bug.description}</p>
                          </div>
                          <Button variant="ghost" size="sm">
                            {expandedBugs[bug.id] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </Button>
                        </div>
                      </CardHeader>
                      
                      {expandedBugs[bug.id] && (
                        <CardContent className="space-y-4 bg-white rounded-b-lg border-t-2 border-orange-200">
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              {t.common.description}
                            </h4>
                            <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded border" data-testid={`text-bug-technical-${bug.id}`}>{bug.technical}</p>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">📂 Affected Files</h4>
                            <div className="flex flex-wrap gap-2">
                              {bug.files.map((file, idx) => (
                                <Badge key={idx} variant="outline" className="font-mono text-xs" data-testid={`badge-bug-file-${bug.id}-${idx}`}>
                                  {file}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">🔄 Steps to Reproduce</h4>
                            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                              {bug.steps.map((step, idx) => (
                                <li key={idx} data-testid={`text-bug-step-${bug.id}-${idx}`}>{step}</li>
                              ))}
                            </ol>
                          </div>

                          <div className="bg-blue-50 border border-blue-200 rounded p-3" data-testid={`container-bug-workaround-${bug.id}`}>
                            <h4 className="font-semibold text-blue-900 mb-1">💡 Workaround</h4>
                            <p className="text-sm text-blue-800" data-testid={`text-bug-workaround-${bug.id}`}>{bug.workaround}</p>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Medium Priority Issues */}
            {filteredBugs.filter(b => b.severity === 'MEDIUM').length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <AlertCircle className="w-6 h-6 text-yellow-600" />
                  {t.tasks.medium}
                </h2>
                <div className="space-y-4">
                  {filteredBugs.filter(b => b.severity === 'MEDIUM').map(bug => (
                    <Card key={bug.id} className="border-2 border-yellow-200 bg-yellow-50 hover:shadow-lg transition-shadow" data-testid={`card-bug-${bug.id}`}>
                      <CardHeader className="cursor-pointer" onClick={() => toggleBug(bug.id)} data-testid={`button-toggle-bug-${bug.id}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge className="bg-gray-800 text-white" data-testid={`text-bug-id-${bug.id}`}>{bug.id}</Badge>
                              <Badge className={getSeverityColor(bug.severity)} data-testid={`text-bug-severity-${bug.id}`}>
                                {getSeverityIcon(bug.severity)} {t.tasks[bug.severity.toLowerCase()] || bug.severity}
                              </Badge>
                              <Badge variant="outline" className="border-blue-300" data-testid={`text-bug-category-${bug.id}`}>{bug.category}</Badge>
                            </div>
                            <CardTitle className="text-xl text-gray-900" data-testid={`text-bug-title-${bug.id}`}>{bug.title}</CardTitle>
                            <p className="text-gray-700 mt-2" data-testid={`text-bug-description-${bug.id}`}>{bug.description}</p>
                          </div>
                          <Button variant="ghost" size="sm">
                            {expandedBugs[bug.id] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </Button>
                        </div>
                      </CardHeader>
                      
                      {expandedBugs[bug.id] && (
                        <CardContent className="space-y-4 bg-white rounded-b-lg border-t-2 border-yellow-200">
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              {t.common.description}
                            </h4>
                            <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded border" data-testid={`text-bug-technical-${bug.id}`}>{bug.technical}</p>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">📂 Affected Files</h4>
                            <div className="flex flex-wrap gap-2">
                              {bug.files.map((file, idx) => (
                                <Badge key={idx} variant="outline" className="font-mono text-xs" data-testid={`badge-bug-file-${bug.id}-${idx}`}>
                                  {file}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">🔄 Steps to Reproduce</h4>
                            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                              {bug.steps.map((step, idx) => (
                                <li key={idx} data-testid={`text-bug-step-${bug.id}-${idx}`}>{step}</li>
                              ))}
                            </ol>
                          </div>

                          <div className="bg-blue-50 border border-blue-200 rounded p-3" data-testid={`container-bug-workaround-${bug.id}`}>
                            <h4 className="font-semibold text-blue-900 mb-1">💡 Workaround</h4>
                            <p className="text-sm text-blue-800" data-testid={`text-bug-workaround-${bug.id}`}>{bug.workaround}</p>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Low Priority Issues */}
            {filteredBugs.filter(b => b.severity === 'LOW').length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <Bug className="w-6 h-6 text-blue-600" />
                  {t.tasks.low}
                </h2>
                <div className="space-y-4">
                  {filteredBugs.filter(b => b.severity === 'LOW').map(bug => (
                    <Card key={bug.id} className="border-2 border-blue-200 bg-blue-50 hover:shadow-lg transition-shadow" data-testid={`card-bug-${bug.id}`}>
                      <CardHeader className="cursor-pointer" onClick={() => toggleBug(bug.id)} data-testid={`button-toggle-bug-${bug.id}`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge className="bg-gray-800 text-white" data-testid={`text-bug-id-${bug.id}`}>{bug.id}</Badge>
                              <Badge className={getSeverityColor(bug.severity)} data-testid={`text-bug-severity-${bug.id}`}>
                                {getSeverityIcon(bug.severity)} {t.tasks[bug.severity.toLowerCase()] || bug.severity}
                              </Badge>
                              <Badge variant="outline" className="border-blue-300" data-testid={`text-bug-category-${bug.id}`}>{bug.category}</Badge>
                            </div>
                            <CardTitle className="text-xl text-gray-900" data-testid={`text-bug-title-${bug.id}`}>{bug.title}</CardTitle>
                            <p className="text-gray-700 mt-2" data-testid={`text-bug-description-${bug.id}`}>{bug.description}</p>
                          </div>
                          <Button variant="ghost" size="sm">
                            {expandedBugs[bug.id] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                          </Button>
                        </div>
                      </CardHeader>
                      
                      {expandedBugs[bug.id] && (
                        <CardContent className="space-y-4 bg-white rounded-b-lg border-t-2 border-blue-200">
                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                              <FileText className="w-4 h-4" />
                              {t.common.description}
                            </h4>
                            <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded border" data-testid={`text-bug-technical-${bug.id}`}>{bug.technical}</p>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">📂 Affected Files</h4>
                            <div className="flex flex-wrap gap-2">
                              {bug.files.map((file, idx) => (
                                <Badge key={idx} variant="outline" className="font-mono text-xs" data-testid={`badge-bug-file-${bug.id}-${idx}`}>
                                  {file}
                                </Badge>
                              ))}
                            </div>
                          </div>

                          <div>
                            <h4 className="font-semibold text-gray-900 mb-2">🔄 Steps to Reproduce</h4>
                            <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
                              {bug.steps.map((step, idx) => (
                                <li key={idx} data-testid={`text-bug-step-${bug.id}-${idx}`}>{step}</li>
                              ))}
                            </ol>
                          </div>

                          <div className="bg-blue-50 border border-blue-200 rounded p-3" data-testid={`container-bug-workaround-${bug.id}`}>
                            <h4 className="font-semibold text-blue-900 mb-1">💡 Workaround</h4>
                            <p className="text-sm text-blue-800" data-testid={`text-bug-workaround-${bug.id}`}>{bug.workaround}</p>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {filteredBugs.length === 0 && (
              <Card className="border-2 border-green-200 bg-green-50" data-testid="card-no-bugs">
                <CardContent className="p-12 text-center">
                  <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-green-900 mb-2">{t.common.noResults || "No Bugs Found"}</h3>
                  <p className="text-green-700">
                    {searchQuery || categoryFilter !== 'all' || severityFilter !== 'all' 
                      ? (t.common.noResults || 'No bugs match your current filters.')
                      : (t.common.completed || 'All systems operational!')}
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="working" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reportData.workingFeatures.map((feature, idx) => (
                <Card key={idx} className="border-2 border-green-200 bg-green-50 hover:shadow-lg transition-shadow" data-testid={`card-feature-${idx}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-gray-900" data-testid={`text-feature-name-${idx}`}>{feature.name}</h3>
                          <Badge variant="outline" className="text-xs" data-testid={`text-feature-category-${idx}`}>{feature.category}</Badge>
                        </div>
                        <p className="text-sm text-gray-700" data-testid={`text-feature-description-${idx}`}>{feature.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}