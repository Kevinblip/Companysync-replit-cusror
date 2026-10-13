import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
}
from "@/components/ui/select";
import {
  Plus,
  Search,
  Briefcase,
  Users,
  DollarSign,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Pause,
  Eye,
  EyeOff,
  Send,
  Flag,
  MessageSquare,
  Image as ImageIcon,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Copy,
  Pencil,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { getAddressSearchText } from "@/utils/addressSearch";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";

import { getMilestones } from '../../lib/projectMilestones.js';

// ── Project Portal Panel ──────────────────────────────────────────────────────
function ProjectPortalPanel({ project, customers = [] }) {
  const { toast } = useToast();

  // Prefer FK lookup (related_customer_id or customer_id), fall back to name match
  const linkedCustomer =
    project.related_customer_id
      ? customers.find(c => c.id === project.related_customer_id)
      : project.customer_id
        ? customers.find(c => c.id === project.customer_id)
        : project.customer_name
          ? customers.find(c => c.name?.toLowerCase().trim() === project.customer_name?.toLowerCase().trim())
          : null;
  const portalToken = linkedCustomer?.portal_token || null;
  const portalUrl = portalToken
    ? `${window.location.origin}/portal?token=${encodeURIComponent(portalToken)}`
    : null;

  const handlePreviewPortal = () => {
    if (portalUrl) window.open(portalUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyPortalLink = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      toast({ title: 'Portal link copied to clipboard' });
    } catch {
      toast({ title: 'Failed to copy link', variant: 'destructive' });
    }
  };

  const [milestoneForm, setMilestoneForm] = useState({
    project_type: project.project_type || 'standard',
    current_milestone: project.current_milestone || '',
  });
  const [savingMilestone, setSavingMilestone] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [logPublic, setLogPublic] = useState(false);
  const [addingLog, setAddingLog] = useState(false);
  const [logs, setLogs] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoPublic, setPhotoPublic] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [showPhotoForm, setShowPhotoForm] = useState(false);

  const milestones = getMilestones(milestoneForm.project_type);

  useEffect(() => {
    setLogsLoading(true);
    Promise.all([
      fetch(`/api/projects/${project.id}/log`).then(r => r.json()).catch(() => ({ logs: [] })),
      fetch(`/api/projects/${project.id}/photos`).then(r => r.json()).catch(() => ({ photos: [] })),
    ]).then(([logData, photoData]) => {
      setLogs(logData.logs || []);
      setPhotos(photoData.photos || []);
    }).finally(() => setLogsLoading(false));
  }, [project.id]);

  const handleSaveMilestone = async () => {
    setSavingMilestone(true);
    try {
      const resp = await fetch(`/api/projects/${project.id}/milestone`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(milestoneForm),
      });
      const data = await resp.json();
      if (data.success) toast({ title: 'Milestone updated', description: 'Homeowner notified via SMS.' });
      else toast({ title: 'Error', description: data.error, variant: 'destructive' });
    } catch {
      toast({ title: 'Error', description: 'Failed to update milestone.', variant: 'destructive' });
    } finally {
      setSavingMilestone(false);
    }
  };

  const handleAddLog = async () => {
    if (!logContent.trim()) return;
    setAddingLog(true);
    try {
      const resp = await fetch(`/api/projects/${project.id}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_body: logContent, is_public: logPublic }),
      });
      const data = await resp.json();
      if (data.success) {
        setLogs(prev => [data.log, ...prev]);
        setLogContent('');
        setLogPublic(false);
        toast({ title: logPublic ? 'Update posted & visible to homeowner' : 'Note saved (internal only)' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to add update.', variant: 'destructive' });
    } finally {
      setAddingLog(false);
    }
  };

  const handleTogglePhotoVisibility = async (photo) => {
    try {
      const response = await fetch(`/api/projects/${project.id}/photos/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_public: !photo.is_public }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not update photo visibility.');
      setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, is_public: !p.is_public } : p));
    } catch {
      toast({ title: 'Error', description: 'Failed to update photo visibility.', variant: 'destructive' });
    }
  };

  const handleAddPhoto = async () => {
    if (!photoUrl.trim()) return;
    setAddingPhoto(true);
    try {
      const resp = await fetch(`/api/projects/${project.id}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: photoUrl.trim(), caption: photoCaption, milestone: milestoneForm.current_milestone, is_public: photoPublic }),
      });
      const data = await resp.json();
      if (data.success) {
        setPhotos(prev => [{ id: data.id, project_id: project.id, photo_url: photoUrl.trim(), caption: photoCaption, milestone: milestoneForm.current_milestone, is_public: photoPublic, created_at: new Date().toISOString() }, ...prev]);
        setPhotoUrl('');
        setPhotoCaption('');
        setPhotoPublic(false);
        setShowPhotoForm(false);
        toast({ title: photoPublic ? 'Photo added & visible to homeowner' : 'Photo added (internal only)' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to add photo.', variant: 'destructive' });
    } finally {
      setAddingPhoto(false);
    }
  };

  const homeownerNotes = logs.filter(l => l.author_role === 'homeowner');
  const teamLogs = logs.filter(l => l.author_role !== 'homeowner');

  return (
    <div className="space-y-5 pt-2">
      {/* Portal Preview */}
      <div className="border rounded-xl p-4 bg-indigo-50/50 space-y-2">
        <h4 className="font-semibold text-sm text-indigo-900 flex items-center gap-2"><ExternalLink className="w-4 h-4" /> Homeowner Portal Preview</h4>
        {!project.related_customer_id && !project.customer_id && !project.customer_name ? (
          <p className="text-xs text-indigo-600/70">No customer linked to this project — assign a customer to enable portal preview.</p>
        ) : !portalUrl ? (
          <p className="text-xs text-indigo-600/70">Portal link not yet generated for this customer. Use the Customer Profile page to send a portal invite first.</p>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handlePreviewPortal}
              className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 text-xs flex-1"
              data-testid={`button-preview-portal-${project.id}`}
            >
              <ExternalLink className="w-3 h-3 mr-1" /> Preview as Homeowner
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopyPortalLink}
              className="h-8 w-8 p-0 flex-shrink-0 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
              title="Copy portal link"
              data-testid={`button-copy-portal-link-${project.id}`}
            >
              <Copy className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Milestone Controls */}
      <div className="border rounded-xl p-4 bg-blue-50/50 space-y-3">
        <h4 className="font-semibold text-sm text-blue-900 flex items-center gap-2"><Flag className="w-4 h-4" /> Project Track & Milestone</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">Project Type</Label>
            <Select value={milestoneForm.project_type} onValueChange={v => setMilestoneForm(f => ({ ...f, project_type: v, current_milestone: '' }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard Job</SelectItem>
                <SelectItem value="sedgwick_claim">Sedgwick Insurance Claim</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-gray-600 mb-1 block">Current Milestone</Label>
            <Select value={milestoneForm.current_milestone} onValueChange={v => setMilestoneForm(f => ({ ...f, current_milestone: v }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select milestone" /></SelectTrigger>
              <SelectContent>
                {milestones.map(m => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button size="sm" onClick={handleSaveMilestone} disabled={savingMilestone || !milestoneForm.current_milestone} className="bg-blue-600 hover:bg-blue-700 text-white h-8">
          {savingMilestone ? 'Saving...' : 'Save & Notify Homeowner'}
        </Button>
      </div>

      {/* Add Update */}
      <div className="border rounded-xl p-4 bg-gray-50 space-y-3">
        <h4 className="font-semibold text-sm text-gray-800 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Add Update</h4>
        <Textarea
          placeholder="Write an update for your records or to share with the homeowner..."
          value={logContent}
          onChange={e => setLogContent(e.target.value)}
          rows={2}
          className="text-sm resize-none bg-white"
          data-testid="input-project-log"
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch checked={logPublic} onCheckedChange={setLogPublic} id="log-public" />
            <Label htmlFor="log-public" className="text-xs text-gray-600 cursor-pointer">
              {logPublic ? <span className="flex items-center gap-1 text-green-700 font-medium"><Eye className="w-3 h-3" /> Show on Portal</span> : <span className="flex items-center gap-1 text-gray-500"><EyeOff className="w-3 h-3" /> Internal only</span>}
            </Label>
          </div>
          <Button size="sm" onClick={handleAddLog} disabled={addingLog || !logContent.trim()} className="h-8 text-xs" data-testid="button-add-log">
            {addingLog ? 'Saving...' : <><Send className="w-3 h-3 mr-1" /> Post Update</>}
          </Button>
        </div>
      </div>

      {/* Homeowner Notes (read-only) */}
      {homeownerNotes.length > 0 && (
        <div className="border rounded-xl p-4 bg-amber-50/50 space-y-2">
          <h4 className="font-semibold text-sm text-amber-800 flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Notes from Homeowner ({homeownerNotes.length})</h4>
          {homeownerNotes.map(note => (
            <div key={note.id} className="bg-white border border-amber-100 rounded-lg p-3">
              <p className="text-sm text-gray-800">{note.content_body}</p>
              <p className="text-xs text-gray-400 mt-1">{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</p>
            </div>
          ))}
        </div>
      )}

      {/* Team Logs */}
      {logsLoading ? (
        <p className="text-xs text-gray-400 py-2">Loading updates...</p>
      ) : teamLogs.length > 0 && (
        <div className="border rounded-xl p-4 bg-white space-y-2">
          <h4 className="font-semibold text-sm text-gray-700">Update History</h4>
          {teamLogs.map(log => (
            <div key={log.id} className={`p-3 rounded-lg border text-sm ${log.is_public ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-gray-800 flex-1">{log.content_body}</p>
                <Badge variant="outline" className={`text-xs flex-shrink-0 ${log.is_public ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                  {log.is_public ? <><Eye className="w-3 h-3 mr-1" />Portal</> : 'Internal'}
                </Badge>
              </div>
              <p className="text-xs text-gray-400 mt-1">{log.author_name} · {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}</p>
            </div>
          ))}
        </div>
      )}

      {/* Photos */}
      <div className="border rounded-xl p-4 bg-white space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm text-gray-700 flex items-center gap-2"><ImageIcon className="w-4 h-4" /> Project Photos ({photos.length})</h4>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowPhotoForm(f => !f)}>
            {showPhotoForm ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />} Add Photo
          </Button>
        </div>
        {showPhotoForm && (
          <div className="space-y-2 pt-1 border-t border-gray-100">
            <Input placeholder="Photo URL" value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} className="text-sm h-8" />
            <Input placeholder="Caption (optional)" value={photoCaption} onChange={e => setPhotoCaption(e.target.value)} className="text-sm h-8" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={photoPublic} onCheckedChange={setPhotoPublic} id="photo-public" />
                <Label htmlFor="photo-public" className="text-xs text-gray-600 cursor-pointer">
                  {photoPublic ? <span className="text-green-700 font-medium">Visible to homeowner</span> : 'Internal only'}
                </Label>
              </div>
              <Button size="sm" onClick={handleAddPhoto} disabled={addingPhoto || !photoUrl.trim()} className="h-7 text-xs">
                {addingPhoto ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        )}
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 pt-1">
            {photos.map(photo => {
              const isHomeowner = photo.uploaded_by?.startsWith('homeowner:');
              return (
                <div key={photo.id} className="relative group rounded-lg overflow-hidden border bg-gray-50">
                  <img src={photo.photo_url} alt={photo.caption || 'Project photo'} className="w-full h-20 object-cover" onError={e => { e.target.style.display = 'none'; }} />
                  <button
                    onClick={() => handleTogglePhotoVisibility(photo)}
                    title={photo.is_public ? 'Hide from homeowner' : 'Show to homeowner'}
                    className={`absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs transition-opacity ${photo.is_public ? 'bg-green-500' : 'bg-gray-400'}`}
                    data-testid={`button-toggle-photo-${photo.id}`}
                  >
                    {photo.is_public ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </button>
                  {isHomeowner && (
                    <div className="absolute bottom-0 left-0 right-0 bg-amber-500/90 px-1 py-0.5">
                      <span className="text-white text-[9px] font-semibold leading-none">Uploaded by homeowner</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Projects() {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  // Added for future edit functionality, as implied by the mutation's onSuccess
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany,
    filterProjects,
    hasPermission,
    isAdmin
  } = useRoleBasedData();

  const [formData, setFormData] = useState({
    name: "",
    customer_name: "",
    related_customer_id: "",
    status: "not_started",
    start_date: "",
    deadline: "",
    budget: 0,
    description: "",
    team_members: []
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allProjects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Project.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany?.id,
  });

  // 🔐 Filter projects based on role permissions
  const projects = React.useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);

  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const newProject = await base44.entities.Project.create({
        ...data,
        company_id: myCompany?.id,
      });

      // 🔔 Trigger workflow automation for project_created
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'project_created',
            companyId: myCompany.id,
            entityType: 'Project',
            entityId: newProject.id,
            entityData: {
              project_name: newProject.name,
              name: newProject.name,
              customer_name: newProject.customer_name || '',
              budget: newProject.budget || 0,
              status: newProject.status,
              start_date: newProject.start_date || '',
              deadline: newProject.deadline || '',
              app_url: window.location.origin
            }
          });
          console.log('✅ Project created workflow triggered');
        } catch (error) {
          console.error('⚠️ Workflow trigger failed:', error);
        }
      }

      return newProject;
    },
    onSuccess: async (newProject) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['my-assignments-projects'] });
      setShowDialog(false);
      setFormData({
        name: "",
        customer_name: "",
        related_customer_id: "",
        status: "not_started",
        start_date: "",
        deadline: "",
        budget: 0,
        description: "",
        team_members: []
      });
    },
  });

  // Replaced and extended updateProjectMutation with new updateMutation logic
  const updateMutation = useMutation({
    mutationFn: async ({ id, data, originalStatus }) => {
      const updatedProject = await base44.entities.Project.update(id, data);

      // --- Workflow Triggers ---

      // 🔥 TRIGGER WORKFLOW: project_started (if status changed to in_progress)
      if (originalStatus !== 'in_progress' && updatedProject.status === 'in_progress') {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'project_started',
            companyId: myCompany?.id,
            entityType: 'Project',
            entityId: updatedProject.id,
            entityData: {
              project_name: updatedProject.name,
              customer_name: updatedProject.customer_name || '',
              budget: updatedProject.budget || 0,
              start_date: updatedProject.start_date || '',
              app_url: window.location.origin
            }
          });
          console.log('✅ Project started workflows triggered:', updatedProject.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed (non-critical):', error);
        }
      }

      // 🔥 TRIGGER WORKFLOW: project_completed (if status changed to completed)
      if (originalStatus !== 'completed' && updatedProject.status === 'completed') {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'project_completed',
            companyId: myCompany?.id,
            entityType: 'Project',
            entityId: updatedProject.id,
            entityData: {
              project_name: updatedProject.name,
              customer_name: updatedProject.customer_name || '',
              budget: updatedProject.budget || 0,
              completed_date: new Date().toISOString(),
              app_url: window.location.origin
            }
          });
          console.log('✅ Project completed workflows triggered:', updatedProject.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed (non-critical):', error);
        }
      }

      // 🔥 NEW TRIGGER WORKFLOW: project_status_changed (if any status change occurred)
      if (myCompany?.id && originalStatus !== updatedProject.status) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'project_status_changed',
            companyId: myCompany.id,
            entityType: 'Project',
            entityId: updatedProject.id,
            entityData: {
              project_name: updatedProject.name,
              name: updatedProject.name, // Keeping both name and project_name for flexibility
              customer_name: updatedProject.customer_name || '',
              old_status: originalStatus,
              new_status: updatedProject.status,
              status: updatedProject.status, // Keeping both status and new_status for flexibility
              app_url: window.location.origin
            }
          });
          console.log('✅ Project status changed workflows triggered:', updatedProject.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed (non-critical) for project_status_changed:', error);
        }
      }

      // --- Notification Logic ---
      // 🔔 Send notifications when project status changes
      if (myCompany?.id && originalStatus !== updatedProject.status) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const adminEmails = myCompany?.created_by ? [myCompany.created_by] : [];

          let assigneeEmails = [];
          if (updatedProject.team_members?.length > 0) {
            assigneeEmails = updatedProject.team_members;
          }

          const notifyEmails = [...new Set([...assigneeEmails, ...adminEmails])];

          for (const email of notifyEmails) {
            const isTeamMember = assigneeEmails.includes(email);

            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: '🚀 Project Status Updated',
              message: `${updatedProject.name} → ${updatedProject.status.replace(/_/g, ' ')}${isTeamMember ? ' (your project)' : ''}`,
              type: 'project_status_update', // Changed type to be more specific for status updates
              related_entity_type: 'Project',
              related_entity_id: updatedProject.id,
              link_url: '/projects',
              is_read: false,
            });

            await base44.integrations.Core.SendEmail({
              to: email,
              from_name: myCompany.company_name || 'CRM',
              subject: `Project Update: ${updatedProject.name}`,
              html: `<h2>Project Status Changed</h2>
                ${isTeamMember ? '<p style="color: blue;"><strong>You are on this project team!</strong></p>' : ''}
                <p><strong>Project:</strong> ${updatedProject.name}</p>
                <p><strong>Status:</strong> ${originalStatus.replace(/_/g, ' ')} → <strong style="color: green;">${updatedProject.status.replace(/_/g, ' ')}</strong></p>
                ${updatedProject.customer_name ? `<p><strong>Customer:</strong> ${updatedProject.customer_name}</p>` : ''}
                ${updatedProject.deadline ? `<p><strong>Deadline:</strong> ${format(new Date(updatedProject.deadline), 'MMM d, yyyy')}</p>` : ''}
                <p><a href="${window.location.origin}/projects">View Projects</a></p>`
            });
          }
        } catch (error) {
          console.error('Failed to send project notifications:', error);
        }
      }

      return updatedProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] }); // Added from outline
      queryClient.invalidateQueries({ queryKey: ['my-assignments-projects'] });
      toast.success('Project updated with notifications sent!'); // Added from outline
      setShowEditDialog(false);
      setEditingProject(null);
    },
    onError: (error) => { // Added from outline
      toast.error(`Failed to update project: ${error.message}`);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  // Admin-triggered backfill: link historical projects to Customer records
  // by case-insensitive exact name match. Ambiguous or unmatched names are
  // left unchanged (safe no-op).
  const backfillMutation = useMutation({
    mutationFn: async () => {
      const customersByName = new Map();
      for (const c of customers) {
        const key = c.name?.toLowerCase().trim();
        if (!key) continue;
        if (!customersByName.has(key)) {
          customersByName.set(key, []);
        }
        customersByName.get(key).push(c);
      }

      let updated = 0;
      let ambiguous = 0;
      let unmatched = 0;
      let alreadyLinked = 0;

      for (const project of allProjects) {
        if (project.related_customer_id) {
          alreadyLinked++;
          continue;
        }
        const key = project.customer_name?.toLowerCase().trim();
        if (!key) {
          unmatched++;
          continue;
        }
        const matches = customersByName.get(key) || [];
        if (matches.length === 0) {
          unmatched++;
          continue;
        }
        if (matches.length > 1) {
          ambiguous++;
          continue;
        }
        try {
          await base44.entities.Project.update(project.id, {
            ...project,
            related_customer_id: matches[0].id,
            customer_name: matches[0].name,
          });
          updated++;
        } catch (err) {
          console.error('Backfill failed for project', project.id, err);
        }
      }

      return { updated, ambiguous, unmatched, alreadyLinked };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({
        title: 'Backfill complete',
        description: `Linked ${result.updated} project(s). ${result.alreadyLinked} already linked, ${result.ambiguous} ambiguous, ${result.unmatched} unmatched.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Backfill failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const openEditDialog = (project) => {
    setEditingProject(project);
    let resolvedCustomerId = project.related_customer_id || "";
    let resolvedCustomerName = project.customer_name || "";
    if (!resolvedCustomerId && resolvedCustomerName) {
      const match = customers.find(
        (c) => c.name?.toLowerCase().trim() === resolvedCustomerName.toLowerCase().trim()
      );
      if (match) {
        resolvedCustomerId = match.id;
        resolvedCustomerName = match.name;
      }
    }
    setFormData({
      name: project.name || "",
      customer_name: resolvedCustomerName,
      related_customer_id: resolvedCustomerId,
      status: project.status || "not_started",
      start_date: project.start_date || "",
      deadline: project.deadline || "",
      budget: project.budget || 0,
      description: project.description || "",
      team_members: project.team_members || [],
    });
    setShowEditDialog(true);
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editingProject) return;
    updateMutation.mutate({
      id: editingProject.id,
      data: { ...editingProject, ...formData },
      originalStatus: editingProject.status,
    });
  };

  const handleStatusChange = (project, newStatus) => {
    updateMutation.mutate({ // Use the new mutation name
      id: project.id,
      data: { ...project, status: newStatus }, // Renamed to 'data' as per updateMutationFn signature
      originalStatus: project.status // Pass the original status
    });
  };

  const getStatusIcon = (status) => {
    const icons = {
      'not_started': Clock,
      'in_progress': Briefcase,
      'on_hold': Pause,
      'completed': CheckCircle2,
      'cancelled': AlertCircle
    };
    return icons[status] || Clock;
  };

  const getStatusColor = (status) => {
    const colors = {
      'not_started': 'bg-gray-100 text-gray-700 border-gray-200',
      'in_progress': 'bg-blue-100 text-blue-700 border-blue-200',
      'on_hold': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'completed': 'bg-green-100 text-green-700 border-green-200',
      'cancelled': 'bg-red-100 text-red-700 border-red-200'
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const filteredProjects = projects.filter(project => {
    const relatedCustomer = customers.find(customer =>
      (project.related_customer_id && customer.id === project.related_customer_id) ||
      (project.customer_name &&
        String(customer.name || '').trim().toLowerCase() === String(project.customer_name).trim().toLowerCase())
    );
    const matchesSearch =
      project.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getAddressSearchText(project, relatedCustomer).includes(searchTerm.toLowerCase().trim());

    const matchesStatus = filterStatus === "all" || project.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-3 sm:p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.projects.title}</h1>
          <p className="text-gray-500 mt-1">{t.projects.noProjects}</p>
        </div>

        {isAdmin && (
          <Button
            type="button"
            variant="outline"
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending || projectsLoading || customersLoading}
            data-testid="button-backfill-customers"
            title="Link historical projects to Customer records by name"
          >
            {backfillMutation.isPending ? 'Linking…' : 'Link Customers'}
          </Button>
        )}

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              {t.projects.addProject}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t.projects.addProject}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>{t.projects.projectName} *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                  placeholder="Kitchen Remodel"
                />
              </div>

              <div>
                <Label>{t.projects.customer}</Label>
                <Select
                  value={formData.related_customer_id || "__none__"}
                  onValueChange={(value) => {
                    if (value === "__none__") {
                      setFormData({ ...formData, related_customer_id: "", customer_name: "" });
                    } else {
                      const selected = customers.find(c => c.id === value);
                      setFormData({ ...formData, related_customer_id: value, customer_name: selected?.name || "" });
                    }
                  }}
                >
                  <SelectTrigger data-testid="select-customer">
                    <SelectValue placeholder={t.projects.customer} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.projects.status}</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({...formData, status: value})}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">{t.common.pending}</SelectItem>
                      <SelectItem value="in_progress">{t.common.inProgress}</SelectItem>
                      <SelectItem value="on_hold">{t.projects.onHold}</SelectItem>
                      <SelectItem value="completed">{t.common.completed}</SelectItem>
                      <SelectItem value="cancelled">{t.common.cancelled}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t.projects.budget}</Label>
                  <Input
                    type="number"
                    value={formData.budget}
                    onChange={(e) => setFormData({...formData, budget: parseFloat(e.target.value)})}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.projects.startDate}</Label>
                  <Input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                  />
                </div>
                <div>
                  <Label>{t.projects.endDate}</Label>
                  <Input
                    type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData({...formData, deadline: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <Label>{t.common.description}</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                  rows={4}
                  placeholder={t.common.description}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                  {t.projects.addProject}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showEditDialog}
          onOpenChange={(open) => {
            setShowEditDialog(open);
            if (!open) setEditingProject(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t.common.edit || 'Edit'} {t.projects.title}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <Label>{t.projects.projectName} *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  placeholder="Kitchen Remodel"
                  data-testid="input-edit-project-name"
                />
              </div>

              <div>
                <Label>{t.projects.customer}</Label>
                <Select
                  value={formData.related_customer_id || "__none__"}
                  onValueChange={(value) => {
                    if (value === "__none__") {
                      setFormData({ ...formData, related_customer_id: "", customer_name: "" });
                    } else {
                      const selected = customers.find(c => c.id === value);
                      setFormData({ ...formData, related_customer_id: value, customer_name: selected?.name || "" });
                    }
                  }}
                >
                  <SelectTrigger data-testid="select-edit-customer">
                    <SelectValue placeholder={t.projects.customer} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.projects.status}</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="not_started">{t.common.pending}</SelectItem>
                      <SelectItem value="in_progress">{t.common.inProgress}</SelectItem>
                      <SelectItem value="on_hold">{t.projects.onHold}</SelectItem>
                      <SelectItem value="completed">{t.common.completed}</SelectItem>
                      <SelectItem value="cancelled">{t.common.cancelled}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t.projects.budget}</Label>
                  <Input
                    type="number"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: parseFloat(e.target.value) || 0 })}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>{t.projects.startDate}</Label>
                  <Input
                    type="date"
                    value={formData.start_date}
                    onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <Label>{t.projects.endDate}</Label>
                  <Input
                    type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <Label>{t.common.description}</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  placeholder={t.common.description}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowEditDialog(false); setEditingProject(null); }}
                  data-testid="button-cancel-edit-project"
                >
                  {t.common.cancel}
                </Button>
                <Button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={updateMutation.isPending}
                  data-testid="button-save-edit-project"
                >
                  {updateMutation.isPending ? '...' : (t.common.save || 'Save')}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-white shadow-md">
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder={t.projects.searchProjects}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t.common.all} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common.all}</SelectItem>
                <SelectItem value="not_started">{t.common.pending}</SelectItem>
                <SelectItem value="in_progress">{t.common.inProgress}</SelectItem>
                <SelectItem value="on_hold">{t.projects.onHold}</SelectItem>
                <SelectItem value="completed">{t.common.completed}</SelectItem>
                <SelectItem value="cancelled">{t.common.cancelled}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => {
              const StatusIcon = getStatusIcon(project.status);
              return (
                <Card key={project.id} className="bg-gradient-to-br from-white to-gray-50 border-gray-200 hover:shadow-lg transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                          <Briefcase className="w-6 h-6 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 truncate">{project.name}</h3>
                          {project.customer_name && (
                            <p className="text-sm text-gray-600 truncate">{project.customer_name}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mb-3">
                      <Select
                        value={project.status}
                        onValueChange={(value) => handleStatusChange(project, value)}
                      >
                        <SelectTrigger className="w-full">
                          <Badge variant="outline" className={`${getStatusColor(project.status)} flex items-center gap-1`}>
                            <StatusIcon className="w-3 h-3" />
                            {project.status === 'not_started' ? t.common.pending :
                             project.status === 'in_progress' ? t.common.inProgress :
                             project.status === 'on_hold' ? t.projects.onHold :
                             project.status === 'completed' ? t.common.completed :
                             project.status === 'cancelled' ? t.common.cancelled :
                             project.status.replace(/_/g, ' ')}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_started">{t.common.pending}</SelectItem>
                          <SelectItem value="in_progress">{t.common.inProgress}</SelectItem>
                          <SelectItem value="on_hold">{t.projects.onHold}</SelectItem>
                          <SelectItem value="completed">{t.common.completed}</SelectItem>
                          <SelectItem value="cancelled">{t.common.cancelled}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {project.description && (
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">{project.description}</p>
                    )}

                    <div className="space-y-2 text-sm">
                      {project.budget > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            {t.projects.budget}
                          </span>
                          <span className="font-semibold text-green-600">
                            ${project.budget.toFixed(2)}
                          </span>
                        </div>
                      )}
                      {project.start_date && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            {t.projects.startDate}
                          </span>
                          <span className="text-gray-700">
                            {format(new Date(project.start_date), 'MMM d, yyyy')}
                          </span>
                        </div>
                      )}
                      {project.deadline && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {t.projects.endDate}
                          </span>
                          <span className="text-gray-700">
                            {format(new Date(project.deadline), 'MMM d, yyyy')}
                          </span>
                        </div>
                      )}
                      {project.team_members && project.team_members.length > 0 && (
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500 flex items-center gap-1">
                            <Users className="w-4 h-4" />
                            {t.projects.crew}
                          </span>
                          <span className="text-gray-700">
                            {project.team_members.length} {t.projects.crew}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Edit Project */}
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs h-7"
                        onClick={() => openEditDialog(project)}
                        data-testid={`button-edit-project-${project.id}`}
                      >
                        <Pencil className="w-3 h-3 mr-1" /> {t.common.edit || 'Edit'}
                      </Button>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="w-full text-xs h-7 text-blue-700 border-blue-200 hover:bg-blue-50" data-testid={`button-portal-panel-${project.id}`}>
                            <Eye className="w-3 h-3 mr-1" /> Homeowner Portal Controls
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="text-base">Portal Controls — {project.name || project.customer_name}</DialogTitle>
                          </DialogHeader>
                          <ProjectPortalPanel project={project} customers={customers} />
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {filteredProjects.length === 0 && (
              <div className="col-span-full py-12 text-center text-gray-500">
                <Briefcase className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p>{t.projects.noProjects}</p>
                <p className="text-sm mt-1">{t.projects.noProjects}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}