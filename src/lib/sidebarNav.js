import { createPageUrl } from "@/utils";

/**
 * CompanySync sidebar, job order.
 * `source` is the legacy menu id (group/item or top-level) used by plan,
 * permission, and Menu Customization filters. Routes are unchanged.
 *
 * Pages in the approved review with no route in this repo are omitted:
 * My Assignments, Route Planner, Marketing Videos, Insurance Claim Audit.
 * Training Videos deep-links into Knowledge Base, where those videos already live.
 */

const page = (name, query = "") => createPageUrl(name) + query;

export function collectVisibleSources(navigationItems = [], settingsItems = []) {
  const sources = new Set();
  for (const item of navigationItems) {
    if (!item?.id) continue;
    sources.add(item.id);
    for (const sub of item.submenu || []) {
      if (!sub?.id) continue;
      sources.add(`${item.id}/${sub.id}`);
    }
  }
  for (const item of settingsItems) {
    if (!item?.id) continue;
    sources.add(`settings:${item.id}`);
  }
  return sources;
}

const NAV_SECTIONS = [
  {
    id: "home",
    label: "Home",
    tooltip: "Your day at a glance",
    icon: "Home",
    page: "Dashboard",
    items: [
      {
        source: "dashboard",
        label: "Dashboard",
        page: "Dashboard",
        tooltip: "Today's numbers, this week's builds and what needs attention.",
        synonyms: ["Dashboard"],
      },
      {
        source: "calendar",
        label: "Calendar",
        page: "Calendar",
        tooltip: "Inspections, appointments and install dates for you and your team.",
        synonyms: ["Calendar"],
      },
      {
        source: "operations/tasks",
        label: "Tasks",
        page: "Tasks",
        tooltip: "Team to-do list with due dates and owners.",
        synonyms: ["Tasks"],
      },
      {
        source: "operations/reminders",
        label: "Reminders",
        page: "Reminders",
        tooltip: "Follow-up nudges so no homeowner falls through the cracks.",
        synonyms: ["Reminders"],
      },
      {
        source: "operations/activity",
        label: "Team Activity",
        page: "Activity",
        tooltip: "What your team did recently, across all jobs.",
        synonyms: ["Activity Feed", "Activity"],
      },
    ],
  },
  {
    id: "leads",
    label: "Leads & Storms",
    tooltip: "Find and win new work",
    icon: "CloudLightning",
    items: [
      {
        source: "lead-manager/all-leads",
        label: "All Leads",
        page: "Leads",
        tooltip: "Every homeowner who might need a roof, by stage.",
        synonyms: ["All Leads", "Lead Manager"],
      },
      {
        source: "lead-manager/storm-tracking",
        label: "Storm Tracker",
        page: "StormTracking",
        tooltip: "Hail and wind events near your service area (NOAA), turned into leads.",
        synonyms: ["Storm Tracking", "Storm Tracker"],
      },
      {
        source: "lead-manager/lead-finder",
        label: "Lead Finder",
        page: "LeadFinder",
        tooltip: "Search property records for homeowners to target. Storm-hit homes come first.",
        synonyms: ["Lead Finder", "property search"],
      },
      {
        source: "map",
        label: "Leads & Jobs Map",
        page: "Map",
        tooltip: "Every lead and customer on a map, plus your service areas.",
        synonyms: ["Map"],
      },
      {
        id: "canvassing",
        label: "Canvassing",
        tooltip: "Door-knocking tools",
        items: [
          {
            source: "field-operations/field-rep-app",
            label: "Door-Knocking Log",
            page: "FieldRepApp",
            tooltip: "Log every door knocked and every conversation.",
            synonyms: ["Work Territory", "Field Operations"],
          },
          {
            source: "field-operations/field-sales-tracker",
            label: "Rep GPS Tracker",
            page: "FieldSalesTracker",
            tooltip: "See where your canvassers are, live.",
            synonyms: ["Field Sales Tracker"],
          },
          {
            source: "field-operations/territory-manager",
            label: "Sales Territories",
            page: "TerritoryManager",
            tooltip: "Draw rep zones and assign neighborhoods.",
            synonyms: ["Territory Manager"],
          },
        ],
      },
    ],
  },
  {
    id: "customers",
    label: "Customers & Jobs",
    tooltip: "The homeowner and the job record",
    icon: "House",
    items: [
      {
        source: "sales/customers",
        label: "Customers",
        page: "LocalCustomers",
        tooltip: "Homeowners you're working with or have worked for.",
        synonyms: ["Customers"],
      },
      {
        source: "operations/projects",
        label: "Jobs",
        page: "Projects",
        tooltip: "Every roof job and its stage, from sold to paid.",
        synonyms: ["Projects", "Jobs"],
      },
      {
        source: "documents/all-documents",
        label: "Job Files",
        page: "Documents",
        tooltip: "All photos, PDFs and paperwork, organized by job.",
        synonyms: ["All Documents", "Documents"],
      },
    ],
  },
  {
    id: "inspections",
    label: "Inspections & Photos",
    tooltip: "Document the roof",
    icon: "Camera",
    items: [
      {
        source: "operations/crewcam-dashboard",
        label: "Inspections",
        page: "InspectionsDashboard",
        tooltip: "All roof inspections and photo reports (PhotoSync).",
        synonyms: ["PhotoSync Dashboard", "CrewCam Dashboard", "PhotoSync"],
      },
      {
        source: "operations/new-crewcam",
        label: "+ New Inspection",
        page: "NewInspection",
        tooltip: "Start an inspection for a lead or customer.",
        synonyms: ["New PhotoSync Job", "New CrewCam Job"],
      },
      {
        source: "operations/crewcam-capture",
        label: "Take Photos",
        page: "InspectionCapture",
        tooltip: "Snap and tag roof photos from your phone.",
        synonyms: ["PhotoSync Capture", "CrewCam Capture"],
      },
      {
        source: "operations/ai-damage",
        label: "AI Damage Report",
        page: "DroneInspections",
        tooltip: "AI marks hail and wind damage on photos and drone shots.",
        synonyms: ["AI Damage Analysis"],
      },
      {
        source: "smart-glasses",
        label: "Hands-Free Photos (Smart Glasses)",
        page: "SmartGlassesSetup",
        tooltip: "Connect smart glasses to capture photos without your hands.",
        synonyms: ["Smart Glasses"],
      },
    ],
  },
  {
    id: "estimates",
    label: "Estimates & Contracts",
    tooltip: "Price it and get it signed",
    icon: "FileSignature",
    items: [
      {
        source: "sales/estimates",
        label: "Estimates",
        page: "Estimates",
        tooltip: "Build and send roof estimates. The Estimate Editor opens from here.",
        synonyms: ["Estimates", "Estimate Editor"],
      },
      {
        source: "ai-tools/ai-estimator",
        label: "AI Estimator",
        page: "AIEstimator",
        tooltip: "Upload a HOVER/EagleView/Xactimate report or use satellite measurements to get a draft estimate.",
        synonyms: ["AI Estimator"],
      },
      {
        source: "sales/proposals",
        label: "Proposals",
        page: "Proposals",
        tooltip: "Good, Better, and Best packages homeowners can choose from.",
        synonyms: ["Proposals"],
      },
      {
        source: "documents/contracts",
        label: "Contracts",
        page: "Contracts",
        tooltip: "Signed agreements for each job.",
        synonyms: ["Contracts"],
      },
      {
        source: "documents/contract-signing",
        label: "Send for E-Signature",
        page: "ContractSigning",
        tooltip: "Send a contract or proposal to sign online.",
        synonyms: ["Contract Signing"],
      },
      {
        source: "documents/contract-templates",
        label: "Contract Templates",
        page: "ContractTemplates",
        tooltip: "Your standard contract wording.",
        synonyms: ["Contract Templates"],
      },
      {
        source: "sales/items",
        label: "Price List",
        page: "Items",
        tooltip: "Materials, labor and supplier pricing used in estimates.",
        synonyms: ["Items & Pricing", "Price List"],
      },
    ],
  },
  {
    id: "production",
    label: "Production / Crew Schedule",
    tooltip: "Build the roof",
    icon: "Hammer",
    items: [
      {
        source: "field-operations/build-schedule",
        label: "Install Schedule",
        page: "BuildSchedule",
        tooltip: "Who's building which roof, and when.",
        synonyms: ["Build Schedule"],
      },
      {
        source: "operations/subcontractors",
        label: "Crews & Subcontractors",
        page: "Subcontractors",
        tooltip: "Your install crews and subs, with contact and pay info.",
        synonyms: ["Subcontractors"],
      },
      {
        source: "ai-tools/permit-assistant",
        label: "Permit Assistant",
        page: "PermitAssistant",
        tooltip: "Upload a permit form and Lexi fills it in.",
        synonyms: ["Permit Assistant"],
      },
      {
        source: "ai-tools/daily-reports",
        label: "Daily Job Reports",
        page: "DailyReports",
        tooltip: "End-of-day AI summary plus your crew notes.",
        synonyms: ["Daily Reports"],
      },
    ],
  },
  {
    id: "money",
    label: "Invoices & Money",
    tooltip: "Get paid, pay people",
    icon: "DollarSign",
    items: [
      {
        source: "sales/invoices",
        label: "Invoices",
        page: "Invoices",
        tooltip: "Bill homeowners and insurance. See what's still owed.",
        synonyms: ["Invoices"],
      },
      {
        source: "sales/payments",
        label: "Payments Received",
        page: "Payments",
        tooltip: "Every payment collected (card, check, ACH).",
        synonyms: ["Payments"],
      },
      {
        source: "sales/commissions",
        label: "Sales Commissions",
        page: "CommissionReport",
        tooltip: "What each rep earned, splits and deductions.",
        synonyms: ["Commission Tracker"],
      },
      {
        source: "sales/family-commissions",
        label: "Family Commissions",
        page: "FamilyCommissions",
        tooltip: "Commission shares paid to family members (auto-pay via Wise).",
        synonyms: ["Family Commissions"],
      },
      {
        id: "bookkeeping",
        label: "Bookkeeping",
        tooltip: "Cash, bills, and the books",
        items: [
          {
            source: "accounting/accounting-dashboard",
            label: "Overview",
            page: "AccountingDashboard",
            tooltip: "Cash, profit and what's due, in one view.",
            synonyms: ["Accounting Dashboard"],
          },
          {
            source: "accounting/bills",
            label: "Bills to Pay",
            page: "Bills",
            tooltip: "Supplier and vendor bills you owe.",
            synonyms: ["Bills & Payables"],
          },
          {
            source: "accounting/expenses",
            label: "Job Expenses",
            page: "Expenses",
            tooltip: "Materials, dumpsters, permits and other costs, by job.",
            synonyms: ["Expenses"],
          },
          {
            source: "accounting/payouts",
            label: "Crew & Sub Payouts",
            page: "Payouts",
            tooltip: "Pay installers, subs and staff.",
            synonyms: ["Payouts"],
          },
          {
            source: "accounting/transactions",
            label: "Bank Transactions",
            page: "Transactions",
            tooltip: "Money in and out of your bank accounts.",
            synonyms: ["Transactions"],
          },
          {
            source: "accounting/reconcile",
            label: "Bank Reconciliation",
            page: "BankReconciliation",
            tooltip: "Match the books to your bank statement.",
            synonyms: ["Reconcile"],
          },
          {
            source: "accounting/transfer",
            label: "Move Money",
            page: "TransferFunds",
            tooltip: "Transfer between your accounts.",
            synonyms: ["Transfer"],
          },
          {
            source: "accounting/reports",
            label: "Financial Reports",
            page: "AccountingReports",
            tooltip: "Profit and loss, balance sheet and cash flow.",
            synonyms: ["Accounting Reports"],
          },
          {
            source: "accounting/mapping-rules",
            label: "Auto-Categorize Rules",
            page: "MappingRules",
            tooltip: "Rules that sort bank transactions automatically.",
            synonyms: ["Mapping Rules"],
          },
          {
            id: "bookkeeping-advanced",
            label: "Advanced",
            tooltip: "Accountant-only tools",
            items: [
              {
                source: "accounting/chart-of-accounts",
                label: "Chart of Accounts",
                page: "ChartOfAccountsPage",
                tooltip: "The list of accounts your books use.",
                synonyms: ["Chart of Accounts"],
              },
              {
                source: "accounting/journal-entry",
                label: "Manual Journal Entry",
                page: "JournalEntry",
                tooltip: "Accountant-only adjustments.",
                synonyms: ["Journal Entry"],
              },
            ],
          },
          {
            source: "accounting/accounting-setup",
            label: "Setup Wizard",
            page: "AccountingSetup",
            tooltip: "Connect your bank and set up the books.",
            synonyms: ["Setup Wizard", "Accounting Setup"],
          },
        ],
      },
    ],
  },
  {
    id: "messages",
    label: "Messages & Marketing",
    tooltip: "Talk to homeowners, get more leads",
    icon: "MessageSquare",
    items: [
      {
        source: "communication/communication-hub",
        label: "Inbox",
        page: "Communication",
        tooltip: "All calls, texts and emails with homeowners in one place.",
        synonyms: ["Communication Hub", "Inbox"],
      },
      {
        source: "communication/live-call-dashboard",
        label: "Live Calls",
        page: "LiveCallDashboard",
        tooltip: "Calls and texts Alex is handling right now.",
        synonyms: ["Live Call Dashboard", "Alex"],
      },
      {
        source: "communication/mailbox",
        label: "Email",
        page: "Mailbox",
        tooltip: "Your connected email account.",
        synonyms: ["Mailbox"],
      },
      {
        source: "communication/messages",
        label: "Customer Chat",
        page: "Messages",
        tooltip: "Real-time chat with customers.",
        synonyms: ["Messages"],
      },
      {
        source: "communication/zoom",
        label: "Video Meetings",
        page: "ZoomMeeting",
        tooltip: "Start or join a Zoom call with a homeowner or adjuster.",
        synonyms: ["Zoom Meeting", "Zoom"],
      },
      {
        source: "communication/campaigns",
        label: "Campaigns",
        page: "Campaigns",
        tooltip: "Bulk email and text blasts, for example after a storm.",
        synonyms: ["Campaign Manager"],
      },
      {
        source: "communication/ad-builder",
        label: "Ad Builder",
        page: "MarcusMarketing",
        tooltip: "Marcus writes Facebook and Google ads for you.",
        synonyms: ["Ad Builder", "Marcus"],
      },
      {
        source: "operations/review-requests",
        label: "Review Requests",
        page: "ReviewRequests",
        tooltip: "Automatically ask happy customers for Google reviews.",
        synonyms: ["Review Requests"],
      },
    ],
  },
  {
    id: "automations",
    label: "Automations & AI",
    tooltip: "Let the system do the follow-up",
    icon: "Zap",
    items: [
      {
        source: "communication/workflow-automation",
        label: "Automations",
        page: "Workflows",
        tooltip: "When something happens, do the next step. For example, a storm hits and recent leads get a text.",
        synonyms: ["Workflow Automation", "Workflows", "Workflow"],
      },
      {
        source: "ai-tools/ai-staff",
        label: "AI Team",
        page: "AIStaff",
        tooltip: "Meet your AI staff: Alex (receptionist), Lexi (office assistant) and Marcus (marketing).",
        synonyms: ["AI Team", "Alex", "Lexi", "Marcus"],
      },
      {
        source: "ai-tools/lexi",
        label: "Ask Lexi",
        page: "AIAssistant",
        tooltip: "Ask your AI assistant anything about your jobs or business.",
        synonyms: ["Lexi AI Assistant", "Lexi"],
      },
      {
        source: "ai-tools/lexi-memory",
        label: "What Lexi Remembers",
        page: "LexiMemory",
        tooltip: "Facts and preferences Lexi has saved about you.",
        synonyms: ["Lexi Memory"],
      },
      {
        source: "ai-tools/ai-training",
        label: "AI Training Library",
        page: "AITraining",
        tooltip: "Past jobs and docs the AI learns from so estimates match yours.",
        synonyms: ["AI Memory", "Training Library"],
      },
      {
        source: "communication/ai-dashboard",
        label: "Alex Phone & Text Settings",
        page: "Settings",
        query: "?tab=communications",
        tooltip: "Set how Alex answers calls and texts and when to transfer.",
        synonyms: ["AI Dashboard", "Sarah", "Communications"],
      },
    ],
  },
];

const FOOTER = [
  {
    id: "reports",
    label: "Reports",
    tooltip: "Numbers for the business",
    icon: "BarChart3",
    items: [
      {
        source: "reports/analytics-dashboard",
        label: "Business Overview",
        page: "Analytics",
        tooltip: "Revenue, close rate and lead sources at a glance.",
        synonyms: ["Analytics"],
      },
      {
        source: "sales/sales-dashboard",
        label: "Sales Performance",
        page: "SalesDashboard",
        tooltip: "Pipeline, rep leaderboard and forecast.",
        synonyms: ["Sales Dashboard"],
      },
      {
        source: "reports/sales-reports",
        label: "Sales Reports",
        page: "Reports",
        query: "?category=sales",
        tooltip: "Ready-made sales reports you can filter and export.",
        synonyms: ["Sales Reports"],
      },
      {
        source: "reports/report-builder",
        label: "Custom Report Builder",
        page: "ReportBuilder",
        tooltip: "Build your own report from any data.",
        synonyms: ["Report Builder"],
      },
    ],
  },
  {
    id: "help",
    label: "Help & Training",
    tooltip: "Learn the screens",
    icon: "HelpCircle",
    items: [
      {
        id: "training-videos",
        visibleIf: "knowledge-base",
        label: "Training Videos",
        page: "KnowledgeBase",
        query: "?category=Training%20Videos",
        tooltip: "Short how-to videos. They live in Help Articles under Training Videos.",
        synonyms: ["Training Videos"],
      },
      {
        source: "knowledge-base",
        label: "Help Articles",
        page: "KnowledgeBase",
        tooltip: "Step-by-step guides and FAQs.",
        synonyms: ["Knowledge Base"],
      },
      {
        source: "coming-soon",
        label: "What's Coming",
        page: "ComingSoon",
        tooltip: "Features on the roadmap.",
        synonyms: ["Coming Soon"],
      },
      {
        source: "ai-tools/video-training",
        label: "Make a Training Video",
        page: "VideoTrainingGenerator",
        tooltip: "Create a narrated walkthrough of any screen for your team.",
        synonyms: ["Video Training Generator", "Video Training"],
      },
    ],
  },
];

const SETTINGS_GROUPS = [
  {
    id: "settings-getting-started",
    label: "Getting Started",
    items: [
      {
        source: "settings:quick-setup",
        label: "Setup Checklist",
        page: "QuickSetup",
        tooltip: "Getting-started steps for a new company.",
        synonyms: ["Quick Setup"],
      },
      {
        source: "settings:launch-checklist",
        label: "Go-Live Test",
        page: "LaunchChecklist",
        tooltip: "Test the critical features before you go live.",
        synonyms: ["Launch Checklist"],
      },
    ],
  },
  {
    id: "settings-company",
    label: "Company",
    items: [
      {
        source: "settings:company-setup",
        label: "Company Profile",
        page: "CompanySetup",
        tooltip: "Your company name, logo, and contact details.",
        synonyms: ["Company Setup"],
      },
      {
        source: "settings:general-settings",
        label: "General & Notifications",
        page: "GeneralSettings",
        tooltip: "Notifications and general preferences.",
        synonyms: ["General Settings"],
      },
      {
        source: "settings:pdf-branding",
        label: "Branding & PDFs",
        page: "PDFBranding",
        tooltip: "Logo, colors, and how PDFs look.",
        synonyms: ["PDF Branding"],
      },
    ],
  },
  {
    id: "settings-team",
    label: "Team",
    items: [
      {
        source: "settings:staff-management",
        label: "Team Members",
        page: "StaffManagement",
        tooltip: "People who work in your company.",
        synonyms: ["Staff Management"],
      },
      {
        source: "settings:roles-management",
        label: "Roles & Permissions",
        page: "RolesManagement",
        tooltip: "What each role is allowed to see and do.",
        synonyms: ["Roles & Permissions"],
      },
      {
        source: "settings:round-robin",
        label: "Lead Assignment Rules",
        page: "RoundRobinSettings",
        tooltip: "How new leads are handed out to reps.",
        synonyms: ["Round Robin", "Round Robin Settings"],
      },
    ],
  },
  {
    id: "settings-payments",
    label: "Payments",
    items: [
      {
        source: "settings:stripe-connect",
        label: "Accept Card/ACH Payments",
        page: "StripeConnect",
        tooltip: "Connect Stripe to take card and ACH payments.",
        synonyms: ["Accept Payments", "Stripe"],
      },
    ],
  },
  {
    id: "settings-phone",
    label: "Phone & AI",
    items: [
      {
        source: "communication/ai-dashboard",
        label: "Alex call & text settings",
        page: "Settings",
        query: "?tab=communications",
        tooltip: "Set how Alex answers calls and texts and when to transfer.",
        synonyms: ["AI Dashboard", "Communications", "Sarah"],
      },
    ],
  },
  {
    id: "settings-templates",
    label: "Templates",
    items: [
      {
        source: "settings:email-templates",
        label: "Email Templates",
        page: "EmailTemplates",
        tooltip: "Saved emails you can send again.",
        synonyms: ["Email Templates"],
      },
      {
        source: "settings:sms-templates",
        label: "Text Templates",
        page: "SMSTemplates",
        tooltip: "Saved text messages you can send again.",
        synonyms: ["SMS Templates"],
      },
      {
        source: "settings:templates",
        label: "Estimate Templates & Bundles",
        page: "Templates",
        tooltip: "Estimate templates and macros.",
        synonyms: ["Templates"],
      },
      {
        source: "settings:report-templates",
        label: "Inspection/Report Templates",
        page: "ReportTemplates",
        tooltip: "Templates for inspection and other reports.",
        synonyms: ["Report Templates"],
      },
      {
        source: "documents/contract-templates",
        label: "Contract Templates",
        page: "ContractTemplates",
        tooltip: "Your standard contract wording.",
        synonyms: ["Contract Templates"],
      },
    ],
  },
  {
    id: "settings-customize",
    label: "Customize",
    items: [
      {
        source: "settings:custom-fields",
        label: "Custom Fields",
        page: "CustomFields",
        tooltip: "Extra fields on leads, customers, and jobs.",
        synonyms: ["Custom Fields"],
      },
      {
        source: "settings:menu-setup",
        label: "Sidebar Menu",
        page: "MenuSetup",
        tooltip: "Choose which menu items each role sees.",
        synonyms: ["Menu Customization"],
      },
    ],
  },
  {
    id: "settings-data",
    label: "Data",
    items: [
      {
        source: "settings:data-import",
        label: "Import Customers & Leads",
        page: "DataImport",
        tooltip: "Bring in customers and leads from a file.",
        synonyms: ["Data Import"],
      },
      {
        source: "settings:property-importer",
        label: "Import Property Lists",
        page: "PropertyDataImporter",
        tooltip: "Bring in property lists to target.",
        synonyms: ["Property Importer"],
      },
      {
        source: "settings:backup-manager",
        label: "Backups",
        page: "BackupManager",
        tooltip: "Download or restore a backup of your data.",
        synonyms: ["Backup Manager"],
      },
    ],
  },
  {
    id: "settings-integrations",
    label: "Integrations",
    items: [
      {
        source: "settings:integration-manager",
        label: "Connected Apps",
        page: "IntegrationManager",
        tooltip: "Apps connected to CompanySync.",
        synonyms: ["Integrations"],
      },
      {
        source: "settings:api-keys",
        label: "API Keys",
        page: "APIKeysSettings",
        tooltip: "Keys for connecting other software.",
        synonyms: ["API Keys"],
      },
      {
        source: "settings:google-chat",
        label: "Google Chat",
        page: "GoogleChatSettings",
        tooltip: "Google Chat notifications.",
        synonyms: ["Google Chat"],
      },
      {
        source: "settings:slack",
        label: "Slack",
        page: "SlackSettings",
        tooltip: "Slack notifications.",
        synonyms: ["Slack"],
      },
    ],
  },
  {
    id: "settings-automations",
    label: "Automations",
    items: [
      {
        id: "background-jobs",
        visibleIf: "settings-access",
        label: "Background jobs",
        page: "Settings",
        query: "?tab=automations",
        tooltip: "Scheduled jobs that send reminders and run automations.",
        synonyms: ["Automations", "Cron"],
      },
    ],
  },
  {
    id: "settings-platform",
    label: "Platform Admin",
    tooltip: "CompanySync staff only",
    platformOnly: true,
    items: [
      {
        source: "settings:saas-admin",
        label: "Platform Admin",
        page: "SaaSAdminDashboard",
        tooltip: "CompanySync platform administration.",
        synonyms: ["SaaS Admin", "Platform Admin"],
      },
      {
        source: "settings:platform-menu-restrictions",
        label: "Platform Restrictions",
        page: "PlatformMenuRestrictions",
        tooltip: "Hide menu items for every subscriber.",
        synonyms: ["Platform Menu Restrictions"],
      },
      {
        source: "settings:billing-api-keys",
        label: "Billing & API Keys",
        page: "BillingDashboard",
        tooltip: "Platform billing and API keys.",
        synonyms: ["Billing & API Keys"],
      },
      {
        source: "settings:cleanup-restart",
        label: "Cleanup & Restart",
        page: "CleanupAndRestart",
        tooltip: "Platform cleanup and restart tools.",
        synonyms: ["Cleanup & Restart"],
      },
      {
        source: "settings:utilities",
        label: "Utilities",
        page: "Utilities",
        tooltip: "Platform utilities.",
        synonyms: ["Utilities"],
      },
      {
        source: "settings:one-click-repair",
        label: "One-Click Repair",
        page: "RunRepairs",
        tooltip: "Platform repair tools.",
        synonyms: ["One-Click Repair"],
      },
      {
        id: "competitor-analysis",
        platformOnly: true,
        label: "Competitor Analysis",
        page: "CompetitorAnalysis",
        tooltip: "CompanySync internal strategy notes. Hidden from roofing accounts.",
        synonyms: ["Competitor Analysis"],
      },
    ],
  },
];

const ACCOUNT_ITEMS = [
  {
    source: "subscription",
    label: "Plan & Billing",
    page: "Pricing",
    tooltip: "Your CompanySync plan and invoices.",
    synonyms: ["Subscription"],
    icon: "CreditCard",
  },
  {
    source: "feature-comparison",
    label: "Compare Plans",
    page: "FeatureComparison",
    tooltip: "What each plan includes.",
    synonyms: ["Feature Comparison"],
    icon: "Layers",
  },
];

function leafVisible(node, ctx) {
  if (node.platformOnly && !ctx.isPlatformStaff) return false;
  if (node.visibleIf === "settings-access") return !!ctx.canOpenSettings;
  if (node.visibleIf) return ctx.visibleSources.has(node.visibleIf);
  if (node.source) return ctx.visibleSources.has(node.source);
  if (node.platformOnly) return !!ctx.isPlatformStaff;
  return false;
}

function filterTree(nodes, ctx) {
  const out = [];
  for (const node of nodes || []) {
    if (node.platformOnly && !ctx.isPlatformStaff && node.items) continue;
    if (node.items) {
      const items = filterTree(node.items, ctx);
      if (items.length === 0) continue;
      out.push({ ...node, items });
      continue;
    }
    if (!leafVisible(node, ctx)) continue;
    out.push({ ...node });
  }
  return out;
}

function attachUrls(nodes) {
  return nodes.map((node) => {
    const withItems = node.items ? { ...node, items: attachUrls(node.items) } : node;
    if (withItems.items && !withItems.page) return withItems;
    const url = withItems.page ? page(withItems.page, withItems.query || "") : withItems.url;
    if (withItems.items) return { ...withItems, url };
    const featureId = withItems.featureId || (withItems.source ? withItems.source.split("/").pop().replace(/^settings:/, "") : withItems.id);
    return { ...withItems, url, featureId };
  });
}

function toEditorNode(node) {
  if (node.platformOnly) return null;
  if (node.source?.startsWith("settings:")) return null;
  if (node.items) {
    const items = node.items.map(toEditorNode).filter(Boolean);
    if (items.length === 0) return null;
    return { id: node.id, title: node.label, items };
  }
  if (!node.source) return null;
  return { id: node.source, title: node.label, source: node.source, enabled: true };
}

export function buildSidebarEditorTree() {
  return [...NAV_SECTIONS, ...FOOTER].map(toEditorNode).filter(Boolean);
}

export function sourceEnabled(source, savedItems) {
  if (!source || !savedItems?.length) return true;
  const [parent, child] = source.split("/");
  const savedParent = savedItems.find((item) => item.id === parent);
  if (!savedParent) return true;
  if (savedParent.enabled === false) return false;
  if (!child) return true;
  const subs = savedParent.submenuItems || savedParent.submenu || [];
  const savedSub = subs.find((item) => item.id === child);
  if (!savedSub) return true;
  return savedSub.enabled !== false;
}

export function applySavedMenuToEditor(tree, savedItems) {
  return tree.map((node) => {
    if (node.items) {
      const items = applySavedMenuToEditor(node.items, savedItems);
      const leaves = [];
      const collect = (nodes) => nodes.forEach((entry) => (entry.items ? collect(entry.items) : leaves.push(entry)));
      collect(items);
      return { ...node, items, enabled: leaves.length ? leaves.some((leaf) => leaf.enabled !== false) : true };
    }
    return { ...node, enabled: sourceEnabled(node.source, savedItems) };
  });
}

export function applyEditorToLegacyMenu(legacyItems, editorTree) {
  const enabledBySource = new Map();
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.items) walk(node.items);
      else if (node.source) enabledBySource.set(node.source, node.enabled !== false);
    }
  };
  walk(editorTree);

  return legacyItems.map((item) => {
    if (item.submenuItems?.length) {
      const submenuItems = item.submenuItems.map((sub) => {
        const key = `${item.id}/${sub.id}`;
        if (!enabledBySource.has(key)) return sub;
        return { ...sub, enabled: enabledBySource.get(key) };
      });
      const referenced = submenuItems.filter((sub) => enabledBySource.has(`${item.id}/${sub.id}`));
      const parentEnabled = referenced.length
        ? referenced.some((sub) => sub.enabled !== false)
        : (enabledBySource.has(item.id) ? enabledBySource.get(item.id) : item.enabled !== false);
      return { ...item, enabled: parentEnabled, submenuItems, hasSubmenu: true };
    }
    if (!enabledBySource.has(item.id)) return item;
    return { ...item, enabled: enabledBySource.get(item.id) };
  });
}

function flattenPages(nodes, sectionLabel, bucket) {
  for (const node of nodes || []) {
    if (node.items) {
      flattenPages(node.items, sectionLabel || node.label, bucket);
    } else if (node.url) {
      bucket.push({ ...node, section: sectionLabel || "" });
    }
  }
}

export function buildSidebarModel({ visibleSources, canOpenSettings = false, isPlatformStaff = false }) {
  const ctx = { visibleSources, canOpenSettings, isPlatformStaff };
  const sections = attachUrls(filterTree(NAV_SECTIONS, ctx));
  const footer = attachUrls(filterTree(FOOTER, ctx));
  const settingsGroups = attachUrls(filterTree(SETTINGS_GROUPS, ctx));
  const account = attachUrls(filterTree(ACCOUNT_ITEMS, ctx));
  const pages = [];
  flattenPages(sections, "", pages);
  flattenPages(footer, "", pages);
  flattenPages(settingsGroups, "Settings", pages);
  flattenPages(account, "Account", pages);
  return { sections, footer, settingsGroups, account, pages };
}

export function isNavItemActive(url, pathname, search) {
  if (!url) return false;
  const [path, query] = url.split("?");
  if (query) return pathname === path && search === `?${query}`;
  return pathname === path;
}

export function findAncestorIds(nodes, pathname, search, acc = []) {
  for (const node of nodes || []) {
    if (node.items) {
      const found = findAncestorIds(node.items, pathname, search, [...acc, node.id]);
      if (found) return found;
    } else if (isNavItemActive(node.url, pathname, search)) {
      return acc;
    }
  }
  return null;
}
