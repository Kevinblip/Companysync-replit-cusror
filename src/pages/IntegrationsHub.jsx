import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Facebook, 
  Instagram, 
  Calendar, 
  MapPin, 
  Video,
  CheckCircle,
  AlertCircle,
  Loader2,
  Settings,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

const INTEGRATIONS = [
  {
    id: 'facebook_leads',
    name: 'Facebook Lead Ads',
    icon: Facebook,
    color: 'bg-blue-600',
    description: 'Automatically capture leads from Facebook ads into your CRM',
    category: 'Marketing',
    features: ['Auto-sync leads', 'Real-time notifications', 'Lead scoring']
  },
  {
    id: 'facebook_pages',
    name: 'Facebook Pages',
    icon: Facebook,
    color: 'bg-blue-500',
    description: 'Manage messages and comments from Facebook Pages',
    category: 'Communication',
    features: ['Inbox management', 'Auto-reply', 'Comment sync']
  },
  {
    id: 'instagram_business',
    name: 'Instagram Business',
    icon: Instagram,
    color: 'bg-gradient-to-r from-purple-500 to-pink-500',
    description: 'Connect Instagram DMs and comments to your CRM',
    category: 'Communication',
    features: ['DM inbox', 'Comment management', 'Lead generation']
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    icon: Calendar,
    color: 'bg-blue-600',
    description: 'Two-way sync between CRM and Google Calendar',
    category: 'Productivity',
    features: ['Auto-sync events', 'Team calendars', 'Appointment booking']
  },
  {
    id: 'google_my_business',
    name: 'Google My Business',
    icon: MapPin,
    color: 'bg-green-600',
    description: 'Manage reviews and respond to customers',
    category: 'Reputation',
    features: ['Review monitoring', 'Auto-responses', 'Analytics']
  },
  {
    id: 'tiktok_leads',
    name: 'TikTok Lead Ads',
    icon: Video,
    color: 'bg-black',
    description: 'Capture leads from TikTok advertising campaigns',
    category: 'Marketing',
    features: ['Lead sync', 'Campaign tracking', 'Instant notifications']
  }
];

export default function IntegrationsHub() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list('-created_date'),
    initialData: [],
    enabled: !!user
  });

  React.useEffect(() => {
    if (user && companies.length > 0) {
      setMyCompany(companies.find(c => c.created_by === user.email));
    }
  }, [user, companies]);

  const { data: credentials = [] } = useQuery({
    queryKey: ['integration-credentials', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.IntegrationCredential.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: []
  });

  const disconnectMutation = useMutation({
    mutationFn: (credentialId) => base44.entities.IntegrationCredential.delete(credentialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integration-credentials'] });
      alert('Integration disconnected');
    }
  });

  const getCredentialForIntegration = (integrationId) => {
    return credentials.find(c => c.integration_name === integrationId && c.is_connected);
  };

  const handleConnect = async (integration) => {
    if (integration.id === 'facebook_leads') {
      alert('📋 Setup Instructions:\n\n1. Go to Dashboard → Code → Functions → facebookLeadsWebhook\n2. Copy the webhook URL\n3. Add it to your Facebook Business Manager → Lead Ads → Webhooks\n4. Use verify token: yicn_roofing_leads_2025\n5. Subscribe to "leadgen" events');
    } else if (integration.id === 'google_calendar') {
      try {
        const response = await base44.functions.invoke('connectGoogleCalendar', {});
        if (response.data?.authUrl) {
          window.location.href = response.data.authUrl;
        }
      } catch (error) {
        alert('Failed to initiate Google Calendar connection: ' + error.message);
      }
    } else if (integration.id === 'tiktok_leads') {
      alert('📋 TikTok Setup:\n\n1. Go to Dashboard → Code → Functions → tiktokLeadsWebhook\n2. Copy the webhook URL\n3. Add it in TikTok Ads Manager → Tools → Events → Lead Generation\n4. Your leads will auto-sync to CRM!');
    } else {
      alert(`${integration.name} integration coming soon! We're adding OAuth flow and advanced features.`);
    }
  };

  const handleDisconnect = (credential) => {
    if (window.confirm(`Disconnect ${credential.integration_name}?`)) {
      disconnectMutation.mutate(credential.id);
    }
  };

  const groupedIntegrations = INTEGRATIONS.reduce((acc, integration) => {
    if (!acc[integration.category]) acc[integration.category] = [];
    acc[integration.category].push(integration);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Integrations</h1>
          <p className="text-gray-600 mt-2">Connect your favorite tools and automate your workflow</p>
        </div>

        <Alert className="bg-blue-50 border-blue-200">
          <AlertCircle className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800">
            <strong>💡 Tip:</strong> Connected integrations will automatically sync data and trigger workflows in real-time.
          </AlertDescription>
        </Alert>

        {Object.entries(groupedIntegrations).map(([category, integrations]) => (
          <div key={category}>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">{category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {integrations.map((integration) => {
                const credential = getCredentialForIntegration(integration.id);
                const Icon = integration.icon;
                const isConnected = !!credential;

                return (
                  <Card key={integration.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 ${integration.color} rounded-lg flex items-center justify-center text-white`}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <div>
                            <CardTitle className="text-lg">{integration.name}</CardTitle>
                            {isConnected && (
                              <Badge className="mt-1 bg-green-100 text-green-700">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Connected
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <CardDescription>{integration.description}</CardDescription>
                      
                      <div className="space-y-1">
                        {integration.features.map((feature, idx) => (
                          <div key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                            <CheckCircle className="w-3 h-3 text-green-600" />
                            {feature}
                          </div>
                        ))}
                      </div>

                      {isConnected ? (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => alert('Integration settings coming soon!')}
                          >
                            <Settings className="w-4 h-4 mr-2" />
                            Settings
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDisconnect(credential)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() => handleConnect(integration)}
                          className="w-full bg-blue-600 hover:bg-blue-700"
                        >
                          Connect
                        </Button>
                      )}

                      {isConnected && credential.last_sync_date && (
                        <p className="text-xs text-gray-500">
                          Last synced: {new Date(credential.last_sync_date).toLocaleString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}

        <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">🚀</span>
              Need a Custom Integration?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-700 mb-4">
              We can build custom integrations for your specific tools and workflows. 
              Contact us to discuss your requirements.
            </p>
            <Button variant="outline">Request Integration</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}