import React from "react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Briefcase, MessageSquare, Phone, Mail, FileText, ArrowRight } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import useTranslation from "@/hooks/useTranslation";

export default function AIStaff() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [user, setUser] = React.useState(null);
  const [company, setCompany] = React.useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ["companies-ai-staff"],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  React.useEffect(() => {
    if (!user || companies.length === 0) return;
    const owned = companies.find((c) => c.created_by === user.email);
    setCompany(owned || companies[0]);
  }, [user, companies]);

  const { data: sarahSettings } = useQuery({
    queryKey: ["sarah-settings-name", company?.id],
    queryFn: async () => {
      if (!company?.id) return null;
      const rows = await base44.entities.AssistantSettings.filter({ company_id: company.id, assistant_name: { $exists: true } });
      // Find the sales assistant (was "sarah" by default)
      return rows.find(r => r.assistant_name) || null;
    },
    enabled: !!company?.id,
  });

  const salesAssistantName = React.useMemo(() => {
    const name = sarahSettings?.assistant_name || "sarah";
    return name.charAt(0).toUpperCase() + name.slice(1);
  }, [sarahSettings]);

  const aiStaff = [
    {
      name: `${salesAssistantName} - ${t.ai.sarah}`,
      role: "Lead Qualifier & Follow-up",
      icon: Phone,
      status: t.common.active,
      tasks: ["Qualify inbound leads", "Schedule appointments", "Send follow-up emails"],
      color: "from-blue-500 to-blue-600",
      hasPage: true,
      pageUrl: createPageUrl("SarahWorkspace")
    },
    {
      name: `${t.ai.lexi} - Internal Assistant`,
      role: "Internal AI Assistant & Research",
      icon: MessageSquare,
      status: t.common.active,
      tasks: ["Answer team questions", "Research & analysis", "Task automation"],
      color: "from-purple-500 to-purple-600",
      hasPage: true,
      pageUrl: createPageUrl("LexiWorkspace")
    },
    {
      name: `${t.ai.marcus} - Marketing Copywriter`,
      role: "Direct Response & Campaign Creation",
      icon: Mail,
      status: t.common.active,
      tasks: ["Generate marketing copy", "Create campaign templates", "Write persuasive CTAs"],
      color: "from-pink-500 to-red-600",
      hasPage: true,
      pageUrl: createPageUrl("MarcusMarketing")
    }
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Bot className="w-8 h-8 text-purple-600" />
          {t.sidebar.aiTeam}
        </h1>
        <p className="text-gray-500 mt-1">Your AI-powered team members working 24/7</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {aiStaff.map((staff, idx) => {
          const Icon = staff.icon;
          return (
            <Card key={idx} className="bg-white shadow-lg hover:shadow-xl transition-shadow">
              <CardHeader className={`bg-gradient-to-r ${staff.color} text-white`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <CardTitle className="text-white">{staff.name}</CardTitle>
                      <p className="text-sm text-white/80">{staff.role}</p>
                    </div>
                  </div>
                  <Badge className="bg-white/20 text-white border-white/30">
                    {staff.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <h4 className="font-semibold mb-3">Key Responsibilities:</h4>
                <ul className="space-y-2">
                  {staff.tasks.map((task, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-green-600 mt-0.5">✓</span>
                      {task}
                    </li>
                  ))}
                  </ul>

                  {staff.hasPage && (
                  <Button
                    onClick={() => navigate(staff.pageUrl)}
                    className={`w-full mt-4 bg-gradient-to-r ${staff.color} text-white hover:opacity-90`}
                  >
                    Open {staff.name.split(' - ')[0]} Workspace
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  )}
                  </CardContent>
                  </Card>
                  );
                  })}
                  </div>
                  </div>
                  );
                  }