import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Phone,
  Mail,
  MessageSquare,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Filter,
  Search,
  Activity,
  Zap,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  Settings,
  Bell,
  PhoneMissed,
  CalendarCheck,
  Save,
  Loader2
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { format } from "date-fns";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import useCompanyTimezone from "@/components/hooks/useCompanyTimezone";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Dialer from "../components/communication/Dialer";
import EmailDialog from "../components/communication/EmailDialog";
import SMSDialog from "../components/communication/SMSDialog";

export default function CommunicationDashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [intentFilter, setIntentFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [messagingSettings, setMessagingSettings] = useState({
    whatsapp_enabled: false,
    missed_call_followup_enabled: false,
    appointment_reminders_enabled: false,
    missed_call_channel: 'sms',
    missed_call_template: 'Hi! We noticed we missed your call. How can we help you? Reply here or call us back anytime.',
    appointment_reminder_template: 'Reminder: You have an appointment scheduled with us tomorrow. Reply CONFIRM to confirm or RESCHEDULE to change.',
    dedup_window_hours: 24
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const { user, myCompany, isAdmin, hasPermission, effectiveUserEmail, filterCommunications } = useRoleBasedData();
  const { formatTime, formatDate, formatInTz } = useCompanyTimezone(myCompany);

  const { data: rawCommunications = [] } = useQuery({
    queryKey: ['communications', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const comms = await base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 500);
      return Array.isArray(comms) ? comms : [];
    },
    enabled: !!myCompany,
    initialData: [],
    refetchInterval: 10000 // Refresh every 10 seconds
  });

  // 🔐 Filter communications using hook's canonical filter
  const communications = React.useMemo(() => filterCommunications(rawCommunications), [rawCommunications, filterCommunications]);

  const { data: workflowExecutions = [] } = useQuery({
    queryKey: ['workflow-executions', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const executions = await base44.entities.WorkflowExecution.filter({ 
        company_id: myCompany.id,
        status: 'active'
      }, "-created_date", 100);
      return Array.isArray(executions) ? executions : [];
    },
    enabled: !!myCompany,
    initialData: [],
  });

  useEffect(() => {
    if (!myCompany?.id) return;
    fetch(`/api/messaging-settings?companyId=${myCompany.id}`)
      .then(r => r.json())
      .then(data => {
        if (data && !data.error) {
          setMessagingSettings(prev => ({ ...prev, ...data }));
        }
      })
      .catch(() => {});
  }, [myCompany?.id]);

  const saveMessagingSettings = async () => {
    if (!myCompany?.id) return;
    setSavingSettings(true);
    try {
      const resp = await fetch('/api/messaging-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: myCompany.id, ...messagingSettings })
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('Messaging settings saved');
      } else {
        toast.error(data.error || 'Failed to save settings');
      }
    } catch (e) {
      toast.error('Failed to save messaging settings');
    }
    setSavingSettings(false);
  };

  const handleSettingToggle = (key) => {
    setMessagingSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Calculate stats
  const stats = React.useMemo(() => {
    const aiComms = communications.filter(c => c.twilio_sid || c.ai_analyzed);
    
    const sentiments = aiComms.map(c => c.sentiment).filter(Boolean);
    const positiveSentiment = sentiments.filter(s => s === 'positive').length;
    const negativeSentiment = sentiments.filter(s => s === 'negative').length;
    
    const intents = aiComms.map(c => c.intent).filter(Boolean);
    const quoteRequests = intents.filter(i => i === 'get_quote' || i === 'pricing').length;
    const emergencies = intents.filter(i => i === 'emergency' || i === 'urgent').length;
    
    return {
      total: communications.length,
      calls: communications.filter(c => c.communication_type === 'call').length,
      sms: communications.filter(c => c.communication_type === 'sms').length,
      emails: communications.filter(c => c.communication_type === 'email').length,
      aiAnalyzed: aiComms.length,
      avgSentiment: sentiments.length > 0 ? (positiveSentiment / sentiments.length) * 100 : 0,
      hotLeads: quoteRequests,
      emergencies: emergencies,
      activeWorkflows: workflowExecutions.length
    };
  }, [communications, workflowExecutions]);

  // Get unique intents and sentiments for filters
  const uniqueIntents = [...new Set(communications.map(c => c.intent).filter(Boolean))];
  const uniqueSentiments = [...new Set(communications.map(c => c.sentiment).filter(Boolean))];

  // Filter communications
  const filteredComms = React.useMemo(() => {
    return communications.filter(comm => {
      const matchesSearch = 
        (comm.contact_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.message || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.subject || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesType = typeFilter === "all" || comm.communication_type === typeFilter;
      const matchesSentiment = sentimentFilter === "all" || comm.sentiment === sentimentFilter;
      const matchesIntent = intentFilter === "all" || comm.intent === intentFilter;
      
      return matchesSearch && matchesType && matchesSentiment && matchesIntent;
    });
  }, [communications, searchTerm, typeFilter, sentimentFilter, intentFilter]);

  // Get hot leads (positive sentiment + quote intent)
  const hotLeads = React.useMemo(() => {
    return communications.filter(c => 
      (c.sentiment === 'positive' || c.sentiment === 'interested') &&
      (c.intent === 'get_quote' || c.intent === 'pricing')
    ).slice(0, 10);
  }, [communications]);

  // Get emergencies
  const emergencies = React.useMemo(() => {
    return communications.filter(c => 
      c.intent === 'emergency' || c.intent === 'urgent' ||
      c.outcome === 'emergency'
    ).slice(0, 10);
  }, [communications]);

  // Intent distribution
  const intentCounts = React.useMemo(() => {
    const counts = {};
    communications.forEach(c => {
      if (c.intent) {
        counts[c.intent] = (counts[c.intent] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [communications]);

  const handleCallClick = (comm) => {
    setSelectedContact({
      phone: comm.contact_phone,
      name: comm.contact_name
    });
    setShowDialer(true);
  };

  const handleSMSClick = (comm) => {
    setSelectedContact({
      phone: comm.contact_phone,
      name: comm.contact_name
    });
    setShowSMSDialog(true);
  };

  const handleEmailClick = (comm) => {
    setSelectedContact({
      email: comm.contact_email,
      name: comm.contact_name
    });
    setShowEmailDialog(true);
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Communication Dashboard</h1>
          <p className="text-gray-500 mt-1">AI-powered insights from all customer interactions</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Activity className="w-4 h-4" />
            {stats.activeWorkflows} Active Workflows
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card className="bg-white">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-gray-600">Total</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </CardContent>
        </Card>

        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4 text-green-600" />
              <span className="text-sm text-green-600">Calls</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{stats.calls}</div>
          </CardContent>
        </Card>

        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-purple-600" />
              <span className="text-sm text-purple-600">SMS</span>
            </div>
            <div className="text-2xl font-bold text-purple-700">{stats.sms}</div>
          </CardContent>
        </Card>

        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-blue-600">Emails</span>
            </div>
            <div className="text-2xl font-bold text-blue-700">{stats.emails}</div>
          </CardContent>
        </Card>

        <Card className="bg-yellow-50 border-yellow-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-yellow-600" />
              <span className="text-sm text-yellow-600">AI Analyzed</span>
            </div>
            <div className="text-2xl font-bold text-yellow-700">{stats.aiAnalyzed}</div>
          </CardContent>
        </Card>

        <Card className="bg-orange-50 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-orange-600" />
              <span className="text-sm text-orange-600">Hot Leads</span>
            </div>
            <div className="text-2xl font-bold text-orange-700">{stats.hotLeads}</div>
          </CardContent>
        </Card>

        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <span className="text-sm text-red-600">Emergencies</span>
            </div>
            <div className="text-2xl font-bold text-red-700">{stats.emergencies}</div>
          </CardContent>
        </Card>
      </div>

      {/* AI Insights Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Average Sentiment */}
        <Card className="bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              {stats.avgSentiment >= 60 ? (
                <ThumbsUp className="w-4 h-4 text-green-600" />
              ) : (
                <ThumbsDown className="w-4 h-4 text-red-600" />
              )}
              Average Sentiment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold mb-2" style={{
              color: stats.avgSentiment >= 60 ? '#16a34a' : stats.avgSentiment >= 40 ? '#eab308' : '#dc2626'
            }}>
              {stats.avgSentiment.toFixed(0)}%
            </div>
            <p className="text-sm text-gray-500">
              {stats.avgSentiment >= 60 ? 'Customers are happy!' : 'Room for improvement'}
            </p>
            <div className="mt-3 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full"
                style={{ width: `${stats.avgSentiment}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Top Intents */}
        <Card className="bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-purple-600" />
              Top Customer Intents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {intentCounts.length === 0 ? (
                <p className="text-sm text-gray-500">No AI-analyzed conversations yet</p>
              ) : (
                intentCounts.map(([intent, count]) => (
                  <div key={intent} className="flex items-center justify-between">
                    <span className="text-sm capitalize">{intent.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-20 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-500 rounded-full"
                          style={{ width: `${(count / communications.length) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-gray-700 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Active Workflows */}
        <Card className="bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-600" />
              Active Workflows
            </CardTitle>
          </CardHeader>
          <CardContent>
            {workflowExecutions.length === 0 ? (
              <div className="text-center py-4">
                <CheckCircle className="w-12 h-12 mx-auto text-green-500 mb-2" />
                <p className="text-sm text-gray-500">All workflows completed</p>
              </div>
            ) : (
              <div className="space-y-2">
                {workflowExecutions.slice(0, 3).map((execution) => (
                  <div key={execution.id} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium truncate">{execution.workflow_name}</span>
                      <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-300 text-xs">
                        Step {execution.current_step + 1}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 truncate">{execution.entity_name}</p>
                  </div>
                ))}
                {workflowExecutions.length > 3 && (
                  <p className="text-xs text-gray-500 text-center mt-2">
                    +{workflowExecutions.length - 3} more running
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card className="bg-white">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search by name, message, or topic..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="call">Calls</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Emails</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Sentiment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sentiments</SelectItem>
                {uniqueSentiments.map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={intentFilter} onValueChange={setIntentFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Intent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Intents</SelectItem>
                {uniqueIntents.map(i => (
                  <SelectItem key={i} value={i} className="capitalize">
                    {i.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="all" data-testid="tab-all-comms">All ({filteredComms.length})</TabsTrigger>
          <TabsTrigger value="hot" data-testid="tab-hot-leads">Hot Leads ({hotLeads.length})</TabsTrigger>
          <TabsTrigger value="emergency" data-testid="tab-emergencies">Emergencies ({emergencies.length})</TabsTrigger>
          <TabsTrigger value="messaging-settings" data-testid="tab-messaging-settings">
            <Settings className="w-4 h-4 mr-1" />
            Messaging
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4 mt-4">
          {filteredComms.length === 0 ? (
            <Card className="bg-white">
              <CardContent className="p-12 text-center text-gray-500">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No communications found</h3>
                <p>Try adjusting your filters or search term</p>
              </CardContent>
            </Card>
          ) : (
            filteredComms.map((comm) => (
              <Card key={comm.id} className="bg-white hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
                      comm.communication_type === 'call' ? 'bg-green-100' :
                      comm.communication_type === 'sms' ? 'bg-purple-100' :
                      'bg-blue-100'
                    }`}>
                      {comm.communication_type === 'call' ? <Phone className="w-6 h-6 text-green-600" /> :
                       comm.communication_type === 'sms' ? <MessageSquare className="w-6 h-6 text-purple-600" /> :
                       <Mail className="w-6 h-6 text-blue-600" />}
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-lg">{comm.contact_name || 'Unknown'}</h3>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className={
                              comm.communication_type === 'call' ? 'bg-green-100 text-green-700 border-green-200' :
                              comm.communication_type === 'sms' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                              'bg-blue-100 text-blue-700 border-blue-200'
                            }>
                              {comm.communication_type}
                            </Badge>
                            
                            {comm.sentiment && (
                              <Badge variant="outline" className={
                                comm.sentiment === 'positive' ? 'bg-green-100 text-green-700 border-green-200' :
                                comm.sentiment === 'negative' ? 'bg-red-100 text-red-700 border-red-200' :
                                'bg-yellow-100 text-yellow-700 border-yellow-200'
                              }>
                                {comm.sentiment === 'positive' ? '😊' : comm.sentiment === 'negative' ? '😞' : '😐'} {comm.sentiment}
                              </Badge>
                            )}
                            
                            {comm.intent && (
                              <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-200 capitalize">
                                {comm.intent.replace(/_/g, ' ')}
                              </Badge>
                            )}

                            {comm.direction && (
                              <Badge variant="outline">{comm.direction}</Badge>
                            )}
                          </div>
                        </div>
                        
                        {comm.created_date && (
                          <div className="text-right text-sm text-gray-500">
                            {formatDate(comm.created_date)}
                            <br />
                            {formatTime(comm.created_date)}
                          </div>
                        )}
                      </div>
                      
                      {comm.subject && (
                        <p className="text-sm font-medium text-gray-700 mb-2">{comm.subject}</p>
                      )}
                      
                      {comm.message && (
                        <p className="text-gray-600 mb-3">{comm.message}</p>
                      )}

                      {comm.ai_summary && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                          <p className="text-sm text-blue-900">
                            <strong>AI Summary:</strong> {comm.ai_summary}
                          </p>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                        {comm.contact_phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {comm.contact_phone}
                          </span>
                        )}
                        {comm.contact_email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            {comm.contact_email}
                          </span>
                        )}
                        {comm.duration_minutes > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {comm.duration_minutes} min
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        {comm.contact_phone && (
                          <>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleCallClick(comm)}
                              className="gap-1"
                            >
                              <Phone className="w-3 h-3" />
                              Call
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => handleSMSClick(comm)}
                              className="gap-1"
                            >
                              <MessageSquare className="w-3 h-3" />
                              SMS
                            </Button>
                          </>
                        )}
                        {comm.contact_email && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleEmailClick(comm)}
                            className="gap-1"
                          >
                            <Mail className="w-3 h-3" />
                            Email
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="hot" className="space-y-4 mt-4">
          {hotLeads.length === 0 ? (
            <Card className="bg-white">
              <CardContent className="p-12 text-center text-gray-500">
                <TrendingUp className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No hot leads yet</h3>
                <p>AI will detect interested customers requesting quotes</p>
              </CardContent>
            </Card>
          ) : (
            hotLeads.map((comm) => (
              <Card key={comm.id} className="bg-gradient-to-r from-orange-50 to-red-50 border-orange-200">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <TrendingUp className="w-6 h-6 text-orange-600" />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-lg">{comm.contact_name || 'Unknown'}</h3>
                            <Badge className="bg-orange-600 text-white">HOT LEAD</Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-200">
                              {comm.sentiment}
                            </Badge>
                            <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-200">
                              {comm.intent?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                        </div>
                        
                        {comm.created_date && (
                          <div className="text-right text-sm text-gray-600">
                            {formatInTz(comm.created_date, 'MMM d, h:mm a')}
                          </div>
                        )}
                      </div>
                      
                      {comm.message && (
                        <p className="text-gray-700 mb-3">{comm.message}</p>
                      )}

                      {comm.ai_summary && (
                        <div className="bg-white border border-orange-200 rounded-lg p-3 mb-3">
                          <p className="text-sm text-gray-900">
                            <strong>Why it's hot:</strong> {comm.ai_summary}
                          </p>
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <Button 
                          size="sm"
                          onClick={() => handleCallClick(comm)}
                          className="bg-orange-600 hover:bg-orange-700 gap-1"
                        >
                          <Phone className="w-3 h-3" />
                          Call Now
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleSMSClick(comm)}
                          className="gap-1"
                        >
                          <MessageSquare className="w-3 h-3" />
                          SMS
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="emergency" className="space-y-4 mt-4">
          {emergencies.length === 0 ? (
            <Card className="bg-white">
              <CardContent className="p-12 text-center text-gray-500">
                <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-semibold mb-2">No emergencies</h3>
                <p>AI will flag urgent situations automatically</p>
              </CardContent>
            </Card>
          ) : (
            emergencies.map((comm) => (
              <Card key={comm.id} className="bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 animate-pulse">
                      <AlertCircle className="w-6 h-6 text-red-600" />
                    </div>
                    
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-lg">{comm.contact_name || 'Unknown'}</h3>
                            <Badge className="bg-red-600 text-white animate-pulse">EMERGENCY</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-red-100 text-red-700 border-red-200">
                              {comm.intent?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                        </div>
                        
                        {comm.created_date && (
                          <div className="text-right text-sm text-gray-600">
                            {formatInTz(comm.created_date, 'MMM d, h:mm a')}
                          </div>
                        )}
                      </div>
                      
                      {comm.message && (
                        <p className="text-gray-700 mb-3 font-medium">{comm.message}</p>
                      )}

                      {comm.ai_summary && (
                        <div className="bg-white border border-red-200 rounded-lg p-3 mb-3">
                          <p className="text-sm text-red-900">
                            <strong>Situation:</strong> {comm.ai_summary}
                          </p>
                        </div>
                      )}
                      
                      <div className="flex gap-2">
                        <Button 
                          size="sm"
                          onClick={() => handleCallClick(comm)}
                          className="bg-red-600 hover:bg-red-700 gap-1"
                        >
                          <Phone className="w-3 h-3" />
                          Call Immediately
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleSMSClick(comm)}
                          className="gap-1 border-red-300"
                        >
                          <MessageSquare className="w-3 h-3" />
                          SMS Update
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="messaging-settings" className="space-y-6 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Automated Messaging Settings
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Control which automated messages are sent. Each toggle stays active until you turn it off. Messages include 24-hour deduplication to prevent spam.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 p-4 border rounded-md">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                      <SiWhatsapp className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <Label className="text-base font-medium" data-testid="label-whatsapp-toggle">WhatsApp Integration</Label>
                      <p className="text-sm text-muted-foreground">
                        Allow AI to respond to incoming WhatsApp messages and send WhatsApp follow-ups. Per-rep WhatsApp must also be enabled in Staff Management.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={messagingSettings.whatsapp_enabled}
                    onCheckedChange={() => handleSettingToggle('whatsapp_enabled')}
                    data-testid="switch-whatsapp-enabled"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-4 border rounded-md">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center flex-shrink-0">
                      <PhoneMissed className="w-5 h-5 text-orange-600" />
                    </div>
                    <div>
                      <Label className="text-base font-medium" data-testid="label-missed-call-toggle">Missed Call Follow-Up</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically send a text when a call goes unanswered. Stays active 24/7 until turned off. Max 1 message per number per 24 hours.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={messagingSettings.missed_call_followup_enabled}
                    onCheckedChange={() => handleSettingToggle('missed_call_followup_enabled')}
                    data-testid="switch-missed-call-followup"
                  />
                </div>

                {messagingSettings.missed_call_followup_enabled && (
                  <div className="ml-14 space-y-3 p-4 border rounded-md bg-muted/30">
                    <div>
                      <Label className="text-sm">Follow-up Channel</Label>
                      <Select
                        value={messagingSettings.missed_call_channel}
                        onValueChange={(val) => setMessagingSettings(prev => ({ ...prev, missed_call_channel: val }))}
                      >
                        <SelectTrigger className="w-40 mt-1" data-testid="select-missed-call-channel">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sms">SMS</SelectItem>
                          <SelectItem value="whatsapp">WhatsApp</SelectItem>
                          <SelectItem value="both">Both</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm">Message Template</Label>
                      <Textarea
                        value={messagingSettings.missed_call_template}
                        onChange={(e) => setMessagingSettings(prev => ({ ...prev, missed_call_template: e.target.value }))}
                        className="mt-1 text-sm"
                        rows={3}
                        data-testid="textarea-missed-call-template"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 p-4 border rounded-md">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                      <CalendarCheck className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <Label className="text-base font-medium" data-testid="label-appointment-reminders-toggle">Appointment Reminders</Label>
                      <p className="text-sm text-muted-foreground">
                        Send automatic reminders before scheduled appointments. One reminder per appointment, sent the day before.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={messagingSettings.appointment_reminders_enabled}
                    onCheckedChange={() => handleSettingToggle('appointment_reminders_enabled')}
                    data-testid="switch-appointment-reminders"
                  />
                </div>

                {messagingSettings.appointment_reminders_enabled && (
                  <div className="ml-14 space-y-3 p-4 border rounded-md bg-muted/30">
                    <div>
                      <Label className="text-sm">Reminder Template</Label>
                      <Textarea
                        value={messagingSettings.appointment_reminder_template}
                        onChange={(e) => setMessagingSettings(prev => ({ ...prev, appointment_reminder_template: e.target.value }))}
                        className="mt-1 text-sm"
                        rows={3}
                        data-testid="textarea-appointment-reminder-template"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border rounded-md bg-muted/30">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Deduplication Window</Label>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  Prevent the same person from receiving duplicate messages within this time window.
                </p>
                <Select
                  value={String(messagingSettings.dedup_window_hours)}
                  onValueChange={(val) => setMessagingSettings(prev => ({ ...prev, dedup_window_hours: parseInt(val) }))}
                >
                  <SelectTrigger className="w-40" data-testid="select-dedup-window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12 hours</SelectItem>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="48">48 hours</SelectItem>
                    <SelectItem value="72">72 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={saveMessagingSettings}
                disabled={savingSettings}
                className="gap-2"
                data-testid="button-save-messaging-settings"
              >
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Messaging Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
        defaultNumber={selectedContact?.phone}
        defaultName={selectedContact?.name}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        defaultTo={selectedContact?.email}
        defaultName={selectedContact?.name}
        companyId={myCompany?.id}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        defaultTo={selectedContact?.phone}
        defaultName={selectedContact?.name}
      />
    </div>
  );
}