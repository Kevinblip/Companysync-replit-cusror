import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  AlertCircle, 
  XCircle, 
  Download,
  Printer,
  FileText,
  Settings,
  Database,
  Calendar,
  Users,
  Mail,
  Phone,
  Sparkles,
  Camera,
  DollarSign,
  Clock,
  Bug,
  AlertTriangle,
  Wrench
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ==========================================
// KNOWN BUGS & ISSUES - ACTIVE TRACKING
// ==========================================
const KNOWN_BUGS = [
  // CRITICAL - Blocking Issues
  {
    id: "BUG-001",
    category: "AI / Voice",
    title: "Lexi Live Voice - Interruption Not Working",
    description: "User CANNOT interrupt Lexi while she is speaking. Two-way conversation is impossible - must wait for Lexi to finish completely before speaking.",
    severity: "critical",
    status: "open",
    technical: "GeminiLiveClient has interruption logic (lines 671-709) but VAD threshold is too high, audio queue clearing isn't fast enough, and WebSocket interrupt signal may not be processed by Gemini. Requires WebRTC-based real-time streaming to fix properly.",
    files: ["components/ai/GeminiLiveClient", "functions/generateLexiVoiceToken"],
    stepsToReproduce: "1. Go to AI Assistant → Live Voice mode. 2. Start speaking. 3. Try to interrupt while Lexi is talking. 4. Notice she keeps talking.",
    workaround: "Use text chat mode instead of live voice."
  },
  {
    id: "BUG-002",
    category: "AI / Voice",
    title: "Lexi Live Voice - Connection Instability",
    description: "Live voice WebSocket drops frequently, audio playback issues, and inconsistent AI responses. Feature is essentially non-functional.",
    severity: "critical",
    status: "open",
    technical: "Railway-hosted bridge has timeout issues. AudioContext unlocking on mobile is fragile. The entire architecture needs redesign for production use.",
    files: ["components/ai/GeminiLiveClient", "pages/GeminiLiveMode"],
    stepsToReproduce: "1. Start Live Voice session. 2. Wait 30-60 seconds. 3. Connection often drops or audio stops playing.",
    workaround: "Use text chat mode."
  },
  {
    id: "BUG-003",
    category: "Integrations",
    title: "Google Calendar Two-Way Sync NOT Working",
    description: "Events created in Google Calendar do NOT sync back to CompanySync. Only one-way sync works (CompanySync → Google).",
    severity: "critical",
    status: "open",
    technical: "Google Calendar webhooks require domain verification in Google Cloud Console. The setupGoogleCalendarWatch function attempts to create a watch but Google rejects the webhook URL. Error: 'Channel id not unique' or domain not verified.",
    files: ["functions/googleCalendarWebhook", "functions/setupGoogleCalendarWatch", "functions/syncGoogleCalendar"],
    stepsToReproduce: "1. Connect Google Calendar. 2. Create an event in Google Calendar. 3. Check CompanySync calendar - event doesn't appear.",
    workaround: "Manually click 'Sync Now' button on Calendar page, or create events in CompanySync only."
  },
  {
    id: "BUG-013",
    category: "AI / Voice",
    title: "Sarah - Twilio Inbound Calls Not Working",
    description: "Sarah does not answer inbound phone calls via Twilio. Calls may ring but no AI response.",
    severity: "critical",
    status: "open",
    technical: "sarahVoiceCallHandler uses Twilio TwiML with Polly.Joanna voice. Issue could be: 1) Twilio webhook URL not configured correctly, 2) Function not deployed, 3) TwiML response format issues, 4) Twilio credentials misconfigured.",
    files: ["functions/sarahVoiceCallHandler", "functions/incomingCall"],
    stepsToReproduce: "1. Call the Twilio phone number. 2. Expect Sarah to answer. 3. No response or call fails.",
    workaround: "None - feature non-functional."
  },
  {
    id: "BUG-014",
    category: "AI / Voice",
    title: "Sarah - SMS Responses Not Working",
    description: "Sarah does not respond to incoming SMS messages from customers.",
    severity: "critical",
    status: "open",
    technical: "incomingSMS function handles SMS but may not be triggering correctly. Possible issues: 1) Twilio SMS webhook not pointing to correct endpoint, 2) Function errors preventing response, 3) Company/settings lookup failing.",
    files: ["functions/incomingSMS", "functions/incomingSMSWebhook", "pages/SarahSettings"],
    stepsToReproduce: "1. Send SMS to Twilio number. 2. Expect Sarah to reply. 3. No response received.",
    workaround: "None - feature non-functional."
  },
  {
    id: "BUG-015",
    category: "AI / Voice",
    title: "Sarah - Gemini Live Voice Mode Not Working",
    description: "Sarah's real-time Gemini voice mode (similar to Lexi Live) is completely non-functional.",
    severity: "critical",
    status: "open",
    technical: "Same architectural issues as Lexi Live Voice - WebSocket instability, AudioContext problems, interruption not working. The 'Live Mode' toggle in Sarah Settings enables this but it doesn't function.",
    files: ["pages/SarahSettings", "components/ai/GeminiLiveClient"],
    stepsToReproduce: "1. Enable Live Mode in Sarah Settings. 2. Attempt real-time voice conversation. 3. Feature doesn't work.",
    workaround: "Disable Live Mode - use standard Twilio TwiML flow instead (also broken)."
  },

  // HIGH - Major Issues
  {
    id: "BUG-004",
    category: "Data",
    title: "Duplicate Company Records Created",
    description: "Some users end up with multiple company records, causing data to split between them and visibility issues.",
    severity: "high",
    status: "open",
    technical: "Race condition during signup when multiple browser tabs are open, or when refreshing during company creation. No deduplication check on create.",
    files: ["functions/autoSetupCompany", "pages/QuickSetup"],
    stepsToReproduce: "1. Open multiple tabs during signup. 2. Complete setup in one tab. 3. Refresh other tabs - may create duplicate companies.",
    workaround: "Use Utilities → Company Cleanup to merge/delete duplicates."
  },
  {
    id: "BUG-005",
    category: "Data",
    title: "Missing company_id on Legacy Records",
    description: "Some older leads, customers, and other records are missing company_id, making them invisible in filtered views.",
    severity: "high",
    status: "open",
    technical: "Data created before multi-tenancy was implemented doesn't have company_id. Backfill scripts exist but may not have run on all records.",
    files: ["functions/backfillAllCompanyIds", "functions/populateCompanyIds"],
    stepsToReproduce: "1. Check old records. 2. Some may be missing from list views despite existing in database.",
    workaround: "Run backfill from Utilities page, or manually update records."
  },
  {
    id: "BUG-006",
    category: "Invoices",
    title: "Invoice Status Not Updating After Payment",
    description: "When a payment is recorded, invoice status sometimes doesn't update to 'paid' or 'partially_paid' correctly.",
    severity: "high",
    status: "open",
    technical: "The payment recording flow doesn't always trigger the invoice status recalculation. Manual 'Fix Statuses' button exists but shouldn't be needed.",
    files: ["pages/Payments", "pages/Invoices", "functions/recalculateInvoicePayments"],
    stepsToReproduce: "1. Create invoice. 2. Record full payment. 3. Check invoice - may still show 'sent' instead of 'paid'.",
    workaround: "Click 'Fix Statuses' button on Invoices page."
  },

  // MEDIUM - Functional Issues
  {
    id: "BUG-007",
    category: "Communication",
    title: "Twilio Calling Needs Verification",
    description: "Outbound calling via Twilio dialer may not work correctly - needs testing and verification.",
    severity: "medium",
    status: "needs_verification",
    technical: "Twilio credentials are configured but actual call flow hasn't been thoroughly tested. May have issues with call recording, status callbacks.",
    files: ["components/communication/Dialer", "functions/makeCall", "functions/callStatusWebhook"],
    stepsToReproduce: "1. Open Dialer. 2. Attempt to make a call. 3. Verify call connects and recording works.",
    workaround: "Use external phone for calls until verified."
  },
  {
    id: "BUG-008",
    category: "Calendar",
    title: "Google Calendar Watch Channels Expire",
    description: "Watch channels expire after 7 days and aren't automatically renewed, causing sync to stop working.",
    severity: "medium",
    status: "open",
    technical: "No scheduled job to renew watch channels. After 7 days, Google stops sending webhook notifications.",
    files: ["functions/setupGoogleCalendarWatch"],
    stepsToReproduce: "1. Set up calendar sync. 2. Wait 7+ days. 3. Sync stops working.",
    workaround: "Re-run setupGoogleCalendarWatch manually every week."
  },
  {
    id: "BUG-009",
    category: "Estimates",
    title: "Estimate Customer Linking Inconsistent",
    description: "Some estimates don't properly link to customer records, making them hard to find in customer profiles.",
    severity: "medium",
    status: "open",
    technical: "customer_id field not always populated when estimate is created from AI Estimator or quick flows.",
    files: ["pages/CreateEstimate", "functions/linkEstimatesToCustomers"],
    stepsToReproduce: "1. Create estimate without selecting existing customer. 2. Check customer profile - estimate may not appear.",
    workaround: "Manually link estimate to customer, or run linkEstimatesToCustomers function."
  },
  {
    id: "BUG-010",
    category: "Workflows",
    title: "Workflow Triggers Inconsistent",
    description: "Automated workflows sometimes don't trigger when expected, or trigger multiple times.",
    severity: "medium",
    status: "open",
    technical: "Race conditions in autoTriggerWorkflows function. Entity mutations may not always reach the trigger check.",
    files: ["functions/autoTriggerWorkflows", "functions/executeWorkflow"],
    stepsToReproduce: "1. Set up workflow trigger on lead creation. 2. Create leads rapidly. 3. Some triggers may be missed.",
    workaround: "Use manual workflow execution as backup."
  },

  // LOW - Minor Issues
  {
    id: "BUG-011",
    category: "UI",
    title: "Mobile Sidebar Doesn't Always Close",
    description: "On mobile, tapping a menu item sometimes doesn't close the sidebar properly.",
    severity: "low",
    status: "open",
    technical: "Race condition between navigation and sidebar close animation.",
    files: ["layout"],
    stepsToReproduce: "1. Open app on mobile. 2. Open sidebar. 3. Tap menu item quickly. 4. Sidebar may stay open.",
    workaround: "Tap outside sidebar to close it."
  },
  {
    id: "BUG-012",
    category: "Reports",
    title: "Report Builder Preview Sometimes Blank",
    description: "When building custom reports, the preview panel occasionally shows blank instead of data.",
    severity: "low",
    status: "open",
    technical: "React Query caching issue with report preview data.",
    files: ["pages/ReportBuilder"],
    stepsToReproduce: "1. Open Report Builder. 2. Configure report. 3. Preview may be blank on first load.",
    workaround: "Click 'Refresh Preview' button or wait a moment."
  }
];

// Features that ARE working
const WORKING_FEATURES = [
  { name: "Lexi AI Text Chat", category: "AI", status: "working", notes: "Full CRM tool calling works in text mode" },
  { name: "AI Estimator", category: "AI", status: "working", notes: "Satellite measurements and document extraction functional" },
  { name: "Lexi Memory", category: "AI", status: "working", notes: "Personal preferences save correctly" },
  { name: "Calendar Events (One-Way)", category: "Calendar", status: "working", notes: "CompanySync → Google works, reminders work" },
  { name: "Email Reminders", category: "Communication", status: "working", notes: "Scheduled automation sends reminders" },
  { name: "SMS Reminders", category: "Communication", status: "working", notes: "Twilio SMS working for notifications" },
  { name: "Lead Management", category: "CRM", status: "working", notes: "CRUD operations, scoring, temperature tracking" },
  { name: "Customer Management", category: "CRM", status: "working", notes: "Full CRUD with multi-assignment" },
  { name: "Estimates", category: "Sales", status: "working", notes: "Creation, merging, PDF generation" },
  { name: "Invoices", category: "Sales", status: "working", notes: "Creation, PDF, payment links (status sync has issues)" },
  { name: "Payments", category: "Sales", status: "working", notes: "Recording payments, linking to invoices" },
  { name: "CrewCam Integration", category: "Operations", status: "working", notes: "Job sync, photo upload, assignments" },
  { name: "Email Sending", category: "Communication", status: "working", notes: "Resend API functional" },
  { name: "SMS Sending", category: "Communication", status: "working", notes: "Twilio API functional" },
  { name: "In-App Notifications", category: "Notifications", status: "working", notes: "Bell notifications, real-time updates" },
  { name: "Role-Based Access", category: "Security", status: "working", notes: "Permissions, admin vs user views" },
  { name: "Multi-Tenancy", category: "Security", status: "working", notes: "Company isolation working (except legacy data)" },
  { name: "Stripe Payments", category: "Billing", status: "working", notes: "Customer payments, subscription billing" },
  { name: "Document Storage", category: "Documents", status: "working", notes: "Upload, view, categorization" },
  { name: "Task Management", category: "Operations", status: "working", notes: "Kanban boards, assignments, reminders" },
];

const severityColors = {
  critical: "bg-red-100 text-red-800 border-red-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
  low: "bg-blue-100 text-blue-800 border-blue-300"
};

const statusColors = {
  open: "bg-red-100 text-red-800",
  in_progress: "bg-blue-100 text-blue-800",
  needs_verification: "bg-yellow-100 text-yellow-800",
  fixed: "bg-green-100 text-green-800"
};

export default function SystemAuditReport() {
  const criticalCount = KNOWN_BUGS.filter(b => b.severity === 'critical' && b.status !== 'fixed').length;
  const highCount = KNOWN_BUGS.filter(b => b.severity === 'high' && b.status !== 'fixed').length;
  const openCount = KNOWN_BUGS.filter(b => b.status !== 'fixed').length;
  
  const handleDownload = () => {
    let content = `COMPANYSYNC CRM - BUG TRACKER REPORT\n`;
    content += `Generated: ${new Date().toISOString()}\n`;
    content += `${'='.repeat(60)}\n\n`;
    
    content += `SUMMARY:\n`;
    content += `- Critical Issues: ${criticalCount}\n`;
    content += `- High Priority: ${highCount}\n`;
    content += `- Total Open: ${openCount}\n\n`;
    
    content += `${'='.repeat(60)}\n`;
    content += `KNOWN BUGS\n`;
    content += `${'='.repeat(60)}\n\n`;
    
    KNOWN_BUGS.forEach(bug => {
      content += `[${bug.id}] ${bug.title}\n`;
      content += `Category: ${bug.category} | Severity: ${bug.severity.toUpperCase()} | Status: ${bug.status}\n`;
      content += `Description: ${bug.description}\n`;
      content += `Technical: ${bug.technical}\n`;
      content += `Files: ${bug.files.join(', ')}\n`;
      content += `Steps: ${bug.stepsToReproduce}\n`;
      content += `Workaround: ${bug.workaround}\n`;
      content += `${'-'.repeat(40)}\n\n`;
    });
    
    content += `\n${'='.repeat(60)}\n`;
    content += `WORKING FEATURES\n`;
    content += `${'='.repeat(60)}\n\n`;
    
    WORKING_FEATURES.forEach(f => {
      content += `✅ ${f.name} (${f.category}): ${f.notes}\n`;
    });
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CompanySync_Bug_Report_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-600 to-orange-600 text-white p-6 rounded-lg shadow-lg mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Bug className="w-8 h-8" />
                CRM Bug Tracker & System Audit
              </h1>
              <p className="text-red-100 mt-2">
                Known issues and working features as of {new Date().toLocaleDateString()}
              </p>
            </div>
            <Button onClick={handleDownload} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
              <Download className="w-4 h-4 mr-2" />
              Export Report
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-red-600">{criticalCount}</div>
              <div className="text-sm text-red-700 font-medium">🚨 Critical</div>
            </CardContent>
          </Card>
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-orange-600">{highCount}</div>
              <div className="text-sm text-orange-700 font-medium">⚠️ High Priority</div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-yellow-600">{openCount}</div>
              <div className="text-sm text-yellow-700 font-medium">📋 Total Open</div>
            </CardContent>
          </Card>
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{WORKING_FEATURES.length}</div>
              <div className="text-sm text-green-700 font-medium">✅ Working</div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="bugs" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="bugs" className="flex items-center gap-2">
              <Bug className="w-4 h-4" /> Known Bugs ({openCount})
            </TabsTrigger>
            <TabsTrigger value="working" className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Working Features ({WORKING_FEATURES.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bugs" className="space-y-4">
            {/* Critical Bugs */}
            {KNOWN_BUGS.filter(b => b.severity === 'critical').length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-red-700 mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" /> Critical Issues
                </h2>
                <div className="space-y-4">
                  {KNOWN_BUGS.filter(b => b.severity === 'critical').map(bug => (
                    <BugCard key={bug.id} bug={bug} />
                  ))}
                </div>
              </div>
            )}

            {/* High Priority */}
            {KNOWN_BUGS.filter(b => b.severity === 'high').length > 0 && (
              <div className="mt-6">
                <h2 className="text-xl font-bold text-orange-700 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" /> High Priority Issues
                </h2>
                <div className="space-y-4">
                  {KNOWN_BUGS.filter(b => b.severity === 'high').map(bug => (
                    <BugCard key={bug.id} bug={bug} />
                  ))}
                </div>
              </div>
            )}

            {/* Medium Priority */}
            {KNOWN_BUGS.filter(b => b.severity === 'medium').length > 0 && (
              <div className="mt-6">
                <h2 className="text-xl font-bold text-yellow-700 mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5" /> Medium Priority Issues
                </h2>
                <div className="space-y-4">
                  {KNOWN_BUGS.filter(b => b.severity === 'medium').map(bug => (
                    <BugCard key={bug.id} bug={bug} />
                  ))}
                </div>
              </div>
            )}

            {/* Low Priority */}
            {KNOWN_BUGS.filter(b => b.severity === 'low').length > 0 && (
              <div className="mt-6">
                <h2 className="text-xl font-bold text-blue-700 mb-3">Low Priority Issues</h2>
                <div className="space-y-4">
                  {KNOWN_BUGS.filter(b => b.severity === 'low').map(bug => (
                    <BugCard key={bug.id} bug={bug} />
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="working">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="w-5 h-5" />
                  Features Confirmed Working
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {WORKING_FEATURES.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                      <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-medium text-green-900">{feature.name}</div>
                        <div className="text-xs text-green-700">{feature.category}</div>
                        <div className="text-sm text-green-600 mt-1">{feature.notes}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Developer Notes */}
        <Card className="mt-6 bg-gray-800 text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5" />
              Developer Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><strong>Priority Order:</strong></p>
            <ol className="list-decimal ml-5 space-y-1 text-gray-300">
              <li><span className="text-red-400">Google Calendar Two-Way Sync</span> - High user impact, requires Google Cloud Console domain verification</li>
              <li><span className="text-red-400">Lexi Live Voice</span> - Needs architectural redesign with proper WebRTC/VAD - consider deprecating for now</li>
              <li><span className="text-orange-400">Invoice Status Sync</span> - Data integrity issue, auto-update after payment recording</li>
              <li><span className="text-orange-400">Duplicate Companies</span> - Add deduplication check during signup flow</li>
              <li><span className="text-yellow-400">Workflow Triggers</span> - Add retry logic and better logging</li>
            </ol>
            <div className="mt-4 pt-4 border-t border-gray-600">
              <p className="text-gray-400">Last updated: {new Date().toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BugCard({ bug }) {
  return (
    <Card className={`border-l-4 ${severityColors[bug.severity]}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{bug.id}</code>
              <Badge variant="outline" className="text-xs">{bug.category}</Badge>
            </div>
            <CardTitle className="text-lg">{bug.title}</CardTitle>
          </div>
          <div className="flex gap-2">
            <Badge className={severityColors[bug.severity]}>
              {bug.severity.toUpperCase()}
            </Badge>
            <Badge className={statusColors[bug.status]}>
              {bug.status.replace('_', ' ').toUpperCase()}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-gray-700">{bug.description}</p>
        
        <div className="bg-gray-50 p-3 rounded border">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Technical Details</div>
          <p className="text-sm text-gray-600">{bug.technical}</p>
        </div>

        <div className="bg-blue-50 p-3 rounded border border-blue-200">
          <div className="text-xs font-semibold text-blue-600 uppercase mb-1">Steps to Reproduce</div>
          <p className="text-sm text-blue-800">{bug.stepsToReproduce}</p>
        </div>

        <div className="bg-green-50 p-3 rounded border border-green-200">
          <div className="text-xs font-semibold text-green-600 uppercase mb-1">Workaround</div>
          <p className="text-sm text-green-800">{bug.workaround}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold text-gray-500">Files:</span>
          {bug.files.map(file => (
            <code key={file} className="text-xs bg-gray-100 px-2 py-1 rounded">{file}</code>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}