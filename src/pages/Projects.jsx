import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  Pause
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import useTranslation from "@/hooks/useTranslation";

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
    status: "not_started",
    start_date: "",
    deadline: "",
    budget: 0,
    description: "",
    team_members: []
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Project.filter({ company_id: myCompany.id }, "-created_date") : [],
    initialData: [],
    enabled: !!myCompany?.id
  });

  // 🔐 Filter projects based on role permissions
  const projects = React.useMemo(() => filterProjects(allProjects), [allProjects, filterProjects]);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany?.id ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    initialData: [],
    enabled: !!myCompany?.id
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
      setShowDialog(false);
      setFormData({
        name: "",
        customer_name: "",
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
    const matchesSearch =
      project.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.customer_name?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = filterStatus === "all" || project.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t.projects.title}</h1>
          <p className="text-gray-500 mt-1">{t.projects.noProjects}</p>
        </div>

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
                <Input
                  value={formData.customer_name}
                  onChange={(e) => setFormData({...formData, customer_name: e.target.value})}
                  placeholder={t.projects.customer}
                  list="customers"
                />
                <datalist id="customers">
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.name} />
                  ))}
                </datalist>
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