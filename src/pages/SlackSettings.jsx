import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { MessageSquare, Plus, Trash2, TestTube, ExternalLink, Check } from "lucide-react";

export default function SlackSettings() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [testMessage, setTestMessage] = useState("🎉 Test message from your CRM!");
  const [isTesting, setIsTesting] = useState(false);

  const [formData, setFormData] = useState({
    webhook_name: "",
    webhook_url: "",
    channel_name: "",
    notification_types: ["all"],
    is_default: false,
    is_active: true
  });

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  useEffect(() => {
    if (user && companies.length > 0) {
      const company = companies.find(c => c.created_by === user.email);
      setMyCompany(company);
    }
  }, [user, companies]);

  const { data: webhooks = [] } = useQuery({
    queryKey: ['slack-webhooks', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.SlackSettings.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createWebhookMutation = useMutation({
    mutationFn: (data) => base44.entities.SlackSettings.create({
      ...data,
      company_id: myCompany?.id
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack-webhooks'] });
      setShowAddDialog(false);
      setFormData({
        webhook_name: "",
        webhook_url: "",
        channel_name: "",
        notification_types: ["all"],
        is_default: false,
        is_active: true
      });
      alert('✅ Slack webhook added successfully!');
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id) => base44.entities.SlackSettings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack-webhooks'] });
      alert('✅ Webhook deleted');
    },
  });

  const handleTest = async (webhook) => {
    setIsTesting(true);
    try {
      await base44.functions.invoke('sendSlackMessage', {
        message: testMessage,
        webhookUrl: webhook.webhook_url,
        companyId: myCompany?.id,
        title: "🧪 Test Message",
        color: "#36a64f"
      });
      alert('✅ Test message sent! Check your Slack channel.');
    } catch (error) {
      alert('❌ Failed to send: ' + error.message);
    }
    setIsTesting(false);
    setShowTestDialog(false);
  };

  const notificationOptions = [
    { value: 'all', label: 'All Notifications' },
    { value: 'lead_created', label: 'New Lead' },
    { value: 'customer_created', label: 'New Customer' },
    { value: 'estimate_created', label: 'Estimate Created' },
    { value: 'estimate_accepted', label: 'Estimate Accepted' },
    { value: 'invoice_created', label: 'Invoice Created' },
    { value: 'invoice_paid', label: 'Invoice Paid' },
    { value: 'payment_received', label: 'Payment Received' },
    { value: 'task_assigned', label: 'Task Assigned' },
  ];

  const toggleNotificationType = (type) => {
    if (type === 'all') {
      setFormData({...formData, notification_types: ['all']});
    } else {
      const currentTypes = formData.notification_types.filter(t => t !== 'all');
      const hasType = currentTypes.includes(type);
      setFormData({
        ...formData,
        notification_types: hasType 
          ? currentTypes.filter(t => t !== type)
          : [...currentTypes, type]
      });
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-purple-600" />
            Slack Integration
          </h1>
          <p className="text-gray-600 mt-1">Send CRM notifications to your Slack channels</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Slack Webhook
        </Button>
      </div>

      {/* Setup Instructions */}
      <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Check className="w-5 h-5 text-purple-600" />
            Quick Setup (5 minutes)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-700">
          <ol className="list-decimal list-inside space-y-2">
            <li>Go to your Slack workspace</li>
            <li>Click your workspace name → <strong>Settings & administration</strong> → <strong>Manage apps</strong></li>
            <li>Search for <strong>"Incoming Webhooks"</strong> and add it</li>
            <li>Choose a channel (or create #crm-alerts)</li>
            <li>Copy the webhook URL and paste below</li>
          </ol>
          <a 
            href="https://slack.com/apps/A0F7XDUAZ-incoming-webhooks" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-purple-600 hover:underline flex items-center gap-1 font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Open Slack App Directory
          </a>
        </CardContent>
      </Card>

      {/* Webhooks List */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Your Slack Webhooks</h2>
        {webhooks.length === 0 ? (
          <Card className="bg-gray-50">
            <CardContent className="py-12 text-center text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No webhooks configured yet</p>
              <p className="text-sm mt-1">Add your first webhook to start receiving notifications</p>
            </CardContent>
          </Card>
        ) : (
          webhooks.map((webhook) => (
            <Card key={webhook.id} className="hover:shadow-md transition-shadow">
              <CardContent className="py-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-lg">{webhook.webhook_name}</h3>
                      {webhook.is_default && (
                        <Badge className="bg-purple-100 text-purple-700">Default</Badge>
                      )}
                      {!webhook.is_active && (
                        <Badge variant="outline" className="text-gray-500">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-1">
                      <strong>Channel:</strong> {webhook.channel_name || 'Not specified'}
                    </p>
                    <p className="text-xs text-gray-500 font-mono bg-gray-50 p-2 rounded">
                      {webhook.webhook_url.substring(0, 50)}...
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {webhook.notification_types?.includes('all') ? (
                        <Badge variant="outline" className="text-xs">All Notifications</Badge>
                      ) : (
                        webhook.notification_types?.map(type => (
                          <Badge key={type} variant="outline" className="text-xs">
                            {notificationOptions.find(o => o.value === type)?.label || type}
                          </Badge>
                        ))
                      )}
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
                    >
                      <TestTube className="w-4 h-4 mr-1" />
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => {
                        if (confirm(`Delete webhook "${webhook.webhook_name}"?`)) {
                          deleteWebhookMutation.mutate(webhook.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add Webhook Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Slack Webhook</DialogTitle>
            <DialogDescription>
              Configure a new Slack webhook for CRM notifications
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            createWebhookMutation.mutate(formData);
          }} className="space-y-4">
            <div>
              <Label htmlFor="webhook_name">Webhook Name *</Label>
              <Input
                id="webhook_name"
                value={formData.webhook_name}
                onChange={(e) => setFormData({...formData, webhook_name: e.target.value})}
                placeholder="Sales Alerts"
                required
              />
            </div>

            <div>
              <Label htmlFor="webhook_url">Webhook URL *</Label>
              <Input
                id="webhook_url"
                value={formData.webhook_url}
                onChange={(e) => setFormData({...formData, webhook_url: e.target.value})}
                placeholder="https://hooks.slack.com/services/..."
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Get this from Slack → Apps → Incoming Webhooks
              </p>
            </div>

            <div>
              <Label htmlFor="channel_name">Channel Name (Optional)</Label>
              <Input
                id="channel_name"
                value={formData.channel_name}
                onChange={(e) => setFormData({...formData, channel_name: e.target.value})}
                placeholder="#crm-alerts"
              />
            </div>

            <div>
              <Label className="mb-2 block">Notification Types</Label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded p-3">
                {notificationOptions.map(option => (
                  <div key={option.value} className="flex items-center gap-2">
                    <Checkbox
                      id={option.value}
                      checked={formData.notification_types.includes(option.value)}
                      onCheckedChange={() => toggleNotificationType(option.value)}
                    />
                    <Label htmlFor={option.value} className="text-sm cursor-pointer">
                      {option.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="is_default"
                checked={formData.is_default}
                onCheckedChange={(checked) => setFormData({...formData, is_default: checked})}
              />
              <Label htmlFor="is_default" className="cursor-pointer">
                Set as default webhook for all notifications
              </Label>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createWebhookMutation.isPending} className="bg-purple-600 hover:bg-purple-700">
                {createWebhookMutation.isPending ? 'Adding...' : 'Add Webhook'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Slack Webhook</DialogTitle>
            <DialogDescription>
              Send a test message to {selectedWebhook?.channel_name || 'your Slack channel'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="test_message">Test Message</Label>
              <Input
                id="test_message"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder="Enter test message"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowTestDialog(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => handleTest(selectedWebhook)}
                disabled={isTesting}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {isTesting ? 'Sending...' : 'Send Test'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}