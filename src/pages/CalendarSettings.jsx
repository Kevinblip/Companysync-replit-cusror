
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import useCurrentCompany from "@/components/hooks/useCurrentCompany";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Users,
  Calendar,
  AlertCircle,
  Mail,
  Phone,
  Copy,
  ExternalLink
} from "lucide-react";

export default function CalendarSettings() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [syncing, setSyncing] = useState({});
  const [bulkSyncing, setBulkSyncing] = useState(false);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { company: myCompany } = useCurrentCompany(user);

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['all-staff-profiles'],
    queryFn: () => base44.entities.StaffProfile.list(),
    initialData: [],
  });

  const { data: calendarEvents = [] } = useQuery({
    queryKey: ['calendar-events-all', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.CalendarEvent.filter({ company_id: myCompany.id }, "-start_time", 1000) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const connectedUsers = allUsers.filter(u => u.google_calendar_connected === true);
  const notConnectedUsers = allUsers.filter(u => u.google_calendar_connected !== true);

  const getStaffName = (email) => {
    const staff = staffProfiles.find(s => s.user_email === email);
    return staff?.full_name || email;
  };

  const getEventsCount = (userEmail) => {
    return calendarEvents.filter(e => e.assigned_to === userEmail).length;
  };

  const handleBulkSync = async () => {
    setBulkSyncing(true);
    
    try {
      const result = await base44.functions.invoke('bulkSyncAllCalendars', {});
      
      queryClient.invalidateQueries({ queryKey: ['calendar-events-all'] });
      queryClient.invalidateQueries({ queryKey: ['all-users'] });

      const data = result.data;
      
      let message = `✅ Bulk sync completed!\n\n`;
      message += `${data.success} users synced successfully\n`;
      message += `${data.failed} users failed\n\n`;
      
      if (data.details) {
        message += 'Details:\n';
        data.details.forEach(detail => {
          if (detail.status === 'success') {
            message += `✅ ${getStaffName(detail.email)}: ${detail.toGoogle?.created || 0} created, ${detail.toGoogle?.updated || 0} updated\n`;
          } else {
            message += `❌ ${getStaffName(detail.email)}: ${detail.error}\n`;
          }
        });
      }
      
      alert(message);
    } catch (error) {
      alert(`❌ Bulk sync failed: ${error.message}`);
    }
    
    setBulkSyncing(false);
  };

  const handleIndividualSync = async (userEmail) => {
    setSyncing(prev => ({ ...prev, [userEmail]: true }));
    
    try {
      const result = await base44.functions.invoke('syncUserGoogleCalendar', {
        targetUserEmail: userEmail
      });
      
      queryClient.invalidateQueries({ queryKey: ['calendar-events-all'] });
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      
      const data = result.data;
      
      let message = `✅ Synced ${getStaffName(userEmail)}'s calendar!\n\n`;
      message += `📥 From Google: ${data.fromGoogle?.created || 0} created, ${data.fromGoogle?.updated || 0} updated\n`;
      message += `📤 To Google: ${data.toGoogle?.created || 0} created, ${data.toGoogle?.updated || 0} updated\n`;
      message += `\nTotal: ${data.total || 0} changes`;
      
      alert(message);
    } catch (error) {
      alert(`❌ Failed to sync: ${error.message}`);
    }
    
    setSyncing(prev => ({ ...prev, [userEmail]: false }));
  };

  const sendConnectionInstructions = async (userEmail) => {
    try {
      const staffName = getStaffName(userEmail);
      const calendarPageUrl = `${window.location.origin}/calendar`;
      
      await base44.integrations.Core.SendEmail({
        from_name: "Calendar Team",
        to: userEmail,
        subject: "Connect Your Google Calendar to CRM",
        body: `Hi ${staffName},

Please connect your personal Google Calendar to the CRM so your assigned appointments and events sync automatically.

Steps:
1. Go to: ${calendarPageUrl}
2. Click "Connect Google Calendar" at the top
3. Sign in with your Google account
4. Allow calendar permissions

Once connected, all CRM events assigned to you will automatically sync to your Google Calendar.

Questions? Reply to this email.

Thanks!`
      });
      
      alert(`✅ Connection instructions sent to ${staffName} (${userEmail})`);
    } catch (error) {
      alert(`❌ Failed to send email: ${error.message}`);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Calendar Settings</h1>
          <p className="text-gray-500 mt-1">Manage Google Calendar connections for your team</p>
        </div>
        
        {connectedUsers.length > 0 && (
          <Button
            onClick={handleBulkSync}
            disabled={bulkSyncing}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {bulkSyncing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Syncing All...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Sync All ({connectedUsers.length})
              </>
            )}
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Staff</p>
                <p className="text-2xl font-bold">{allUsers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Connected</p>
                <p className="text-2xl font-bold text-green-600">{connectedUsers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <XCircle className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Not Connected</p>
                <p className="text-2xl font-bold text-orange-600">{notConnectedUsers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Connected Users */}
      {connectedUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Connected Staff ({connectedUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {connectedUsers.map((user) => {
                const eventsCount = getEventsCount(user.email);
                const lastSync = user.last_google_sync 
                  ? new Date(user.last_google_sync).toLocaleString() 
                  : 'Never';
                
                return (
                  <div key={user.id} className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{getStaffName(user.email)}</p>
                        <Badge className="bg-green-600 text-white">Connected</Badge>
                      </div>
                      <p className="text-sm text-gray-600">{user.email}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {eventsCount} events assigned
                        </span>
                        <span>Last sync: {lastSync}</span>
                      </div>
                    </div>
                    <Button
                      onClick={() => handleIndividualSync(user.email)}
                      disabled={syncing[user.email]}
                      size="sm"
                      variant="outline"
                      className="border-green-600 text-green-700 hover:bg-green-100"
                    >
                      {syncing[user.email] ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                          Syncing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-1" />
                          Sync Now
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Not Connected Users */}
      {notConnectedUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              Not Connected ({notConnectedUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Alert className="mb-4 bg-orange-50 border-orange-200">
              <AlertDescription className="text-orange-800">
                <strong>📧 How to get staff connected:</strong>
                <ol className="list-decimal list-inside mt-2 space-y-1 text-sm">
                  <li>Send them connection instructions (click "Send Instructions" button)</li>
                  <li>They go to Calendar page and click "Connect Google Calendar"</li>
                  <li>They sign in with their Google account</li>
                  <li>Events assigned to them will auto-sync</li>
                </ol>
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              {notConnectedUsers.map((user) => {
                const eventsCount = getEventsCount(user.email);
                
                return (
                  <div key={user.id} className="flex items-center justify-between p-4 bg-orange-50 border border-orange-200 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-gray-900">{getStaffName(user.email)}</p>
                        <Badge className="bg-orange-600 text-white">Not Connected</Badge>
                      </div>
                      <p className="text-sm text-gray-600 flex items-center gap-2">
                        <Mail className="w-3 h-3" />
                        {user.email}
                      </p>
                      {eventsCount > 0 && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-orange-700">
                          <AlertCircle className="w-3 h-3" />
                          {eventsCount} events assigned (not syncing to their calendar)
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={() => sendConnectionInstructions(user.email)}
                      size="sm"
                      variant="outline"
                      className="border-orange-600 text-orange-700 hover:bg-orange-100"
                    >
                      <Mail className="w-4 h-4 mr-1" />
                      Send Instructions
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions Card */}
      <Card>
        <CardHeader>
          <CardTitle>📘 How Calendar Sync Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">For Sales Reps & Staff:</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
              <li>Each staff member must connect their <strong>own</strong> Google Calendar (individually)</li>
              <li>Go to Calendar page → Click "Connect Google Calendar"</li>
              <li>Sign in with their Google account and grant permissions</li>
              <li>Events <strong>assigned to them</strong> will automatically sync to their calendar</li>
              <li>Syncs every 3 minutes automatically</li>
            </ol>
          </div>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-900">
              <strong>💡 Important:</strong> Calendar sync is <strong>per-person</strong>. Each rep sees events assigned to them in their own Google Calendar. This is the standard way CRM calendars work!
            </AlertDescription>
          </Alert>

          <div>
            <h4 className="font-semibold mb-2">Connection URL to Share:</h4>
            <div className="flex items-center gap-2">
              <Input
                value={`${window.location.origin}/calendar`}
                readOnly
                className="font-mono text-sm bg-gray-50"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/calendar`);
                  alert('✅ URL copied to clipboard!');
                }}
              >
                <Copy className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(`${window.location.origin}/calendar`, '_blank')}
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
