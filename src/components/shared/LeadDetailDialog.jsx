import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Edit,
  UserPlus,
  Camera,
  FileText,
  Sparkles,
  CheckCircle2,
  Phone,
  Mail,
  MessageCircle,
  Calendar,
  TrendingUp,
  Flame,
  ThermometerSun,
  Snowflake,
} from "lucide-react";

export default function LeadDetailDialog({
  viewingLead,
  onClose,
  onEdit,
  onConvertToCustomer,
  isConverting,
  onCreateInspection,
  onCreateEstimate,
  onCreateAIEstimate,
  onAddTask,
  onCall,
  onEmail,
  onSMS,
  onScheduleMeeting,
  getLeadScore,
  renderTemperatureBadge,
  getStatusColor,
  getSourceBadge,
  safeFormatDate,
  communications,
  calendarEvents,
  staffProfiles,
  t,
}) {
  if (!viewingLead) return null;

  const leadComms = communications.filter(c =>
    c.contact_name === viewingLead.name ||
    (c.contact_phone && (c.contact_phone === viewingLead.phone || c.contact_phone === viewingLead.phone_2)) ||
    c.contact_email === viewingLead.email
  );

  const leadMeetings = calendarEvents.filter(e =>
    e.related_lead && viewingLead.name && e.related_lead.toLowerCase() === viewingLead.name.toLowerCase()
  );

  return (
    <Dialog open={!!viewingLead} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span>Lead Details - {viewingLead?.name}</span>
              {renderTemperatureBadge(viewingLead.id)}
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onEdit(viewingLead);
                    onClose();
                  }}
                  className="bg-white hover:bg-gray-50"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  {t.leads.editLead}
                </Button>
                <Button
                  size="sm"
                  onClick={() => onConvertToCustomer(viewingLead)}
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={isConverting}
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  {isConverting ? t.common.loading : t.leads.convertToCustomer}
                </Button>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap pt-2 border-t">
              <Button onClick={() => {
                onClose();
                onCreateInspection(viewingLead);
              }} size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-50">
                <Camera className="w-4 h-4 mr-2" />
                Create Inspection
              </Button>
              <Button onClick={() => {
                onClose();
                onCreateEstimate(viewingLead);
              }} size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
                <FileText className="w-4 h-4 mr-2" />
                Manual Estimate
              </Button>
              <Button onClick={() => {
                onClose();
                onCreateAIEstimate(viewingLead);
              }} size="sm" variant="outline" className="border-purple-300 text-purple-700 hover:bg-purple-50">
                <Sparkles className="w-4 h-4 mr-2" />
                AI Estimate
              </Button>
              <Button onClick={() => {
                onAddTask(viewingLead);
              }} size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Add Related Task
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-grow pr-4">
          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="score">
                Score History ({getLeadScore(viewingLead.id)?.score_history?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="communications">
                Communications ({leadComms.length})
              </TabsTrigger>
              <TabsTrigger value="meetings">
                Meetings ({leadMeetings.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-gray-500">{t.leads.name}</Label>
                  <p className="font-semibold">{viewingLead.name}</p>
                </div>
                <div>
                  <Label className="text-gray-500">Company</Label>
                  <p className="font-semibold">{viewingLead.company || '-'}</p>
                </div>
                <div>
                  <Label className="text-gray-500">{t.leads.email}</Label>
                  <p className="font-semibold text-blue-600">{viewingLead.email || '-'}</p>
                </div>
                <div>
                  <Label className="text-gray-500">{t.leads.phone} 1</Label>
                  <p className="font-semibold">{viewingLead.phone || '-'}</p>
                </div>
                <div>
                  <Label className="text-gray-500">{t.leads.phone} 2</Label>
                  <p className="font-semibold">{viewingLead.phone_2 || '-'}</p>
                </div>
                <div>
                  <Label className="text-gray-500">{t.leads.assignedTo}</Label>
                  <p className="font-semibold">
                    {viewingLead.assigned_to_users && viewingLead.assigned_to_users.length > 0 ? (
                        viewingLead.assigned_to_users.map(email => {
                            const staff = staffProfiles.find(s => s.user_email === email);
                            return <span key={email}>{staff?.full_name || email}{viewingLead.assigned_to_users.length > 1 ? ', ' : ''}</span>;
                        })
                    ) : (viewingLead.assigned_to ?
                        (staffProfiles.find(s => s.user_email === viewingLead.assigned_to)?.full_name || viewingLead.assigned_to)
                        : '-')}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">{t.leads.status}</Label>
                  <Badge variant="outline" className={getStatusColor(viewingLead.status)}>
                    {viewingLead.status}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div className="col-span-2">
                  <Label className="text-gray-500">{t.leads.address}</Label>
                  <p className="font-semibold">
                    {viewingLead.street && <span>{viewingLead.street}<br /></span>}
                    {viewingLead.city && <span>{viewingLead.city}, </span>}
                    {viewingLead.state && <span>{viewingLead.state} </span>}
                    {viewingLead.zip && <span>{viewingLead.zip}</span>}
                    {!viewingLead.street && !viewingLead.city && !viewingLead.state && !viewingLead.zip && '-'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <Label className="text-gray-500">{t.leads.source}</Label>
                  <div className="flex items-center gap-2">
                    {getSourceBadge(viewingLead)}
                  </div>
                </div>
                {viewingLead.lead_source && (
                  <div>
                    <Label className="text-gray-500">Source Details</Label>
                    <p className="font-semibold">{viewingLead.lead_source}</p>
                  </div>
                )}
                {viewingLead.referred_by && (
                  <div>
                    <Label className="text-gray-500">Referred By</Label>
                    <p className="font-semibold text-green-700">👥 {viewingLead.referred_by}</p>
                  </div>
                )}
                <div>
                  <Label className="text-gray-500">{t.leads.value}</Label>
                  <p className="font-semibold text-green-600">${(viewingLead.value || 0).toLocaleString()}</p>
                </div>
                <div>
                  <Label className="text-gray-500">Created Date</Label>
                  <p className="font-semibold">{safeFormatDate(viewingLead.created_date, 'MMM d, yyyy')}</p>
                </div>
                <div>
                  <Label className="text-gray-500">Active</Label>
                  <p className="font-semibold">{viewingLead.is_active ? '✅ Yes' : '❌ No'}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <Label className="text-gray-500">Last Contact</Label>
                  <p className="font-semibold">
                    {safeFormatDate(viewingLead.last_contact_date, 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">Next Follow-up</Label>
                  <p className="font-semibold">
                    {safeFormatDate(viewingLead.next_follow_up_date, 'MMM d, yyyy')}
                  </p>
                </div>
                <div>
                  <Label className="text-gray-500">Total Communications</Label>
                  <p className="font-semibold text-blue-600">{viewingLead.communication_count || 0}</p>
                </div>
              </div>

              {viewingLead.notes && (
                <div>
                  <Label className="text-gray-500">{t.leads.notes}</Label>
                  <p className="mt-1 p-3 bg-gray-50 rounded border">{viewingLead.notes}</p>
                </div>
              )}

              <div className="flex gap-2 flex-wrap pt-4 border-t">
               <Button onClick={() => {
                 onClose();
                 onCall(viewingLead);
               }} className="bg-green-600 hover:bg-green-700">
                 <Phone className="w-4 h-4 mr-2" />
                 Call Now
               </Button>
               <Button onClick={() => {
                 onClose();
                 onEmail(viewingLead);
               }} className="bg-blue-600 hover:bg-blue-700">
                 <Mail className="w-4 h-4 mr-2" />
                 Send Email
               </Button>
               <Button onClick={() => {
                 onClose();
                 onSMS(viewingLead);
               }} className="bg-purple-600 hover:bg-purple-700">
                 <MessageCircle className="w-4 h-4 mr-2" />
                 Send SMS
               </Button>
               <Button onClick={() => {
                 onClose();
                 onScheduleMeeting(viewingLead);
               }} variant="outline">
                 📅 Schedule Meeting
               </Button>
               <Button onClick={() => {
                 onAddTask(viewingLead);
                 onClose();
               }} variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50">
                 <CheckCircle2 className="w-4 h-4 mr-2" />
                 Add Related Task
               </Button>
              </div>
            </TabsContent>

            <TabsContent value="score" className="space-y-3 mt-4">
              {(() => {
                const score = getLeadScore(viewingLead.id);
                if (!score || !score.score_history || score.score_history.length === 0) {
                  return (
                    <div className="text-center py-8 text-gray-500">
                      <TrendingUp className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>No scoring history yet</p>
                      <p className="text-sm text-gray-400">Score will update as you interact with this lead</p>
                    </div>
                  );
                }

                return (
                  <>
                    <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-200">
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-gray-600">Current Score</p>
                            <p className="text-4xl font-bold text-gray-900">{score.total_score}</p>
                          </div>
                          <div className="text-right">
                            {score.temperature === 'hot' && <Flame className="w-16 h-16 text-red-500" />}
                            {score.temperature === 'warm' && <ThermometerSun className="w-16 h-16 text-orange-500" />}
                            {score.temperature === 'cold' && <Snowflake className="w-16 h-16 text-blue-500" />}
                            <p className="text-lg font-semibold uppercase">{score.temperature}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    <div className="space-y-2">
                      {[...score.score_history].reverse().map((entry, idx) => (
                        <Card key={idx} className="bg-white">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="font-medium text-sm">{entry.actionDescription || entry.action}</p>
                                <p className="text-xs text-gray-500">
                                  {safeFormatDate(entry.timestamp, 'MMM d, yyyy h:mm a')}
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className={`${entry.points > 0 ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'} font-semibold`}
                              >
                                {entry.points > 0 ? '+' : ''}{entry.points}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                );
              })()}
            </TabsContent>

            <TabsContent value="communications" className="space-y-3 mt-4">
              {leadComms
              .sort((a,b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime())
              .map(comm => (
                <Card key={comm.id} className="bg-gray-50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        comm.communication_type === 'call' ? 'bg-green-100' :
                        comm.communication_type === 'email' ? 'bg-blue-100' :
                        comm.communication_type === 'sms' ? 'bg-purple-100' : 'bg-gray-100'
                      }`}>
                        {comm.communication_type === 'call' && <Phone className="w-5 h-5 text-green-600" />}
                        {comm.communication_type === 'email' && <Mail className="w-5 h-5 text-blue-600" />}
                        {comm.communication_type === 'sms' && <MessageCircle className="w-5 h-5 text-purple-600" />}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="secondary">{comm.communication_type}</Badge>
                          <span className="text-xs text-gray-500">
                            {safeFormatDate(comm.created_date, 'MMM d, yyyy h:mm a')}
                          </span>
                        </div>
                        {comm.subject && (
                          <p className="font-medium text-sm mb-1">{comm.subject}</p>
                        )}
                        <p className="text-sm text-gray-600">{comm.message}</p>
                        {comm.duration_minutes > 0 && (
                          <p className="text-xs text-gray-500 mt-1">Duration: {comm.duration_minutes} min</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {leadComms.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No communications yet</p>
                  <p className="text-sm text-gray-400">Start by calling, texting, or emailing this lead</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="meetings" className="space-y-3 mt-4">
              {leadMeetings
              .sort((a,b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
              .map(event => (
                <Card key={event.id} className="bg-gray-50">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold">{event.title}</h4>
                        <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          <span>📅 {safeFormatDate(event.start_time, 'MMM d, yyyy h:mm a')}</span>
                          {event.location && <span>📍 {event.location}</span>}
                        </div>
                      </div>
                      <Badge>{event.event_type}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {leadMeetings.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No meetings scheduled</p>
                  <Button onClick={() => {
                    onClose();
                    onScheduleMeeting(viewingLead);
                  }} className="mt-3">
                    📅 Schedule Meeting
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
