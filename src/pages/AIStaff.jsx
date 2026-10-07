import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, MessageSquare, Phone, Mail, ArrowRight } from "lucide-react";
import useTranslation from "@/hooks/useTranslation";

export default function AIStaff() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const aiStaff = [
    {
      name: "Alex",
      role: "Receptionist",
      icon: Phone,
      status: t.common.active,
      tasks: ["Answer calls and texts", "Qualify inbound leads", "Schedule appointments"],
      color: "from-blue-500 to-blue-600",
      hasPage: true,
      pageUrl: createPageUrl("SarahWorkspace")
    },
    {
      name: "Lexi",
      role: "Office Assistant",
      icon: MessageSquare,
      status: t.common.active,
      tasks: ["Answer team questions", "Research & analysis", "Task automation"],
      color: "from-purple-500 to-purple-600",
      hasPage: true,
      pageUrl: createPageUrl("LexiWorkspace")
    },
    {
      name: "Marcus",
      role: "Marketing",
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