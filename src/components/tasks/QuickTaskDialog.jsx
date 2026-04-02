import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, CheckCircle2, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

const COMMON_TASK_TITLES = [
  "Follow up with customer",
  "Schedule inspection",
  "Send estimate",
  "Call for approval",
  "Site visit",
  "Material pickup",
  "Invoice follow-up",
  "Customer meeting",
  "Photo documentation",
  "Final walkthrough",
  "Insurance claim follow-up",
  "Schedule installation",
  "Get permits",
  "Order materials",
  "Quality check"
];

export default function QuickTaskDialog({ open, onOpenChange, relatedTo, relationType }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [myCompany, setMyCompany] = useState(null);
  const [openCombobox, setOpenCombobox] = useState(false);
  const [taskData, setTaskData] = useState({
    name: "",
    description: "",
    priority: "medium",
    due_date: null,
    assigned_to: "",
    assigned_to_users: [],
    status: "not_started",
    column: "",
  });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => base44.entities.Company.list("-created_date"),
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles-quick-task'],
    queryFn: () => base44.entities.StaffProfile.list(),
    initialData: [],
  });

  const { data: boards = [] } = useQuery({
    queryKey: ['task-boards'],
    queryFn: () => base44.entities.TaskBoard.list("-created_date"),
    initialData: [],
  });

  // 🔥 NEW: Fetch existing open tasks for this entity to prevent duplicates
  const { data: existingTasks = [] } = useQuery({
    queryKey: ['existing-tasks', relatedTo?.name, relatedTo?.customer_name],
    queryFn: async () => {
      const name = relatedTo?.name || relatedTo?.customer_name;
      if (!name) return [];
      // Filter for tasks related to this entity that are NOT completed
      const tasks = await base44.entities.Task.filter({ related_to: name });
      return tasks.filter(t => 
        t.status !== 'job_completed' && 
        t.column !== 'job_completed' && 
        t.column !== 'customer_lost'
      );
    },
    enabled: !!(relatedTo?.name || relatedTo?.customer_name) && open,
    initialData: [],
  });

  useEffect(() => {
    if (user && companies.length > 0) {
      const ownedCompany = companies.find(c => c.created_by === user.email);
      if (ownedCompany) {
        setMyCompany(ownedCompany);
        return;
      }
      
      const staffProfile = staffProfiles.find(s => s.user_email === user.email);
      if (staffProfile?.company_id) {
        setMyCompany(companies.find(c => c.id === staffProfile.company_id));
      }
    }
  }, [user, companies, staffProfiles]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      const defaultColumn = defaultBoard?.columns?.[0]?.id || "not_started";
      
      setTaskData({
        name: "",
        description: "",
        priority: "medium",
        due_date: null,
        assigned_to: user?.email || "",
        assigned_to_users: [user?.email || ""],
        status: "not_started",
        column: defaultColumn,
      });
    }
  }, [open, user, boards]);

  const createTaskMutation = useMutation({
    mutationFn: async (data) => {
      const task = await base44.entities.Task.create(data);

      // Create in-app notification and send email/SMS
      if (myCompany?.id && data.assigned_to) {
        try {
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: data.assigned_to,
            title: '📋 New Task Assigned',
            message: `You've been assigned: ${data.name}`,
            type: 'task_assigned',
            related_entity_type: 'Task',
            related_entity_id: task.id,
            link_url: '/tasks',
            is_read: false
          });

          // Send email notification
          const assignedStaff = staffProfiles.find(s => s.user_email === data.assigned_to);
          if (assignedStaff) {
            await base44.integrations.Core.SendEmail({
              to: data.assigned_to,
              from_name: myCompany.company_name || 'CRM',
              subject: '📋 New Task Assigned to You',
              html: `<h2>New Task Assignment</h2>
                <p><strong>Task:</strong> ${data.name}</p>
                <p><strong>Description:</strong> ${data.description || 'No description provided'}</p>
                <p><strong>Priority:</strong> ${data.priority}</p>
                <p><strong>Due Date:</strong> ${data.due_date || 'Not set'}</p>
                <p><strong>Related To:</strong> ${relatedTo?.name || relatedTo?.customer_name || 'N/A'}</p>
                <p><a href="${window.location.origin}/tasks">View All Tasks</a></p>`
            });

            // Send SMS notification if staff has phone
            if (assignedStaff.phone) {
              try {
                await base44.functions.invoke('sendSMS', {
                  to: assignedStaff.phone,
                  message: `📋 New task assigned: ${data.name}. Priority: ${data.priority}. ${data.due_date ? `Due: ${data.due_date}` : ''}`,
                  companyId: myCompany.id
                });
              } catch (smsError) {
                console.log('SMS notification skipped:', smsError.message);
              }
            }
          }
        } catch (error) {
          console.error('Failed to send notifications:', error);
        }
      }

      // Trigger workflow
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'task_created',
            companyId: myCompany.id,
            entityType: 'Task',
            entityId: task.id,
            entityData: {
              name: task.name,
              description: task.description,
              assigned_to: task.assigned_to,
              priority: task.priority
            }
          });
        } catch (error) {
          console.error('Workflow trigger failed (non-critical):', error);
        }
      }

      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('✅ Task created successfully!');
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('Failed to create task: ' + error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!taskData.name.trim()) {
      toast.error('Task name is required');
      return;
    }

    const defaultBoard = boards.find(b => b.is_default) || boards[0];
    
    if (!defaultBoard) {
      toast.error('No task board found. Please create a task board first in the Tasks page.');
      return;
    }

    const assignedUsers = taskData.assigned_to_users || [taskData.assigned_to || user?.email];
    const assignees = assignedUsers
      .map(email => {
        const staff = staffProfiles.find(s => s.user_email === email);
        return staff ? {
          email: staff.user_email,
          name: staff.full_name,
          avatar: staff.avatar_url
        } : null;
      })
      .filter(Boolean);

    const payload = {
      company_id: myCompany?.id,
      board_id: defaultBoard.id,
      column: taskData.column || defaultBoard?.columns?.[0]?.id || "not_started",
      name: taskData.name,
      description: taskData.description,
      priority: taskData.priority,
      status: taskData.status,
      due_date: taskData.due_date ? format(taskData.due_date, 'yyyy-MM-dd') : null,
      assigned_to: assignedUsers[0] || user?.email,
      assignees: assignees,
      related_to: relatedTo?.name || relatedTo?.customer_name || "",
      source: relationType === 'lead' ? 'lead' : 'customer',
    };

    console.log('Creating task with payload:', payload);
    createTaskMutation.mutate(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-blue-600" />
            Add Task for {relatedTo?.name || relatedTo?.customer_name || 'Contact'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Related To (non-editable) */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-gray-600 mb-1">Related {relationType === 'lead' ? 'Lead' : 'Customer'}</p>
            <p className="font-semibold text-blue-900">{relatedTo?.name || relatedTo?.customer_name || 'Unknown'}</p>
          </div>

          {/* 🔥 NEW: Warning for existing tasks */}
          {existingTasks.length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs font-semibold text-yellow-800 mb-2">
                ⚠️ {existingTasks.length} Open Task{existingTasks.length !== 1 ? 's' : ''} Already Exist:
              </p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {existingTasks.map(t => {
                  const creator = staffProfiles.find(s => s.user_email === t.created_by)?.full_name || t.created_by;
                  return (
                    <div key={t.id} className="text-xs text-yellow-900 bg-yellow-100/50 p-1.5 rounded border border-yellow-200">
                      <span className="font-medium">{t.name}</span>
                      <span className="mx-1">•</span>
                      <span className="text-yellow-700">{t.status?.replace(/_/g, ' ')}</span>
                      <span className="mx-1">•</span>
                      <span className="text-yellow-600 opacity-75">By {creator}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task Name */}
          <div>
            <Label>Task Title *</Label>
            <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between h-10 font-normal"
                >
                  {taskData.name || "e.g., Follow up on estimate"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Command>
                  <CommandInput 
                    placeholder="Search or type custom title..." 
                    value={taskData.name}
                    onValueChange={(value) => setTaskData({ ...taskData, name: value })}
                  />
                  <CommandEmpty>
                    <div className="p-2">
                      <Button
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => {
                          setOpenCombobox(false);
                        }}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Use "{taskData.name}"
                      </Button>
                    </div>
                  </CommandEmpty>
                  <CommandGroup>
                    {COMMON_TASK_TITLES.map((title) => (
                      <CommandItem
                        key={title}
                        onSelect={() => {
                          setTaskData({ ...taskData, name: title });
                          setOpenCombobox(false);
                        }}
                      >
                        {title}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Description */}
          <div>
            <Label>Description</Label>
            <Textarea
              placeholder="Task details..."
              value={taskData.description}
              onChange={(e) => setTaskData({ ...taskData, description: e.target.value })}
              rows={3}
            />
          </div>

          {/* Column/Status */}
          <div>
            <Label>Column/Status *</Label>
            <Select value={taskData.column} onValueChange={(value) => setTaskData({ ...taskData, column: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                {(boards.find(b => b.is_default) || boards[0])?.columns?.map(col => (
                  <SelectItem key={col.id} value={col.id}>
                    {col.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div>
            <Label>Priority</Label>
            <Select value={taskData.priority} onValueChange={(value) => setTaskData({ ...taskData, priority: value })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Due Date */}
          <div>
            <Label>Due Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {taskData.due_date ? format(taskData.due_date, 'PPP') : 'Select date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={taskData.due_date}
                  onSelect={(date) => setTaskData({ ...taskData, due_date: date })}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Assignees (Multiple) */}
          <div>
            <Label>Assign To (Multiple)</Label>
            <Select 
              value="placeholder"
              onValueChange={(value) => {
                const currentUsers = taskData.assigned_to_users || [];
                if (!currentUsers.includes(value)) {
                  const updatedUsers = [...currentUsers, value];
                  setTaskData({ 
                    ...taskData, 
                    assigned_to_users: updatedUsers,
                    assigned_to: updatedUsers[0]
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Add assignees..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={user?.email}>{user?.full_name} (Me)</SelectItem>
                {staffProfiles
                  .filter(s => s.user_email !== user?.email)
                  .map(staff => (
                    <SelectItem key={staff.user_email} value={staff.user_email}>
                      {staff.full_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {taskData.assigned_to_users && taskData.assigned_to_users.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {taskData.assigned_to_users.map(email => {
                  const staff = staffProfiles.find(s => s.user_email === email);
                  return (
                    <Badge key={email} variant="secondary" className="flex items-center gap-1">
                      {staff?.full_name || email}
                      <button
                        type="button"
                        onClick={() => {
                          const updatedUsers = taskData.assigned_to_users.filter(e => e !== email);
                          setTaskData({ 
                            ...taskData, 
                            assigned_to_users: updatedUsers,
                            assigned_to: updatedUsers[0] || ""
                          });
                        }}
                        className="ml-1 hover:bg-gray-300 rounded-full p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createTaskMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTaskMutation.isPending || !taskData.name.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {createTaskMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Create Task
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}