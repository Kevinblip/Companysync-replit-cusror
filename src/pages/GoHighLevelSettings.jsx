import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Copy } from "lucide-react";
import GoHighLevelSetup from "@/components/settings/GoHighLevelSetup";

export default function GoHighLevelSettings() {
  const [user, setUser] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ["ghl-page-staff", user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const { data: ownedCompanies = [] } = useQuery({
    queryKey: ["ghl-page-owned", user?.email],
    queryFn: () => user ? base44.entities.Company.filter({ created_by: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  const lastUsedId = typeof window !== "undefined" ? localStorage.getItem("last_used_company_id") : null;
  const companyId = lastUsedId
    || staffProfiles[0]?.company_id
    || ownedCompanies[0]?.id
    || null;

  const webhookUrl = `https://${window.location.hostname}/api/functions/ghlWebhook`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">GoHighLevel Integration</h1>
        <p className="text-gray-500 mt-1">
          Two-way CRM sync — auto-import GHL contacts as leads and push new leads to GoHighLevel
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configure GoHighLevel</CardTitle>
          <CardDescription>
            Paste a Private Integration token and Location ID, save, then run a two-way contact/lead sync.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GoHighLevelSetup companyId={companyId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Optional webhook</CardTitle>
          <CardDescription>
            Real-time ContactCreate events can POST here. Scheduled / manual sync does not require this.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-sm text-blue-900">
              In GHL Automation → Workflows, add a Webhook / HTTP Request action (POST) and paste this URL.
              Append <code className="bg-white px-1 rounded">?company_id=YOUR_COMPANY_ID</code> if the location is shared.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-sm" />
            <Button variant="outline" onClick={copyWebhookUrl} className="shrink-0">
              {copied ? <><CheckCircle2 className="w-4 h-4 mr-2" />Copied</> : <><Copy className="w-4 h-4 mr-2" />Copy</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
