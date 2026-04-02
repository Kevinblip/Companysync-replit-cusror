import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Phone, Mail, MessageSquare, Search, Settings, Bot, CheckCircle2, AlertCircle, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { format } from "date-fns";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import useCompanyTimezone from "@/components/hooks/useCompanyTimezone";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

import Dialer from "@/components/communication/Dialer";
import EmailDialog from "@/components/communication/EmailDialog";
import SMSDialog from "@/components/communication/SMSDialog";
import { useNavigate } from 'react-router-dom';
import useTranslation from "@/hooks/useTranslation";

export default function Communication() {
  const { t } = useTranslation();
  const [user, setUser] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showThoughtlyDialog, setShowThoughtlyDialog] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [thoughtlyAgents, setThoughtlyAgents] = useState([]);

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);
  const { formatDate, formatTime } = useCompanyTimezone(myCompany);

  const { data: rawCommunications = [], refetch: refetchCommunications } = useQuery({
    queryKey: ['communications', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      console.log('🔍 Fetching communications for company:', myCompany.id);
      const comms = await base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date", 500);
      console.log('📊 Found communications:', comms.length);
      return Array.isArray(comms) ? comms : [];
    },
    enabled: !!myCompany,
    initialData: [],
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });

  const { data: twilioConfig } = useQuery({
    queryKey: ['twilio-settings', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return null;
      const settings = await base44.entities.TwilioSettings.filter({ company_id: myCompany.id });
      return settings[0] || null;
    },
    enabled: !!myCompany,
  });

  // Filter out invalid communications with comprehensive checks
  const validCommunications = React.useMemo(() => {
    if (!Array.isArray(rawCommunications)) return [];
    
    return rawCommunications.filter(comm => {
      // Must be an object
      if (!comm || typeof comm !== 'object') return false;
      // Must have communication_type or type
      if (!comm.communication_type && !comm.type) return false;
      // Must have id
      if (!comm.id) return false;
      
      return true;
    });
  }, [rawCommunications]);

  const stats = React.useMemo(() => {
    return {
      total: validCommunications.length,
      calls: validCommunications.filter(c => c && c.communication_type === 'call').length,
      emails: validCommunications.filter(c => c && c.communication_type === 'email').length,
      sms: validCommunications.filter(c => c && (c.communication_type === 'sms' || c.communication_type === 'whatsapp')).length,
    };
  }, [validCommunications]);

  const filteredComms = React.useMemo(() => {
    return validCommunications.filter(comm => {
      const type = comm.communication_type || comm.type;
      const normalizedType = (type === 'whatsapp') ? 'sms' : type;
      const matchesSearch = 
        (comm.contact_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.message || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.subject || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.transcription || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (comm.body || '').toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesType = typeFilter === "all" || normalizedType === typeFilter;
      
      return matchesSearch && matchesType;
    });
  }, [validCommunications, searchTerm, typeFilter]);

  const handleCreateThoughtlyAgent = async () => {
    if (!myCompany?.id) {
      alert('Please complete company setup first');
      return;
    }
    if (!twilioConfig) {
      alert('Twilio settings not found. Please set up Twilio in settings.');
      return;
    }

    setIsCreatingAgent(true);
    try {
      const response = await base44.functions.invoke('createThoughtlyAgent', {
        companyId: myCompany.id,
        twilioSettingsId: twilioConfig.id
      });

      alert('✅ Thoughtly AI agent created successfully! Your AI phone receptionist is ready.');
      setShowThoughtlyDialog(false);
      queryClient.invalidateQueries({ queryKey: ['twilio-settings', myCompany?.id] });
    } catch (error) {
      console.error('Failed to create agent:', error);
      alert(`Failed to create agent: ${error.message}`);
    }
    setIsCreatingAgent(false);
  };

  const handleListThoughtlyAgents = async () => {
    setIsLoadingAgents(true);
    try {
      const response = await base44.functions.invoke('listThoughtlyAgents', {});
      setThoughtlyAgents(response.data.agents || []);
    } catch (error) {
      console.error('Failed to load agents:', error);
      const backendError = error.response?.data?.error || error.message;
      const help = error.response?.data?.help || '';
      alert(`Failed to load agents: ${backendError}. ${help}`);
    }
    setIsLoadingAgents(false);
  };

  useEffect(() => {
    if (showThoughtlyDialog) {
      handleListThoughtlyAgents();
    }
  }, [showThoughtlyDialog]);

  const handleCallClick = (comm) => {
    setSelectedContact({ phone: comm.contact_phone, name: comm.contact_name });
    setShowDialer(true);
  };

  const handleSMSClick = (comm) => {
    setSelectedContact({
      phone: comm.contact_phone,
      name: comm.contact_name,
      from: comm.data?.company_phone || null,
    });
    setShowSMSDialog(true);
  };

  const handleEmailClick = (comm) => {
    setSelectedContact({ email: comm.contact_email, name: comm.contact_name });
    setShowEmailDialog(true);
  };

  const getTypeIcon = (type) => {
    if (!type) return Phone; // Default icon
    const icons = {
      email: Mail,
      call: Phone,
      sms: MessageSquare,
      meeting: Bot, // Changed to Bot for general non-specific types, as per outline context
      note: Bot // Changed to Bot for general non-specific types
    };
    return icons[type] || Bot;
  };

  const getTypeColor = (type) => {
    if (!type) return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };
    const colors = {
      email: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
      call: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
      sms: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
      meeting: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200' },
      note: { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' }
    };
    return colors[type] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };
  };

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.communication.title}</h1>
          <p className="text-gray-500 mt-1">{t.communication.subtitle || "All customer interactions in one place"}</p>
        </div>
        <Button
          onClick={() => refetchCommunications()}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          {t.common.refresh}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Button
          onClick={() => navigate('/settings')}
          variant="outline"
          className="h-24 flex-col gap-2 text-left justify-start items-start hover:border-blue-500 hover:bg-blue-50"
        >
          <Settings className="w-6 h-6 text-gray-600" />
          <span className="font-semibold">{t.sidebar.integrations || "Twilio Setup"}</span>
        </Button>

        <Button
          onClick={() => setShowDialer(true)}
          className="h-24 flex-col gap-2 bg-green-600 hover:bg-green-700 text-white"
        >
          <Phone className="w-6 h-6" />
          <span className="font-semibold">{t.communication.callLog}</span>
        </Button>

        <Button
          onClick={() => setShowSMSDialog(true)}
          className="h-24 flex-col gap-2 bg-purple-600 hover:bg-purple-700 text-white"
        >
          <MessageSquare className="w-6 h-6" />
          <span className="font-semibold">{t.communication.smsHistory}</span>
        </Button>

        <Button
          onClick={() => setShowEmailDialog(true)}
          className="h-24 flex-col gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Mail className="w-6 h-6" />
          <span className="font-semibold">{t.communication.emailThreads}</span>
        </Button>
      </div>

      {/* Sarah AI Assistant Card */}
      <Card className="border-l-4 border-l-blue-500">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-blue-600" />
              <div>
                <h3 className="font-semibold text-lg">{t.ai.sarah} Assistant</h3>
                <p className="text-sm text-gray-500">{t.communication.sarahSubtitle || "Native AI for SMS + Voice calls with full CRM control"}</p>
              </div>
            </div>
            
            <Button 
              onClick={() => navigate('/SarahSettings')}
              variant="outline"
            >
              <Settings className="w-4 h-4 mr-2" />
              {t.common.configure || "Configure"} {t.ai.sarah}
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
              <p className="text-sm font-semibold text-green-900">SMS {t.common.active}</p>
              <p className="text-xs text-green-600">{stats.sms} {t.dashboard.today}</p>
            </div>
            <div className="text-center p-3 bg-orange-50 rounded-lg">
              <AlertCircle className="w-5 h-5 text-orange-600 mx-auto mb-1" />
              <p className="text-sm font-semibold text-orange-900">Voice: {t.common.inactive || "Not Active"}</p>
              <p className="text-xs text-orange-600">{t.communication.setupNeeded || "Setup needed"}</p>
            </div>
            <div className="text-center p-3 bg-blue-50 rounded-lg">
              <Bot className="w-5 h-5 text-blue-600 mx-auto mb-1" />
              <p className="text-sm font-semibold text-blue-900">0 {t.calendar.appointments || "Appointments"}</p>
              <p className="text-xs text-blue-600">{t.common.booked || "Booked"} {t.dashboard.today}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SOFT-HIDDEN: Thoughtly AI Card - disabled platform-wide */}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
            <p className="text-sm text-gray-500">{t.common.total} {t.communication.title}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100">
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-green-700">{stats.calls}</div>
            <p className="text-sm text-green-600">{t.communication.callLog}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100">
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-purple-700">{stats.sms}</div>
            <p className="text-sm text-purple-600">{t.communication.smsHistory}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100">
          <CardContent className="p-6">
            <div className="text-3xl font-bold text-orange-700">0</div>
            <p className="text-sm text-orange-600">{t.communication.emailThreads || "Email Threads"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder={`${t.common.search}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              data-testid="input-search-communications"
            />
          </div>

          <Tabs defaultValue="all" value={typeFilter} onValueChange={setTypeFilter}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">{t.common.all}</TabsTrigger>
              <TabsTrigger value="call">{t.communication.callLog}</TabsTrigger>
              <TabsTrigger value="sms">{t.communication.smsHistory}</TabsTrigger>
              <TabsTrigger value="email">{t.communication.emailThreads}</TabsTrigger>
            </TabsList>

            <TabsContent value={typeFilter} className="space-y-4 mt-4">
              {filteredComms.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <MessageSquare className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-semibold mb-2">{t.communication.noMessages}</h3>
                  <p>{t.communication.noMessagesSubtitle || "Start by making a call, sending an SMS, or emailing a customer"}</p>
                </div>
              ) : (
                filteredComms.map((comm) => {
                  if (!comm || !comm.id || !comm.communication_type) return null;
                  
                  const Icon = getTypeIcon(comm.communication_type);
                  const typeColors = getTypeColor(comm.communication_type);
                  
                  return (
                    <Card key={comm.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${getTypeColor(comm.communication_type || comm.type).bg}`}>
                            {React.createElement(getTypeIcon(comm.communication_type || comm.type), { className: `w-6 h-6 ${getTypeColor(comm.communication_type || comm.type).text}` })}
                          </div>
                          
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <h3 className="font-semibold text-lg">
                                  {comm.contact_name || comm.contact_phone || 'Unknown Contact'}
                                </h3>
                                {comm.contact_name && comm.contact_phone && (
                                  <p className="text-xs text-gray-400 mt-0.5">{comm.contact_phone}</p>
                                )}
                                {comm.direction === 'outbound' && (comm.data?.sent_by || comm.created_by) && (
                                  <p className="text-xs text-blue-600 mt-0.5">
                                    Sent by: {comm.data?.sent_by || comm.created_by}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge variant="outline" className={`${getTypeColor(comm.communication_type || comm.type).bg} ${getTypeColor(comm.communication_type || comm.type).text} ${getTypeColor(comm.communication_type || comm.type).border}`}>
                                    {t.communication[comm.communication_type] || comm.communication_type || comm.type}
                                  </Badge>
                                  {comm.direction && <Badge variant="outline" className="capitalize">{comm.direction === 'inbound' ? t.communication.inbound : comm.direction === 'outbound' ? t.communication.outbound : comm.direction}</Badge>}
                                  {(comm.status || comm.data?.status) && (
                                    <Badge variant="outline" className="capitalize">
                                      {t.common[comm.status] || comm.status || t.common[comm.data?.status] || comm.data?.status}
                                    </Badge>
                                  )}
                                  {comm.duration_minutes && (
                                    <Badge variant="outline" className="bg-blue-50 text-blue-700">
                                      {t.communication.duration}: {Math.floor(comm.duration_minutes)} {t.common.min || "min"}
                                    </Badge>
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
                            
                            {(comm.message || comm.body || comm.ai_reply || comm.message_body) && (
                              <p className="text-gray-600 mb-3">{comm.message || comm.body || comm.ai_reply || comm.message_body}</p>
                            )}

                            {comm.ai_summary && (
                              <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2" data-testid={`text-ai-summary-${comm.id}`}>
                                <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                <p className="text-sm text-amber-900">{comm.ai_summary}</p>
                              </div>
                            )}

                            {comm.recording_url && (
                              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg" data-testid={`audio-recording-${comm.id}`}>
                                <div className="flex items-center gap-2 mb-2">
                                  <Phone className="w-4 h-4 text-blue-600" />
                                  <span className="text-sm font-semibold text-blue-900">{t.communication.callLog} Recording</span>
                                </div>
                                <audio controls className="w-full" preload="metadata" data-testid={`audio-player-${comm.id}`}>
                                  <source src={`/api/twilio/recording-proxy?url=${encodeURIComponent(comm.recording_url)}${comm.company_id ? `&companyId=${encodeURIComponent(comm.company_id)}` : ''}`} type="audio/mpeg" />
                                  {t.communication.audioNotSupported || "Your browser does not support audio playback."}
                                </audio>
                              </div>
                            )}

                            {comm.transcription && (
                              <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <MessageSquare className="w-4 h-4 text-gray-600" />
                                  <span className="text-sm font-semibold text-gray-900">{t.communication.message}</span>
                                </div>
                                <p className="text-sm text-gray-700">{comm.transcription}</p>
                              </div>
                            )}

                            <div className="flex gap-2">
                              {comm.contact_phone && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => handleCallClick(comm)}>
                                    <Phone className="w-3 h-3 mr-1" />
                                    {t.communication.callLog}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={comm.direction === 'inbound' ? 'default' : 'outline'}
                                    className={comm.direction === 'inbound' ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}
                                    onClick={() => handleSMSClick(comm)}
                                  >
                                    <MessageSquare className="w-3 h-3 mr-1" />
                                    {comm.direction === 'inbound' ? 'Reply' : t.communication.smsHistory}
                                  </Button>
                                </>
                              )}
                              {comm.contact_email && (
                                <Button size="sm" variant="outline" onClick={() => handleEmailClick(comm)}>
                                  <Mail className="w-3 h-3 mr-1" />
                                  {t.communication.emailThreads}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

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
        defaultFrom={selectedContact?.from}
        companyId={myCompany?.id}
      />
    </div>
  );
}