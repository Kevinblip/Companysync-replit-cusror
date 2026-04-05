import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Camera, Users, FileText, Settings, Video, Loader2, Eye, Send, Trash2, MoreVertical, UserPlus, CalendarDays, Search, X, Download, Upload } from 'lucide-react';
import { Input } from '@/components/ui/input';
import AssignmentDialog from '../components/inspections/AssignmentDialog';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import useTranslation from "@/hooks/useTranslation";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";

const StatCard = ({ title, value, icon: Icon, linkTo, linkText }) => (
  <Card className="hover:shadow-lg transition-shadow">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">{title}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent>
      {linkTo ? (
        <Button asChild variant="link" className="p-0 h-auto text-2xl font-bold">
            <Link to={linkTo}>{value}</Link>
        </Button>
      ) : (
        <div className="text-2xl font-bold">{value}</div>
      )}
      {linkText && <p className="text-xs text-muted-foreground">{linkText}</p>}
    </CardContent>
  </Card>
);

const ActionCard = ({ title, description, icon: Icon, linkTo }) => {
    const navigate = useNavigate();
    return (
        <Card onClick={() => navigate(linkTo)} className="cursor-pointer hover:bg-gray-50 transition-colors flex flex-col items-center justify-center text-center p-6">
            <Icon className="w-8 h-8 text-blue-600 mb-2" />
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-gray-500">{description}</p>
        </Card>
    );
};

export default function InspectionsDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const { user, myCompany, isAdmin, hasPermission, effectiveUserEmail, filterJobs } = useRoleBasedData();

  const { data: allJobs = [], isLoading: isLoadingJobs } = useQuery({
    queryKey: ['inspectionJobs', myCompany?.id, isAdmin],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.InspectionJob.filter({ company_id: myCompany.id }, '-created_date', 200);
      // Admins: if company_id filter returns nothing (jobs may lack company_id), fetch all
      if (isAdmin && byCompany.length === 0) {
        return await base44.entities.InspectionJob.filter({}, '-created_date', 200);
      }
      return byCompany;
    },
    initialData: [],
    enabled: !!myCompany?.id
  });

  // 🔐 Filter jobs using hook's canonical filter
  const jobs = React.useMemo(() => filterJobs(allJobs), [allJobs, filterJobs]);

  const { data: media = [], isLoading: isLoadingMedia } = useQuery({
    queryKey: ['inspectionMedia', myCompany?.id, isAdmin],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.JobMedia.filter({ related_entity_type: 'InspectionJob', company_id: myCompany.id }, '-created_date', 5000);
      // Admins: if company_id filter returns nothing (media may lack company_id), fetch all
      if (isAdmin && byCompany.length === 0) {
        return await base44.entities.JobMedia.filter({ related_entity_type: 'InspectionJob' }, '-created_date', 5000);
      }
      return byCompany;
    },
    initialData: [],
    enabled: !!myCompany?.id
  });

  const { data: users = [] } = useQuery({ // Added for assignee info
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-inspections', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    initialData: [],
    enabled: !!myCompany?.id
  });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId) => {
      // Delete associated media first
      const jobMedia = await base44.entities.JobMedia.filter({ 
        related_entity_id: jobId, 
        related_entity_type: 'InspectionJob' 
      });
      
      for (const media of jobMedia) {
        await base44.entities.JobMedia.delete(media.id);
      }
      
      // Then delete the job
      await base44.entities.InspectionJob.delete(jobId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
    },
  });

  const deleteAllJobsMutation = useMutation({
    mutationFn: async () => {
      const result = await base44.functions.invoke('deleteAllInspectionJobs', { company_id: myCompany.id });
      if (!result.success) throw new Error(result.error || 'Delete failed');
      return result;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
      alert(`Deleted ${data.deleted} inspection jobs.`);
    },
    onError: (err) => alert('Delete failed: ' + err.message),
  });

  const handleDeleteAllJobs = () => {
    if (window.confirm(`⚠️ This will permanently delete ALL ${allJobs.length} inspection jobs. This cannot be undone. Continue?`)) {
      deleteAllJobsMutation.mutate();
    }
  };

  const addToCalendarMutation = useMutation({
    mutationFn: async (job) => {
      const dateStr = job.inspection_date || job.scheduled_date || (job.created_date ? job.created_date.slice(0, 10) : null);
      if (!dateStr) throw new Error('No date available for this job');

      const startDate = new Date(dateStr + 'T12:00:00');
      if (job.inspection_time) {
        const [h, m] = job.inspection_time.split(':');
        startDate.setHours(parseInt(h), parseInt(m), 0, 0);
      }
      const endDate = new Date(startDate);
      endDate.setHours(startDate.getHours() + 2);

      const attendees = [job.assigned_to_email, user?.email].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

      const calendarEvent = await base44.entities.CalendarEvent.create({
        company_id: myCompany.id,
        title: `Inspection: ${job.client_name || job.customer_name || job.property_address}`,
        description: `📍 ${job.property_address}\n\n👤 Client: ${job.client_name || job.customer_name || ''}\n📞 ${job.client_phone || ''}\n\n🔍 Damage: ${job.damage_type || 'Assessment'}\n⚡ Priority: ${job.priority || 'Normal'}`,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        event_type: 'inspection',
        assigned_to: job.assigned_to_email || user?.email,
        attendees,
        related_customer: job.client_name || job.customer_name,
        status: 'scheduled',
        color: '#10b981',
        send_email_notification: true,
        email_reminder_minutes: [1440, 360, 60],
        send_browser_notification: true,
        browser_reminder_minutes: [1440, 360, 60],
      });

      await base44.entities.InspectionJob.update(job.id, { calendar_event_id: calendarEvent.id });
      return calendarEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspection-jobs-dashboard'] });
    },
    onError: (err) => {
      alert('Failed to add to calendar: ' + (err.message || 'Unknown error'));
    },
  });

  const myJobs = React.useMemo(() => {
    if (!jobs.length || !user) return jobs;
    if (isAdmin) return jobs;
    return jobs.filter(j => j.assigned_to_email === user.email);
  }, [jobs, user, isAdmin]);

  const completedJobs = myJobs.filter(j => j.status === 'completed').length;
  const totalPhotos = media.filter(m => m.file_type === 'photo').length;
  const totalVideos = media.filter(m => m.file_type === 'video').length;

  const filteredJobs = React.useMemo(() => {
    if (!searchTerm.trim()) return myJobs;
    const q = searchTerm.toLowerCase();
    return myJobs.filter(j =>
      (j.client_name || '').toLowerCase().includes(q) ||
      (j.customer_name || '').toLowerCase().includes(q) ||
      (j.property_address || '').toLowerCase().includes(q) ||
      (j.assigned_to_email || '').toLowerCase().includes(q)
    );
  }, [myJobs, searchTerm]);

  const getAssigneeInfo = (job) => {
    if (!job.assigned_to_email) return null;
    const staff = staffProfiles.find(s => s.user_email === job.assigned_to_email);
    const user = users.find(u => u.email === job.assigned_to_email);
    return {
        email: job.assigned_to_email,
        name: staff?.full_name || user?.full_name || job.assigned_to_email,
        avatar: staff?.avatar_url || user?.avatar_url
    };
  };

  const getJobPhotoCount = (jobId) => {
    return media.filter(m => m.related_entity_id === jobId && m.file_type === 'photo').length;
  };

  const getImportedPhotoUrls = (job) => {
    if (!job.photo_urls) return [];
    return String(job.photo_urls).split(/[\n,|]+/).map(u => u.trim()).filter(Boolean);
  };

  const handleDeleteJob = (jobId) => {
    if (window.confirm(t.inspections.deleteConfirm || 'Are you sure you want to delete this inspection job?')) {
      deleteJobMutation.mutate(jobId);
    }
  };

  const handleExportCSV = () => {
    const cols = ['client_name', 'property_address', 'client_phone', 'client_email', 'inspection_type', 'damage_type', 'priority', 'status', 'assigned_to_email', 'inspection_date', 'inspection_time', 'notes'];
    const header = cols.join(',');
    const rows = allJobs.map(j => cols.map(c => {
      const v = j[c] ?? '';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `crewcam-jobs-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-2 md:p-6 bg-gradient-to-br from-blue-50 to-indigo-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-2">
            <h1 className="text-3xl font-bold text-gray-800">{t.sidebar.crewcamDashboard}</h1>
            <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={handleExportCSV} data-testid="button-export-crewcam">
                    <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
                <Button variant="outline" size="sm" asChild data-testid="button-import-crewcam">
                    <Link to={createPageUrl('DataImport')}>
                        <Upload className="mr-2 h-4 w-4" /> Import CSV
                    </Link>
                </Button>
                {allJobs.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteAllJobs}
                    disabled={deleteAllJobsMutation.isPending}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    data-testid="button-delete-all-jobs"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {deleteAllJobsMutation.isPending ? 'Deleting...' : `Delete All (${allJobs.length})`}
                  </Button>
                )}
                <Button asChild>
                    <Link to={createPageUrl('InspectionCapture')}>
                        <Plus className="mr-2 h-4 w-4" /> {t.inspections.startNewJob || 'Start New Job'}
                    </Link>
                </Button>
            </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <ActionCard title={t.sidebar.newCrewcamJob} description={t.inspections.createAndAssign || "Create and assign a new job"} icon={Plus} linkTo={createPageUrl('NewInspection')} />
            <ActionCard title={t.inspections.manageTeam || "Manage Team"} description={t.inspections.manageCertifiedInspectors || "Manage your certified inspectors"} icon={Users} linkTo={createPageUrl('Inspectors')} />
            <ActionCard title={t.inspections.viewAIReports || "View AI Reports"} description={t.inspections.seeAIAnalyzedReports || "See AI-analyzed damage reports"} icon={FileText} linkTo={createPageUrl('DroneInspections')} />
            <ActionCard title={t.inspections.crewcamSettings || "CrewCam Settings"} description={t.inspections.configureJobDetails || "Configure job details"} icon={Settings} linkTo={createPageUrl('Settings')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title={t.inspections.totalJobs || "Total Jobs"} value={isLoadingJobs ? <Loader2 className="animate-spin" /> : myJobs.length} icon={FileText} />
          <StatCard title={t.common.completed} value={isLoadingJobs ? <Loader2 className="animate-spin" /> : completedJobs} icon={FileText} />
          <StatCard title={t.inspections.totalPhotos || "Total Photos"} value={isLoadingMedia ? <Loader2 className="animate-spin" /> : totalPhotos} icon={Camera} />
          <StatCard title={t.inspections.totalVideos || "Total Videos"} value={isLoadingMedia ? <Loader2 className="animate-spin" /> : totalVideos} icon={Video} />
        </div>

        {/* Recent Jobs List */}
        <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex justify-between items-center mb-3">
                <h2 className="text-2xl font-bold text-gray-800">{t.inspections.recentCrewcamJobs || "Recent CrewCam Jobs"}</h2>
                <Button onClick={() => { setSelectedJob(null); setShowAssignDialog(true); }} className="bg-green-600 hover:bg-green-700 text-white shrink-0">
                    <Send className="w-4 h-4 mr-2" />
                    {t.inspections.sendAssignment || "Send Assignment"}
                </Button>
            </div>
            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                    data-testid="input-job-search"
                    placeholder="Search by client name, address, or assignee..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 pr-8 w-full"
                />
                {searchTerm && (
                    <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        data-testid="button-clear-search"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {isLoadingJobs ? (
                <div className="text-center py-8"><Loader2 className="animate-spin inline-block text-gray-600"/></div>
            ) : (
                <div className="space-y-4">
                    {filteredJobs.length === 0 && (
                        <p className="text-gray-500 text-center py-8" data-testid="text-no-jobs">
                            {searchTerm ? `No jobs found matching "${searchTerm}"` : (t.inspections.noInspectionJobsFound || "No inspection jobs found.")}
                        </p>
                    )}
                    {filteredJobs.map(job => {
                        const assignee = getAssigneeInfo(job);
                        const photoCount = getJobPhotoCount(job.id);
                        const importedPhotoUrls = getImportedPhotoUrls(job);
                        const totalPhotoCount = photoCount + importedPhotoUrls.length;
                        
                        return (
                            <div key={job.id} className="border rounded-lg hover:bg-gray-50 transition-colors">
                              <div className="flex items-center justify-between p-4">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900">
                                        {job.property_address || t.inspections.unassignedInspection || 'Unassigned Inspection'}
                                    </h3>
                                    {!job.property_address && (
                                        <p className="text-xs text-orange-600 mt-0.5">{t.inspections.noAddressProvided || "No address provided"}</p>
                                    )}
                                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                                        <p className="text-sm text-gray-600">{job.client_name || t.inspections.noClientSpecified || 'No client specified'}</p>

                                        {totalPhotoCount > 0 && (
                                            <div className="flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-md">
                                                <Camera className="w-3.5 h-3.5 text-blue-600" />
                                                <span className="text-xs font-semibold text-blue-700">{totalPhotoCount} {totalPhotoCount !== 1 ? t.inspections.photos : (t.inspections.photo || 'photo')}</span>
                                            </div>
                                        )}

                                        {assignee && (
                                            <div className="flex items-center gap-1.5 bg-green-50 px-2 py-1 rounded-md border border-green-200">
                                                {assignee.avatar ? (
                                                    <img 
                                                        src={assignee.avatar} 
                                                        alt={assignee.name}
                                                        className="w-5 h-5 rounded-full border border-white shadow-sm"
                                                    />
                                                ) : (
                                                    <div 
                                                        className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold border border-white shadow-sm"
                                                    >
                                                        {assignee.name[0]}
                                                    </div>
                                                )}
                                                <span className="text-xs font-semibold text-green-900">{assignee.name}</span>
                                            </div>
                                        )}
                                    </div>
                                    {(() => {
                                      const scheduledDate = job.inspection_date || job.scheduled_date;
                                      const safeDate = (d) => {
                                        if (!d) return null;
                                        const s = typeof d === 'string' ? d : String(d);
                                        return s.length === 10 ? new Date(s + 'T12:00:00') : new Date(s);
                                      };
                                      if (scheduledDate) {
                                        const d = safeDate(scheduledDate);
                                        return <p className="text-xs text-blue-500 mt-1">📅 Scheduled: {d ? format(d, 'MM/dd/yyyy') : scheduledDate}</p>;
                                      }
                                      const createdD = safeDate(job.created_date);
                                      return <p className="text-xs text-gray-400 mt-1">{t.common.created}: {createdD ? format(createdD, 'MM/dd/yyyy') : ''}</p>;
                                    })()}
                                    {job.ladder_assist_needed && (
                                        <Badge variant="outline" className="bg-yellow-50 border-yellow-300 text-yellow-800 text-xs mt-1">
                                            💵 {t.inspections.ladderAssist || "Ladder Assist"} ${job.ladder_assist_cost}
                                        </Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    {job.status === 'assigned' && (
                                        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">{t.inspections.assigned || "assigned"}</Badge>
                                    )}
                                    {job.status === 'completed' && (
                                        <Badge className="bg-green-100 text-green-800 border-green-300">{t.common.completed.toLowerCase()}</Badge>
                                    )}
                                    {job.status === 'in_progress' && (
                                        <Badge className="bg-blue-100 text-blue-800 border-blue-300">{t.common.inProgress || "in progress"}</Badge>
                                    )}
                                    {job.status === 'draft' && (
                                        <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-300">{t.common.draft.toLowerCase()}</Badge>
                                    )}
                                    
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => navigate(createPageUrl('InspectionReports') + `?jobId=${job.id}`)}
                                    >
                                        <Eye className="w-4 h-4 mr-1" />
                                        {t.common.view}
                                    </Button>
                                    
                                    <Button
                                        size="sm"
                                        onClick={() => navigate(createPageUrl('InspectionCapture') + `?jobId=${job.id}`)}
                                        className="bg-gray-900 hover:bg-gray-800 text-white"
                                    >
                                        {t.inspections.continue || "Continue"}
                                    </Button>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="outline" size="sm">
                                                <MoreVertical className="w-4 h-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => {
                                                setSelectedJob(job);
                                                setShowAssignDialog(true);
                                            }}>
                                                <UserPlus className="w-4 h-4 mr-2" />
                                                {job.status === 'assigned' ? (t.inspections.reassign || 'Reassign') : (t.inspections.assign || 'Assign')}
                                            </DropdownMenuItem>
                                            {!job.calendar_event_id && (
                                                <DropdownMenuItem
                                                    onClick={() => addToCalendarMutation.mutate(job)}
                                                    disabled={addToCalendarMutation.isPending}
                                                    data-testid={`add-to-calendar-${job.id}`}
                                                >
                                                    <CalendarDays className="w-4 h-4 mr-2 text-emerald-600" />
                                                    {addToCalendarMutation.isPending ? 'Adding...' : 'Add to Calendar'}
                                                </DropdownMenuItem>
                                            )}
                                            {job.calendar_event_id && (
                                                <DropdownMenuItem disabled className="text-emerald-600">
                                                    <CalendarDays className="w-4 h-4 mr-2" />
                                                    On Calendar ✓
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => handleDeleteJob(job.id)} className="text-red-600">
                                                <Trash2 className="w-4 h-4 mr-2" />
                                                {t.common.delete}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                              </div>
                              {importedPhotoUrls.length > 0 && (
                                <div className="px-4 pb-3 border-t pt-3">
                                  <p className="text-xs text-gray-500 mb-2 font-medium">Imported Photos ({importedPhotoUrls.length})</p>
                                  <div className="flex flex-wrap gap-2">
                                    {importedPhotoUrls.map((url, idx) => (
                                      <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                                        <img
                                          src={url}
                                          alt={`Inspection photo ${idx + 1}`}
                                          className="w-20 h-20 object-cover rounded-md border border-gray-200 hover:opacity-80 transition-opacity cursor-pointer"
                                          onError={e => { e.target.style.display = 'none'; }}
                                        />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
      </div>

      <AssignmentDialog
        isOpen={showAssignDialog}
        onOpenChange={setShowAssignDialog}
        existingJob={selectedJob}
        onAssignmentSent={() => {
          setShowAssignDialog(false);
          setSelectedJob(null);
          queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
        }}
      />
    </div>
  );
}