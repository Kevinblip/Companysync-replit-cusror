import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Phone,
  PhoneCall,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOff,
  MessageSquare,
  AlertTriangle,
  Clock,
  User,
  MapPin,
  Activity,
  TrendingUp,
  Zap
} from "lucide-react";
import { format } from "date-fns";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import useCompanyTimezone from "@/components/hooks/useCompanyTimezone";

export default function LiveCallDashboard() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);
  const { formatTime, formatInTz } = useCompanyTimezone(myCompany);

  const { data: activeComms = [] } = useQuery({
    queryKey: ['active-communications', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const all = await base44.entities.Communication.filter({
        company_id: myCompany.id
      }, "-created_date", 100);
      
      return all.filter(c => 
        new Date(c.created_date) > new Date(fiveMinutesAgo) &&
        (c.communication_type === 'call' || c.communication_type === 'sms')
      );
    },
    enabled: !!myCompany,
    initialData: [],
    refetchInterval: 3000 // Refresh every 3 seconds
  });

  // Fetch today's stats
  const { data: todayComms = [] } = useQuery({
    queryKey: ['today-communications', myCompany?.id],
    queryFn: async () => {
      if (!myCompany) return [];
      const all = await base44.entities.Communication.filter({
        company_id: myCompany.id
      }, "-created_date", 1000);
      
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      
      return all.filter(c => new Date(c.created_date) >= todayStart);
    },
    enabled: !!myCompany,
    initialData: [],
    refetchInterval: 10000
  });

  const stats = React.useMemo(() => {
    const calls = todayComms.filter(c => c.communication_type === 'call');
    const inboundCalls = calls.filter(c => c.direction === 'inbound');
    const totalCallMinutes = calls.reduce((sum, c) => sum + (c.duration_minutes || 0), 0);
    const emergencyCalls = calls.filter(c => c.outcome === 'emergency' || c.intent === 'emergency');
    
    return {
      totalCalls: calls.length,
      inboundCalls: inboundCalls.length,
      totalSMS: todayComms.filter(c => c.communication_type === 'sms').length,
      avgCallDuration: calls.length > 0 ? totalCallMinutes / calls.length : 0,
      emergencies: emergencyCalls.length,
      aiHandled: calls.filter(c => c.message?.includes('Sarah') || c.ai_analyzed).length
    };
  }, [todayComms]);

  // Group active by phone
  const activeByPhone = React.useMemo(() => {
    const grouped = {};
    activeComms.forEach(comm => {
      const key = comm.contact_phone || comm.contact_email;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(comm);
    });
    return Object.entries(grouped).map(([phone, comms]) => ({
      phone,
      name: comms[0].contact_name || 'Unknown',
      messages: comms.sort((a, b) => new Date(a.created_date) - new Date(b.created_date)),
      isEmergency: comms.some(c => c.outcome === 'emergency' || c.intent === 'emergency'),
      lastActivity: new Date(Math.max(...comms.map(c => new Date(c.created_date))))
    })).sort((a, b) => b.lastActivity - a.lastActivity);
  }, [activeComms]);

  return (
    <div className="p-6 space-y-6 bg-gradient-to-br from-blue-50 to-purple-50 min-h-screen">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Live Call Dashboard</h1>
          <p className="text-gray-500 mt-1">Real-time monitoring of active conversations</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
          <span className="text-sm text-gray-600">Live</span>
        </div>
      </div>

      {/* Today's Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-gray-600">Total Calls</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stats.totalCalls}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <PhoneIncoming className="w-4 h-4 text-green-600" />
              <span className="text-xs text-gray-600">Inbound</span>
            </div>
            <div className="text-2xl font-bold text-green-700">{stats.inboundCalls}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-gray-600">SMS</span>
            </div>
            <div className="text-2xl font-bold text-purple-700">{stats.totalSMS}</div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <span className="text-xs text-gray-600">Avg Duration</span>
            </div>
            <div className="text-2xl font-bold text-indigo-700">
              {stats.avgCallDuration.toFixed(1)}m
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-yellow-600" />
              <span className="text-xs text-gray-600">AI Handled</span>
            </div>
            <div className="text-2xl font-bold text-yellow-700">{stats.aiHandled}</div>
          </CardContent>
        </Card>

        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-xs text-red-600">Emergencies</span>
            </div>
            <div className="text-2xl font-bold text-red-700">{stats.emergencies}</div>
          </CardContent>
        </Card>
      </div>

      {/* Active Conversations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Active Conversations (Last 5 Minutes)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeByPhone.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <PhoneOff className="w-16 h-16 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No active conversations</p>
              <p className="text-sm mt-1">When calls or messages come in, they'll appear here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeByPhone.map((conversation, idx) => (
                <div 
                  key={idx}
                  className={`p-4 rounded-lg border-2 ${
                    conversation.isEmergency 
                      ? 'bg-red-50 border-red-300 animate-pulse' 
                      : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        conversation.isEmergency ? 'bg-red-600' : 'bg-blue-600'
                      }`}>
                        <User className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{conversation.name}</h3>
                        <p className="text-sm text-gray-600">{conversation.phone}</p>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-2">
                      <Badge className={conversation.isEmergency ? 'bg-red-600' : 'bg-blue-600'}>
                        {conversation.isEmergency ? '🚨 EMERGENCY' : '🟢 ACTIVE'}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        Last: {formatInTz(conversation.lastActivity, 'h:mm:ss a')}
                      </span>
                    </div>
                  </div>

                  {/* Conversation Thread */}
                  <ScrollArea className="h-48 bg-gray-50 rounded-lg p-3 mb-3">
                    <div className="space-y-2">
                      {conversation.messages.map((msg, i) => (
                        <div 
                          key={i}
                          className={`flex ${msg.direction === 'inbound' ? 'justify-start' : 'justify-end'}`}
                        >
                          <div className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                            msg.direction === 'inbound'
                              ? 'bg-white border border-gray-200 text-gray-900 shadow-sm'
                              : 'bg-blue-600 text-white shadow-md'
                          }`}>
                            <div className="flex items-center gap-2 mb-1">
                              {msg.communication_type === 'call' ? (
                                <Phone className="w-3 h-3 opacity-70" />
                              ) : (
                                <MessageSquare className="w-3 h-3 opacity-70" />
                              )}
                              <span className="text-[10px] opacity-70 font-medium">
                                {msg.direction === 'inbound' ? 'Customer' : 'Sarah'} • {formatTime(msg.created_date)}
                              </span>
                            </div>
                            <p className="leading-tight font-medium">{msg.message}</p>
                            {msg.intent && (
                              <Badge variant="outline" className="mt-1 text-[10px] bg-white/10 border-white/20">
                                {msg.intent}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  {/* Quick Actions */}
                  <div className="flex gap-2">
                    <Button 
                      size="sm" 
                      className={conversation.isEmergency ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
                    >
                      <PhoneForwarded className="w-4 h-4 mr-1" />
                      Transfer to Staff
                    </Button>
                    <Button size="sm" variant="outline">
                      <MessageSquare className="w-4 h-4 mr-1" />
                      Send SMS
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              AI Performance Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Answer Rate</span>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-green-500"
                      style={{ 
                        width: `${stats.inboundCalls > 0 ? (stats.aiHandled / stats.inboundCalls * 100) : 0}%` 
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold">
                    {stats.inboundCalls > 0 ? ((stats.aiHandled / stats.inboundCalls * 100).toFixed(0)) : 0}%
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Avg Handle Time</span>
                <span className="text-sm font-semibold">{stats.avgCallDuration.toFixed(1)} min</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Total Volume</span>
                <span className="text-sm font-semibold">{stats.totalCalls} calls</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">SMS Responses</span>
                <span className="text-sm font-semibold">{stats.totalSMS}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-600" />
              Quick Stats
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="p-3 bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg">
                <div className="text-sm text-blue-700 font-medium mb-1">AI Automation Rate</div>
                <div className="text-2xl font-bold text-blue-900">
                  {stats.inboundCalls > 0 ? ((stats.aiHandled / stats.inboundCalls * 100).toFixed(0)) : 0}%
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  {stats.aiHandled} of {stats.inboundCalls} calls handled by Sarah AI
                </p>
              </div>

              <div className={`p-3 rounded-lg ${
                stats.emergencies > 0 
                  ? 'bg-gradient-to-r from-red-50 to-red-100' 
                  : 'bg-gradient-to-r from-green-50 to-green-100'
              }`}>
                <div className={`text-sm font-medium mb-1 ${
                  stats.emergencies > 0 ? 'text-red-700' : 'text-green-700'
                }`}>
                  Emergency Calls
                </div>
                <div className={`text-2xl font-bold ${
                  stats.emergencies > 0 ? 'text-red-900' : 'text-green-900'
                }`}>
                  {stats.emergencies}
                </div>
                <p className={`text-xs mt-1 ${
                  stats.emergencies > 0 ? 'text-red-600' : 'text-green-600'
                }`}>
                  {stats.emergencies > 0 ? 'Requires immediate attention' : 'No emergencies today'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}