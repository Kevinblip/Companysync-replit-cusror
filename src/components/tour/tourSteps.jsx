import { 
  LayoutDashboard, 
  Sparkles, 
  UserPlus, 
  ShoppingCart, 
  Briefcase, 
  MessageSquare, 
  FileText, 
  BarChart3, 
  Calendar,
  Wallet,
  Map as MapIcon,
  Camera,
  Search,
  Video,
  Hammer
} from "lucide-react";

export const tourSteps = [
  {
    id: "welcome",
    title: "Welcome to CompanySync",
    description: "Your all-in-one business management solution. We've prepared a comprehensive tour to show you how to maximize your growth using our platform.",
    image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80",
    target: null
  },
  {
    id: "dashboard",
    title: "Command Center",
    description: "Start here every day. Get a real-time overview of your revenue, open tasks, recent activity, and key performance indicators at a glance.",
    target: "menu-item-dashboard",
    icon: LayoutDashboard,
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "ai-tools",
    title: "AI Powerhouse",
    description: "Your secret weapon. Use Lexi Assistant for 24/7 help, generate instant estimates with AI, and automate your daily reporting workflows.",
    target: "menu-item-ai-tools",
    icon: Sparkles,
    image: "https://images.unsplash.com/photo-1677442136019-21780ecad795?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "lead-manager",
    title: "Lead Management",
    description: "Centralize your inbound leads. Track their status, assign them to reps, and ensure no opportunity slips through the cracks.",
    target: "menu-item-lead-manager",
    icon: UserPlus,
    image: "https://images.unsplash.com/photo-1552581234-26160f608093?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "lead-finder",
    title: "Lead Finder",
    description: "Need more business? Use our advanced Lead Finder to discover potential customers in your area and add them directly to your pipeline.",
    target: "menu-item-lead-manager",
    icon: Search,
    image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "sales",
    title: "Sales Pipeline",
    description: "From estimate to invoice. Create professional proposals, track customer interactions, and manage your entire sales process seamlessly.",
    target: "menu-item-sales",
    icon: ShoppingCart,
    image: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "field-operations",
    title: "Field Operations",
    description: "Manage your territories efficiently. Assign areas to your canvassers and track field performance in real-time.",
    target: "menu-item-field-operations",
    icon: MapIcon,
    image: "https://images.unsplash.com/photo-1581094794329-cd1196532882?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "smart-glasses",
    title: "Smart Glasses Integration",
    description: "Go hands-free. Connect Ray-Ban Meta smart glasses to capture site photos and videos that instantly sync to your job files.",
    target: "menu-item-smart-glasses",
    icon: Camera,
    image: "https://images.unsplash.com/photo-1572635196237-14b3f281503f?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "operations",
    title: "CrewCam & Projects",
    description: "Document every job. Use CrewCam for comprehensive photo reports and manage your active projects and subcontractors in one place.",
    target: "menu-item-operations",
    icon: Hammer,
    image: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "communication",
    title: "Unified Communication",
    description: "Stop switching apps. Manage calls, texts, and emails from a single inbox. Set up automated campaigns to nurture your leads.",
    target: "menu-item-communication",
    icon: MessageSquare,
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "calendar",
    title: "Smart Scheduling",
    description: "Keep your team in sync. Schedule inspections, installations, and meetings. Full two-way sync with Google Calendar included.",
    target: "menu-item-calendar",
    icon: Calendar,
    image: "https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "map",
    title: "Interactive Map",
    description: "Visual intelligence. See your leads, jobs, and field staff locations on a live, interactive map for better logistics planning.",
    target: "menu-item-map",
    icon: MapIcon,
    image: "https://images.unsplash.com/photo-1524661135-423995f22d0b?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "accounting",
    title: "Financial Health",
    description: "Know your numbers. Track expenses, manage bills, and view profit & loss reports. Integrate with QuickBooks for seamless accounting.",
    target: "menu-item-accounting",
    icon: Wallet,
    image: "https://images.unsplash.com/photo-1554224154-26032ffc0d07?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "documents",
    title: "Digital Documents",
    description: "Streamline paperwork. Send contracts for e-signature, manage templates, and keep all your important files secure and organized.",
    target: "menu-item-documents",
    icon: FileText,
    image: "https://images.unsplash.com/photo-1568026156976-74df0a97a300?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "reports",
    title: "Analytics & Reports",
    description: "Data-driven decisions. Generate detailed sales reports, analyze competitor data, and track your team's performance metrics.",
    target: "menu-item-reports",
    icon: BarChart3,
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "training",
    title: "Video Training",
    description: "Master the platform. Use our Video Training Generator to create custom onboarding content and tutorials for your team.",
    target: "menu-item-ai-tools",
    icon: Video,
    image: "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "conclusion",
    title: "Ready to Grow?",
    description: "You've seen the highlights. Now it's time to dive in. Don't forget to check the 'AI Tools' section for more in-depth training videos!",
    target: null,
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=800&q=80"
  }
];