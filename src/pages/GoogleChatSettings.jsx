import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Plus,
  Trash2,
  Send,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Settings,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export default function GoogleChatSettings() {
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [testMessage, setTestMessage] = useState("👋 Test message from your CRM!");
  const [isTesting, setIsTesting] = useState(false);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [spaceId, setSpaceId] = useState("");
  
  const [formData, setFormData] = useState({
    webhook_name: "",
    webhook_url: "",
    is_default: false,
    send_conflict_alerts: true,
    send_new_leads: true,
    send_urgent_items: true,
    send_daily_summary: false,
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

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-gchat', user?.email],
    queryFn: () => user ? base44.entities.StaffProfile.filter({ user_email: user.email }) : [],
    enabled: !!user,
    initialData: [],
  });

  useEffect(() => {
    if (user && companies.length > 0) {
      const ownedCompany = companies.find(c => c.created_by === user.email);
      if (ownedCompany) {
        setMyCompany(ownedCompany);
        return;
      }
      
      const staffProfile = staffProfiles[0];
      if (staffProfile?.company_id) {
        setMyCompany(companies.find(c => c.id === staffProfile.company_id));
      }
    }
  }, [user, companies, staffProfiles]);

  const { data: webhooks = [] } = useQuery({
    queryKey: ['google-chat-webhooks', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.GoogleChatSettings.filter({ 
      company_id: myCompany.id 
    }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const createWebhookMutation = useMutation({
    mutationFn: (data) => base44.entities.GoogleChatSettings.create({
      ...data,
      company_id: myCompany?.id
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-chat-webhooks'] });
      setShowAddDialog(false);
      setFormData({
        webhook_name: "",
        webhook_url: "",
        is_default: false,
        send_conflict_alerts: true,
        send_new_leads: true,
        send_urgent_items: true,
        send_daily_summary: false,
      });
      alert('✅ Google Chat webhook added!');
    },
  });

  const updateWebhookMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GoogleChatSettings.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-chat-webhooks'] });
    },
  });

  const deleteWebhookMutation = useMutation({
    mutationFn: (id) => base44.entities.GoogleChatSettings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-chat-webhooks'] });
      alert('✅ Webhook deleted');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createWebhookMutation.mutate({
      ...formData,
      space_id: spaceId
    });
  };

  const handleTest = async (webhook) => {
    setIsTesting(true);
    try {
      if (webhook.webhook_url) {
        // Webhook-based
        await base44.functions.invoke('sendGoogleChatMessage', {
          message: testMessage,
          webhookUrl: webhook.webhook_url,
          companyId: myCompany?.id,
          cardTitle: "🧪 Test Message",
          cardSubtitle: `From ${user?.full_name || 'CRM'}`
        });
      } else if (webhook.space_id) {
        // OAuth-based
        await base44.functions.invoke('sendGoogleChatMessageOAuth', {
          message: testMessage,
          spaceId: webhook.space_id,
          cardTitle: "🧪 Test Message",
          cardSubtitle: `From ${user?.full_name || 'CRM'}`
        });
      }
      alert('✅ Test message sent! Check your Google Chat.');
    } catch (error) {
      alert('❌ Failed to send: ' + error.message);
    }
    setIsTesting(false);
    setShowTestDialog(false);
  };

  const handleConnectGoogle = async () => {
    try {
      const result = await base44.connectors.requestOAuthAuthorization('google', {
        scopes: [
          'https://www.googleapis.com/auth/chat.messages',
          'https://www.googleapis.com/auth/chat.spaces.readonly'
        ]
      });
      if (result.success) {
        setIsGoogleConnected(true);
        alert('✅ Google Chat connected! You can now add spaces.');
      }
    } catch (error) {
      alert('❌ Failed to connect: ' + error.message);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-blue-600" />
            Google Chat Integration
          </h1>
          <p className="text-gray-500 mt-1">Send CRM notifications to your Google Chat spaces</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Webhook
        </Button>
      </div>

      {/* OAuth Connection */}
      {!isGoogleConnected && (
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg mb-1">Connect Google Chat (Recommended)</h3>
                <p className="text-sm text-gray-600">
                  Use OAuth to bypass webhook restrictions and send messages directly via API
                </p>
              </div>
              <Button onClick={handleConnectGoogle} className="bg-blue-600 hover:bg-blue-700">
                <MessageSquare className="w-4 h-4 mr-2" />
                Connect Google
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Instructions */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            How to Set Up Google Chat
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-gray-700">
          <div>
            <p className="font-semibold mb-2">✅ Recommended: OAuth Method (No Webhooks Needed)</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Click "Connect Google" above to authorize</li>
              <li>Copy your Google Chat Space ID from the URL (e.g., <code className="bg-white px-1 rounded">AAQA9W4wPtE</code>)</li>
              <li>Add the Space ID below and start receiving notifications</li>
            </ol>
          </div>
          
          <div className="border-t pt-3">
            <p className="font-semibold mb-2">⚠️ Alternative: Webhook Method (May Be Restricted)</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Open <strong>Google Chat</strong> and go to your space</li>
              <li>Click space name → <strong>Manage webhooks</strong></li>
              <li>Click <strong>+ Add another</strong> and name it</li>
              <li>Copy the webhook URL and paste below</li>
            </ol>
          </div>
        </CardContent>
      </Card>

      {/* Webhook List */}
      <div className="grid gap-4">
        {webhooks.map((webhook) => (
          <Card key={webhook.id} className={webhook.is_default ? 'border-2 border-blue-500' : ''}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-600" />
                    {webhook.webhook_name}
                    {webhook.is_default && (
                      <Badge className="bg-blue-100 text-blue-700">Default</Badge>
                    )}
                    {!webhook.is_active && (
                      <Badge variant="outline" className="text-gray-500">Inactive</Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-gray-500 mt-1 font-mono truncate max-w-md">
                    {webhook.webhook_url}
                  </p>
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
                    <Send className="w-4 h-4 mr-1" />
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm('Delete this webhook?')) {
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
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={webhook.send_conflict_alerts}
                    onCheckedChange={(checked) => 
                      updateWebhookMutation.mutate({ 
                        id: webhook.id, 
                        data: { send_conflict_alerts: checked } 
                      })
                    }
                  />
                  <Label className="cursor-pointer">🔴 Conflict Alerts</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={webhook.send_new_leads}
                    onCheckedChange={(checked) => 
                      updateWebhookMutation.mutate({ 
                        id: webhook.id, 
                        data: { send_new_leads: checked } 
                      })
                    }
                  />
                  <Label className="cursor-pointer">🎯 New Leads</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={webhook.send_urgent_items}
                    onCheckedChange={(checked) => 
                      updateWebhookMutation.mutate({ 
                        id: webhook.id, 
                        data: { send_urgent_items: checked } 
                      })
                    }
                  />
                  <Label className="cursor-pointer">🚨 Urgent Items</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={webhook.send_daily_summary}
                    onCheckedChange={(checked) => 
                      updateWebhookMutation.mutate({ 
                        id: webhook.id, 
                        data: { send_daily_summary: checked } 
                      })
                    }
                  />
                  <Label className="cursor-pointer">📊 Daily Summary</Label>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t">
                <Checkbox
                  checked={webhook.is_active}
                  onCheckedChange={(checked) => 
                    updateWebhookMutation.mutate({ 
                      id: webhook.id, 
                      data: { is_active: checked } 
                    })
                  }
                />
                <Label className="cursor-pointer font-medium">Active</Label>
                
                <span className="text-gray-300">|</span>
                
                <Checkbox
                  checked={webhook.is_default}
                  onCheckedChange={(checked) => 
                    updateWebhookMutation.mutate({ 
                      id: webhook.id, 
                      data: { is_default: checked } 
                    })
                  }
                />
                <Label className="cursor-pointer font-medium">Set as Default</Label>
              </div>
            </CardContent>
          </Card>
        ))}

        {webhooks.length === 0 && (
          <Card className="bg-gray-50">
            <CardContent className="py-12 text-center">
              <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg mb-2">No Google Chat webhooks configured</p>
              <p className="text-gray-400 text-sm mb-4">Add your first webhook to start receiving CRM notifications in Google Chat</p>
              <Button onClick={() => setShowAddDialog(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Webhook
              </Button>
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
                onChange={(e) => setFormData({...formData, webhook_name: e.target.value})}
                placeholder="Main Team, Sales Channel, Support Team..."
                required
              />
            </div>

            <div>
              <Label htmlFor="space_id">Google Chat Space ID (OAuth) *</Label>
              <Input
                id="space_id"
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                placeholder="AAQA9W4wPtE"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Copy from your Chat space URL: https://chat.google.com/room/<strong>SPACE_ID</strong>
              </p>
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label className="font-semibold">Notification Types</Label>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send_conflict_alerts"
                    checked={formData.send_conflict_alerts}
                    onCheckedChange={(checked) => 
                      setFormData({...formData, send_conflict_alerts: checked})
                    }
                  />
                  <Label htmlFor="send_conflict_alerts" className="cursor-pointer">
                    🔴 Calendar Conflicts
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send_new_leads"
                    checked={formData.send_new_leads}
                    onCheckedChange={(checked) => 
                      setFormData({...formData, send_new_leads: checked})
                    }
                  />
                  <Label htmlFor="send_new_leads" className="cursor-pointer">
                    🎯 New Leads
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send_urgent_items"
                    checked={formData.send_urgent_items}
                    onCheckedChange={(checked) => 
                      setFormData({...formData, send_urgent_items: checked})
                    }
                  />
                  <Label htmlFor="send_urgent_items" className="cursor-pointer">
                    🚨 Urgent Notifications
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="send_daily_summary"
                    checked={formData.send_daily_summary}
                    onCheckedChange={(checked) => 
                      setFormData({...formData, send_daily_summary: checked})
                    }
                  />
                  <Label htmlFor="send_daily_summary" className="cursor-pointer">
                    📊 Daily Reports
                  </Label>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="is_default"
                checked={formData.is_default}
                onCheckedChange={(checked) => 
                  setFormData({...formData, is_default: checked})
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
                {createWebhookMutation.isPending ? 'Adding...' : 'Add Webhook'}
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
                placeholder="Your test message..."
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
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    Sending...
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