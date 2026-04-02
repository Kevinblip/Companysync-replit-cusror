import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { base44 } from "@/api/base44Client";
import { 
  CheckCircle2, 
  Circle, 
  AlertTriangle,
  Rocket,
  TestTube,
  Mail,
  MessageSquare,
  Calendar,
  DollarSign,
  Users,
  FileText,
  Sparkles,
  Bell,
  Database,
  Settings,
  Zap,
  Loader2,
  Briefcase,
  Camera,
  BarChart3,
  Plug,
  Upload
} from "lucide-react";

const TEST_CATEGORIES = [
  {
    id: "core-crm",
    title: "Core CRM Functions",
    icon: Database,
    tests: [
      { id: "create-customer", name: "Create a new customer", priority: "critical" },
      { id: "view-customer-profile", name: "View customer profile", priority: "critical" },
      { id: "edit-customer", name: "Edit customer details", priority: "critical" },
      { id: "delete-customer", name: "Delete a customer", priority: "medium" },
      { id: "filter-customers", name: "Filter/search customers", priority: "high" },
      { id: "create-lead", name: "Create a new lead", priority: "critical" },
      { id: "view-lead-profile", name: "View lead profile", priority: "high" },
      { id: "edit-lead", name: "Edit lead details", priority: "high" },
      { id: "delete-lead", name: "Delete a lead", priority: "medium" },
      { id: "convert-lead", name: "Convert lead to customer", priority: "high" },
      { id: "search-contacts", name: "Search customers and leads", priority: "high" },
    ]
  },
  {
    id: "estimates-invoices",
    title: "Estimates & Invoicing",
    icon: FileText,
    tests: [
      { id: "create-estimate", name: "Create a new estimate", priority: "critical" },
      { id: "view-estimate", name: "View estimate details", priority: "high" },
      { id: "edit-estimate", name: "Edit estimate", priority: "high" },
      { id: "delete-estimate", name: "Delete estimate", priority: "medium" },
      { id: "send-estimate", name: "Send estimate via email", priority: "critical" },
      { id: "accept-estimate", name: "Customer accepts estimate", priority: "high" },
      { id: "create-invoice", name: "Create a new invoice", priority: "critical" },
      { id: "view-invoice", name: "View invoice details", priority: "high" },
      { id: "edit-invoice", name: "Edit invoice", priority: "high" },
      { id: "delete-invoice", name: "Delete invoice", priority: "medium" },
      { id: "send-invoice", name: "Send invoice via email", priority: "critical" },
      { id: "record-payment", name: "Record a payment", priority: "critical" },
      { id: "generate-pdf", name: "Generate PDF documents", priority: "high" },
    ]
  },
  {
    id: "communication",
    title: "Communication",
    icon: MessageSquare,
    tests: [
      { id: "send-email", name: "Send email to customer", priority: "critical" },
      { id: "send-sms", name: "Send SMS to customer", priority: "critical" },
      { id: "receive-sms", name: "Receive SMS reply", priority: "high" },
      { id: "make-call", name: "Make outbound call", priority: "high" },
      { id: "receive-call", name: "Receive inbound call", priority: "high" },
      { id: "email-tracking", name: "Email open/click tracking", priority: "medium" },
    ]
  },
  {
    id: "automations",
    title: "Marketing Automations",
    icon: Zap,
    tests: [
      { id: "workflow-trigger", name: "Workflow auto-triggers on event", priority: "critical" },
      { id: "inspection-reminder", name: "Inspection reminder workflow", priority: "high" },
      { id: "appointment-confirm", name: "Appointment confirmation workflow", priority: "high" },
      { id: "post-inspection", name: "Post-inspection follow-up", priority: "high" },
      { id: "7-day-checkin", name: "7-Day check-in workflow", priority: "medium" },
      { id: "review-requests", name: "Automated review requests", priority: "critical" },
      { id: "workflow-stops", name: "Workflow stops on reply", priority: "medium" },
    ]
  },
  {
    id: "calendar",
    title: "Calendar & Scheduling",
    icon: Calendar,
    tests: [
      { id: "create-event", name: "Create calendar event", priority: "critical" },
      { id: "edit-event", name: "Edit calendar event", priority: "high" },
      { id: "delete-event", name: "Delete calendar event", priority: "medium" },
      { id: "google-sync", name: "Google Calendar sync", priority: "high" },
      { id: "event-reminder", name: "Event reminder notifications", priority: "high" },
      { id: "conflict-detection", name: "Appointment conflict detection", priority: "medium" },
    ]
  },
  {
    id: "payments",
    title: "Payment Processing",
    icon: DollarSign,
    tests: [
      { id: "stripe-connect", name: "Stripe Connect setup", priority: "critical" },
      { id: "payment-link", name: "Generate payment link", priority: "critical" },
      { id: "customer-payment", name: "Customer makes payment", priority: "critical" },
      { id: "payment-webhook", name: "Payment webhook processing", priority: "high" },
      { id: "invoice-update", name: "Invoice status auto-updates", priority: "high" },
    ]
  },
  {
    id: "ai-features",
    title: "AI Features",
    icon: Sparkles,
    tests: [
      { id: "lexi-chat", name: "Chat with Lexi AI", priority: "high" },
      { id: "lexi-voice", name: "Voice call with Lexi", priority: "medium" },
      { id: "lexi-memory", name: "Lexi AI memory storage", priority: "medium" },
      { id: "sarah-intake", name: "Sarah AI lead intake", priority: "high" },
      { id: "ai-estimator", name: "AI Estimator generates estimate", priority: "medium" },
    ]
  },
  {
    id: "staff-roles",
    title: "Staff & Permissions",
    icon: Users,
    tests: [
      { id: "invite-staff", name: "Invite new staff member", priority: "critical" },
      { id: "view-staff-profile", name: "View staff profile", priority: "high" },
      { id: "edit-staff-profile", name: "Edit staff profile", priority: "high" },
      { id: "role-permissions", name: "Role-based access control", priority: "critical" },
      { id: "admin-access", name: "Admin sees all data", priority: "high" },
      { id: "rep-limited", name: "Sales rep sees only their data", priority: "high" },
    ]
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: Bell,
    tests: [
      { id: "browser-notify", name: "Browser notification appears", priority: "medium" },
      { id: "email-notify", name: "Email notification sent", priority: "high" },
      { id: "notification-prefs", name: "Notification preferences work", priority: "medium" },
      { id: "mark-read", name: "Mark notification as read", priority: "low" },
    ]
  },
  {
    id: "data-integrity",
    title: "Data Integrity",
    icon: Database,
    tests: [
      { id: "no-duplicates", name: "No duplicate customers created", priority: "critical" },
      { id: "revenue-accuracy", name: "Revenue calculations accurate", priority: "critical" },
      { id: "invoice-payment-link", name: "Invoices linked to payments", priority: "critical" },
      { id: "commission-calc", name: "Commission calculations correct", priority: "high" },
    ]
  },
  {
    id: "setup-onboarding",
    title: "Setup & Onboarding",
    icon: Settings,
    tests: [
      { id: "quick-setup", name: "Quick Setup wizard completes", priority: "critical" },
      { id: "company-settings", name: "Company settings save correctly", priority: "critical" },
      { id: "twilio-setup", name: "Twilio integration setup", priority: "high" },
      { id: "template-setup", name: "Email/SMS templates work", priority: "high" },
    ]
  },
  {
    id: "document-management",
    title: "Document Management",
    icon: FileText,
    tests: [
      { id: "upload-document", name: "Upload a document", priority: "critical" },
      { id: "view-document", name: "View document details", priority: "high" },
      { id: "create-contract", name: "Create a contract", priority: "critical" },
      { id: "sign-contract", name: "Sign a contract", priority: "high" },
    ]
  },
  {
    id: "accounting-finance",
    title: "Accounting & Finance",
    icon: DollarSign,
    tests: [
      { id: "view-chart-of-accounts", name: "View Chart of Accounts", priority: "critical" },
      { id: "record-expense", name: "Record an expense", priority: "critical" },
      { id: "view-payouts", name: "View payouts/disbursements", priority: "high" },
      { id: "run-report", name: "Run financial report", priority: "high" },
    ]
  },
  {
    id: "project-management",
    title: "Project Management",
    icon: Briefcase,
    tests: [
      { id: "create-project", name: "Create a new project", priority: "critical" },
      { id: "view-project", name: "View project details", priority: "high" },
      { id: "edit-project", name: "Edit project information", priority: "high" },
      { id: "assign-project-team", name: "Assign team to project", priority: "high" },
      { id: "update-project-status", name: "Update project status", priority: "medium" },
    ]
  },
  {
    id: "advanced-tasks",
    title: "Advanced Task Management",
    icon: CheckCircle2,
    tests: [
      { id: "create-task", name: "Create a new task", priority: "critical" },
      { id: "view-tasks", name: "View all tasks", priority: "high" },
      { id: "edit-task", name: "Edit task details", priority: "high" },
      { id: "delete-task", name: "Delete a task", priority: "medium" },
      { id: "assign-task", name: "Assign task to team member", priority: "high" },
      { id: "add-task-comment", name: "Add comment to task", priority: "medium" },
      { id: "track-time", name: "Track time on task", priority: "medium" },
    ]
  },
  {
    id: "proposals",
    title: "Proposals",
    icon: FileText,
    tests: [
      { id: "create-proposal", name: "Create a new proposal", priority: "critical" },
      { id: "view-proposal", name: "View proposal details", priority: "high" },
      { id: "edit-proposal", name: "Edit proposal", priority: "high" },
      { id: "send-proposal", name: "Send proposal via email", priority: "critical" },
      { id: "accept-proposal", name: "Customer accepts proposal", priority: "high" },
    ]
  },
  {
    id: "inspections",
    title: "Inspections & Field Work",
    icon: Camera,
    tests: [
      { id: "create-inspection", name: "Create inspection job", priority: "critical" },
      { id: "upload-inspection-photos", name: "Upload inspection photos", priority: "critical" },
      { id: "ai-damage-detection", name: "AI damage detection works", priority: "high" },
      { id: "generate-inspection-report", name: "Generate inspection PDF", priority: "critical" },
      { id: "field-location-tracking", name: "Field rep location tracking", priority: "medium" },
    ]
  },
  {
    id: "reports-analytics",
    title: "Reports & Analytics",
    icon: BarChart3,
    tests: [
      { id: "view-dashboard", name: "View analytics dashboard", priority: "high" },
      { id: "sales-report", name: "Generate sales report", priority: "high" },
      { id: "commission-report", name: "View commission report", priority: "high" },
      { id: "export-data-csv", name: "Export data to CSV", priority: "medium" },
      { id: "custom-report", name: "Create custom report", priority: "medium" },
    ]
  },
  {
    id: "integrations",
    title: "Integrations",
    icon: Plug,
    tests: [
      { id: "twilio-working", name: "Twilio calls/SMS functional", priority: "critical" },
      { id: "google-calendar-working", name: "Google Calendar syncing", priority: "high" },
      { id: "stripe-working", name: "Stripe payments working", priority: "critical" },
      { id: "quickbooks-sync", name: "QuickBooks data sync", priority: "medium" },
      { id: "ghl-integration", name: "GoHighLevel integration", priority: "medium" },
    ]
  },
  {
    id: "settings-config",
    title: "Settings & Configuration",
    icon: Settings,
    tests: [
      { id: "tax-rates-setup", name: "Tax rates configured", priority: "high" },
      { id: "custom-fields-work", name: "Custom fields functional", priority: "medium" },
      { id: "email-template-save", name: "Email templates save", priority: "high" },
      { id: "sms-template-save", name: "SMS templates save", priority: "high" },
      { id: "menu-customization", name: "Menu customization works", priority: "low" },
    ]
  },
  {
    id: "data-management",
    title: "Data Import/Export",
    icon: Upload,
    tests: [
      { id: "import-customers", name: "Import customers from CSV", priority: "high" },
      { id: "import-leads", name: "Import leads from CSV", priority: "high" },
      { id: "export-customers", name: "Export customers to CSV", priority: "medium" },
      { id: "bulk-operations", name: "Bulk update records", priority: "medium" },
    ]
  },
  {
    id: "critical-integrations",
    title: "Critical Integrations",
    icon: Plug,
    tests: [
      { id: "twilio-sms-test", name: "Twilio SMS can send", priority: "critical" },
      { id: "twilio-call-test", name: "Twilio call can connect", priority: "critical" },
      { id: "stripe-checkout-test", name: "Stripe checkout session creates", priority: "critical" },
      { id: "email-smtp-test", name: "Email SMTP connection works", priority: "critical" },
      { id: "google-calendar-sync-test", name: "Google Calendar sync functional", priority: "high" },
    ]
  },
  {
    id: "core-functionality",
    title: "Core Functionality",
    icon: Zap,
    tests: [
      { id: "dashboard-loads", name: "Dashboard loads with data", priority: "critical" },
      { id: "search-works", name: "Global search returns results", priority: "critical" },
      { id: "file-upload-works", name: "File upload completes", priority: "critical" },
      { id: "workflow-executes", name: "Workflow executes actions", priority: "high" },
      { id: "round-robin-assigns", name: "Round robin assigns leads", priority: "high" },
      { id: "commission-splits-calc", name: "Commission splits calculate correctly", priority: "high" },
      { id: "review-request-auto-gen", name: "Review request auto-generates", priority: "medium" },
      { id: "duplicate-detection", name: "Duplicate detection on create", priority: "medium" },
    ]
  }
];

export default function LaunchChecklist() {
  const [testResults, setTestResults] = useState({});
  const [notes, setNotes] = useState({});
  const [isAutoTesting, setIsAutoTesting] = useState(false);
  const [currentTest, setCurrentTest] = useState(null);
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);

  // Get user and company context
  React.useEffect(() => {
    const init = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      
      // Check for impersonation first
      const impersonatedId = typeof window !== 'undefined' ? sessionStorage.getItem('impersonating_company_id') : null;
      
      if (impersonatedId) {
        const impersonatedCompanies = await base44.entities.Company.filter({ id: impersonatedId });
        if (impersonatedCompanies.length > 0) {
          setMyCompany(impersonatedCompanies[0]);
          console.log('✅ Using impersonated company:', impersonatedCompanies[0].company_name, impersonatedCompanies[0].id);
          return;
        }
      }
      
      const companies = await base44.entities.Company.filter({ created_by: currentUser.email });
      if (companies.length > 0) {
        setMyCompany(companies[0]);
        console.log('✅ Using owned company:', companies[0].company_name, companies[0].id);
      }
    };
    init().catch(console.error);
  }, []);

  const runAutomatedTest = async (testId) => {
    if (!myCompany?.id) {
      alert('Company context not ready - wait a moment and try again');
      return;
    }
    
    console.log('Running test:', testId, 'for company:', myCompany.id);
    setCurrentTest(testId);
    try {
      const result = await base44.functions.invoke('runLaunchTest', { 
        testId, 
        companyId: myCompany.id 
      });
      setTestResults(prev => ({
        ...prev,
        [testId]: result.data?.passed ? 'pass' : 'fail'
      }));
      if (!result.data?.passed && result.data?.error) {
        setNotes(prev => ({
          ...prev,
          [testId]: result.data.error
        }));
      }
    } catch (error) {
      console.log('Test error:', testId, error);
      setTestResults(prev => ({ ...prev, [testId]: 'fail' }));
      setNotes(prev => ({ ...prev, [testId]: error.message }));
    }
    setCurrentTest(null);
  };

  const runAllTests = async () => {
    if (!myCompany?.id) {
      alert('Company context not ready - wait a moment and try again');
      return;
    }
    
    setIsAutoTesting(true);
    const allTests = TEST_CATEGORIES.flatMap(cat => cat.tests);
    
    console.log(`🚀 Starting automated test run: ${allTests.length} total tests for company ${myCompany.company_name} (${myCompany.id})`);
    
    for (let i = 0; i < allTests.length; i++) {
      const test = allTests[i];
      console.log(`📝 Running test ${i + 1}/${allTests.length}: ${test.id}`);
      await runAutomatedTest(test.id);
      // Longer delay to prevent overwhelming database connection pool
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    console.log('✅ All tests completed');
    setIsAutoTesting(false);
  };

  const handleToggleTest = (testId, status) => {
    setTestResults(prev => ({
      ...prev,
      [testId]: status
    }));
  };

  const handleAddNote = (testId, note) => {
    setNotes(prev => ({
      ...prev,
      [testId]: note
    }));
  };

  // Calculate progress
  const allTests = TEST_CATEGORIES.flatMap(cat => cat.tests);
  const totalTests = allTests.length;
  const passedTests = Object.values(testResults).filter(r => r === 'pass').length;
  const failedTests = Object.values(testResults).filter(r => r === 'fail').length;
  const progressPercent = (passedTests / totalTests) * 100;

  const criticalTests = allTests.filter(t => t.priority === 'critical');
  const passedCritical = criticalTests.filter(t => testResults[t.id] === 'pass').length;

  const isReadyForLaunch = passedCritical === criticalTests.length && failedTests === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <TestTube className="w-8 h-8 text-blue-600" />
              Launch Readiness Checklist
            </h1>
            <p className="text-gray-600 mt-2">Test all critical features before going live</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={runAllTests}
              disabled={isAutoTesting}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isAutoTesting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Run All Tests
                </>
              )}
            </Button>
            {isReadyForLaunch && (
              <Button className="bg-green-600 hover:bg-green-700 text-lg px-6 py-6">
                <Rocket className="w-5 h-5 mr-2" />
                Ready to Launch! 🚀
              </Button>
            )}
          </div>
        </div>

        {/* Overall Progress */}
        <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold">Overall Progress</h2>
                <p className="text-blue-100">
                  {passedTests} of {totalTests} tests passed
                  {failedTests > 0 && ` • ${failedTests} failed`}
                </p>
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold">{Math.round(progressPercent)}%</div>
                <div className="text-blue-100">Complete</div>
              </div>
            </div>
            <Progress value={progressPercent} className="h-3 bg-white/20" />

            <div className="grid grid-cols-3 gap-4 mt-6">
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-2xl font-bold">{passedCritical}/{criticalTests.length}</div>
                <div className="text-sm text-blue-100">Critical Tests</div>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-2xl font-bold">{passedTests}</div>
                <div className="text-sm text-blue-100">Passed</div>
              </div>
              <div className="bg-white/10 rounded-lg p-4">
                <div className="text-2xl font-bold">{failedTests}</div>
                <div className="text-sm text-blue-100">Failed</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Test Categories */}
        <div className="grid gap-6">
          {TEST_CATEGORIES.map((category) => {
            const CategoryIcon = category.icon;
            const categoryTests = category.tests;
            const categoryPassed = categoryTests.filter(t => testResults[t.id] === 'pass').length;
            const categoryFailed = categoryTests.filter(t => testResults[t.id] === 'fail').length;
            const categoryProgress = (categoryPassed / categoryTests.length) * 100;

            return (
              <Card key={category.id} className="shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-3">
                      <CategoryIcon className="w-6 h-6 text-blue-600" />
                      {category.title}
                    </CardTitle>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">
                        {categoryPassed}/{categoryTests.length} passed
                      </span>
                      <Progress value={categoryProgress} className="w-32 h-2" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {categoryTests.map((test) => {
                      const status = testResults[test.id];
                      return (
                        <div
                          key={test.id}
                          className={`p-4 rounded-lg border-2 transition-all ${
                            status === 'pass'
                              ? 'bg-green-50 border-green-200'
                              : status === 'fail'
                              ? 'bg-red-50 border-red-200'
                              : 'bg-gray-50 border-gray-200 hover:border-blue-300'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 flex-1">
                              <div className="mt-1">
                                {status === 'pass' ? (
                                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                                ) : status === 'fail' ? (
                                  <AlertTriangle className="w-5 h-5 text-red-600" />
                                ) : (
                                  <Circle className="w-5 h-5 text-gray-400" />
                                )}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium">{test.name}</span>
                                  <Badge
                                    variant={
                                      test.priority === 'critical'
                                        ? 'destructive'
                                        : test.priority === 'high'
                                        ? 'default'
                                        : 'secondary'
                                    }
                                    className="text-xs"
                                  >
                                    {test.priority}
                                  </Badge>
                                  {currentTest === test.id && (
                                    <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                                  )}
                                </div>
                                {notes[test.id] && (
                                  <p className="text-sm text-gray-600 mt-1">{notes[test.id]}</p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => runAutomatedTest(test.id)}
                                disabled={isAutoTesting || currentTest === test.id}
                                className="text-purple-600 hover:text-purple-700"
                              >
                                <Zap className="w-4 h-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant={status === 'pass' ? 'default' : 'outline'}
                                onClick={() => handleToggleTest(test.id, 'pass')}
                                className={status === 'pass' ? 'bg-green-600 hover:bg-green-700' : ''}
                              >
                                Pass
                              </Button>
                              <Button
                                size="sm"
                                variant={status === 'fail' ? 'destructive' : 'outline'}
                                onClick={() => handleToggleTest(test.id, 'fail')}
                              >
                                Fail
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Launch Recommendation */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Rocket className="w-6 h-6 text-blue-600" />
              Launch Recommendation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isReadyForLaunch ? (
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="w-8 h-8 text-green-600 flex-shrink-0" />
                  <div>
                    <h3 className="text-xl font-bold text-green-900 mb-2">
                      ✅ Ready for Launch!
                    </h3>
                    <p className="text-green-800">
                      All critical tests have passed. Your CRM is production-ready. Recommended next steps:
                    </p>
                    <ul className="mt-3 space-y-2 text-green-800">
                      <li>• Run a final data backup</li>
                      <li>• Notify your team about launch</li>
                      <li>• Monitor first 24 hours closely</li>
                      <li>• Set up daily health checks</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-8 h-8 text-yellow-600 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-yellow-900 mb-2">
                      ⚠️ Not Ready Yet
                    </h3>
                    <p className="text-yellow-800 mb-3">
                      Complete these items before launching:
                    </p>
                    <ul className="space-y-2 text-yellow-800 mb-4">
                      {criticalTests
                        .filter(t => testResults[t.id] !== 'pass')
                        .map(t => (
                          <li key={t.id}>• {t.name} (Critical)</li>
                        ))}
                      {failedTests > 0 && (
                        <li className="text-red-600 font-semibold">
                          • Fix {failedTests} failed test{failedTests > 1 ? 's' : ''}
                        </li>
                      )}
                    </ul>

                    <Button
                      onClick={async () => {
                        const failedTestsData = Object.entries(testResults)
                          .filter(([_, status]) => status === 'fail')
                          .map(([testId]) => {
                            const test = allTests.find(t => t.id === testId);
                            return {
                              id: testId,
                              name: test?.name,
                              priority: test?.priority,
                              error: notes[testId] || 'No error details'
                            };
                          });

                        const errorReport = {
                          timestamp: new Date().toISOString(),
                          totalTests: allTests.length,
                          passedTests,
                          failedTests,
                          criticalFailed: criticalTests.filter(t => testResults[t.id] !== 'pass').length,
                          failures: failedTestsData
                        };

                        // Copy detailed error report to clipboard for Base44 chat
                        const reportText = `🚨 CRM LAUNCH CHECKLIST - AUTO-FIX REQUEST

**Summary:**
- Total Tests: ${errorReport.totalTests}
- Passed: ${errorReport.passedTests}
- Failed: ${errorReport.failedTests}
- Critical Failures: ${errorReport.criticalFailed}

**Failed Tests Details:**

${failedTestsData.map((t, i) => `${i + 1}. **${t.name}** (Priority: ${t.priority})
Test ID: ${t.id}
Error: ${t.error}
`).join('\n')}

**Instructions for Base44 AI:**
Please analyze each failing test above and automatically fix the issues in the codebase where possible. For each test:
1. Identify the root cause (code bug, missing config, data issue)
2. Make the necessary code changes to fix it
3. For data issues, guide me to the right page
4. Re-run the test to verify the fix

Start with critical priority tests first, then move to high/medium priority.`;

                        navigator.clipboard.writeText(reportText).then(() => {
                          alert('✅ Error report copied to clipboard!\n\n' + 
                                'Now paste this into Base44 chat (bottom-right) and I\'ll automatically fix the issues for you.\n\n' +
                                `Found ${failedTests} failing tests (${errorReport.criticalFailed} critical).`);
                        }).catch(() => {
                          alert(reportText);
                        });
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white"
                    >
                      <Sparkles className="w-4 h-4 mr-2" />
                      Send to Base44 AI for Auto-Fix
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}