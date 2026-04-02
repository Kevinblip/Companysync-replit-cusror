import { lazy } from 'react';
import __Layout from './Layout.jsx';

const APIKeysSettings = lazy(() => import('./pages/APIKeysSettings'));
const AIAccountant = lazy(() => import('./pages/AIAccountant'));
const AIAssistant = lazy(() => import('./pages/AIAssistant'));
const AIEstimator = lazy(() => import('./pages/AIEstimator'));
const AIStaff = lazy(() => import('./pages/AIStaff'));
const AITraining = lazy(() => import('./pages/AITraining'));
const Accounting = lazy(() => import('./pages/Accounting'));
const AccountingDashboard = lazy(() => import('./pages/AccountingDashboard'));
const AccountingReports = lazy(() => import('./pages/AccountingReports'));
const AccountingSetup = lazy(() => import('./pages/AccountingSetup'));
const AccountsReceivableReport = lazy(() => import('./pages/AccountsReceivableReport'));
const Activity = lazy(() => import('./pages/Activity'));
const Analytics = lazy(() => import('./pages/Analytics'));
const BackupManager = lazy(() => import('./pages/BackupManager'));
const BankReconciliation = lazy(() => import('./pages/BankReconciliation'));
const BetaQuestionnaire = lazy(() => import('./pages/BetaQuestionnaire'));
const Billing = lazy(() => import('./pages/Billing'));
const BillingDashboard = lazy(() => import('./pages/BillingDashboard'));
const Bills = lazy(() => import('./pages/Bills'));
const BookAppointment = lazy(() => import('./pages/BookAppointment'));
const BugTrackerReport = lazy(() => import('./pages/BugTrackerReport'));
const BuildSchedule = lazy(() => import('./pages/BuildSchedule'));
const BulkImport = lazy(() => import('./pages/BulkImport'));
const Calendar = lazy(() => import('./pages/Calendar'));
const CalendarSettings = lazy(() => import('./pages/CalendarSettings'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const ChartOfAccountsPage = lazy(() => import('./pages/ChartOfAccountsPage'));
const CleanupAndRestart = lazy(() => import('./pages/CleanupAndRestart'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const CommissionReport = lazy(() => import('./pages/CommissionReport'));
const CommissionRules = lazy(() => import('./pages/CommissionRules'));
const CommissionTracking = lazy(() => import('./pages/CommissionTracking'));
const Communication = lazy(() => import('./pages/Communication'));
const CommunicationDashboard = lazy(() => import('./pages/CommunicationDashboard'));
const CompanySetup = lazy(() => import('./pages/CompanySetup'));
const CompetitorAnalysis = lazy(() => import('./pages/CompetitorAnalysis'));
const ContractFieldEditor = lazy(() => import('./pages/ContractFieldEditor'));
const ContractSigning = lazy(() => import('./pages/ContractSigning'));
const ContractTemplates = lazy(() => import('./pages/ContractTemplates'));
const Contracts = lazy(() => import('./pages/Contracts'));
const ConversationHistory = lazy(() => import('./pages/ConversationHistory'));
const CreateEstimate = lazy(() => import('./pages/CreateEstimate'));
const CustomFields = lazy(() => import('./pages/CustomFields'));
const CustomFormats = lazy(() => import('./pages/CustomFormats'));
const CustomerGroups = lazy(() => import('./pages/CustomerGroups'));
const CustomerPortal = lazy(() => import('./pages/CustomerPortal'));
const CustomerPortalPublic = lazy(() => import('./pages/CustomerPortalPublic'));
const CustomerProfile = lazy(() => import('./pages/CustomerProfile'));
const Customers = lazy(() => import('./pages/Customers'));
const DailyReports = lazy(() => import('./pages/DailyReports'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const DataCleanup = lazy(() => import('./pages/DataCleanup'));
const DataImport = lazy(() => import('./pages/DataImport'));
const Documents = lazy(() => import('./pages/Documents'));
const DownloadCompetitorAnalysis = lazy(() => import('./pages/DownloadCompetitorAnalysis'));
const DroneInspections = lazy(() => import('./pages/DroneInspections'));
const EmailTemplates = lazy(() => import('./pages/EmailTemplates'));
const EstimateEditor = lazy(() => import('./pages/EstimateEditor'));
const EstimateImporter = lazy(() => import('./pages/EstimateImporter'));
const Estimates = lazy(() => import('./pages/Estimates'));
const Expenses = lazy(() => import('./pages/Expenses'));
const FamilyCommissions = lazy(() => import('./pages/FamilyCommissions'));
const FeatureComparison = lazy(() => import('./pages/FeatureComparison'));
const FieldRepApp = lazy(() => import('./pages/FieldRepApp'));
const FieldSalesTracker = lazy(() => import('./pages/FieldSalesTracker'));
const GeminiLiveMode = lazy(() => import('./pages/GeminiLiveMode'));
const GeneralSettings = lazy(() => import('./pages/GeneralSettings'));
const GoHighLevelSettings = lazy(() => import('./pages/GoHighLevelSettings'));
const GoogleChatSettings = lazy(() => import('./pages/GoogleChatSettings'));
const HRManagement = lazy(() => import('./pages/HRManagement'));
const InspectionCapture = lazy(() => import('./pages/InspectionCapture'));
const InspectionReports = lazy(() => import('./pages/InspectionReports'));
const InspectionsDashboard = lazy(() => import('./pages/InspectionsDashboard'));
const Inspectors = lazy(() => import('./pages/Inspectors'));
const IntegrationManager = lazy(() => import('./pages/IntegrationManager'));
const IntegrationsHub = lazy(() => import('./pages/IntegrationsHub'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Items = lazy(() => import('./pages/Items'));
const JournalEntry = lazy(() => import('./pages/JournalEntry'));
const KnowledgeBase = lazy(() => import('./pages/KnowledgeBase'));
const LadderAssistDashboard = lazy(() => import('./pages/LadderAssistDashboard'));
const LaunchChecklist = lazy(() => import('./pages/LaunchChecklist'));
const LeadFinder = lazy(() => import('./pages/LeadFinder'));
const LeadProfile = lazy(() => import('./pages/LeadProfile'));
const LeadSettings = lazy(() => import('./pages/LeadSettings'));
const Leads = lazy(() => import('./pages/Leads'));
const LexiMemory = lazy(() => import('./pages/LexiMemory'));
const LexiSettings = lazy(() => import('./pages/LexiSettings'));
const LexiWorkspace = lazy(() => import('./pages/LexiWorkspace'));
const LiveCallDashboard = lazy(() => import('./pages/LiveCallDashboard'));
const LocalCustomers = lazy(() => import('./pages/LocalCustomers'));
const LiveVoice = lazy(() => import('./pages/LiveVoice'));
const Logout = lazy(() => import('./pages/Logout'));
const Mailbox = lazy(() => import('./pages/Mailbox'));
const ManageSubscription = lazy(() => import('./pages/ManageSubscription'));
const MapPage = lazy(() => import('./pages/Map'));
const MarcusMarketing = lazy(() => import('./pages/MarcusMarketing'));
const MappingRules = lazy(() => import('./pages/MappingRules'));
const MenuSetup = lazy(() => import('./pages/MenuSetup'));
const Messages = lazy(() => import('./pages/Messages'));
const NewInspection = lazy(() => import('./pages/NewInspection'));
const NotificationDiagnostics = lazy(() => import('./pages/NotificationDiagnostics'));
const OnboardingWizard = lazy(() => import('./pages/OnboardingWizard'));
const PDFBranding = lazy(() => import('./pages/PDFBranding'));
const PDFSettings = lazy(() => import('./pages/PDFSettings'));
const PageBuilder = lazy(() => import('./pages/PageBuilder'));
const Payments = lazy(() => import('./pages/Payments'));
const Payouts = lazy(() => import('./pages/Payouts'));
const Payroll = lazy(() => import('./pages/Payroll'));
const PermitAssistant = lazy(() => import('./pages/PermitAssistant'));
const PlatformMenuRestrictions = lazy(() => import('./pages/PlatformMenuRestrictions'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Projects = lazy(() => import('./pages/Projects'));
const PropertyDataImporter = lazy(() => import('./pages/PropertyDataImporter'));
const Proposals = lazy(() => import('./pages/Proposals'));
const PublicPricing = lazy(() => import('./pages/PublicPricing'));
const QuickSetup = lazy(() => import('./pages/QuickSetup'));
const Reminders = lazy(() => import('./pages/Reminders'));
const ReportBuilder = lazy(() => import('./pages/ReportBuilder'));
const ReportTemplates = lazy(() => import('./pages/ReportTemplates'));
const Reports = lazy(() => import('./pages/Reports'));
const ReviewRequests = lazy(() => import('./pages/ReviewRequests'));
const RolesManagement = lazy(() => import('./pages/RolesManagement'));
const RoundRobinSettings = lazy(() => import('./pages/RoundRobinSettings'));
const RunRepairs = lazy(() => import('./pages/RunRepairs'));
const SMSTemplates = lazy(() => import('./pages/SMSTemplates'));
const Settings = lazy(() => import('./pages/Settings'));
const SaaSAdminDashboard = lazy(() => import('./pages/SaaSAdminDashboard'));
const SalesDashboard = lazy(() => import('./pages/SalesDashboard'));
const SalesTracking = lazy(() => import('./pages/SalesTracking'));
const SarahSettings = lazy(() => import('./pages/SarahSettings'));
const SarahWorkspace = lazy(() => import('./pages/SarahWorkspace'));
const SecurityCompliance = lazy(() => import('./pages/SecurityCompliance'));
const SetupBankAccount = lazy(() => import('./pages/SetupBankAccount'));
const SetupWizard = lazy(() => import('./pages/SetupWizard'));
const SignContractRep = lazy(() => import('./pages/SignContractRep'));
const SlackSettings = lazy(() => import('./pages/SlackSettings'));
const SmartGlassesSetup = lazy(() => import('./pages/SmartGlassesSetup'));
const SmsSender = lazy(() => import('./pages/SmsSender'));
const StaffManagement = lazy(() => import('./pages/StaffManagement'));
const StaffProfilePage = lazy(() => import('./pages/StaffProfilePage'));
const StormAlertSettings = lazy(() => import('./pages/StormAlertSettings'));
const StormReport = lazy(() => import('./pages/StormReport'));
const StormTracking = lazy(() => import('./pages/StormTracking'));
const StripeConnect = lazy(() => import('./pages/StripeConnect'));
const Subcontractors = lazy(() => import('./pages/Subcontractors'));
const SubscriptionCancel = lazy(() => import('./pages/SubscriptionCancel'));
const SubscriptionLimitsAdmin = lazy(() => import('./pages/SubscriptionLimitsAdmin'));
const SubscriptionPackages = lazy(() => import('./pages/SubscriptionPackages'));
const SubscriptionSuccess = lazy(() => import('./pages/SubscriptionSuccess'));
const SubscriptionUsage = lazy(() => import('./pages/SubscriptionUsage'));
const Subscriptions = lazy(() => import('./pages/Subscriptions'));
const Support = lazy(() => import('./pages/Support'));
const SystemAuditReport = lazy(() => import('./pages/SystemAuditReport'));
const TaskCustomerLinker = lazy(() => import('./pages/TaskCustomerLinker'));
const TaskImporter = lazy(() => import('./pages/TaskImporter'));
const TaskSettings = lazy(() => import('./pages/TaskSettings'));
const Tasks = lazy(() => import('./pages/Tasks'));
const TaxRates = lazy(() => import('./pages/TaxRates'));
const Templates = lazy(() => import('./pages/Templates'));
const TerritoryManager = lazy(() => import('./pages/TerritoryManager'));
const TestContractSigning = lazy(() => import('./pages/TestContractSigning'));
const TrainingVideoPlayer = lazy(() => import('./pages/TrainingVideoPlayer'));
const Transactions = lazy(() => import('./pages/Transactions'));
const TransferFunds = lazy(() => import('./pages/TransferFunds'));
const Utilities = lazy(() => import('./pages/Utilities'));
const VideoTrainingGenerator = lazy(() => import('./pages/VideoTrainingGenerator'));
const ViewEstimate = lazy(() => import('./pages/ViewEstimate'));
const WorkflowDebug = lazy(() => import('./pages/WorkflowDebug'));
const Workflows = lazy(() => import('./pages/Workflows'));
const ZoomMeeting = lazy(() => import('./pages/ZoomMeeting'));
const estimateEditor = lazy(() => import('./pages/estimate-editor'));
const invoiceDetails = lazy(() => import('./pages/invoice-details'));
const invoicesPage = lazy(() => import('./pages/invoices'));
const leadProfile = lazy(() => import('./pages/lead-profile'));
const settingsPage = lazy(() => import('./pages/settings'));
const signContractCustomer = lazy(() => import('./pages/sign-contract-customer'));
const signContract = lazy(() => import('./pages/sign-contract'));
const tasksPage = lazy(() => import('./pages/tasks'));


export const PAGES = {
    "APIKeysSettings": APIKeysSettings,
    "AIAccountant": AIAccountant,
    "AIAssistant": AIAssistant,
    "AIEstimator": AIEstimator,
    "AIStaff": AIStaff,
    "AITraining": AITraining,
    "Accounting": Accounting,
    "AccountingDashboard": AccountingDashboard,
    "AccountingReports": AccountingReports,
    "AccountingSetup": AccountingSetup,
    "AccountsReceivableReport": AccountsReceivableReport,
    "Activity": Activity,
    "Analytics": Analytics,
    "BackupManager": BackupManager,
    "BankReconciliation": BankReconciliation,
    "BetaQuestionnaire": BetaQuestionnaire,
    "Billing": Billing,
    "BillingDashboard": BillingDashboard,
    "Bills": Bills,
    "BookAppointment": BookAppointment,
    "BugTrackerReport": BugTrackerReport,
    "BuildSchedule": BuildSchedule,
    "BulkImport": BulkImport,
    "Calendar": Calendar,
    "CalendarSettings": CalendarSettings,
    "Campaigns": Campaigns,
    "ChartOfAccountsPage": ChartOfAccountsPage,
    "CleanupAndRestart": CleanupAndRestart,
    "ComingSoon": ComingSoon,
    "CommissionReport": CommissionReport,
    "CommissionRules": CommissionRules,
    "CommissionTracking": CommissionTracking,
    "Communication": Communication,
    "CommunicationDashboard": CommunicationDashboard,
    "CompanySetup": CompanySetup,
    "CompetitorAnalysis": CompetitorAnalysis,
    "ContractFieldEditor": ContractFieldEditor,
    "ContractSigning": ContractSigning,
    "ContractTemplates": ContractTemplates,
    "Contracts": Contracts,
    "ConversationHistory": ConversationHistory,
    "CreateEstimate": CreateEstimate,
    "CustomFields": CustomFields,
    "CustomFormats": CustomFormats,
    "CustomerGroups": CustomerGroups,
    "CustomerPortal": CustomerPortal,
    "CustomerPortalPublic": CustomerPortalPublic,
    "CustomerProfile": CustomerProfile,
    "Customers": Customers,
    "DailyReports": DailyReports,
    "Dashboard": Dashboard,
    "DataCleanup": DataCleanup,
    "DataImport": DataImport,
    "Documents": Documents,
    "DownloadCompetitorAnalysis": DownloadCompetitorAnalysis,
    "DroneInspections": DroneInspections,
    "EmailTemplates": EmailTemplates,
    "EstimateEditor": EstimateEditor,
    "EstimateImporter": EstimateImporter,
    "Estimates": Estimates,
    "Expenses": Expenses,
    "FamilyCommissions": FamilyCommissions,
    "FeatureComparison": FeatureComparison,
    "FieldRepApp": FieldRepApp,
    "FieldSalesTracker": FieldSalesTracker,
    "GeminiLiveMode": GeminiLiveMode,
    "GeneralSettings": GeneralSettings,
    "GoHighLevelSettings": GoHighLevelSettings,
    "GoogleChatSettings": GoogleChatSettings,
    "HRManagement": HRManagement,
    "InspectionCapture": InspectionCapture,
    "InspectionReports": InspectionReports,
    "InspectionsDashboard": InspectionsDashboard,
    "Inspectors": Inspectors,
    "IntegrationManager": IntegrationManager,
    "IntegrationsHub": IntegrationsHub,
    "Invoices": Invoices,
    "Items": Items,
    "JournalEntry": JournalEntry,
    "KnowledgeBase": KnowledgeBase,
    "LadderAssistDashboard": LadderAssistDashboard,
    "LaunchChecklist": LaunchChecklist,
    "LeadFinder": LeadFinder,
    "LeadProfile": LeadProfile,
    "LeadSettings": LeadSettings,
    "Leads": Leads,
    "LexiMemory": LexiMemory,
    "LexiSettings": LexiSettings,
    "LexiWorkspace": LexiWorkspace,
    "LiveCallDashboard": LiveCallDashboard,
    "LocalCustomers": LocalCustomers,
    "LiveVoice": LiveVoice,
    "Logout": Logout,
    "Mailbox": Mailbox,
    "ManageSubscription": ManageSubscription,
    "Map": MapPage,
    "MarcusMarketing": MarcusMarketing,
    "MappingRules": MappingRules,
    "MenuSetup": MenuSetup,
    "Messages": Messages,
    "NewInspection": NewInspection,
    "NotificationDiagnostics": NotificationDiagnostics,
    "OnboardingWizard": OnboardingWizard,
    "PDFBranding": PDFBranding,
    "PDFSettings": PDFSettings,
    "PageBuilder": PageBuilder,
    "Payments": Payments,
    "Payouts": Payouts,
    "Payroll": Payroll,
    "PermitAssistant": PermitAssistant,
    "PlatformMenuRestrictions": PlatformMenuRestrictions,
    "Pricing": Pricing,
    "Projects": Projects,
    "PropertyDataImporter": PropertyDataImporter,
    "Proposals": Proposals,
    "PublicPricing": PublicPricing,
    "QuickSetup": QuickSetup,
    "Reminders": Reminders,
    "ReportBuilder": ReportBuilder,
    "ReportTemplates": ReportTemplates,
    "Reports": Reports,
    "ReviewRequests": ReviewRequests,
    "RolesManagement": RolesManagement,
    "RoundRobinSettings": RoundRobinSettings,
    "RunRepairs": RunRepairs,
    "SMSTemplates": SMSTemplates,
    "Settings": Settings,
    "SaaSAdminDashboard": SaaSAdminDashboard,
    "SalesDashboard": SalesDashboard,
    "SalesTracking": SalesTracking,
    "SarahSettings": SarahSettings,
    "SarahWorkspace": SarahWorkspace,
    "SecurityCompliance": SecurityCompliance,
    "SetupBankAccount": SetupBankAccount,
    "SetupWizard": SetupWizard,
    "SignContractRep": SignContractRep,
    "SlackSettings": SlackSettings,
    "SmartGlassesSetup": SmartGlassesSetup,
    "SmsSender": SmsSender,
    "StaffManagement": StaffManagement,
    "StaffProfilePage": StaffProfilePage,
    "StormAlertSettings": StormAlertSettings,
    "StormReport": StormReport,
    "StormTracking": StormTracking,
    "StripeConnect": StripeConnect,
    "Subcontractors": Subcontractors,
    "SubscriptionCancel": SubscriptionCancel,
    "SubscriptionLimitsAdmin": SubscriptionLimitsAdmin,
    "SubscriptionPackages": SubscriptionPackages,
    "SubscriptionSuccess": SubscriptionSuccess,
    "SubscriptionUsage": SubscriptionUsage,
    "Subscriptions": Subscriptions,
    "Support": Support,
    "SystemAuditReport": SystemAuditReport,
    "TaskCustomerLinker": TaskCustomerLinker,
    "TaskImporter": TaskImporter,
    "TaskSettings": TaskSettings,
    "Tasks": Tasks,
    "TaxRates": TaxRates,
    "Templates": Templates,
    "TerritoryManager": TerritoryManager,
    "TestContractSigning": TestContractSigning,
    "TrainingVideoPlayer": TrainingVideoPlayer,
    "Transactions": Transactions,
    "TransferFunds": TransferFunds,
    "Utilities": Utilities,
    "VideoTrainingGenerator": VideoTrainingGenerator,
    "ViewEstimate": ViewEstimate,
    "WorkflowDebug": WorkflowDebug,
    "Workflows": Workflows,
    "ZoomMeeting": ZoomMeeting,
    "estimate-editor": estimateEditor,
    "invoice-details": invoiceDetails,
    "invoices": invoicesPage,
    "lead-profile": leadProfile,
    "settings": settingsPage,
    "sign-contract-customer": signContractCustomer,
    "sign-contract": signContract,
    "tasks": tasksPage,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};
