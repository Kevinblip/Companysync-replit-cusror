import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Camera, Users, FileText, Settings, Video, Loader2, Eye, Send, Trash2, MoreVertical, UserPlus, CalendarDays, Download, Search, X, Archive, ArchiveRestore, BellOff, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import AssignmentDialog from '../components/inspections/AssignmentDialog';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import useTranslation from "@/hooks/useTranslation";
import { useRoleBasedData } from "@/components/hooks/useRoleBasedData";
import { usePostPaintGate } from "@/hooks/usePostPaintGate";
import { photoSyncClientName } from "@/utils/photoSyncCustomerName";

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
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [filterNoReminder, setFilterNoReminder] = useState(false);

  const { user, myCompany, isAdmin, hasPermission, effectiveUserEmail, filterJobs, isDataLoading } = useRoleBasedData();
  const isInspectionMediaReady = usePostPaintGate(!!myCompany?.id && !isDataLoading, 'inspections');

  const canViewAllJobs = isAdmin;

  const { data: allJobs = [], isLoading: isLoadingJobsQuery } = useQuery({
    queryKey: ['inspectionJobs', myCompany?.id, canViewAllJobs],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.InspectionJob.filter({ company_id: myCompany.id }, '-created_date', 200);
      // Admins only: if company_id filter returns nothing, fetch all
      if (canViewAllJobs && byCompany.length === 0) {
        return await base44.entities.InspectionJob.filter({}, '-created_date', 200);
      }
      return byCompany;
    },
    enabled: !!myCompany?.id,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Show loading when company is resolving OR job query is in-flight for first time
  const isLoadingJobs = isDataLoading || !myCompany || isLoadingJobsQuery;

  // Filter first so the name lookup never fetches customers for jobs this
  // inspector is not permitted to see.
  const scopedJobs = React.useMemo(() => filterJobs(allJobs), [allJobs, filterJobs]);
  const linkedCustomerIds = React.useMemo(() => (
    [...new Set(scopedJobs.map(job => job.related_customer_id).filter(Boolean))].sort()
  ), [scopedJobs]);
  const { data: linkedCustomers = [] } = useQuery({
    queryKey: ['photoSyncCustomerNames', myCompany?.id, linkedCustomerIds.join('|')],
    queryFn: () => base44.entities.Customer.filter({
      company_id: myCompany.id,
      id: { $in: linkedCustomerIds },
    }, '-created_date', linkedCustomerIds.length),
    enabled: !!myCompany?.id && linkedCustomerIds.length > 0,
    staleTime: 0,
  });
  const jobs = React.useMemo(() => {
    const byId = new Map(linkedCustomers.map(customer => [customer.id, customer]));
    return scopedJobs.map(job => {
      const clientName = photoSyncClientName(job, byId.get(job.related_customer_id), myCompany?.id);
      return clientName === job.client_name ? job : { ...job, client_name: clientName };
    });
  }, [scopedJobs, linkedCustomers, myCompany?.id]);

  const { data: media = [], isLoading: isLoadingMediaQuery } = useQuery({
    queryKey: ['inspectionMedia', myCompany?.id, showArchived],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const all = await base44.entities.JobMedia.filter(
        { related_entity_type: 'InspectionJob', company_id: myCompany.id },
        '-created_date',
        10000
      );
      if (showArchived) return all;
      return all.filter(m => !m.is_archived);
    },
    enabled: !!myCompany?.id && isInspectionMediaReady,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const resendNotificationMutation = useMutation({
    mutationFn: async (job) => {
      await base44.functions.invoke('sendInspectionAssignment', {
        jobId: job.id,
        inspectorEmail: job.assigned_to_email,
        appUrl: window.location.origin,
        isResend: true,
      });
      const now = new Date().toISOString();
      const existingHistory = Array.isArray(job.notification_history) ? job.notification_history : [];
      await base44.entities.InspectionJob.update(job.id, {
        last_resend_at: now,
        notification_history: [
          ...existingHistory,
          { type: 'resend', sent_at: now, to: job.assigned_to_email },
        ],
      });
    },
    onSuccess: () => {
      toast.success('Email and SMS re-sent to the inspector.');
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
    },
    onError: (err) => {
      toast.error('Failed to resend notification: ' + (err.message || 'Unknown error'));
    },
  });

  const archiveJobMediaMutation = useMutation({
    mutationFn: async (jobId) => {
      const all = await base44.entities.JobMedia.filter({
        related_entity_id: jobId,
        related_entity_type: 'InspectionJob',
      });
      const jobMedia = all.filter(m => !m.is_archived);
      await Promise.all(jobMedia.map(m => base44.entities.JobMedia.update(m.id, { is_archived: true })));
      return jobMedia.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
      toast.success(`${count} photo${count !== 1 ? 's' : ''} archived`);
    },
    onError: () => toast.error('Failed to archive photos'),
  });

  const unarchiveJobMediaMutation = useMutation({
    mutationFn: async (jobId) => {
      const jobMedia = await base44.entities.JobMedia.filter({
        related_entity_id: jobId,
        related_entity_type: 'InspectionJob',
        is_archived: true,
      });
      await Promise.all(jobMedia.map(m => base44.entities.JobMedia.update(m.id, { is_archived: false })));
      return jobMedia.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
      toast.success(`${count} photo${count !== 1 ? 's' : ''} restored`);
    },
    onError: () => toast.error('Failed to restore photos'),
  });

  const archiveJobMutation = useMutation({
    mutationFn: async (jobId) => {
      // Archive the job AND all its photos together
      await base44.entities.InspectionJob.update(jobId, { is_archived: true });
      const jobMedia = await base44.entities.JobMedia.filter({
        related_entity_id: jobId,
        related_entity_type: 'InspectionJob',
      });
      await Promise.all(jobMedia.filter(m => !m.is_archived).map(m =>
        base44.entities.JobMedia.update(m.id, { is_archived: true })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
      toast.success('Job archived — tap "Show Archived" to restore it');
    },
    onError: () => toast.error('Failed to archive job'),
  });

  const unarchiveJobMutation = useMutation({
    mutationFn: async (jobId) => {
      // Restore the job AND all its photos together
      await base44.entities.InspectionJob.update(jobId, { is_archived: false });
      const jobMedia = await base44.entities.JobMedia.filter({
        related_entity_id: jobId,
        related_entity_type: 'InspectionJob',
        is_archived: true,
      });
      await Promise.all(jobMedia.map(m =>
        base44.entities.JobMedia.update(m.id, { is_archived: false })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionJobs'] });
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
      toast.success('Job and photos restored');
    },
    onError: () => toast.error('Failed to restore job'),
  });

  const isLoadingMedia = isDataLoading || !myCompany || isLoadingMediaQuery;

  const { data: users = [] } = useQuery({ // Added for assignee info
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-inspections', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
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

  const addToCalendarMutation = useMutation({
    mutationFn: async (job) => {
      const rawDate = job.inspection_date || job.scheduled_date || job.created_date || null;
      if (!rawDate) throw new Error('No date available for this job');
      // Safely extract just YYYY-MM-DD from any ISO timestamp before constructing the Date
      const dateOnly = rawDate.slice(0, 10);
      const startDate = new Date(dateOnly + 'T12:00:00');
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
      toast.success('📅 Added to your calendar!');
    },
    onError: (err) => {
      toast.error('Could not add to calendar: ' + (err.message || 'Unknown error'));
    },
  });

  const myJobs = React.useMemo(() => {
    let result = jobs;
    if (!canViewAllJobs && user) result = result.filter(j => j.assigned_to_email === user.email);
    if (showArchived) {
      result = result.filter(j => j.is_archived);
    } else {
      result = result.filter(j => !j.is_archived);
    }
    return result;
  }, [jobs, user, canViewAllJobs, showArchived]);

  const completedJobs = myJobs.filter(j => j.status === 'completed').length;
  const totalPhotos = media.filter(m => m.file_type === 'photo').length;
  const totalVideos = media.filter(m => m.file_type === 'video').length;

  const filteredJobs = React.useMemo(() => {
    let result = myJobs;

    if (filterNoReminder) {
      result = result.filter(j => j.assigned_to_email && !j.last_resend_at);
    }

    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter(j =>
      (j.property_address || '').toLowerCase().includes(q) ||
      (j.client_name || '').toLowerCase().includes(q) ||
      (j.customer_name || '').toLowerCase().includes(q) ||
      (j.assigned_to_email || '').toLowerCase().includes(q) ||
      (j.status || '').toLowerCase().includes(q) ||
      (j.insurance_claim_number || '').toLowerCase().includes(q) ||
      (j.claim_number || '').toLowerCase().includes(q)
    );
  }, [myJobs, searchQuery, filterNoReminder]);

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

  const getJobPhotoCounts = (jobId) => {
    const jobMedia = media.filter(m => m.related_entity_id === jobId && m.file_type === 'photo');
    return {
      total: jobMedia.length,
      whatsapp: jobMedia.filter(m => m.source === 'whatsapp_upload').length,
      standard: jobMedia.filter(m => m.source === 'crew_upload').length,
    };
  };

  const handleDeleteJob = (jobId) => { // Renamed from handleDelete
    if (window.confirm(t.inspections.deleteConfirm || 'Are you sure you want to delete this inspection job?')) {
      deleteJobMutation.mutate(jobId);
    }
  };

  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      const parseNotes = (notesStr) => {
        if (!notesStr) return '';
        try {
          const parsed = JSON.parse(notesStr);
          if (typeof parsed === 'object' && !Array.isArray(parsed)) {
            return Object.entries(parsed)
              .map(([section, text]) => `[${section}]: ${text}`)
              .join(' | ');
          }
          return notesStr;
        } catch {
          return notesStr;
        }
      };

      const escCSV = (val) => {
        const str = String(val ?? '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const toCSVRow = (row) => row.map(escCSV).join(',');

      // --- JOB ROWS ---
      const jobHeaders = [
        'Job ID', 'Date Created', 'Job Title / Address', 'Client Name', 'Client Phone',
        'Status', 'Priority', 'Damage Type', 'Assigned Inspector', 'Inspection Date',
        'Assignments', 'Reminders', 'Notes', 'Photo Count', 'Video Count', 'Photo URLs'
      ];

      const jobRows = filteredJobs.map(job => {
        const jobMediaItems = media.filter(m => m.related_entity_id === job.id);
        const photos = jobMediaItems.filter(m => m.file_type === 'photo');
        const videos = jobMediaItems.filter(m => m.file_type === 'video');
        const photoUrls = photos.map(p => p.file_url).filter(Boolean).join(' | ');
        const assignee = getAssigneeInfo(job);
        const history = Array.isArray(job.notification_history) ? job.notification_history : [];
        const assignmentCount = history.length > 0
          ? history.filter(e => e.type !== 'resend').length
          : (job.notification_count || 0);
        const reminderCount = history.filter(e => e.type === 'resend').length;
        return [
          job.id,
          job.created_date ? format(new Date(job.created_date), 'MMM dd yyyy h:mm a') : '',
          job.property_address || 'Unassigned Inspection',
          job.client_name || job.customer_name || '',
          job.client_phone || '',
          job.status || '',
          job.priority || '',
          job.damage_type || '',
          assignee?.name || job.assigned_to_email || 'Unassigned',
          job.inspection_date || job.scheduled_date || '',
          assignmentCount,
          reminderCount,
          parseNotes(job.notes),
          photos.length,
          videos.length,
          photoUrls
        ];
      });

      // --- MEDIA DETAIL ROWS ---
      const mediaHeaders = [
        'Job ID', 'Job Address', 'Client Name', 'Media Type', 'Section',
        'Caption / Description', 'AI Damage Notes', 'AI Severity', 'Photo URL', 'Date Captured'
      ];

      const mediaRows = [];
      filteredJobs.forEach(job => {
        const jobMediaItems = media.filter(m => m.related_entity_id === job.id);
        jobMediaItems.forEach(m => {
          const aiData = m.ai_damage_analysis || {};
          mediaRows.push([
            job.id,
            job.property_address || 'Unassigned Inspection',
            job.client_name || job.customer_name || '',
            m.file_type || 'photo',
            m.section || '',
            m.caption || '',
            aiData.ai_notes || aiData.description || aiData.summary || '',
            aiData.severity || aiData.damage_severity || '',
            m.file_url || '',
            m.created_date ? format(new Date(m.created_date), 'MMM dd yyyy h:mm a') : ''
          ]);
        });
      });

      const lines = [
        '=== CREWCAM JOB ASSIGNMENTS ===',
        toCSVRow(jobHeaders),
        ...jobRows.map(toCSVRow),
        '',
        '=== PHOTO & VIDEO DETAILS ===',
        toCSVRow(mediaHeaders),
        ...mediaRows.map(toCSVRow)
      ];

      const csvContent = lines.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Mark as scoped/filtered if user can't see all jobs (access scope)
      // OR if they have an active search/filter narrowing the visible set.
      const isFiltered = !canViewAllJobs || filteredJobs.length < myJobs.length;
      a.download = `PhotoSync_${isFiltered ? 'Filtered_' : ''}Export_${format(new Date(), 'yyyy-MM-dd')}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed: ' + (e.message || 'Unknown error'));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-2 md:p-6 bg-gradient-to-br from-blue-50 to-indigo-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">{t.sidebar.crewcamDashboard}</h1>
            <div className="flex items-center gap-2">
                <Button
                    variant={showArchived ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setShowArchived(v => !v)}
                    data-testid="toggle-show-archived"
                >
                    {showArchived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
                    {showArchived ? 'Hide Archived' : 'Show Archived'}
                </Button>
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
            <ActionCard title={t.inspections.crewcamSettings || "PhotoSync Settings"} description={t.inspections.configureJobDetails || "Configure job details"} icon={Settings} linkTo={createPageUrl('Settings')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title={t.inspections.totalJobs || "Total Jobs"} value={isLoadingJobs ? <Loader2 className="animate-spin" /> : myJobs.length} icon={FileText} />
          <StatCard title={t.common.completed} value={isLoadingJobs ? <Loader2 className="animate-spin" /> : completedJobs} icon={FileText} />
          <StatCard title={t.inspections.totalPhotos || "Total Photos"} value={isLoadingMedia ? <Loader2 className="animate-spin" /> : totalPhotos} icon={Camera} />
          <StatCard title={t.inspections.totalVideos || "Total Videos"} value={isLoadingMedia ? <Loader2 className="animate-spin" /> : totalVideos} icon={Video} />
        </div>

        {/* Recent Jobs List */}
        <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h2 className="text-2xl font-bold text-gray-800">{t.inspections.recentCrewcamJobs || "Recent PhotoSync Jobs"}</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <Input
                            type="text"
                            placeholder="Search jobs..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 pr-8 w-48 sm:w-56 h-9 text-sm"
                            data-testid="input-search-crewcam"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                    {canViewAllJobs && (
                        <Button
                            variant={filterNoReminder ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => setFilterNoReminder(v => !v)}
                            className={filterNoReminder ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200' : ''}
                            data-testid="button-filter-no-reminder"
                            title="Show only assigned jobs with no reminder sent"
                        >
                            <BellOff className="w-4 h-4 mr-1.5" />
                            No reminder sent
                            {filterNoReminder && <X className="w-3 h-3 ml-1.5" />}
                        </Button>
                    )}
                    <Button
                        onClick={handleExportCSV}
                        disabled={isExporting || isLoadingJobs || isLoadingMedia}
                        variant="outline"
                        className="border-blue-600 text-blue-600 hover:bg-blue-50"
                        data-testid="button-export-crewcam"
                    >
                        {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                        Export CSV ({filteredJobs.length} {filteredJobs.length === 1 ? 'job' : 'jobs'})
                    </Button>
                    <Button onClick={() => { setSelectedJob(null); setShowAssignDialog(true); }} className="bg-green-600 hover:bg-green-700 text-white">
                        <Send className="w-4 h-4 mr-2" />
                        {t.inspections.sendAssignment || "Send Assignment"}
                    </Button>
                </div>
            </div>

            {isLoadingJobs ? (
                <div className="text-center py-8"><Loader2 className="animate-spin inline-block text-gray-600"/></div>
            ) : (
                <div className="space-y-4">
                    {filteredJobs.length === 0 && (
                        <p className="text-gray-500 text-center py-8">
                            {searchQuery.trim()
                                ? `No jobs found for "${searchQuery}"`
                                : filterNoReminder
                                    ? 'No assigned jobs without a reminder sent.'
                                    : (t.inspections.noInspectionJobsFound || "No inspection jobs found.")}
                        </p>
                    )}
                    {filteredJobs.map(job => {
                        const assignee = getAssigneeInfo(job);
                        const photoCounts = getJobPhotoCounts(job.id);
                        const hasPhotoCounts = photoCounts.total > 0;
                        const hasBreakdown = photoCounts.whatsapp > 0 || photoCounts.standard > 0;
                        
                        return (
                            <div key={job.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                                <div className="flex-1">
                                    <h3 className="font-semibold text-gray-900">
                                        {job.property_address || t.inspections.unassignedInspection || 'Unassigned Inspection'}
                                    </h3>
                                    {!job.property_address && (
                                        <p className="text-xs text-orange-600 mt-0.5">{t.inspections.noAddressProvided || "No address provided"}</p>
                                    )}
                                    <div className="flex items-center gap-4 mt-1 flex-wrap">
                                        <p className="text-sm text-gray-600">{job.client_name || t.inspections.noClientSpecified || 'No client specified'}</p>

                                        {hasPhotoCounts && (
                                            <div className="flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-md">
                                                <Camera className="w-3.5 h-3.5 text-blue-600" />
                                                <span className="text-xs font-semibold text-blue-700" data-testid={`text-photo-count-${job.id}`}>{photoCounts.total} {photoCounts.total !== 1 ? t.inspections.photos : (t.inspections.photo || 'photo')}</span>
                                                {hasBreakdown && (
                                                    <>
                                                        <span className="text-xs text-blue-400 mx-0.5">·</span>
                                                        <span className="text-xs font-medium text-green-700" data-testid={`text-whatsapp-count-${job.id}`}>{photoCounts.whatsapp} WhatsApp</span>
                                                        <span className="text-xs text-blue-400 mx-0.5">·</span>
                                                        <span className="text-xs font-medium text-blue-700" data-testid={`text-standard-count-${job.id}`}>{photoCounts.standard} Standard</span>
                                                    </>
                                                )}
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
                                    <p className="text-xs text-gray-400 mt-1">
                                        {t.common.created}: {format(new Date(job.created_date), 'MM/dd/yyyy')}
                                        {(job.first_notified_at || job.last_notified_at) && (
                                            <span className="ml-2" data-testid={`text-last-notified-${job.id}`}>
                                                • Assigned: {format(new Date(job.first_notified_at || job.last_notified_at), 'MM/dd/yyyy h:mm a')}
                                                {job.last_resend_at && (
                                                    <span className="ml-2 text-amber-600" data-testid={`text-last-resend-${job.id}`}>
                                                        • Last reminder: {format(new Date(job.last_resend_at), 'MM/dd/yyyy h:mm a')}
                                                    </span>
                                                )}
                                                {job.notification_count > 0 && (
                                                    Array.isArray(job.notification_history) && job.notification_history.length > 0 ? (() => {
                                                        const reminderCount = job.notification_history.filter(e => e.type === 'resend').length;
                                                        const assignmentCount = job.notification_history.filter(e => e.type !== 'resend').length;
                                                        return (
                                                            <span className="inline-flex items-center gap-1 ml-1">
                                                                <span className="text-blue-700 font-medium" data-testid={`text-assignment-count-${job.id}`}>
                                                                    {assignmentCount} {assignmentCount === 1 ? 'assignment' : 'assignments'}
                                                                </span>
                                                                <span className="text-gray-400">·</span>
                                                                <span className="text-amber-600 font-medium" data-testid={`text-reminder-count-${job.id}`}>
                                                                    {reminderCount} {reminderCount === 1 ? 'reminder' : 'reminders'}
                                                                </span>
                                                                <Popover>
                                                                    <PopoverTrigger asChild>
                                                                        <button
                                                                            className="text-gray-400 hover:text-gray-600 cursor-pointer inline-flex items-center"
                                                                            data-testid={`button-notification-history-${job.id}`}
                                                                            onClick={e => e.stopPropagation()}
                                                                            aria-label="View send history"
                                                                        >
                                                                            <Info className="w-3 h-3" />
                                                                        </button>
                                                                    </PopoverTrigger>
                                                                    <PopoverContent className="w-72 p-3" align="start">
                                                                        <p className="text-xs font-semibold text-gray-700 mb-2">Send History</p>
                                                                        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                                                                            {job.notification_history.map((entry, i) => (
                                                                                <li key={i} className="text-xs text-gray-600 border-b last:border-0 pb-1 last:pb-0">
                                                                                    <span className="font-medium">{format(new Date(entry.sent_at), 'MM/dd/yyyy h:mm a')}</span>
                                                                                    {entry.type === 'resend' ? (
                                                                                        <span className="ml-1 text-amber-600 font-medium">🔁 Reminder</span>
                                                                                    ) : (
                                                                                        <span className="ml-1 text-blue-600 font-medium">📋 Assignment</span>
                                                                                    )}
                                                                                    {entry.sent_by_email && (
                                                                                        <span className="block text-gray-400 truncate">{entry.sent_by_email}</span>
                                                                                    )}
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </PopoverContent>
                                                                </Popover>
                                                            </span>
                                                        );
                                                    })() : (
                                                        <span className="ml-1 text-gray-500" data-testid={`text-notification-counts-${job.id}`}>— {job.notification_count}x total</span>
                                                    )
                                                )}
                                            </span>
                                        )}
                                    </p>
                                    {job.ladder_assist_needed && (
                                        <Badge variant="outline" className="bg-yellow-50 border-yellow-300 text-yellow-800 text-xs mt-1">
                                            💵 {t.inspections.ladderAssist || "Ladder Assist"} ${job.ladder_assist_cost}
                                        </Badge>
                                    )}
                                    {job.drone_pilot_needed && (
                                        <Badge variant="outline" className="bg-blue-50 border-blue-300 text-blue-800 text-xs mt-1 ml-1" data-testid={`badge-drone-pilot-${job.id}`}>
                                            🚁 Drone Pilot ${job.drone_pilot_cost || 150}
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
                                            {job.assigned_to_email && (
                                                <DropdownMenuItem
                                                    onClick={() => resendNotificationMutation.mutate(job)}
                                                    disabled={resendNotificationMutation.isPending}
                                                    data-testid={`resend-notification-${job.id}`}
                                                >
                                                    <Send className="w-4 h-4 mr-2 text-blue-600" />
                                                    {resendNotificationMutation.isPending ? 'Resending...' : 'Resend Link'}
                                                </DropdownMenuItem>
                                            )}
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
                                            <DropdownMenuSeparator />
                                            {!showArchived ? (
                                              <DropdownMenuItem
                                                onClick={() => archiveJobMutation.mutate(job.id)}
                                                disabled={archiveJobMutation.isPending}
                                                data-testid={`archive-job-${job.id}`}
                                              >
                                                <Archive className="w-4 h-4 mr-2 text-amber-600" />
                                                Archive Job
                                              </DropdownMenuItem>
                                            ) : (
                                              <DropdownMenuItem
                                                onClick={() => unarchiveJobMutation.mutate(job.id)}
                                                disabled={unarchiveJobMutation.isPending}
                                                data-testid={`restore-job-${job.id}`}
                                              >
                                                <ArchiveRestore className="w-4 h-4 mr-2 text-blue-600" />
                                                Restore Job
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => handleDeleteJob(job.id)} className="text-red-600">
                                                <Trash2 className="w-4 h-4 mr-2" />
                                                {t.common.delete}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
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