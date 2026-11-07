/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import APIKeysSettings from './pages/APIKeysSettings';
import ActionItems from './pages/ActionItems';
import AIAccountant from './pages/AIAccountant';
import AIAssistant from './pages/AIAssistant';
import AIEstimator from './pages/AIEstimator';
import AIStaff from './pages/AIStaff';
import AITraining from './pages/AITraining';
import Accounting from './pages/Accounting';
import AccountingDashboard from './pages/AccountingDashboard';
import AccountingReports from './pages/AccountingReports';
import AccountingSetup from './pages/AccountingSetup';
import AccountsReceivableReport from './pages/AccountsReceivableReport';
import Activity from './pages/Activity';
import Analytics from './pages/Analytics';
import BackupManager from './pages/BackupManager';
import ClaimsAudit from './pages/ClaimsAudit';
import BankReconciliation from './pages/BankReconciliation';
import BetaQuestionnaire from './pages/BetaQuestionnaire';
import Billing from './pages/Billing';
import BillingDashboard from './pages/BillingDashboard';
import Bills from './pages/Bills';
import BookAppointment from './pages/BookAppointment';
import BugTrackerReport from './pages/BugTrackerReport';
import BuildSchedule from './pages/BuildSchedule';
import BulkImport from './pages/BulkImport';
import Calendar from './pages/Calendar';
import CalendarSettings from './pages/CalendarSettings';
import Campaigns from './pages/Campaigns';
import ChartOfAccountsPage from './pages/ChartOfAccountsPage';
import CleanupAndRestart from './pages/CleanupAndRestart';
import ComingSoon from './pages/ComingSoon';
import CommissionReport from './pages/CommissionReport';
import CommissionRules from './pages/CommissionRules';
import CommissionTracking from './pages/CommissionTracking';
import Communication from './pages/Communication';
import CommunicationDashboard from './pages/CommunicationDashboard';
import CompanySetup from './pages/CompanySetup';
import CompetitorAnalysis from './pages/CompetitorAnalysis';
import ContractFieldEditor from './pages/ContractFieldEditor';
import ContractSigning from './pages/ContractSigning';
import ContractTemplates from './pages/ContractTemplates';
import Contracts from './pages/Contracts';
import ConversationHistory from './pages/ConversationHistory';
import CreateEstimate from './pages/CreateEstimate';
import CustomFields from './pages/CustomFields';
import CustomFormats from './pages/CustomFormats';
import CustomerGroups from './pages/CustomerGroups';
import CustomerPortal from './pages/CustomerPortal';
import CustomerPortalPublic from './pages/CustomerPortalPublic';
import CustomerProfile from './pages/CustomerProfile';
import Customers from './pages/Customers';
import DailyReports from './pages/DailyReports';
import Dashboard from './pages/Dashboard';
import DataCleanup from './pages/DataCleanup';
import DataImport from './pages/DataImport';
import Documents from './pages/Documents';
import DownloadCompetitorAnalysis from './pages/DownloadCompetitorAnalysis';
import DroneInspections from './pages/DroneInspections';
import EmailTemplates from './pages/EmailTemplates';
import EstimateEditor from './pages/EstimateEditor';
import EstimateImporter from './pages/EstimateImporter';
import Estimates from './pages/Estimates';
import Expenses from './pages/Expenses';
import FamilyCommissions from './pages/FamilyCommissions';
import FeatureComparison from './pages/FeatureComparison';
import FieldRepApp from './pages/FieldRepApp';
import FieldSalesTracker from './pages/FieldSalesTracker';
import GeminiLiveMode from './pages/GeminiLiveMode';
import GeneralSettings from './pages/GeneralSettings';
import GoHighLevelSettings from './pages/GoHighLevelSettings';
import GoogleChatSettings from './pages/GoogleChatSettings';
import GoogleMeet from './pages/GoogleMeet';
import HRManagement from './pages/HRManagement';
import InspectionCapture from './pages/InspectionCapture';
import InspectionReports from './pages/InspectionReports';
import InspectionRouting from './pages/InspectionRouting';
import InspectionsDashboard from './pages/InspectionsDashboard';
import Inspectors from './pages/Inspectors';
import IntegrationManager from './pages/IntegrationManager';
import IntegrationsHub from './pages/IntegrationsHub';
import Invoices from './pages/Invoices';
import JobNimbusSettings from './pages/JobNimbusSettings';
import Items from './pages/Items';
import JournalEntry from './pages/JournalEntry';
import KnowledgeBase from './pages/KnowledgeBase';
import LadderAssistDashboard from './pages/LadderAssistDashboard';
import LaunchChecklist from './pages/LaunchChecklist';
import LeadFinder from './pages/LeadFinder';
import LeadProfile from './pages/LeadProfile';
import LeadSettings from './pages/LeadSettings';
import Leads from './pages/Leads';
import LaborRates from './pages/LaborRates';
import Leaderboard from './pages/Leaderboard';
import LexiMemory from './pages/LexiMemory';
import LexiSettings from './pages/LexiSettings';
import LexiWorkspace from './pages/LexiWorkspace';
import LiveCallDashboard from './pages/LiveCallDashboard';
import LocalCustomers from './pages/LocalCustomers';
import LiveVoice from './pages/LiveVoice';
import Logout from './pages/Logout';
import Mailbox from './pages/Mailbox';
import MyAssignments from './pages/MyAssignments';
import ManageSubscription from './pages/ManageSubscription';
import Map from './pages/Map';
import MarcusMarketing from './pages/MarcusMarketing';
import MarketingVideos from './pages/MarketingVideos';
import MappingRules from './pages/MappingRules';
import MenuSetup from './pages/MenuSetup';
import Messages from './pages/Messages';
import TeamChat from './pages/TeamChat';
import NewInspection from './pages/NewInspection';
import NotificationDiagnostics from './pages/NotificationDiagnostics';
import OnboardingWizard from './pages/OnboardingWizard';
import PDFBranding from './pages/PDFBranding';
import PDFSettings from './pages/PDFSettings';
import PageBuilder from './pages/PageBuilder';
import Payments from './pages/Payments';
import Payouts from './pages/Payouts';
import Payroll from './pages/Payroll';
import PermitAssistant from './pages/PermitAssistant';
import PlatformMenuRestrictions from './pages/PlatformMenuRestrictions';
import Pricing from './pages/Pricing';
import Projects from './pages/Projects';
import PropertyDataImporter from './pages/PropertyDataImporter';
import Proposals from './pages/Proposals';
import PublicPricing from './pages/PublicPricing';
import QuickSetup from './pages/QuickSetup';
import Reminders from './pages/Reminders';
import ReportBuilder from './pages/ReportBuilder';
import ReportTemplates from './pages/ReportTemplates';
import Reports from './pages/Reports';
import RepPerformance from './pages/RepPerformance';
import ReviewRequests from './pages/ReviewRequests';
import RolesManagement from './pages/RolesManagement';
import RoundRobinSettings from './pages/RoundRobinSettings';
import RunRepairs from './pages/RunRepairs';
import SMSTemplates from './pages/SMSTemplates';
import Settings from './pages/Settings';
import SaaSAdminDashboard from './pages/SaaSAdminDashboard';
import SalesDashboard from './pages/SalesDashboard';
import SalesDemo from './pages/SalesDemo';
import SalesAgentAdmin from './pages/SalesAgentAdmin';
import SalesTracking from './pages/SalesTracking';
import SarahSettings from './pages/SarahSettings';
import SarahWorkspace from './pages/SarahWorkspace';
import SecurityCompliance from './pages/SecurityCompliance';
import SetupBankAccount from './pages/SetupBankAccount';
import SetupWizard from './pages/SetupWizard';
import SignContractRep from './pages/SignContractRep';
import SlackSettings from './pages/SlackSettings';
import SmartGlassesSetup from './pages/SmartGlassesSetup';
import SmsSender from './pages/SmsSender';
import StaffManagement from './pages/StaffManagement';
import StaffProfilePage from './pages/StaffProfilePage';
import StormAlertSettings from './pages/StormAlertSettings';
import StormReport from './pages/StormReport';
import StormTracking from './pages/StormTracking';
import StripeConnect from './pages/StripeConnect';
import Subcontractors from './pages/Subcontractors';
import SubcontractorWorkOrders from './pages/SubcontractorWorkOrders';
import SubscriptionCancel from './pages/SubscriptionCancel';
import SubscriptionLimitsAdmin from './pages/SubscriptionLimitsAdmin';
import SubscriptionPackages from './pages/SubscriptionPackages';
import SubscriptionSuccess from './pages/SubscriptionSuccess';
import SubscriptionUsage from './pages/SubscriptionUsage';
import Subscriptions from './pages/Subscriptions';
import Support from './pages/Support';
import SystemAuditReport from './pages/SystemAuditReport';
import TaskCustomerLinker from './pages/TaskCustomerLinker';
import TaskImporter from './pages/TaskImporter';
import TaskSettings from './pages/TaskSettings';
import Tasks from './pages/Tasks';
import TaxRates from './pages/TaxRates';
import Templates from './pages/Templates';
import TerritoryManager from './pages/TerritoryManager';
import TestContractSigning from './pages/TestContractSigning';
// SOFT-HIDDEN: Thoughtly integration disabled platform-wide
// import ThoughtlySetup from './pages/ThoughtlySetup';
import TrainingVideoPlayer from './pages/TrainingVideoPlayer';
import TrainingVideos from './pages/TrainingVideos';
import Transactions from './pages/Transactions';
import TransferFunds from './pages/TransferFunds';
import Utilities from './pages/Utilities';
import VideoTrainingGenerator from './pages/VideoTrainingGenerator';
import ViewEstimate from './pages/ViewEstimate';
import WorkflowDebug from './pages/WorkflowDebug';
import Workflows from './pages/Workflows';
import ZoomMeeting from './pages/ZoomMeeting';
import estimateEditor from './pages/estimate-editor';
import invoiceDetails from './pages/invoice-details';
import invoices from './pages/invoices';
import leadProfile from './pages/lead-profile';
import settings from './pages/settings';
import signContractCustomer from './pages/sign-contract-customer';
import signContract from './pages/sign-contract';
import tasks from './pages/tasks';
import __Layout from './Layout.jsx';


export const PAGES = {
    "ActionItems": ActionItems,
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
    "ClaimsAudit": ClaimsAudit,
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
    "GoogleMeet": GoogleMeet,
    "HRManagement": HRManagement,
    "InspectionCapture": InspectionCapture,
    "InspectionReports": InspectionReports,
    "InspectionRouting": InspectionRouting,
    "InspectionsDashboard": InspectionsDashboard,
    "Inspectors": Inspectors,
    "IntegrationManager": IntegrationManager,
    "IntegrationsHub": IntegrationsHub,
    "Invoices": Invoices,
    "JobNimbusSettings": JobNimbusSettings,
    "Items": Items,
    "JournalEntry": JournalEntry,
    "KnowledgeBase": KnowledgeBase,
    "LadderAssistDashboard": LadderAssistDashboard,
    "LaunchChecklist": LaunchChecklist,
    "LeadFinder": LeadFinder,
    "LeadProfile": LeadProfile,
    "LeadSettings": LeadSettings,
    "Leads": Leads,
    "LaborRates": LaborRates,
    "Leaderboard": Leaderboard,
    "LexiMemory": LexiMemory,
    "LexiSettings": LexiSettings,
    "LexiWorkspace": LexiWorkspace,
    "LiveCallDashboard": LiveCallDashboard,
    "LocalCustomers": LocalCustomers,
    "LiveVoice": LiveVoice,
    "Logout": Logout,
    "Mailbox": Mailbox,
    "MyAssignments": MyAssignments,
    "ManageSubscription": ManageSubscription,
    "Map": Map,
    "MarcusMarketing": MarcusMarketing,
    "MarketingVideos": MarketingVideos,
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
    "RepPerformance": RepPerformance,
    "ReviewRequests": ReviewRequests,
    "RolesManagement": RolesManagement,
    "RoundRobinSettings": RoundRobinSettings,
    "RunRepairs": RunRepairs,
    "SMSTemplates": SMSTemplates,
    "Settings": Settings,
    "SaaSAdminDashboard": SaaSAdminDashboard,
    "SalesDashboard": SalesDashboard,
    "SalesDemo": SalesDemo,
    "SalesAgentAdmin": SalesAgentAdmin,
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
    "SubcontractorWorkOrders": SubcontractorWorkOrders,
    "SubscriptionCancel": SubscriptionCancel,
    "SubscriptionLimitsAdmin": SubscriptionLimitsAdmin,
    "SubscriptionPackages": SubscriptionPackages,
    "SubscriptionSuccess": SubscriptionSuccess,
    "SubscriptionUsage": SubscriptionUsage,
    "Subscriptions": Subscriptions,
    "Support": Support,
    "SystemAuditReport": SystemAuditReport,
    "TeamChat": TeamChat,
    "TaskCustomerLinker": TaskCustomerLinker,
    "TaskImporter": TaskImporter,
    "TaskSettings": TaskSettings,
    "Tasks": Tasks,
    "TaxRates": TaxRates,
    "Templates": Templates,
    "TerritoryManager": TerritoryManager,
    "TestContractSigning": TestContractSigning,
    // SOFT-HIDDEN: Thoughtly integration disabled platform-wide
    // "ThoughtlySetup": ThoughtlySetup,
    "TrainingVideoPlayer": TrainingVideoPlayer,
    "TrainingVideos": TrainingVideos,
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
    "invoices": invoices,
    "lead-profile": leadProfile,
    "settings": settings,
    "sign-contract-customer": signContractCustomer,
    "sign-contract": signContract,
    "tasks": tasks,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};