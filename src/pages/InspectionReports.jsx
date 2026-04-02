import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Trash2, Image as ImageIcon, Video } from 'lucide-react';
import useTranslation from "@/hooks/useTranslation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export default function InspectionReports() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedJob, setSelectedJob] = useState(null);
  const [showMediaDialog, setShowMediaDialog] = useState(false);
  
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
    enabled: !!user,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles'],
    queryFn: () => base44.entities.StaffProfile.list(),
    initialData: [],
  });

  const myCompany = React.useMemo(() => {
    if (!user) return null;
    const impersonatedId = sessionStorage.getItem('impersonating_company_id');
    if (impersonatedId) return companies.find(c => c.id === impersonatedId);
    
    const owned = companies.find(c => c.created_by === user.email);
    if (owned) return owned;
    
    const profile = staffProfiles.find(s => s.user_email === user.email);
    if (profile) return companies.find(c => c.id === profile.company_id);
    
    return companies[0];
  }, [user, companies, staffProfiles]);

  const { data: jobs = [], isLoading: isLoadingJobs } = useQuery({
    queryKey: ['inspectionJobs', myCompany?.id, user?.is_administrator],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.InspectionJob.filter({ company_id: myCompany.id }, '-created_date');
      if (user?.is_administrator && byCompany.length === 0) {
        return await base44.entities.InspectionJob.filter({}, '-created_date');
      }
      return byCompany;
    },
    enabled: !!myCompany?.id
  });

  const { data: media = [] } = useQuery({
    queryKey: ['inspectionMedia', myCompany?.id, user?.is_administrator],
    queryFn: async () => {
      if (!myCompany?.id) return [];
      const byCompany = await base44.entities.JobMedia.filter({ company_id: myCompany.id });
      // Admins: if company_id filter returns nothing (media may lack company_id), fetch all
      if (user?.is_administrator && byCompany.length === 0) {
        return await base44.entities.JobMedia.filter({});
      }
      return byCompany;
    },
    initialData: [],
    enabled: !!myCompany?.id
  });

  const deleteMediaMutation = useMutation({
    mutationFn: (mediaId) => base44.entities.JobMedia.delete(mediaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspectionMedia'] });
    },
  });
  
  const filteredJobs = jobs
    .filter(job => job.property_address?.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter(job => statusFilter === 'all' || job.status === statusFilter);

  const getJobMedia = (jobId) => {
    return media.filter(m => m.related_entity_id === jobId);
  };

  const getJobMediaCount = (jobId) => {
    return getJobMedia(jobId).length;
  };

  const handleDeleteMedia = async (mediaId) => {
    if (window.confirm(t.customers.deleteConfirm)) {
      await deleteMediaMutation.mutateAsync(mediaId);
    }
  };

  const completedJobs = jobs.filter(j => j.status === 'completed').length;
  const totalPhotos = media.filter(m => m.file_type === 'photo' || m.media_type === 'photo').length;
  const totalVideos = media.filter(m => m.file_type === 'video' || m.media_type === 'video').length;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-6">
        <Button variant="ghost" onClick={() => navigate(createPageUrl('InspectionsDashboard'))} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> {t.common.back}
        </Button>
        <h1 className="text-3xl font-bold text-gray-800">{t.sidebar.reportTemplates}</h1>

        <Card>
            <CardHeader>
                <CardTitle>{t.estimates.estimateSummary}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-4">
                <div className="p-4 bg-gray-100 rounded-lg">
                    <h4 className="text-sm text-gray-600">{t.common.total} {t.sidebar.tasks}</h4>
                    <p className="text-2xl font-bold">{jobs.length}</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                    <h4 className="text-sm text-green-700">{t.common.completed}</h4>
                    <p className="text-2xl font-bold">{completedJobs}</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                    <h4 className="text-sm text-blue-700">{t.common.total} {t.dashboard.photos}</h4>
                    <p className="text-2xl font-bold">{totalPhotos}</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                    <h4 className="text-sm text-purple-700">{t.common.total} Videos</h4>
                    <p className="text-2xl font-bold">{totalVideos}</p>
                </div>
            </CardContent>
        </Card>

        <div className="flex gap-4">
            <Input 
                placeholder={t.common.search} 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder={t.common.filter} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">{t.common.all}</SelectItem>
                    <SelectItem value="pending">{t.common.pending}</SelectItem>
                    <SelectItem value="in_progress">{t.tasks.inProgress}</SelectItem>
                    <SelectItem value="completed">{t.common.completed}</SelectItem>
                    <SelectItem value="assigned">{t.customers.assigned}</SelectItem>
                </SelectContent>
            </Select>
        </div>

        {isLoadingJobs ? (
            <div className="text-center"><Loader2 className="animate-spin inline-block"/></div>
        ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredJobs.map(job => (
                    <Card key={job.id}>
                        <CardHeader>
                            <CardTitle className="text-base">{job.property_address || 'Unassigned Inspection'}</CardTitle>
                            <p className="text-sm text-gray-500">{job.client_name}</p>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${job.status === 'completed' ? 'bg-green-100 text-green-800' : job.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
                              {job.status === 'completed' ? t.common.completed : job.status === 'in_progress' ? t.tasks.inProgress : t.common.pending}
                            </span>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="text-sm text-gray-600">
                                <p>{getJobMediaCount(job.id)} {t.mobileNav.camera.toLowerCase()}</p>
                                <p>{t.common.date}: {new Date(job.created_date).toLocaleDateString()}</p>
                            </div>
                            <div className="flex gap-2">
                                <Button 
                                  asChild 
                                  variant="outline"
                                  className="flex-1"
                                >
                                    <Link to={createPageUrl(`InspectionCapture?id=${job.id}`)}>{t.common.view}</Link>
                                </Button>
                                {getJobMediaCount(job.id) > 0 && (
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => {
                                      setSelectedJob(job);
                                      setShowMediaDialog(true);
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 text-red-600" />
                                  </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        )}

        <Dialog open={showMediaDialog} onOpenChange={setShowMediaDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.common.actions} - {selectedJob?.property_address || 'Inspection'}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
              {selectedJob && getJobMedia(selectedJob.id).map((item) => (
                <div key={item.id} className="relative group border rounded-lg overflow-hidden">
                  {(item.file_type === 'photo' || item.media_type === 'photo') ? (
                    <img 
                      src={item.file_url} 
                      alt="Inspection" 
                      className="w-full h-32 object-cover"
                    />
                  ) : (
                    <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                      <Video className="w-8 h-8 text-gray-400" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-opacity flex items-center justify-center">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteMedia(item.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      disabled={deleteMediaMutation.isPending}
                    >
                      {deleteMediaMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  <div className="p-2 bg-gray-50 text-xs text-gray-600">
                    {item.section || 'General'}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}