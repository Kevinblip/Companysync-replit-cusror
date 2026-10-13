import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  MessageSquare,
  Plus,
  Trash2,
  Send,
  Copy,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Link as LinkIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const APP_URL = import.meta.env.VITE_REPLIT_APP_URL || "https://getcompanysync.com";

export default function GoogleChatSettings() {
  const { user, myCompany } = useRoleBasedData();
  const queryClient = useQueryClient();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [testMessage, setTestMessage] = useState("👋 Test message from your CRM!");
  const [isTesting, setIsTesting] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [formData, setFormData] = useState({
    webhook_name: "",
    webhook_url: "",
    is_default: false,
    integration_enabled: true,
    send_conflict_alerts: true,
    send_new_leads: true,
    send_urgent_items: true,
    send_invoice_paid: true,
    send_estimate_accepted: true,
    send_job_status_change: false,
    send_daily_summary: false,
  });

  const { data: webhooks = [] } = useQuery({
    queryKey: ["google-chat-webhooks", myCompany?.id],
    queryFn: () =>
      myCompany
        ? base44.entities.GoogleChatSettings.filter({ company_id: myCompany.id })
        : [],
    enabled: !!myCompany,
  });

  const gcEnabled = myCompany?.settings?.google_chat_enabled === true;
  const inboundToken = myCompany?.settings?.google_chat_inbound_token || null;
  const inboundUrl = myCompany?.id && inboundToken
    ? `${APP_URL}/api/google-chat-webhook?company_id=${myCompany.id}&token=${inboundToken}`
    : null;

  const toggleMasterMutation = useMutation({
    mutationFn: async (enabled) => {
      const currentSettings = myCompany?.settings || {};
      let newToken = currentSettings.google_chat_inbound_token;
      if (enabled && !newToken) {
        newToken = crypto.randomUUID().replace(/-/g, "");
      }
      return base44.entities.Company.update(myCompany.id, {
        settings: {
          ...currentSettings,
          google_chat_enabled: enabled,
          ...(newToken ? { google_chat_inbound_token: newToken } : {}),
        },
      });
    },
    onSuccess: (updatedCompany) => {
      // Immediately patch the cached company so gcEnabled / inboundToken / inboundUrl
      // reflect the new state without waiting for a round-trip refetch.
      queryClient.setQueryData(["my-company", myCompany.id], (old) =>
        Array.isArray(old)
          ? old.map((c) => (c.id === myCompany.id ? { ...c, ...updatedCompany } : c))
          : old
      );
      // Also fire background refetches to stay authoritative.
      queryClient.invalidateQueries({ queryKey: ["my-company", myCompany.id] });
      queryClient.invalidateQueries({ queryKey: ["owned-companies"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["current-company-list"] });
    },
  });

  const createWebhookMutation = useMutation({
    mutationFn: (data) =>
      base44.entities.GoogleChatSettings.create({
        ...data,
        company_id: myCompany?.id,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-chat-webhooks"] });
      setShowAddDialog(false);
      setFormData({
        webhook_name: "",
        webhook_url: "",
        is_default: false,
        integration_enabled: true,
        send_conflict_alerts: true,
        send_new_leads: true,
        send_urgent_items: true,
        send_invoice_paid: true,
        send_estimate_accepted: true,
        send_job_status_change: false,
        send_daily_summary: false,
      });
    },
  });

  const updateWebhookMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GoogleChatSettings.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-chat-webhooks"] });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id) => base44.entities.GoogleChatSettings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["google-chat-webhooks"] });
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.webhook_name.trim() || !formData.webhook_url.trim()) {
      alert("Webhook name and URL are required.");
      return;
    }
    createWebhookMutation.mutate(formData);
  };

  const handleTest = async (webhook) => {
    setIsTesting(true);
    try {
      await base44.functions.invoke("sendGoogleChatMessage", {
        message: testMessage,
        webhookUrl: webhook.webhook_url,
        companyId: myCompany?.id,
        cardTitle: "🧪 Test Message",
        cardSubtitle: `From ${user?.full_name || "CRM"}`,
      });
      alert("✅ Test message sent! Check your Google Chat.");
    } catch (error) {
      alert("❌ Failed to send: " + error.message);
    }
    setIsTesting(false);
    setShowTestDialog(false);
  };

  const handleCopyUrl = () => {
    if (!inboundUrl) return;
    navigator.clipboard.writeText(inboundUrl).then(() => {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const toggle = (key, webhookId, current) => {
    updateWebhookMutation.mutate({ id: webhookId, data: { [key]: !current } });
  };

  if (!myCompany) {
    return (
      <div className="p-3 sm:p-6 text-center text-gray-500">Loading settings…</div>
    );
  }

  return (
    <div className="p-3 sm:p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-blue-600" />
            Google Chat Integration
          </h1>
          <p className="text-gray-500 mt-1">
            Send CRM notifications to your Google Chat spaces
          </p>
        </div>
        <Button
          onClick={() => setShowAddDialog(true)}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={!gcEnabled}
          title={!gcEnabled ? "Enable the integration first" : undefined}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Webhook
        </Button>
      </div>

      {/* Master toggle */}
      <Card className="bg-white shadow-sm">
        <CardContent className="py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900 text-base">
                Google Chat Integration
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                {gcEnabled
                  ? "Active — CRM events are posting to your Chat spaces"
                  : "Disabled — no notifications will be sent to Google Chat"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {gcEnabled && (
                <Badge className="bg-green-100 text-green-700">Enabled</Badge>
              )}
              <Switch
                checked={gcEnabled}
                onCheckedChange={(checked) =>
                  toggleMasterMutation.mutate(checked)
                }
                disabled={toggleMasterMutation.isPending}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inbound webhook URL — only visible when enabled */}
      {gcEnabled && inboundUrl && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-blue-600" />
              Lexi Google Chat App URL
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-gray-600">
              Use this as the HTTP endpoint URL when configuring the Lexi app
              in Google Cloud. Lexi can answer CRM questions and receive files.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={inboundUrl}
                className="font-mono text-xs bg-white"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyUrl}
                className="shrink-0"
              >
                {copiedUrl ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                {copiedUrl ? "Copied!" : "Copy"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Guide */}
      <Card className="bg-white border border-gray-200">
        <button
          type="button"
          className="w-full text-left px-6 py-4 flex items-center justify-between"
          onClick={() => setShowGuide(!showGuide)}
        >
          <span className="font-semibold text-gray-800">
            📖 Setup Guide — How to connect Google Chat
          </span>
          {showGuide ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>
        {showGuide && (
          <CardContent className="space-y-4 text-sm text-gray-700 border-t pt-4">
            <div>
              <p className="font-semibold mb-2">
                Step 1 — Create an outbound webhook in Google Chat
              </p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Open Google Chat and go to your space.</li>
                <li>
                  Click the space name at the top → <strong>Apps & integrations</strong>.
                </li>
                <li>
                  Click <strong>Add webhooks</strong>, give it a name (e.g.
                  "CompanySync"), and copy the URL.
                </li>
                <li>Paste that URL into the "Webhook URL" field below.</li>
              </ol>
            </div>
            <div className="border-t pt-3">
              <p className="font-semibold mb-2">
                Step 2 — Configure event notifications
              </p>
              <p>
                Each webhook has individual toggles for which events it
                receives: New Leads, Invoice/Payment activity, Estimate
                Accepted, Job Status Changes, Calendar Conflicts, and Urgent
                Alerts.
              </p>
            </div>
            <div className="border-t pt-3">
              <p className="font-semibold mb-2">
                Step 3 — Add Lexi as a Google Chat app
              </p>
              <p>
                In Google Cloud, enable the <strong>Google Chat API</strong>,
                open its Configuration page, name the app <strong>Lexi</strong>,
                choose <strong>HTTP endpoint URL</strong>, and paste the
                <strong>Lexi Google Chat App URL</strong> shown above. Enable
                direct messages and spaces, save the configuration, then add
                Lexi from Google Chat&apos;s <strong>Apps &amp; integrations</strong>
                menu. Mention <strong>@Lexi</strong> to ask CRM questions.
              </p>
            </div>
            <div className="border-t pt-3">
              <p className="font-semibold mb-2">
                What file types are supported inbound?
              </p>
              <p className="mb-2">
                <strong>Direct multipart uploads</strong> (when your bot or
                integration sends files as{" "}
                <code>multipart/form-data</code>) are fully supported — the
                binary is stored directly in your CRM file vault and linked to
                matching customers or leads.
              </p>
              <p>
                <strong>Google-hosted attachment references</strong> (attachment
                URIs that Google Chat's bot framework includes in event
                payloads) require a Google service account to download. Add
                your service account key to the environment variable{" "}
                <code>GOOGLE_CHAT_CREDENTIALS</code> (paste the full JSON key
                file contents). The service account must have the{" "}
                <strong>Google Chat API</strong> enabled and the{" "}
                <code>chat.messages.readonly</code> OAuth scope. When the
                credential is present, the server automatically exchanges it
                for a short-lived access token and downloads the binary
                before storing it in your vault. If the credential is absent,
                reference-URI attachments will be skipped (only
                direct multipart uploads will be stored).
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Webhook list */}
      <div className="grid gap-4">
        {webhooks.map((webhook) => (
          <Card
            key={webhook.id}
            className={`${webhook.is_default ? "border-2 border-blue-500" : ""} ${
              !webhook.integration_enabled ? "opacity-60" : ""
            }`}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <MessageSquare className="w-5 h-5 text-blue-600 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">
                        {webhook.webhook_name}
                      </span>
                      {webhook.is_default && (
                        <Badge className="bg-blue-100 text-blue-700">
                          Default
                        </Badge>
                      )}
                      {!webhook.is_active && (
                        <Badge variant="outline" className="text-gray-500">
                          Inactive
                        </Badge>
                      )}
                      {!webhook.integration_enabled && (
                        <Badge variant="outline" className="text-orange-500 border-orange-300">
                          Paused
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 font-mono mt-0.5 max-w-xs truncate">
                      {webhook.webhook_url}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedWebhook(webhook);
                      setShowTestDialog(true);
                    }}
                    disabled={!webhook.webhook_url}
                  >
                    <Send className="w-4 h-4 mr-1" />
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm("Delete this webhook?")) {
                        deleteWebhookMutation.mutate(webhook.id);
                      }
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {/* Per-event toggles */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  { key: "send_new_leads", label: "🎯 New Leads" },
                  { key: "send_invoice_paid", label: "💰 Invoice / Payment" },
                  { key: "send_estimate_accepted", label: "📄 Estimate Accepted" },
                  { key: "send_job_status_change", label: "🏗️ Job Status Change" },
                  { key: "send_conflict_alerts", label: "🔴 Conflict Alerts" },
                  { key: "send_urgent_items", label: "🚨 Urgent Alerts" },
                  { key: "send_daily_summary", label: "📊 Daily Summary" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      checked={!!webhook[key]}
                      onCheckedChange={() =>
                        toggle(key, webhook.id, webhook[key])
                      }
                    />
                    <Label className="cursor-pointer text-gray-700">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>

              {/* Active / Default / Integration Enabled */}
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t text-sm">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={!!webhook.is_active}
                    onCheckedChange={() =>
                      toggle("is_active", webhook.id, webhook.is_active)
                    }
                  />
                  <Label className="cursor-pointer font-medium">Active</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={!!webhook.is_default}
                    onCheckedChange={() =>
                      toggle("is_default", webhook.id, webhook.is_default)
                    }
                  />
                  <Label className="cursor-pointer font-medium">Default</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={!!webhook.integration_enabled}
                    onCheckedChange={() =>
                      toggle(
                        "integration_enabled",
                        webhook.id,
                        webhook.integration_enabled
                      )
                    }
                  />
                  <Label className="cursor-pointer font-medium">
                    Integration Enabled
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {webhooks.length === 0 && (
          <Card className="bg-gray-50">
            <CardContent className="py-12 text-center">
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg mb-2">
                No Google Chat webhooks configured
              </p>
              <p className="text-gray-400 text-sm mb-4">
                {gcEnabled
                  ? "Add your first webhook to start receiving CRM notifications in Google Chat"
                  : "Enable the integration above, then add a webhook"}
              </p>
              {gcEnabled && (
                <Button
                  onClick={() => setShowAddDialog(true)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Webhook
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add Webhook Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Google Chat Webhook</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="webhook_name">Webhook Name *</Label>
              <Input
                id="webhook_name"
                value={formData.webhook_name}
                onChange={(e) =>
                  setFormData({ ...formData, webhook_name: e.target.value })
                }
                placeholder="Main Team, Sales Channel, Support..."
                required
              />
            </div>

            <div>
              <Label htmlFor="webhook_url">Google Chat Webhook URL *</Label>
              <Input
                id="webhook_url"
                value={formData.webhook_url}
                onChange={(e) =>
                  setFormData({ ...formData, webhook_url: e.target.value })
                }
                placeholder="https://chat.googleapis.com/v1/spaces/..."
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Get this from Google Chat → Space → Apps &amp; integrations →
                Add webhooks
              </p>
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label className="font-semibold">Notifications to send</Label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: "send_new_leads", label: "🎯 New Leads" },
                  { key: "send_invoice_paid", label: "💰 Invoice / Payment" },
                  { key: "send_estimate_accepted", label: "📄 Estimate Accepted" },
                  { key: "send_job_status_change", label: "🏗️ Job Status Change" },
                  { key: "send_conflict_alerts", label: "🔴 Calendar Conflicts" },
                  { key: "send_urgent_items", label: "🚨 Urgent Alerts" },
                  { key: "send_daily_summary", label: "📊 Daily Reports" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={key}
                      checked={!!formData[key]}
                      onCheckedChange={(checked) =>
                        setFormData({ ...formData, [key]: checked })
                      }
                    />
                    <Label htmlFor={key} className="cursor-pointer">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="is_default"
                checked={formData.is_default}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_default: checked })
                }
              />
              <Label htmlFor="is_default" className="cursor-pointer font-medium">
                Set as default webhook
              </Label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700"
                disabled={createWebhookMutation.isPending}
              >
                {createWebhookMutation.isPending ? "Adding…" : "Add Webhook"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Test Message Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Google Chat Integration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="testMessage">Test Message</Label>
              <Textarea
                id="testMessage"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                rows={3}
                placeholder="Your test message…"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowTestDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => handleTest(selectedWebhook)}
                disabled={isTesting}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isTesting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Test
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
