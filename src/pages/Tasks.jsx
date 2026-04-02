import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Settings, Trash2, X, AlertCircle, User, MessageSquare, Paperclip, Eye, GripVertical, Columns, List, Upload, Clock, Tag as TagIcon, CheckSquare, Send, Edit2, Link as LinkIcon, Calendar, Check, Bell, Users, Search, Archive, ArchiveRestore, Loader2, FileText, Download, Wrench, Mail } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from 'sonner';
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import SubcontractorFinder from "../components/subcontractors/SubcontractorFinder";
import FilteredTasksList from "../components/tasks/FilteredTasksList";
import useTranslation from "@/hooks/useTranslation";

export default function Tasks() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [showTaskDetailDialog, setShowTaskDetailDialog] = useState(false);
  const [showColumnManagerDialog, setShowColumnManagerDialog] = useState(false);
  const [showBoardManagerDialog, setShowBoardManagerDialog] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [currentBoard, setCurrentBoard] = useState(null);
  const [editingColumns, setEditingColumns] = useState([]);
  const [viewMode, setViewMode] = useState("kanban");
  const [searchTerm, setSearchTerm] = useState("");
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    column: "not_started",
    priority: "medium",
    start_date: "",
    due_date: "",
    assigned_to: "",
    assignees: [],
    related_to: "",
    source: "internal",
    tags: [],
  });

  // Task detail states
  const [editingDescription, setEditingDescription] = useState(false);
  const [taskDescription, setTaskDescription] = useState("");
  const [newComment, setNewComment] = useState("");
  const [notifyCustomerOnUpdate, setNotifyCustomerOnUpdate] = useState(false);
  const [taskComments, setTaskComments] = useState([]);
  const [checklistItems, setChecklistItems] = useState([]);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [taskFiles, setTaskFiles] = useState([]);
  const [openAssignees, setOpenAssignees] = useState(false);
  const [openFollowers, setOpenFollowers] = useState(false);
  const [viewingFile, setViewingFile] = useState(null);
  
  // Timesheet states
  const [showTimesheetForm, setShowTimesheetForm] = useState(false);
  const [timesheetData, setTimesheetData] = useState({
    member_email: "",
    start_time: "",
    end_time: "",
    note: ""
  });

  // Reminder states
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderData, setReminderData] = useState({
    reminder_date: "",
    reminder_to: [],
    reminder_description: "",
    is_recurring: false,
    recurrence_frequency: "",
    add_to_calendar: true
  });
  const [openReminderAssignees, setOpenReminderAssignees] = useState(false);

  // Subcontractor finder states
  const [showSubcontractorFinder, setShowSubcontractorFinder] = useState(false);
  const [jobLocationForSub, setJobLocationForSub] = useState(null);

  // Merge task states
  const [mergingMode, setMergingMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState([]);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [selectedColumnFilter, setSelectedColumnFilter] = React.useState(null);
  const [primaryMergeId, setPrimaryMergeId] = useState(null);

  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany,
    filterTasks,
    hasPermission,
    isAdmin
  } = useRoleBasedData();

  const queryClient = useQueryClient();

  const { data: allTasks = [] } = useQuery({
    queryKey: ['tasks', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Task.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
    initialData: [],
  });

  // 🔐 Filter tasks based on role permissions
  const tasks = React.useMemo(() => filterTasks(allTasks), [allTasks, filterTasks]);

  // ⚠️ Detect duplicates: Map of related_to -> count of open tasks
  const duplicateWarningMap = React.useMemo(() => {
    const counts = {};
    allTasks.forEach(t => {
      if (!t.related_to || t.column === 'job_completed' || t.column === 'customer_lost' || t.status === 'job_completed') return;
      counts[t.related_to] = (counts[t.related_to] || 0) + 1;
    });
    return counts;
  }, [allTasks]);

  // 🔥 Read filter and task_id from URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const filterParam = urlParams.get('filter');
    const taskIdParam = urlParams.get('task_id');
    
    if (filterParam) {
      setActiveFilter(filterParam);
      setViewMode("list");
    }
    
    // Auto-open task modal when task_id is in URL
    if (taskIdParam && allTasks.length > 0) {
      const task = allTasks.find(t => t.id === taskIdParam);
      if (task) {
        // Small delay to ensure board is loaded
        setTimeout(() => {
          handleTaskClick(task);
        }, 300);
      }
    }
  }, [allTasks.length]);

  const { data: boards = [] } = useQuery({
    queryKey: ['task-boards', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.TaskBoard.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!myCompany,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: async () => {
      // Prefer company-scoped staff when available, otherwise fall back to all staff
      if (myCompany?.id) {
        const byCompany = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
        if (byCompany && byCompany.length > 0) return byCompany;
      }
      return await base44.entities.StaffProfile.list('-created_date', 500);
    },
    initialData: [],
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Customer.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: leads = [] } = useQuery({
    queryKey: ['leads', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.Lead.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  // 🔥 NEW: Fetch existing open tasks for duplicate check in New Task dialog
  const { data: existingTasksForDuplicateCheck = [] } = useQuery({
    queryKey: ['existing-tasks-check', formData.related_to],
    queryFn: async () => {
      if (!formData.related_to) return [];
      const matches = allTasks.filter(t => 
        t.related_to === formData.related_to &&
        t.status !== 'job_completed' && 
        t.column !== 'job_completed' && 
        t.column !== 'customer_lost'
      );
      return matches;
    },
    enabled: !!formData.related_to && showTaskDialog,
    initialData: [],
  });

  React.useEffect(() => {
    if (!currentBoard && boards.length > 0) {
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      setCurrentBoard(defaultBoard);
      setSelectedColumnFilter(null); // Clear filter when loading board
    } else if (currentBoard && !boards.some(b => b.id === currentBoard.id)) {
      const newDefaultBoard = boards.find(b => b.is_default) || boards[0];
      setCurrentBoard(newDefaultBoard || null);
      setSelectedColumnFilter(null); // Clear filter when board changes
    }
  }, [boards, currentBoard]);

  // Clear column filter when switching boards
  const handleBoardChange = (boardId) => {
    const newBoard = boards.find(b => b.id === boardId);
    setCurrentBoard(newBoard);
    setSelectedColumnFilter(null); // Reset column filter
  };

  React.useEffect(() => {
    if (currentBoard && showColumnManagerDialog) {
      setEditingColumns(JSON.parse(JSON.stringify(currentBoard.columns || [])));
    }
  }, [currentBoard, showColumnManagerDialog]);

  const createTaskMutation = useMutation({
    onMutate: async (taskData) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previousTasks = queryClient.getQueryData(['tasks']);

      const optimisticTask = {
        ...taskData,
        id: 'temp-' + Date.now(),
        created_date: new Date().toISOString(),
        company_id: myCompany?.id,
        board_id: currentBoard?.id,
        // Ensure defaults
        column: taskData.column || "not_started",
        priority: taskData.priority || "medium",
        assignees: taskData.assignees || [],
        comments: [],
        files: [],
        checklist_items: []
      };

      // Auto-assign creator logic for optimistic update
      if ((!optimisticTask.assignees || optimisticTask.assignees.length === 0) && user) {
        const creatorStaff = staffProfiles.find(s => s.user_email === user.email);
        if (creatorStaff) {
          optimisticTask.assignees = [{
            email: user.email,
            name: creatorStaff.full_name || user.full_name,
            avatar: creatorStaff.avatar_url
          }];
          optimisticTask.assigned_to = user.email;
        }
      }

      queryClient.setQueryData(['tasks'], (old) => {
        return [optimisticTask, ...(old || [])];
      });

      setShowTaskDialog(false);
      return { previousTasks };
    },
    onError: (err, newTask, context) => {
      queryClient.setQueryData(['tasks'], context.previousTasks);
      toast.error('Failed to create task: ' + err.message);
    },
    mutationFn: async (taskData) => {
      // Auto-assign creator if no assignees specified
      let finalTaskData = { ...taskData };
      if ((!finalTaskData.assignees || finalTaskData.assignees.length === 0) && user) {
        const creatorStaff = staffProfiles.find(s => s.user_email === user.email);
        if (creatorStaff) {
          finalTaskData.assignees = [{
            email: user.email,
            name: creatorStaff.full_name || user.full_name,
            avatar: creatorStaff.avatar_url
          }];
          finalTaskData.assigned_to = user.email;
          finalTaskData.assigned_to_name = creatorStaff.full_name || user.full_name;
          finalTaskData.assigned_to_avatar = creatorStaff.avatar_url;
        }
      }
      
      const newTask = await base44.entities.Task.create({
        ...finalTaskData,
        company_id: myCompany?.id,
        board_id: currentBoard?.id
      });

      if (myCompany?.id && newTask.assignees && newTask.assignees.length > 0) {
        try {
          const assigneeEmails = newTask.assignees.map(a => a.email);
          const assigneeNames = newTask.assignees.map(a => a.name).join(', ');

          for (const assignee of newTask.assignees) {
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: assignee.email,
              title: 'Task Assigned to You',
              message: `"${newTask.name}" assigned by ${user?.full_name || user?.email}`,
              type: 'task_assigned',
              related_entity_type: 'Task',
              related_entity_id: newTask.id,
              link_url: '/tasks',
              is_read: false,
            });

            // Send email notification via Resend
            await base44.functions.invoke('sendTaskEmail', {
              to: assignee.email,
              subject: 'New Task Assigned to You',
              html: `<h2>Task Assignment</h2>
                <p>Hi ${assignee.name},</p>
                <p>You have been assigned a new task by ${user?.full_name || user?.email}:</p>
                <p><strong>Task:</strong> ${newTask.name}</p>
                <p><strong>Description:</strong> ${newTask.description || 'No description provided'}</p>
                <p><strong>Priority:</strong> ${newTask.priority}</p>
                <p><strong>Due Date:</strong> ${newTask.due_date || 'Not set'}</p>
                ${newTask.related_to ? `<p><strong>Related To:</strong> ${newTask.related_to}</p>` : ''}
                <p><a href="${window.location.origin}/tasks">View All Tasks</a></p>`,
              companyName: myCompany.company_name
            });
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'task_assigned',
            companyId: myCompany.id,
            entityType: 'Task',
            entityId: newTask.id,
            entityData: {
              task_name: newTask.name,
              name: newTask.name,
              assigned_to: assigneeNames,
              assigned_to_name: assigneeNames,
              assigned_to_email: assigneeEmails.join(', '),
              created_by: user?.full_name || user?.email,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Failed to send task assignment notifications:', error);
        }
      }

      return newTask;
    },
    onSuccess: async (newTask) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      
      if (myCompany?.id) {
        try {
          await base44.functions.invoke('autoTriggerWorkflowsFromMutation', {
            action: 'create',
            entityType: 'Task',
            entityId: newTask.id,
            entityData: newTask,
            companyId: myCompany.id
          });
          console.log('Workflows triggered for new task:', newTask.id);
        } catch (error) {
          console.error('Workflow trigger failed:', error);
        }

        // Notify all admins about the new task
        try {
          await base44.functions.invoke('universalNotificationDispatcher', {
            action: 'create',
            entityType: 'Task',
            entityId: newTask.id,
            entityData: newTask,
            companyId: myCompany.id
          });
        } catch (error) {
          console.error('Admin task notification failed:', error);
        }
      }
      
      setShowTaskDialog(false);
      setFormData({
        name: "",
        description: "",
        column: "not_started",
        priority: "medium",
        start_date: "",
        due_date: "",
        assigned_to: "",
        assignees: [],
        related_to: "",
        source: "internal",
        tags: [],
        followers: [],
        timesheets: [],
        comments: [],
        checklist_items: [],
        reminders: []
      });
      toast.success('Task created with notifications sent!');
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      console.log('📝 Updating task:', id, data);
      const oldTask = tasks.find(t => t.id === id);
      const updatedTask = await base44.entities.Task.update(id, data);
      console.log('✅ Task updated:', updatedTask);

      if (oldTask && oldTask.column !== data.column && myCompany?.id) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const notifyEmails = [...new Set([oldTask.created_by, ...(myCompany?.created_by ? [myCompany.created_by] : [])])]; 
          
          const oldColumnName = currentBoard?.columns?.find(c => c.id === oldTask.column)?.name || oldTask.column;
          const newColumnName = currentBoard?.columns?.find(c => c.id === data.column)?.name || data.column;
          
          for (const email of notifyEmails) {
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: 'Task Status Changed',
              message: `"${updatedTask.name}" moved from ${oldColumnName} to ${newColumnName}`,
              type: 'task_status_changed',
              related_entity_type: 'Task',
              related_entity_id: id,
              link_url: '/tasks',
              is_read: false,
            });

            // Send email notification via Resend
            await base44.functions.invoke('sendTaskEmail', {
              to: email,
              subject: `Task Status Changed: ${updatedTask.name}`,
              html: `<h2>Task Status Update</h2>
                <p><strong>Task:</strong> ${updatedTask.name}</p>
                <p><strong>Status Changed:</strong> ${oldColumnName} to ${newColumnName}</p>
                ${updatedTask.related_to ? `<p><strong>Related To:</strong> ${updatedTask.related_to}</p>` : ''}
                <p><strong>Updated By:</strong> ${user?.full_name || user?.email}</p>
                <p><a href="${window.location.origin}/tasks">View All Tasks</a></p>`,
              companyName: myCompany.company_name
            });
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'task_status_changed',
            companyId: myCompany.id,
            entityType: 'Task',
            entityId: id,
            entityData: {
              task_name: updatedTask.name || '',
              task_description: updatedTask.description || '',
              old_column: oldTask.column || '',
              new_column: data.column || '',
              assigned_to: updatedTask.assigned_to || '',
              priority: updatedTask.priority || 'medium',
              app_url: window.location.origin || ''
            }
          });

          if (updatedTask.customer_id) {
            try {
              await base44.functions.invoke('sendTaskUpdateToCustomer', {
                taskId: id,
                taskName: updatedTask.name,
                updateText: `Status updated: ${oldColumnName} → ${newColumnName}`,
                updatedBy: user?.full_name || user?.email,
                companyId: myCompany.id,
                companyName: myCompany.company_name,
                appUrl: window.location.origin
              });
            } catch (custErr) {
              console.error('Customer status notification failed (non-critical):', custErr);
            }
          }
        } catch (error) {
          console.error('Workflow trigger failed (non-critical) or notification failed:', error);
        }
      }

      if (data.column === 'job_completed' && oldTask?.column !== 'job_completed' && myCompany?.id) {
        try {
          const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const notifyEmails = new Set();
          
          if (oldTask.created_by) {
            notifyEmails.add(oldTask.created_by);
          }

          if (updatedTask.followers && updatedTask.followers.length > 0) {
            updatedTask.followers.forEach(f => notifyEmails.add(f.email));
          }
          if (myCompany?.created_by) notifyEmails.add(myCompany.created_by);

          for (const email of notifyEmails) {
            await base44.entities.Notification.create({
              company_id: myCompany.id,
              user_email: email,
              title: 'Task Completed',
              message: `"${updatedTask.name}" marked as completed`,
              type: 'task_completed',
              related_entity_type: 'Task',
              related_entity_id: id,
              link_url: '/tasks',
              is_read: false,
            });

            // Send email notification via Resend
            await base44.functions.invoke('sendTaskEmail', {
              to: email,
              subject: `Task Completed: ${updatedTask.name}`,
              html: `<h2>Task Completion</h2>
                <p><strong>Task:</strong> ${updatedTask.name}</p>
                <p><strong>Status:</strong> Marked as completed</p>
                ${updatedTask.related_to ? `<p><strong>Related To:</strong> ${updatedTask.related_to}</p>` : ''}
                <p><strong>Completed By:</strong> ${user?.full_name || user?.email}</p>
                <p><a href="${window.location.origin}/tasks">View All Tasks</a></p>`,
              companyName: myCompany.company_name
            });
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'task_completed',
            companyId: myCompany.id,
            entityType: 'Task',
            entityId: id,
            entityData: {
              task_name: updatedTask.name,
              name: updatedTask.name,
              completed_by: user?.full_name || user?.email,
              app_url: window.location.origin
            }
          });
        } catch (error) {
          console.error('Failed to send task completion notifications:', error);
        }
      }

      return updatedTask;
    },
    onSuccess: (updatedTask) => {
      console.log('🎉 Update mutation success, invalidating queries');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      
      // Update local state
      if (selectedTask?.id === updatedTask.id) {
        setSelectedTask(updatedTask);
        setTaskFiles(updatedTask.files || []);
      }
    },
    onError: (error) => {
      console.error('❌ Task update failed:', error);
      toast.error('Failed to update task: ' + error.message);
    }
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id) => base44.entities.Task.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const updateBoardColumnsMutation = useMutation({
    mutationFn: async ({ boardId, columns }) => {
      return await base44.entities.TaskBoard.update(boardId, { columns });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-boards'] });
      setShowColumnManagerDialog(false);
    },
  });

  const updateBoardMutation = useMutation({
    mutationFn: async ({ boardId, data }) => {
      return await base44.entities.TaskBoard.update(boardId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-boards'] });
    },
  });

  const deleteBoardMutation = useMutation({
    mutationFn: async (boardId) => {
      return await base44.entities.TaskBoard.delete(boardId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-boards'] });
      setShowBoardManagerDialog(false);
      setCurrentBoard(null);
    },
  });

  const mergeTasksMutation = useMutation({
    mutationFn: async ({ taskIds, primaryTaskId }) => {
      return await base44.functions.invoke('mergeTasks', { taskIds, primaryTaskId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setMergingMode(false);
      setSelectedForMerge([]);
      setShowMergeDialog(false);
      toast.success('Tasks merged successfully!');
    },
    onError: (error) => {
      toast.error('Failed to merge tasks: ' + error.message);
    }
  });

  const toggleTaskSelection = (taskId) => {
    if (selectedForMerge.includes(taskId)) {
      setSelectedForMerge(selectedForMerge.filter(id => id !== taskId));
    } else {
      setSelectedForMerge([...selectedForMerge, taskId]);
    }
  };

  const handleMergeClick = () => {
    if (selectedForMerge.length < 2) {
      toast.error('Please select at least 2 tasks to merge');
      return;
    }
    setPrimaryMergeId(selectedForMerge[0]);
    setShowMergeDialog(true);
  };

  const handleConfirmMerge = () => {
    mergeTasksMutation.mutate({
      taskIds: selectedForMerge,
      primaryTaskId: primaryMergeId
    });
  };

  const handleArchiveTask = async (task) => {
    updateTaskMutation.mutate({
      id: task.id,
      data: { 
        ...task, 
        is_archived: true,
        archived_at: new Date().toISOString()
      }
    });
    setShowTaskDetailDialog(false);
    toast.success('Task archived successfully!');
  };

  const handleUnarchiveTask = async (task) => {
    updateTaskMutation.mutate({
      id: task.id,
      data: { 
        ...task, 
        is_archived: false,
        archived_at: null
      }
    });
    toast.success('Task unarchived successfully!');
  };

  const testEmailMutation = useMutation({
    mutationFn: async () => {
      console.log('=== TEST EMAIL START ===');
      console.log('User:', user?.email);
      console.log('Company:', myCompany?.company_name);
      
      const response = await base44.functions.invoke('sendTaskEmail', {
        to: 'stonekevin866@gmail.com',
        subject: 'Resend Email Test - Task Notifications',
        html: '<h2>Test Email</h2><p>This is a test email from CrewCam CRM.</p>',
        companyName: myCompany?.company_name || 'CrewCam'
      });
      
      console.log('Full response object:', response);
      console.log('Response status:', response?.status);
      console.log('Response data:', response?.data);
      
      return response;
    },
    onSuccess: (response) => {
      console.log('=== EMAIL SUCCESS ===', response);
      toast.success('Test email sent to stonekevin866@gmail.com!');
    },
    onError: (error) => {
      console.error('=== EMAIL ERROR ===');
      console.error('Error object:', error);
      console.error('Error response:', error.response);
      console.error('Error response data:', error.response?.data);
      console.error('Error message:', error.message);
      
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
      toast.error('Email failed: ' + errorMsg);
      
      alert('DETAILED ERROR:\n' + JSON.stringify(error.response?.data || error, null, 2));
    }
  });

  const handleTaskSubmit = (e) => {
    e.preventDefault();
    
    const taskData = {
      ...formData,
    };

    if (formData.assignees.length === 0 && formData.assigned_to) {
      const assignedStaff = staffProfiles.find(s => s.user_email === formData.assigned_to);
      if (assignedStaff) {
        taskData.assignees = [{
          email: assignedStaff.user_email,
          name: assignedStaff.full_name,
          avatar: assignedStaff.avatar_url
        }];
        taskData.assigned_to_name = assignedStaff.full_name;
        taskData.assigned_to_avatar = assignedStaff.avatar_url;
      }
    } else if (formData.assignees.length > 0) {
      taskData.assigned_to = formData.assignees[0].email;
      taskData.assigned_to_name = formData.assignees[0].name;
      taskData.assigned_to_avatar = formData.assignees[0].avatar;
    }
    
    createTaskMutation.mutate(taskData);
  };

  const handleDragEnd = (result) => {
    if (!result.destination || !currentBoard) return;

    const taskId = result.draggableId;
    const destinationColumn = result.destination.droppableId;
    const task = tasks.find(t => t.id === taskId);

    if (task && (task.column !== destinationColumn || task.board_id !== currentBoard.id)) {
      // Update column AND ensure board_id is set (adopting orphaned tasks)
      updateTaskMutation.mutate({
        id: taskId,
        data: { 
          ...task, 
          column: destinationColumn,
          board_id: currentBoard.id 
        },
      });
    }
  };

  const handleTaskClick = (task) => {
    // 🔧 Migrate old reminder format to new format
    const migratedReminders = (task.reminders || []).map(reminder => {
      if (typeof reminder.reminder_to === 'string') {
        const staff = staffProfiles.find(s => s.user_email === reminder.reminder_to);
        return {
          ...reminder,
          reminder_to: [{
            email: reminder.reminder_to,
            name: staff?.full_name || reminder.reminder_to
          }]
        };
      }
      return reminder;
    });

    const taskWithDefaults = {
      ...task,
      assignees: task.assignees || [],
      followers: task.followers || [],
      timesheets: task.timesheets || [],
      reminders: migratedReminders,
      comments: task.comments || [],
      checklist_items: task.checklist_items || [],
      files: task.files || []
    };
    
    setSelectedTask(taskWithDefaults);
    setTaskDescription(task.description || "");
    setTaskComments(task.comments || []);
    setChecklistItems(task.checklist_items || []);
    setTaskFiles(task.files || []);
    setShowTimesheetForm(false);
    setShowReminderForm(false);
    setShowTaskDetailDialog(true);
  };

  const handleUpdateTaskField = (field, value) => {
    if (!selectedTask) return;
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { ...selectedTask, [field]: value },
    });
    setSelectedTask({ ...selectedTask, [field]: value });
  };

  const handleToggleAssignee = (staffEmail) => {
    if (!selectedTask) return;
    
    const currentAssignees = selectedTask.assignees || [];
    const staff = staffProfiles.find(s => s.user_email === staffEmail);
    
    let newAssignees;
    const isAssigned = currentAssignees.some(a => a.email === staffEmail);
    
    if (isAssigned) {
      newAssignees = currentAssignees.filter(a => a.email !== staffEmail);
    } else {
      if (!staff) return;
      newAssignees = [...currentAssignees, {
        email: staff.user_email,
        name: staff.full_name,
        avatar: staff.avatar_url
      }];
    }
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { 
        ...selectedTask, 
        assignees: newAssignees,
        assigned_to: newAssignees.length > 0 ? newAssignees[0].email : "",
        assigned_to_name: newAssignees.length > 0 ? newAssignees[0].name : "",
        assigned_to_avatar: newAssignees.length > 0 ? newAssignees[0].avatar : ""
      },
    });
    setSelectedTask(prev => ({ 
      ...prev, 
      assignees: newAssignees,
      assigned_to: newAssignees.length > 0 ? newAssignees[0].email : "",
      assigned_to_name: newAssignees.length > 0 ? newAssignees[0].name : "",
      assigned_to_avatar: newAssignees.length > 0 ? newAssignees[0].avatar : ""
    }));
  };

  const handleToggleFollower = (staffEmail) => {
    if (!selectedTask) return;
    
    const currentFollowers = selectedTask.followers || [];
    const staff = staffProfiles.find(s => s.user_email === staffEmail);
    
    let newFollowers;
    const isFollowing = currentFollowers.some(f => f.email === staffEmail);
    
    if (isFollowing) {
      newFollowers = currentFollowers.filter(f => f.email !== staffEmail);
    } else {
      if (!staff) return;
      newFollowers = [...currentFollowers, {
        email: staff.user_email,
        name: staff.full_name,
        avatar: staff.avatar_url
      }];
    }
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { ...selectedTask, followers: newFollowers },
    });
    setSelectedTask(prev => ({ ...prev, followers: newFollowers }));
  };

  const handleAddTimesheet = () => {
    if (!selectedTask || !timesheetData.member_email || !timesheetData.start_time || !timesheetData.end_time) {
      alert('Please fill in all timesheet fields');
      return;
    }

    const start = new Date(timesheetData.start_time);
    const end = new Date(timesheetData.end_time);
    if (start >= end) {
      alert('End time must be after start time.');
      return;
    }
    const timeSpentMinutes = Math.round((end - start) / 1000 / 60);

    const staff = staffProfiles.find(s => s.user_email === timesheetData.member_email);
    
    const newTimesheet = {
      member_email: timesheetData.member_email,
      member_name: staff?.full_name || timesheetData.member_email,
      start_time: timesheetData.start_time,
      end_time: timesheetData.end_time,
      time_spent_minutes: timeSpentMinutes,
      note: timesheetData.note,
      logged_at: new Date().toISOString()
    };

    const currentTimesheets = selectedTask.timesheets || [];
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { 
        ...selectedTask, 
        timesheets: [...currentTimesheets, newTimesheet]
      },
    });
    
    setSelectedTask(prev => ({ 
      ...prev, 
      timesheets: [...currentTimesheets, newTimesheet]
    }));

    setTimesheetData({ member_email: "", start_time: "", end_time: "", note: "" });
    setShowTimesheetForm(false);
  };

  const handleAddReminder = async () => {
    if (!selectedTask || !reminderData.reminder_date || !reminderData.reminder_to || reminderData.reminder_to.length === 0) {
      alert('Please fill in reminder date and select at least one recipient');
      return;
    }

    if (reminderData.is_recurring && !reminderData.recurrence_frequency) {
      alert('Please select a recurrence frequency');
      return;
    }

    const newReminder = {
      id: Date.now().toString(),
      reminder_date: reminderData.reminder_date,
      reminder_to: reminderData.reminder_to,
      reminder_description: reminderData.reminder_description,
      is_recurring: reminderData.is_recurring,
      recurrence_frequency: reminderData.is_recurring ? reminderData.recurrence_frequency : null,
      next_reminder_date: reminderData.is_recurring ? reminderData.reminder_date : null,
      is_sent: false
    };

    // Migrate old reminders to new format
    const currentReminders = (selectedTask.reminders || []).map(reminder => {
      if (typeof reminder.reminder_to === 'string') {
        const staff = staffProfiles.find(s => s.user_email === reminder.reminder_to);
        return {
          ...reminder,
          reminder_to: [{
            email: reminder.reminder_to,
            name: staff?.full_name || reminder.reminder_to
          }]
        };
      }
      return reminder;
    });
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { 
        ...selectedTask, 
        reminders: [...currentReminders, newReminder]
      },
    });
    
    setSelectedTask(prev => ({ 
      ...prev, 
      reminders: [...currentReminders, newReminder]
    }));

    // Create calendar events if requested
    if (reminderData.add_to_calendar && myCompany) {
      for (const person of reminderData.reminder_to) {
        try {
          await base44.entities.CalendarEvent.create({
            company_id: myCompany.id,
            title: `Reminder: ${selectedTask.name}`,
            description: reminderData.reminder_description || `Task reminder for: ${selectedTask.name}`,
            start_time: reminderData.reminder_date,
            end_time: new Date(new Date(reminderData.reminder_date).getTime() + 30 * 60000).toISOString(),
            assigned_to: person.email,
            event_type: 'reminder',
            status: 'scheduled',
            related_customer: selectedTask.related_to || null,
            send_email_notification: true,
            email_reminder_minutes: [0]
          });
        } catch (error) {
          console.error('Failed to create calendar event:', error);
        }
      }
    }

    setReminderData({ 
      reminder_date: "", 
      reminder_to: [], 
      reminder_description: "",
      is_recurring: false,
      recurrence_frequency: "",
      add_to_calendar: true
    });
    setShowReminderForm(false);
  };

  const handleToggleReminderAssignee = (staffEmail) => {
    const staff = staffProfiles.find(s => s.user_email === staffEmail);
    if (!staff) return;

    const isSelected = reminderData.reminder_to.some(r => r.email === staffEmail);

    let newReminderTo;
    if (isSelected) {
      newReminderTo = reminderData.reminder_to.filter(r => r.email !== staffEmail);
    } else {
      newReminderTo = [...reminderData.reminder_to, {
        email: staff.user_email,
        name: staff.full_name
      }];
    }

    setReminderData(prev => ({ ...prev, reminder_to: newReminderTo }));
  };

  const formatTimeSpent = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const handleSaveDescription = () => {
    if (!selectedTask) return;
    handleUpdateTaskField('description', taskDescription);
    setEditingDescription(false);
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !selectedTask) return;
    
    const commenterStaff = staffProfiles.find(s => s.user_email === user?.email);
    const commenterName = commenterStaff?.full_name || commenterStaff?.name || 
      (user?.full_name !== 'User' ? user?.full_name : null) || user?.email || 'User';
    const comment = {
      id: Date.now().toString(),
      user: commenterName,
      user_email: user?.email,
      avatar: commenterStaff?.avatar_url || user?.profile_image_url,
      text: newComment,
      timestamp: new Date().toISOString()
    };
    
    const updatedComments = [comment, ...taskComments];
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { 
        ...selectedTask, 
        comments: updatedComments
      },
    });
    
    setTaskComments(updatedComments);
    setSelectedTask({ ...selectedTask, comments: updatedComments });
    setNewComment("");

    if (myCompany?.id) {
      try {
        const notifyEmails = new Set();
        
        if (selectedTask.assignees && selectedTask.assignees.length > 0) {
          selectedTask.assignees.forEach(a => {
            if (a.email !== user?.email) notifyEmails.add(a.email);
          });
        }
        
        if (selectedTask.followers && selectedTask.followers.length > 0) {
          selectedTask.followers.forEach(f => {
            if (f.email !== user?.email) notifyEmails.add(f.email);
          });
        }

        const allStaff = await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
        if (myCompany?.created_by && myCompany.created_by !== user?.email) {
          notifyEmails.add(myCompany.created_by);
        }

        for (const email of notifyEmails) {
          await base44.entities.Notification.create({
            company_id: myCompany.id,
            user_email: email,
            title: 'New Comment on Task',
            message: `${user?.full_name || user?.email} commented on "${selectedTask.name}"`,
            type: 'task_comment',
            related_entity_type: 'Task',
            related_entity_id: selectedTask.id,
            link_url: '/tasks',
            is_read: false,
          });

          // Send email notification via Resend
          await base44.functions.invoke('sendTaskEmail', {
            to: email,
            subject: `New Comment: ${selectedTask.name}`,
            html: `<h2>New Task Comment</h2>
              <p><strong>Task:</strong> ${selectedTask.name}</p>
              <p><strong>Comment by:</strong> ${user?.full_name || user?.email}</p>
              <p><strong>Comment:</strong></p>
              <p style="padding: 10px; background: #f3f4f6; border-left: 3px solid #3b82f6;">${comment.text}</p>
              <p><a href="${window.location.origin}/tasks">View Task</a></p>`,
            companyName: myCompany.company_name
          });
        }

        await base44.functions.invoke('triggerWorkflow', {
          triggerType: 'task_comment',
          companyId: myCompany.id,
          entityType: 'Task',
          entityId: selectedTask.id,
          entityData: {
            task_name: selectedTask.name,
            name: selectedTask.name,
            comment_by: user?.full_name || user?.email,
            comment_text: comment.text,
            app_url: window.location.origin
          }
        });

        if (notifyCustomerOnUpdate && selectedTask.customer_id) {
          try {
            await base44.functions.invoke('sendTaskUpdateToCustomer', {
              taskId: selectedTask.id,
              taskName: selectedTask.name,
              updateText: comment.text,
              updatedBy: user?.full_name || user?.email,
              companyId: myCompany.id,
              companyName: myCompany.company_name,
              appUrl: window.location.origin
            });
          } catch (custErr) {
            console.error('Customer notification failed (non-critical):', custErr);
          }
        }
      } catch (error) {
        console.error('Failed to send comment notifications:', error);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistItem.trim() || !selectedTask) return;
    
    const item = {
      id: Date.now().toString(),
      text: newChecklistItem,
      completed: false
    };
    
    const updatedChecklist = [...checklistItems, item];
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { 
        ...selectedTask, 
        checklist_items: updatedChecklist
      },
    });
    
    setChecklistItems(updatedChecklist);
    setSelectedTask({ ...selectedTask, checklist_items: updatedChecklist });
    setNewChecklistItem("");
  };

  const toggleChecklistItem = (id) => {
    if (!selectedTask) return;
    
    const updatedChecklist = checklistItems.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    
    updateTaskMutation.mutate({
      id: selectedTask.id,
      data: { 
        ...selectedTask, 
        checklist_items: updatedChecklist
      },
    });
    
    setChecklistItems(updatedChecklist);
    setSelectedTask({ ...selectedTask, checklist_items: updatedChecklist });
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !selectedTask) return;

    console.log('📎 Starting file upload. Files count:', files.length);
    console.log('📎 Selected task ID:', selectedTask.id);
    console.log('📎 Current files:', selectedTask.files);
    setUploadingFile(true);
    
    try {
      const currentFiles = selectedTask.files || [];
      const uploadedFileInfos = [];

      for (const file of files) {
        console.log('⬆️ Uploading file:', file.name, 'Size:', file.size, 'Type:', file.type);
        
        try {
          const uploadResult = await base44.integrations.Core.UploadFile({ file });
          console.log('✅ File uploaded successfully:', uploadResult);
          
          const fileInfo = {
            id: Date.now().toString() + Math.random().toString(),
            name: file.name,
            url: uploadResult.file_url,
            size: file.size,
            type: file.type,
            uploadedBy: user?.full_name || user?.email,
            uploadedAt: new Date().toISOString()
          };
          uploadedFileInfos.push(fileInfo);

          // 📁 Create Document record for customer/lead files
          if (selectedTask.related_to && myCompany?.id) {
            const customer = customers.find(c => c.name === selectedTask.related_to);
            const lead = leads.find(l => l.name === selectedTask.related_to);
            
            if (customer || lead) {
              await base44.entities.Document.create({
                company_id: myCompany.id,
                document_name: file.name,
                file_url: uploadResult.file_url,
                file_size: file.size,
                file_type: file.type,
                category: 'other',
                related_entity_type: customer ? 'Customer' : 'Lead',
                related_entity_id: customer?.id || lead?.id,
                related_customer: customer?.name,
                uploaded_by: user?.email,
                description: `Uploaded from task: ${selectedTask.name}`
              });
              console.log('✅ Document record created for', customer?.name || lead?.name);
            }
          }
        } catch (uploadError) {
          console.error('❌ Single file upload failed:', file.name, uploadError);
          toast.error(`Failed to upload ${file.name}: ${uploadError.message || 'Unknown error'}`);
          throw uploadError;
        }
      }

      const newFilesArray = [...currentFiles, ...uploadedFileInfos];
      console.log('💾 Saving files array to task. Total files:', newFilesArray.length);

      const updatedTask = await updateTaskMutation.mutateAsync({
        id: selectedTask.id,
        data: {
          ...selectedTask,
          files: newFilesArray
        },
      });

      console.log('✅ Files saved to database!', updatedTask);
      setTaskFiles(newFilesArray);
      setSelectedTask({ ...selectedTask, files: newFilesArray });
      toast.success(`${files.length} file(s) uploaded successfully!`);

    } catch (error) {
      console.error('❌ File upload error - Full error object:', error);
      console.error('❌ Error message:', error?.message);
      console.error('❌ Error response:', error?.response);
      toast.error(`Upload failed: ${error?.response?.data?.error || error?.message || 'Unknown error'}`);
    } finally {
      setUploadingFile(false);
      e.target.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getPriorityColor = (priority) => {
    const colors = {
      'high': 'bg-red-100 text-red-700',
      'medium': 'bg-orange-100 text-orange-700',
      'low': 'bg-blue-100 text-blue-700',
    };
    return colors[priority] || 'bg-gray-100 text-gray-700';
  };

  const addNewColumn = () => {
    const newColumn = {
      id: `col_${Date.now()}`,
      name: "New Column",
      color: "#6366f1"
    };
    setEditingColumns([...editingColumns, newColumn]);
  };

  const updateColumn = (index, field, value) => {
    const updated = [...editingColumns];
    updated[index] = { ...updated[index], [field]: value };
    setEditingColumns(updated);
  };

  const deleteColumn = (index) => {
    const columnId = editingColumns[index].id;
    const tasksInColumn = tasks.filter(t => t.column === columnId && t.board_id === currentBoard?.id);
    
    if (tasksInColumn.length > 0) {
      if (!window.confirm(`This column has ${tasksInColumn.length} task(s). Deleting it will remove the column assignment from those tasks. Continue?`)) {
        return;
      }
    }
    
    setEditingColumns(editingColumns.filter((_, i) => i !== index));
  };

  const saveColumns = () => {
    if (!currentBoard) return;
    updateBoardColumnsMutation.mutate({
      boardId: currentBoard.id,
      columns: editingColumns
    });
  };

  const handleEditBoardName = (board, newName) => {
    if (!newName.trim() || newName === board.name) return;
    updateBoardMutation.mutate({
      boardId: board.id,
      data: { name: newName }
    });
  };

  const handleDeleteBoard = (board) => {
    const boardTasksCount = tasks.filter(t => t.board_id === board.id).length;
    if (boardTasksCount > 0) {
      if (!window.confirm(`This board has ${boardTasksCount} task(s). Deleting it will also delete all associated tasks. Are you sure?`)) {
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to delete the "${board.name}" board?`)) {
        return;
      }
    }
    deleteBoardMutation.mutate(board.id);
  };

  const activeTasks = showArchivedTasks ? tasks : tasks.filter(t => !t.is_archived);
  
  // Include tasks belonging to this board OR orphaned tasks if this is the default board
  const boardTasks = activeTasks.filter(t => {
    if (!currentBoard) return false;
    if (t.board_id === currentBoard.id) return true;
    
    // Show orphans on default board (or first board if no default)
    const isDefaultBoard = currentBoard.is_default || (!boards.some(b => b.is_default) && boards[0]?.id === currentBoard.id);
    if (isDefaultBoard && !t.board_id) return true;
    
    return false;
  }).filter(t => t.column); // Ensure column property exists

  const columns = currentBoard?.columns || [];

  const filteredTasks = boardTasks.filter(task => {
    // Hide completed and lost tasks by default
    if (task.column === 'job_completed' || task.column === 'customer_lost') return false;

    // Column filter from overview cards
    if (selectedColumnFilter && task.column !== selectedColumnFilter) return false;

    // Apply URL filter first
    if (activeFilter) {
      if (activeFilter === 'overdue') {
        if (!task.due_date) return false;
        const dueDate = new Date(task.due_date);
        dueDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dueDate >= today) return false;
      } else if (activeFilter === 'unassigned') {
        if (task.assignees?.length > 0 || task.assigned_to) return false;
      } else if (activeFilter === 'high-priority') {
        if (task.priority !== 'high') return false;
        // Exclude tasks in "customer_lost" column
        if (task.column === 'customer_lost') return false;
      } else if (activeFilter === 'critical') {
        // Critical = overdue OR stuck >5 days
        const isOverdue = task.due_date && new Date(task.due_date) < new Date();
        const criticalColumns = ['not_started', 'in_progress', 'awaiting_payment', 'follow_up_needed', 'awaiting_feedback'];
        const daysSinceUpdate = Math.floor((new Date() - new Date(task.updated_date)) / (1000 * 60 * 60 * 24));
        const isStuck = criticalColumns.includes(task.column) && daysSinceUpdate >= 5;
        if (!isOverdue && !isStuck) return false;
      }
    }

    // Then apply search term
    if (!searchTerm) return true;
    
    const search = searchTerm.toLowerCase();
    
    if (task.name?.toLowerCase().includes(search)) return true;
    if (task.related_to?.toLowerCase().includes(search)) return true;
    if (task.assigned_to_name?.toLowerCase().includes(search)) return true;
    
    if (task.assignees && task.assignees.length > 0) {
      const foundInAssignees = task.assignees.some(assignee => 
        assignee.name?.toLowerCase().includes(search) || 
        assignee.email?.toLowerCase().includes(search)
      );
      if (foundInAssignees) return true;
    }
    
    return false;
  });

  // Auto-scroll to first matching task when searching
  useEffect(() => {
    if (searchTerm && filteredTasks.length > 0 && viewMode === 'kanban') {
      const firstMatchingTask = filteredTasks[0];
      const columnElement = document.getElementById(`kanban-column-${firstMatchingTask.column}`);
      if (columnElement) {
        setTimeout(() => {
          columnElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }, 100);
      }
    }
  }, [searchTerm, filteredTasks.length, viewMode]);

  const getColumnStats = (columnId) => {
    const columnTasks = boardTasks.filter(t => t.column === columnId);
    const myTasks = columnTasks.filter(t => {
      if (t.assignees && t.assignees.length > 0) {
        return t.assignees.some(a => a.email === user?.email);
      }
      return t.assigned_to === user?.email;
    });
    return {
      total: columnTasks.length,
      myTasks: myTasks.length
    };
  };

  const getTaskAssignees = (task) => {
    if (task.assignees && task.assignees.length > 0) {
      return task.assignees;
    }
    if (task.assigned_to) {
      return [{
        email: task.assigned_to,
        name: task.assigned_to_name || task.assigned_to,
        avatar: task.assigned_to_avatar
      }];
    }
    return [];
  };

  const archivedCount = tasks.filter(t => t.is_archived).length;

  const handleFindSubcontractor = async (task) => {
    // Try to get address from related customer/lead
    let address = null;
    let lat = null;
    let lng = null;
    let contactName = null;

    if (task.related_to) {
      const customer = customers.find(c => c.name === task.related_to);
      const lead = leads.find(l => l.name === task.related_to);
      
      if (customer) {
        contactName = customer.name;
        // Build address from components OR use legacy address field
        const components = [customer.street, customer.city, customer.state, customer.zip].filter(Boolean);
        address = components.length > 0 ? components.join(', ') : (customer.address || null);
      } else if (lead) {
        contactName = lead.name;
        // Build address from components OR use legacy address field
        const components = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean);
        address = components.length > 0 ? components.join(', ') : (lead.address || null);
      }
    }

    if (!task.related_to) {
      alert('⚠️ This task is not linked to a Customer/Lead.\n\nPlease set the "Related To" field to a customer or lead name first.');
      return;
    }

    if (!contactName) {
      alert(`⚠️ Customer/Lead "${task.related_to}" not found in your database.\n\nPlease check the spelling or create this customer/lead first.`);
      return;
    }

    if (!address || address.trim() === '') {
      alert(`⚠️ Customer "${contactName}" has no address on file.\n\nPlease add their street address in the customer/lead profile.`);
      return;
    }

    // Geocode address to get coordinates
    if (window.google && window.google.maps && address) {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const location = results[0].geometry.location;
          setJobLocationForSub({
            address,
            latitude: location.lat(),
            longitude: location.lng(),
            taskId: task.id
          });
          setShowSubcontractorFinder(true);
        } else {
          alert('Could not find location for this address. Please update the customer/lead address.');
        }
      });
    } else {
      alert('Google Maps not loaded. Please refresh the page.');
    }
  };

  const handleSubSelected = async (sub) => {
    if (!jobLocationForSub?.taskId) return;

    const task = tasks.find(t => t.id === jobLocationForSub.taskId);
    if (!task) return;

    // Add subcontractor to assignees
    const newAssignee = {
      email: sub.email || sub.id,
      name: sub.name,
      avatar: null
    };

    const updatedAssignees = [...(task.assignees || []), newAssignee];

    await updateTaskMutation.mutateAsync({
      id: task.id,
      data: {
        ...task,
        assignees: updatedAssignees,
        assigned_to: updatedAssignees[0].email,
        assigned_to_name: updatedAssignees[0].name
      }
    });

    toast.success(`${sub.name} assigned to task!`);
    setShowSubcontractorFinder(false);
    setJobLocationForSub(null);
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <style>{`
        .task-detail-fullscreen[data-state="open"] {
          position: fixed !important;
          z-index: 60 !important;
          pointer-events: auto !important;
        }
        @media (max-width: 767px) {
          .task-detail-fullscreen[data-state="open"] {
            width: 100vw !important;
            max-width: 100vw !important;
            height: 100dvh !important;
            max-height: 100dvh !important;
            inset: 0 !important;
            transform: none !important;
            border-radius: 0 !important;
            border: none !important;
          }
        }
        @media (min-width: 768px) {
          .task-detail-fullscreen[data-state="open"] {
            max-width: 72rem !important;
            height: 90vh !important;
            left: 50% !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            border-radius: 0.5rem !important;
          }
        }
      `}</style>
      {/* Header */}
      <div className="bg-gray-800 text-white px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">{t.tasks.title}</h1>
              {activeFilter && (
                <Badge className="bg-orange-500 text-white">
                  {t.common.filter}: {activeFilter === 'high-priority' ? t.tasks.high : activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1)}
                  <button
                    onClick={() => {
                      setActiveFilter(null);
                      navigate(createPageUrl('Tasks'));
                    }}
                    className="ml-2 hover:bg-white/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              )}
            </div>
            <a href="#" className="text-blue-400 text-sm hover:underline">Tasks Overview →</a>
          </div>
          <div className="flex gap-3">
            <Button
              variant={showArchivedTasks ? "default" : "outline"}
              className={showArchivedTasks ? "bg-white text-gray-800" : "border-gray-600 hover:bg-gray-700 bg-transparent text-white"}
              onClick={() => setShowArchivedTasks(!showArchivedTasks)}
            >
              <Archive className="w-4 h-4 mr-2" />
              {showArchivedTasks ? 'Hide Archived' : `Archived (${archivedCount})`}
            </Button>

            <Dialog open={showBoardManagerDialog} onOpenChange={setShowBoardManagerDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-gray-600 hover:bg-gray-700 bg-transparent text-white">
                  <Edit2 className="w-4 h-4 mr-2" />
                  {t.common.edit} Boards
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t.common.edit} Task Boards</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {boards.length === 0 && <p className="text-gray-500 text-sm p-2">No boards found. Create a new one by adding a task.</p>}
                  {boards.map(board => (
                    <div key={board.id} className="flex items-center gap-3 p-3 border rounded-lg bg-gray-50">
                      <Input
                        defaultValue={board.name}
                        onBlur={(e) => handleEditBoardName(board, e.target.value)}
                        className="flex-1"
                      />
                      {board.is_default ? (
                        <Badge className="bg-blue-100 text-blue-700">Default</Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            await updateBoardMutation.mutateAsync({
                              boardId: board.id,
                              data: { is_default: true }
                            });
                            
                            for (const otherBoard of boards) {
                              if (otherBoard.id !== board.id && otherBoard.is_default) {
                                await updateBoardMutation.mutateAsync({
                                  boardId: otherBoard.id,
                                  data: { is_default: false }
                                });
                              }
                            }
                            
                            queryClient.invalidateQueries({ queryKey: ['task-boards'] });
                          }}
                          className="whitespace-nowrap"
                        >
                          Set Default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteBoard(board)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showColumnManagerDialog} onOpenChange={setShowColumnManagerDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-gray-600 hover:bg-gray-700 bg-transparent text-white">
                  <Settings className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl sm:max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle>Manage Board Columns</DialogTitle>
                </DialogHeader>
                
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      Add, edit, or remove columns from your task board
                    </p>
                    <Button onClick={addNewColumn} size="sm">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Column
                    </Button>
                  </div>

                  <DragDropContext onDragEnd={(result) => {
                    if (!result.destination) return;
                    const items = Array.from(editingColumns);
                    const [reordered] = items.splice(result.source.index, 1);
                    items.splice(result.destination.index, 0, reordered);
                    setEditingColumns(items);
                  }}>
                    <Droppable droppableId="columns-list">
                      {(provided) => (
                        <div 
                          {...provided.droppableProps} 
                          ref={provided.innerRef}
                          className="space-y-3 max-h-96 overflow-y-auto"
                        >
                          {editingColumns.length === 0 && <p className="text-gray-500 text-sm p-2">No columns added yet.</p>}
                          {editingColumns.map((col, index) => (
                            <Draggable key={col.id} draggableId={col.id} index={index}>
                              {(provided, snapshot) => (
                                <div 
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`flex gap-3 items-center p-3 border rounded-lg bg-gray-50 ${
                                    snapshot.isDragging ? 'shadow-lg' : ''
                                  }`}
                                >
                                  <div {...provided.dragHandleProps} className="cursor-grab active:cursor-grabbing">
                                    <GripVertical className="w-5 h-5 text-gray-400" />
                                  </div>
                                  <Input
                                    placeholder="Column Name"
                                    value={col.name}
                                    onChange={(e) => updateColumn(index, 'name', e.target.value)}
                                    className="flex-1"
                                  />
                                  <Input
                                    type="color"
                                    value={col.color}
                                    onChange={(e) => updateColumn(index, 'color', e.target.value)}
                                    className="w-20"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => deleteColumn(index)}
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </DragDropContext>

                  <div className="flex justify-end gap-3 pt-4 border-t">
                    <Button 
                      variant="outline" 
                      onClick={() => setShowColumnManagerDialog(false)}
                    >
                      {t.common.cancel}
                    </Button>
                    <Button 
                      onClick={saveColumns}
                      className="bg-blue-600 hover:bg-blue-700"
                      disabled={updateBoardColumnsMutation.isPending}
                    >
                      {updateBoardColumnsMutation.isPending ? t.common.loading : t.common.save}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      {/* Board Tabs */}
      {boards.length > 0 && (
        <div className="bg-white border-b px-6">
          <Tabs value={currentBoard?.id} onValueChange={handleBoardChange}>
            <TabsList className="bg-transparent">
              {boards.map(board => (
                <TabsTrigger 
                  key={board.id} 
                  value={board.id}
                  className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none"
                >
                  {board.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* OVERVIEW CARDS */}
      {currentBoard && (
        <div className="bg-white px-6 py-2 border-b">
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {columns.map(column => {
              const stats = getColumnStats(column.id);
              return (
                <Card 
                  key={column.id} 
                  className={`hover:shadow-md transition-all cursor-pointer border-l-4 shadow-sm min-w-[160px] flex-shrink-0 ${
                    selectedColumnFilter === column.id ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                  }`} 
                  style={{ borderLeftColor: column.color }}
                  onClick={() => {
                    const isClearing = selectedColumnFilter === column.id;
                    setSelectedColumnFilter(isClearing ? null : column.id);
                    
                    if (!isClearing) {
                      setTimeout(() => {
                        const columnElement = document.getElementById(`kanban-column-${column.id}`);
                        if (columnElement) {
                          columnElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                        }
                      }, 100);
                    }
                  }}
                >
                  <CardContent className="p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-gray-700 truncate" title={column.name}>
                        {column.name}
                      </div>
                      <div className="text-lg font-bold text-gray-900">{stats.total}</div>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-500 mt-1">
                      <User className="w-3 h-3" />
                      <span>{t.dashboard.today}: <span className="font-semibold text-gray-700">{stats.myTasks}</span></span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* TOOLBAR */}
      <div className="bg-white border-b px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1">
            <Dialog open={showTaskDialog} onOpenChange={setShowTaskDialog}>
              <DialogTrigger asChild>
                <Button className="bg-gray-800 hover:bg-gray-700 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  {t.tasks.addTask}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{t.tasks.addTask}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleTaskSubmit} className="space-y-4">
                  <div>
                    <Label>{t.tasks.taskTitle} *</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      placeholder={t.tasks.taskTitle}
                      required
                    />
                  </div>
                  
                  <div>
                    <Label>{t.tasks.description} (Customer/Lead)</Label>
                    <Input
                      value={formData.related_to}
                      onChange={(e) => setFormData({...formData, related_to: e.target.value})}
                      placeholder={t.common.name}
                      list="customers-leads-list"
                    />
                    <datalist id="customers-leads-list">
                      {[
                        ...customers.map(c => ({ name: c.name, type: 'Customer' })),
                        ...leads.map(l => ({ name: l.name, type: 'Lead' }))
                      ].map((item, idx) => (
                        <option key={idx} value={item.name}>
                          {item.name} ({item.type})
                        </option>
                      ))}
                    </datalist>
                  </div>

                  {/* 🔥 NEW: Warning for existing tasks */}
                  {existingTasksForDuplicateCheck.length > 0 && (
                    <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <p className="text-xs font-semibold text-yellow-800 mb-2">
                        ⚠️ {existingTasksForDuplicateCheck.length} Open Task{existingTasksForDuplicateCheck.length !== 1 ? 's' : ''} Already Exist:
                      </p>
                      <div className="space-y-1 max-h-24 overflow-y-auto">
                        {existingTasksForDuplicateCheck.map(t => {
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

                  <div>
                    <Label>Source</Label>
                    <Select
                      value={formData.source}
                      onValueChange={(v) => setFormData({...formData, source: v})}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer Request</SelectItem>
                        <SelectItem value="lead">Lead Follow-up</SelectItem>
                        <SelectItem value="project">Project Task</SelectItem>
                        <SelectItem value="estimate">Estimate Follow-up</SelectItem>
                        <SelectItem value="invoice">Invoice Related</SelectItem>
                        <SelectItem value="internal">Internal Task</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>{t.tasks.description}</Label>
                    <Textarea
                      value={formData.description}
                      onChange={(e) => setFormData({...formData, description: e.target.value})}
                      rows={3}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>{t.tasks.status} *</Label>
                      <Select value={formData.column} onValueChange={(v) => setFormData({...formData, column: v})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map(col => (
                            <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t.tasks.priority}</Label>
                      <Select value={formData.priority} onValueChange={(v) => setFormData({...formData, priority: v})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">{t.tasks.low}</SelectItem>
                          <SelectItem value="medium">{t.tasks.medium}</SelectItem>
                          <SelectItem value="high">{t.tasks.high}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{t.tasks.assignedTo}</Label>
                      <Popover open={openAssignees} onOpenChange={setOpenAssignees}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between">
                            <div className="flex -space-x-2 overflow-hidden">
                              {formData.assignees.length > 0 ? (
                                formData.assignees.map((assignee, i) => {
                                  const staff = staffProfiles.find(s => s.user_email === assignee.email);
                                  return staff?.avatar_url ? (
                                    <img 
                                      key={i} 
                                      src={staff.avatar_url} 
                                      alt={staff.full_name} 
                                      className="w-7 h-7 rounded-full border-2 border-white" 
                                    />
                                  ) : (
                                    <div key={i} className="w-7 h-7 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center text-white text-xs font-semibold">
                                      {staff?.full_name?.[0] || assignee.email?.[0] || '?'}
                                    </div>
                                  );
                                })
                              ) : (
                                <span className="text-gray-500">{t.common.select} {t.tasks.assignedTo}...</span>
                              )}
                            </div>
                            <Plus className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                          <Command>
                            <CommandInput placeholder={`${t.common.search} staff...`} />
                            <CommandEmpty>No staff found.</CommandEmpty>
                            <CommandGroup>
                              {staffProfiles.filter(s => s.user_email).map((staff) => {
                                const isAssigned = formData.assignees.some(
                                  (a) => a.email === staff.user_email
                                );
                                return (
                                  <CommandItem
                                    key={staff.user_email}
                                    onSelect={() => {
                                      let newAssignees;
                                      if (isAssigned) {
                                        newAssignees = formData.assignees.filter(a => a.email !== staff.user_email);
                                      } else {
                                        newAssignees = [...formData.assignees, {
                                          email: staff.user_email,
                                          name: staff.full_name,
                                          avatar: staff.avatar_url
                                        }];
                                      }
                                      setFormData(prev => ({
                                        ...prev,
                                        assignees: newAssignees,
                                        assigned_to: newAssignees.length === 1 ? newAssignees[0].email : ""
                                      }));
                                    }}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    {staff.avatar_url ? (
                                      <img src={staff.avatar_url} alt={staff.full_name} className="w-6 h-6 rounded-full" />
                                    ) : (
                                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold">
                                        {staff.full_name?.[0] || '?'}
                                      </div>
                                    )}
                                    <span className="flex-1">{staff.full_name}</span>
                                    <Check className={`ml-auto h-4 w-4 ${isAssigned ? "opacity-100" : "opacity-0"}`} />
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div>
                      <Label>{t.tasks.dueDate}</Label>
                      <Input
                        type="date"
                        value={formData.due_date}
                        onChange={(e) => setFormData({...formData, due_date: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => setShowTaskDialog(false)}>
                      {t.common.cancel}
                    </Button>
                    <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                      {t.tasks.addTask}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <Button
              variant={viewMode === "kanban" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("kanban")}
              className={viewMode === "kanban" ? "bg-gray-800 text-white" : ""}
            >
              <Columns className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("list")}
              className={viewMode === "list" ? "bg-gray-800 text-white" : ""}
            >
              <List className="w-4 h-4" />
            </Button>

            {viewMode === "kanban" && (
              <div className="relative w-64 ml-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder={t.tasks.searchTasks}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="w-4 h-4 mr-2" />
                {t.sidebar.more || "More"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowBoardManagerDialog(true)}>
                <Edit2 className="w-4 h-4 mr-2" />
                {t.common.edit} Boards
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowColumnManagerDialog(true)}>
                <Settings className="w-4 h-4 mr-2" />
                {t.common.edit} Columns
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setMergingMode(!mergingMode);
                setSelectedForMerge([]);
              }}>
                <div className="flex items-center">
                  <GripVertical className="w-4 h-4 mr-2" />
                  {mergingMode ? 'Exit Merge Mode' : 'Merge Tasks'}
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => testEmailMutation.mutate()} disabled={testEmailMutation.isPending}>
                <Mail className="w-4 h-4 mr-2" />
                Test Emails
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* KANBAN VIEW */}
      {viewMode === "kanban" && currentBoard && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="overflow-x-auto p-6">
            <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
              {columns.map((column, colIndex) => {
                // Filter tasks for this column, plus rescue tasks with invalid/unknown columns into the first column
                const columnTasks = filteredTasks.filter(t => {
                  if (t.column === column.id) return true;
                  if (colIndex === 0) {
                    // Check if task's column exists in this board
                    const isValidColumn = columns.some(c => c.id === t.column);
                    // If task has no valid column on this board (e.g. "not_started" default), show in first column
                    return !isValidColumn; 
                  }
                  return false;
                });
                
                return (
                  <div key={column.id} id={`kanban-column-${column.id}`} className="flex-shrink-0" style={{ width: '320px' }}>
                    <div 
                      className="px-4 py-3 rounded-t-lg text-white font-semibold text-sm flex items-center justify-between"
                      style={{ backgroundColor: column.color }}
                    >
                      <span className="truncate">{column.name}</span>
                      <span className="ml-2 bg-white/20 px-2.5 py-0.5 rounded-full text-xs">{columnTasks.length}</span>
                    </div>

                    <Droppable droppableId={column.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`bg-gray-100 rounded-b-lg p-3 overflow-y-auto ${
                            snapshot.isDraggingOver ? 'bg-blue-50' : ''
                          }`}
                          style={{ 
                            minHeight: '120px',
                            maxHeight: 'calc(100vh - 280px)' // Better height management
                          }}
                        >
                          {columnTasks.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8">
                              <div className="w-10 h-10 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center mb-2">
                                <X className="w-5 h-5" />
                              </div>
                              <p className="text-sm">{t.tasks.noTasks}</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {columnTasks.map((task, index) => (
                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      className={`cursor-pointer hover:bg-gray-50 transition-all bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md ${
                                        snapshot.isDragging ? 'shadow-xl ring-2 ring-blue-500 rotate-2' : ''
                                      } ${selectedForMerge.includes(task.id) ? 'ring-2 ring-blue-500 bg-blue-50' : ''}`}
                                      onClick={() => {
                                        if (mergingMode) {
                                          toggleTaskSelection(task.id);
                                        } else {
                                          handleTaskClick(task);
                                        }
                                      }}
                                    >
                                      <div className="p-3 flex items-start gap-3">
                                        {mergingMode ? (
                                          <div className="flex-shrink-0 mt-1">
                                            <input
                                              type="checkbox"
                                              checked={selectedForMerge.includes(task.id)}
                                              onChange={() => toggleTaskSelection(task.id)}
                                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                              onClick={(e) => e.stopPropagation()}
                                            />
                                          </div>
                                        ) : (
                                          <div {...provided.dragHandleProps} className="mt-1 hover:text-gray-600 transition-colors">
                                            <GripVertical className="w-4 h-4 text-gray-300" />
                                          </div>
                                        )}

                                        <div className="flex-1 min-w-0">
                                          <div className="flex justify-between items-start gap-2 mb-1.5">
                                            <h4 className="font-semibold text-gray-800 text-sm leading-tight hover:text-blue-600 transition-colors">
                                              {task.name}
                                            </h4>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                              {task.priority === 'high' && (
                                                <div className="w-2 h-2 rounded-full bg-red-500" title="High Priority"></div>
                                              )}
                                            </div>
                                          </div>
                                          
                                          {task.related_to && (
                                            <div className="text-xs text-gray-500 mb-2 flex items-center gap-1 truncate">
                                              <User className="w-3 h-3" />
                                              {task.related_to}
                                            </div>
                                          )}

                                          {/* Duplicate Warning */}
                                          {duplicateWarningMap[task.related_to] > 1 && (
                                            <div className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 w-fit mb-2" title="This customer has multiple open tasks">
                                              <AlertCircle className="w-3 h-3" />
                                              <span className="font-medium">{duplicateWarningMap[task.related_to]} Open</span>
                                            </div>
                                          )}

                                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                                            <div className="flex items-center gap-2">
                                              <div className="flex -space-x-2 hover:space-x-1 transition-all">
                                                {getTaskAssignees(task).length > 0 ? (
                                                  getTaskAssignees(task).slice(0, 3).map((assignee, i) => (
                                                    assignee.avatar ? (
                                                      <img 
                                                        key={i}
                                                        src={assignee.avatar} 
                                                        alt={assignee.name}
                                                        className="w-6 h-6 rounded-full border-2 border-white ring-1 ring-gray-100"
                                                        title={assignee.name}
                                                      />
                                                    ) : assignee.name ? (
                                                      <div key={i} className="w-6 h-6 rounded-full bg-blue-600 border-2 border-white ring-1 ring-gray-100 flex items-center justify-center text-white text-[10px] font-bold shadow-sm" title={assignee.name}>
                                                        {assignee.name?.[0] || '?'}
                                                      </div>
                                                    ) : null
                                                  ))
                                                ) : (
                                                  <div className="w-6 h-6 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-gray-400">
                                                    <User className="w-3 h-3" />
                                                  </div>
                                                )}
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                              {task.due_date && (
                                                <div className={`flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${
                                                  new Date(task.due_date) < new Date() 
                                                    ? 'text-red-700 bg-red-50' 
                                                    : 'text-gray-600 bg-gray-100'
                                                }`}>
                                                  <Calendar className="w-3 h-3" />
                                                  {format(new Date(task.due_date), 'MMM d')}
                                                </div>
                                              )}

                                              {(task.comments?.length > 0 || task.files?.length > 0) && (
                                                <div className="flex items-center gap-2 text-gray-400 text-[11px]">
                                                  {task.comments?.length > 0 && (
                                                    <span className="flex items-center hover:text-gray-600">
                                                      <MessageSquare className="w-3.5 h-3.5 mr-0.5" />{task.comments.length}
                                                    </span>
                                                  )}
                                                  {task.files?.length > 0 && (
                                                    <span className="flex items-center hover:text-gray-600">
                                                      <Paperclip className="w-3.5 h-3.5 mr-0.5" />{task.files.length}
                                                    </span>
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              
                              {columnTasks.length > 5 && (
                                <button className="w-full py-2 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors bg-gray-100/50 border border-transparent hover:border-gray-200">
                                  {t.dashboard.viewAll} ({columnTasks.length - 5} {t.tasks.title.toLowerCase()})
                                </button>
                              )}
                            </div>
                          )}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>
          </div>
        </DragDropContext>
      )}

      {/* LIST VIEW */}
      {viewMode === "list" && currentBoard && activeFilter && (
        <FilteredTasksList
          tasks={filteredTasks}
          columns={columns}
          staffProfiles={staffProfiles}
          activeFilter={activeFilter}
          onTaskClick={handleTaskClick}
          onUpdateTask={updateTaskMutation.mutate}
          getTaskAssignees={getTaskAssignees}
        />
      )}

      {/* REGULAR LIST VIEW (no filter) */}
      {viewMode === "list" && currentBoard && !activeFilter && (
        <div className="p-6">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div className="flex items-center gap-4">
                  <Select defaultValue="25">
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm">{t.common.export}</Button>
                  <Button variant="outline" size="sm">Bulk {t.common.actions}</Button>
                </div>
                <Input 
                  placeholder={`${t.common.search}...`} 
                  className="w-64" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">#</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">{t.common.name}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">{t.tasks.status}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">{t.tasks.dueDate} / {t.tasks.overdue}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">{t.tasks.assignedTo}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">{t.tasks.priority}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                  <tbody>
                    {filteredTasks.length === 0 ? (
                      <tr>
                        <td colSpan="7" className="px-4 py-12 text-center text-gray-500">
                          {activeFilter ? (
                            <div>
                              <CheckSquare className="w-12 h-12 mx-auto mb-3 text-green-500" />
                              <p className="font-semibold text-lg">{t.common.completed}!</p>
                              <p className="text-sm mt-1">{t.common.noResults} {t.tasks.title.toLowerCase()}</p>
                            </div>
                          ) : (
                            t.tasks.noTasks
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredTasks.map((task, idx) => {
                        const isOverdue = task.due_date && new Date(task.due_date) < new Date();
                        const daysPastDue = task.due_date ? Math.floor((new Date() - new Date(task.due_date)) / (1000 * 60 * 60 * 24)) : 0;
                        
                        return (
                          <tr 
                            key={task.id} 
                            className={`border-b hover:bg-gray-50 cursor-pointer ${isOverdue ? 'bg-red-50' : ''} ${selectedForMerge.includes(task.id) ? 'bg-blue-50' : ''}`}
                            onClick={() => {
                              if (mergingMode) {
                                toggleTaskSelection(task.id);
                              } else {
                                handleTaskClick(task);
                              }
                            }}
                          >
                            <td className="px-4 py-4 text-gray-600">
                              {mergingMode ? (
                                <input
                                  type="checkbox"
                                  checked={selectedForMerge.includes(task.id)}
                                  onChange={() => toggleTaskSelection(task.id)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                idx + 1
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <div className="font-medium text-blue-600 hover:underline">
                                {task.name}
                              </div>
                              {task.related_to && (
                                <div className="text-sm text-gray-500 flex items-center gap-2">
                                  {task.related_to}
                                  {duplicateWarningMap[task.related_to] > 1 && (
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] h-5 px-1.5 gap-1">
                                      <AlertCircle className="w-3 h-3" />
                                      {duplicateWarningMap[task.related_to]} Open
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <Badge 
                                variant="outline" 
                                style={{ 
                                  backgroundColor: columns.find(c => c.id === task.column)?.color + '20',
                                  color: columns.find(c => c.id === task.column)?.color,
                                  borderColor: columns.find(c => c.id === task.column)?.color
                                }}
                              >
                                {columns.find(c => c.id === task.column)?.name}
                              </Badge>
                              </td>
                              <td className="px-4 py-4">
                              {task.due_date ? (
                                <div>
                                  <div className={isOverdue ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                                    {format(new Date(task.due_date), 'MMM d, yyyy')}
                                  </div>
                                  {isOverdue && daysPastDue > 0 && (
                                    <Badge className="bg-red-100 text-red-700 mt-1">
                                      {t.tasks.overdue} {daysPastDue}d
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                              </td>
                            <td className="px-4 py-4">
                              {getTaskAssignees(task).length > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex items-center -space-x-2">
                                    {getTaskAssignees(task).slice(0, 2).map((assignee, i) => (
                                      assignee.avatar ? (
                                        <img key={i} src={assignee.avatar} alt={assignee.name} className="w-8 h-8 rounded-full border-2 border-white" />
                                      ) : assignee.name ? (
                                        <div key={i} className="w-8 h-8 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center text-white text-sm font-semibold">
                                          {assignee.name?.[0] || '?'}
                                        </div>
                                      ) : (
                                        <div key={i} className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                                          <User className="w-4 h-4 text-gray-400" />
                                        </div>
                                      )
                                    ))}
                                  </div>
                                  {getTaskAssignees(task).length > 2 && (
                                    <span className="text-xs text-gray-500">+{getTaskAssignees(task).length - 2}</span>
                                  )}
                                </div>
                              ) : (
                                <Badge variant="outline" className="bg-yellow-100 text-yellow-700">
                                  Unassigned
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <Badge className={getPriorityColor(task.priority)}>
                                {task.priority}
                              </Badge>
                            </td>
                            <td className="px-4 py-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTaskClick(task);
                                }}
                              >
                                <Edit2 className="w-3 h-3 mr-1" />
                                Edit
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ENHANCED TASK DETAIL MODAL */}
      <Dialog open={showTaskDetailDialog} onOpenChange={setShowTaskDetailDialog}>
        <DialogContent className="task-detail-fullscreen p-0 overflow-hidden border-0 [&>button.absolute]:hidden" style={{ pointerEvents: 'auto' }}>
          <div className="flex flex-col md:flex-row h-full overflow-hidden" style={{ pointerEvents: 'auto' }}>
            {/* LEFT SIDE - Main Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
              <div className="flex items-start justify-between mb-4 md:mb-6 sticky top-0 bg-white z-10 pb-2 border-b md:border-0 md:static">
                <div className="flex-1 pr-2 min-w-0">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-2">
                    <h2 className="text-lg md:text-2xl font-bold truncate">{selectedTask?.name}</h2>
                    <Badge 
                      style={{ 
                        backgroundColor: columns.find(c => c.id === selectedTask?.column)?.color,
                        color: 'white'
                      }}
                      className="w-fit"
                    >
                      {columns.find(c => c.id === selectedTask?.column)?.name}
                    </Badge>
                    {selectedTask?.is_archived && (
                      <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 w-fit">
                        Archived
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 text-xs md:text-sm text-gray-500">
                    <span>Created by {selectedTask?.created_by || 'Unknown'}</span>
                    {selectedTask?.related_to && (
                      <>
                        <span className="hidden md:inline">•</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const customer = customers.find(c => c.name === selectedTask.related_to);
                            const lead = leads.find(l => l.name === selectedTask.related_to);
                            
                            if (customer) {
                              setShowTaskDetailDialog(false);
                              setTimeout(() => {
                                navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`);
                              }, 100);
                            } else if (lead) {
                              setShowTaskDetailDialog(false);
                              setTimeout(() => {
                                navigate(createPageUrl('LeadProfile') + `?id=${lead.id}`);
                              }, 100);
                            } else {
                              toast.error('Customer or Lead not found: ' + selectedTask.related_to);
                            }
                          }}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
                        >
                          <LinkIcon className="w-3 h-3 md:w-4 md:h-4" />
                          <span>{selectedTask.related_to}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowTaskDetailDialog(false)}
                  className="flex-shrink-0"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>

              {/* Quick Actions - Mobile Only */}
              <div className="space-y-3 mb-4 md:hidden">
                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.status}</Label>
                  <Select
                    value={selectedTask?.column}
                    onValueChange={(v) => handleUpdateTaskField('column', v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map(col => (
                        <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-gray-500 mb-1">{t.tasks.priority}</Label>
                    <Select
                      value={selectedTask?.priority}
                      onValueChange={(v) => handleUpdateTaskField('priority', v)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t.tasks.low}</SelectItem>
                      <SelectItem value="medium">{t.tasks.medium}</SelectItem>
                      <SelectItem value="high">{t.tasks.high}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.dueDate}</Label>
                  <Input
                    type="date"
                    value={selectedTask?.due_date || ''}
                    onChange={(e) => handleUpdateTaskField('due_date', e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.assignedTo}</Label>
                  <Select
                    value={selectedTask?.related_to || "none"}
                    onValueChange={(v) => handleUpdateTaskField('related_to', v === "none" ? "" : v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.name} (Customer)
                        </SelectItem>
                      ))}
                      {leads.map(l => (
                        <SelectItem key={l.id} value={l.name}>
                          {l.name} (Lead)
                        </SelectItem>
                      ))}
                      {/* Preserve current value if not in list */}
                      {selectedTask?.related_to && 
                       !customers.some(c => c.name === selectedTask.related_to) && 
                       !leads.some(l => l.name === selectedTask.related_to) && (
                        <SelectItem value={selectedTask.related_to}>
                          {selectedTask.related_to} (Unknown)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.assignedTo}</Label>
                  <Select
                    value={selectedTask?.assignees?.[0]?.email || "unassigned"}
                    onValueChange={(v) => {
                      let newAssignees = [];
                      let newAssignedTo = "";
                      if (v && v !== "unassigned") {
                        const staff = staffProfiles.find(s => s.user_email === v);
                        if (staff) {
                          newAssignees = [{ email: staff.user_email, name: staff.full_name, avatar: staff.avatar_url }];
                          newAssignedTo = staff.user_email;
                        }
                      }
                      handleUpdateTaskField('assignees', newAssignees);
                      handleUpdateTaskField('assigned_to', newAssignedTo);
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {staffProfiles.filter(s => s.user_email).map(staff => (
                        <SelectItem key={staff.user_email} value={staff.user_email}>
                          {staff.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Start Date & Time */}
              <div className="mb-4 md:mb-6">
                <Label className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Start Date & Time
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={selectedTask?.start_date || ''}
                    onChange={(e) => handleUpdateTaskField('start_date', e.target.value)}
                    className="flex-1 h-9"
                  />
                  <Input
                    type="time"
                    className="w-24 md:w-32 h-9"
                  />
                </div>
              </div>

              {/* Description */}
              <div className="mb-4 md:mb-6">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-semibold">{t.tasks.description}</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingDescription(!editingDescription)}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
                {editingDescription ? (
                  <div className="space-y-2">
                    <Textarea
                      value={taskDescription}
                      onChange={(e) => setTaskDescription(e.target.value)}
                      rows={3}
                      placeholder="Add description for this task..."
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveDescription}>{t.common.save}</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingDescription(false)}>{t.common.cancel}</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">
                    {taskDescription || 'No description for this task'}
                  </p>
                )}
              </div>

              {/* Checklist Items */}
              <div className="mb-4 md:mb-6">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-sm font-semibold flex items-center gap-2">
                    <CheckSquare className="w-4 h-4" />
                    Checklist Items
                  </Label>
                </div>
                <div className="space-y-2 mb-3">
                  {checklistItems.length === 0 && <p className="text-sm text-gray-500">No checklist items yet.</p>}
                  {checklistItems.map(item => (
                    <div key={item.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => toggleChecklistItem(item.id)}
                        className="w-4 h-4"
                      />
                      <span className={`text-sm ${item.completed ? 'line-through text-gray-400' : ''}`}>
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Add checklist item..."
                    value={newChecklistItem}
                    onChange={(e) => setNewChecklistItem(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddChecklistItem()}
                    className="h-9 text-sm"
                  />
                  <Button onClick={handleAddChecklistItem} size="sm">Add</Button>
                </div>
              </div>

              {/* Comments */}
              <div className="mb-4 md:mb-6">
                <Label className="text-sm font-semibold mb-3 block flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Comments
                </Label>
                <div className="space-y-4 mb-4">
                  {taskComments.length === 0 && <p className="text-sm text-gray-500">No comments yet.</p>}
                  {taskComments.map(comment => {
                    const commenterProfile = comment.user_email 
                      ? staffProfiles.find(s => s.user_email === comment.user_email) 
                      : null;
                    const displayName = commenterProfile?.full_name || commenterProfile?.name || 
                      (comment.user !== 'User' ? comment.user : null) || comment.user_email || 'User';
                    const displayAvatar = comment.avatar || commenterProfile?.avatar_url;
                    return (
                    <div key={comment.id} className="flex gap-3">
                      {displayAvatar ? (
                         <img src={displayAvatar} alt={displayName} className="w-8 h-8 rounded-full flex-shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                          {displayName?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-sm">{displayName}</span>
                          <span className="text-xs text-gray-500">
                            {format(new Date(comment.timestamp), 'MMM d, h:mm a')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.text}</p>
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <Textarea
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    rows={2}
                    className="text-sm"
                    data-testid="input-task-comment"
                  />
                  <Button onClick={handleAddComment} size="sm" data-testid="button-add-comment">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
                {selectedTask?.customer_id && (
                  <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer" data-testid="toggle-notify-customer">
                    <input
                      type="checkbox"
                      checked={notifyCustomerOnUpdate}
                      onChange={(e) => setNotifyCustomerOnUpdate(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <Bell className="w-3 h-3" />
                    Notify customer via email & SMS
                    {selectedTask.customer_name && <span className="font-medium">({selectedTask.customer_name})</span>}
                  </label>
                )}
              </div>

              {/* File Upload - Show on mobile too */}
              <div className="mb-4 md:hidden">
                <h4 className="font-semibold mb-3 flex items-center gap-2 text-sm">
                  <Paperclip className="w-4 h-4" />
                  {t.sidebar.documents || "Attachments"} ({taskFiles.length})
                </h4>
                <div className="border-2 border-dashed rounded-lg p-3 text-center hover:border-blue-500 transition-colors">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload-mobile"
                    disabled={uploadingFile}
                  />
                  <label htmlFor="file-upload-mobile" className={uploadingFile ? 'cursor-wait' : 'cursor-pointer'}>
                    {uploadingFile ? (
                      <Loader2 className="w-6 h-6 mx-auto mb-1 text-blue-500 animate-spin" />
                    ) : (
                      <Upload className="w-6 h-6 mx-auto mb-1 text-gray-400" />
                    )}
                    <p className="text-xs text-gray-600">
                      {uploadingFile ? `${t.common.loading}...` : `Tap to ${t.common.upload.toLowerCase()} ${t.sidebar.documents?.toLowerCase() || 'files'}`}
                    </p>
                  </label>
                </div>
                
                {taskFiles.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {taskFiles.map(file => {
                      const isImage = file.type?.startsWith('image/');
                      const isPDF = file.type === 'application/pdf';
                      
                      return (
                        <div
                          key={file.id}
                          className="group relative border rounded-lg overflow-hidden bg-gray-50 hover:shadow-lg transition-all cursor-pointer"
                          onClick={() => setViewingFile(file)}
                        >
                          {isImage ? (
                            <img 
                              src={file.url} 
                              alt={file.name}
                              className="w-full h-24 object-cover"
                            />
                          ) : isPDF ? (
                            <div className="w-full h-24 bg-red-100 flex items-center justify-center">
                              <FileText className="w-8 h-8 text-red-600" />
                            </div>
                          ) : (
                            <div className="w-full h-24 bg-gray-100 flex items-center justify-center">
                              <FileText className="w-8 h-8 text-gray-400" />
                            </div>
                          )}
                          <div className="p-2">
                            <p className="font-medium text-xs truncate">{file.name}</p>
                            <p className="text-xs text-gray-400">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Archive/Delete Buttons - Mobile */}
              <div className="md:hidden space-y-2">
                {!selectedTask?.is_archived ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleArchiveTask(selectedTask)}
                  >
                    <Archive className="w-4 h-4 mr-2" />
                    Archive Task
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleUnarchiveTask(selectedTask)}
                  >
                    <ArchiveRestore className="w-4 h-4 mr-2" />
                    Unarchive Task
                  </Button>
                )}
                
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    if (window.confirm(t.tasks.deleteConfirm)) {
                      deleteTaskMutation.mutate(selectedTask.id);
                      setShowTaskDetailDialog(false);
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t.common.delete}
                </Button>
              </div>
            </div>

            {/* RIGHT SIDE - Task Info (Hidden on Mobile) */}
            <div className="hidden md:block w-80 border-l bg-gray-50 overflow-y-auto p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {t.tasks.title.slice(0, -1)} {t.common.notes}
              </h3>

              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.status}</Label>
                  <Select
                    value={selectedTask?.column}
                    onValueChange={(v) => handleUpdateTaskField('column', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map(col => (
                        <SelectItem key={col.id} value={col.id}>{col.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.startDate || "Start Date"}</Label>
                  <Input
                    type="date"
                    value={selectedTask?.start_date || ''}
                    onChange={(e) => handleUpdateTaskField('start_date', e.target.value)}
                  />
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.dueDate}</Label>
                  <Input
                    type="date"
                    value={selectedTask?.due_date || ''}
                    onChange={(e) => handleUpdateTaskField('due_date', e.target.value)}
                  />
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.tasks.priority}</Label>
                  <Select
                    value={selectedTask?.priority}
                    onValueChange={(v) => handleUpdateTaskField('priority', v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t.tasks.low}</SelectItem>
                      <SelectItem value="medium">{t.tasks.medium}</SelectItem>
                      <SelectItem value="high">{t.tasks.high}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">Related To</Label>
                  <Select
                    value={selectedTask?.related_to || "none"}
                    onValueChange={(v) => handleUpdateTaskField('related_to', v === "none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t.common.all} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t.common.all}</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.name}>
                          {c.name} ({t.customers.title.slice(0, -1)})
                        </SelectItem>
                      ))}
                      {leads.map(l => (
                        <SelectItem key={l.id} value={l.name}>
                          {l.name} ({t.leads.title.slice(0, -1)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-500">Billable</Label>
                  <Switch />
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1">{t.common.all} logged time</Label>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-sm">
                      {selectedTask?.timesheets ? 
                        formatTimeSpent(selectedTask.timesheets.reduce((sum, t) => sum + (t.time_spent_minutes || 0), 0)) 
                        : '0h 0m'}
                    </span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                    <TagIcon className="w-3 h-3" />
                    Tags
                  </Label>
                  <Input placeholder="Add tags..." />
                </div>
              </div>

              {/* Assignees */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {t.tasks.assignedTo}
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleFindSubcontractor(selectedTask)}
                    className="text-blue-600 border-blue-300 hover:bg-blue-50"
                  >
                    <Wrench className="w-3 h-3 mr-1" />
                    {t.sidebar.subcontractors.slice(0, -1)}
                  </Button>
                </div>
                <Popover open={openAssignees} onOpenChange={setOpenAssignees}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedTask?.assignees && selectedTask.assignees.length > 0
                        ? `${selectedTask.assignees.length} ${t.tasks.assignedTo.toLowerCase()}`
                        : `${t.common.select} staff...`}
                      <User className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0">
                    <Command>
                      <CommandInput placeholder={`${t.common.search} staff...`} />
                      <CommandEmpty>No staff found.</CommandEmpty>
                      <CommandGroup className="max-h-64 overflow-y-auto">
                        {staffProfiles.map((staff) => {
                          const isAssigned = selectedTask?.assignees?.some(
                            (a) => a.email === staff.user_email
                          );
                          return (
                            <CommandItem
                              key={staff.user_email}
                              onSelect={() => handleToggleAssignee(staff.user_email)}
                              className="cursor-pointer"
                            >
                              <div className="flex items-center gap-2 flex-1">
                                {staff.avatar_url ? (
                                  <img
                                    src={staff.avatar_url}
                                    alt={staff.full_name}
                                    className="w-8 h-8 rounded-full"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
                                    {staff.full_name?.[0] || '?'}
                                  </div>
                                )}
                                <span>{staff.full_name}</span>
                              </div>
                              <Check
                                className={`ml-auto h-4 w-4 ${
                                  isAssigned ? "opacity-100" : "opacity-0"
                                }`}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
                
                {selectedTask?.assignees && selectedTask.assignees.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {selectedTask.assignees.map((assignee) => (
                      <div key={assignee.email} className="flex items-center gap-2 p-2 bg-white rounded border">
                        {assignee.avatar ? (
                          <img
                            src={assignee.avatar}
                            alt={assignee.name}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
                            {assignee.name?.[0] || '?'}
                          </div>
                        )}
                        <span className="flex-1 text-sm">{assignee.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleToggleAssignee(assignee.email)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Followers */}
              <div className="mt-6">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  {t.calendar.attendees || "Followers"}
                </h4>
                <Popover open={openFollowers} onOpenChange={setOpenFollowers}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-full justify-between"
                    >
                      {selectedTask?.followers && selectedTask.followers.length > 0
                        ? `${selectedTask.followers.length} following`
                        : `${t.common.add} followers...`}
                      <Users className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0">
                    <Command>
                      <CommandInput placeholder={`${t.common.search} staff...`} />
                      <CommandEmpty>No staff found.</CommandEmpty>
                      <CommandGroup className="max-h-64 overflow-y-auto">
                        {staffProfiles.map((staff) => {
                          const isFollowing = selectedTask?.followers?.some(
                            (f) => f.email === staff.user_email
                          );
                          return (
                            <CommandItem
                              key={staff.user_email}
                              onSelect={() => handleToggleFollower(staff.user_email)}
                              className="cursor-pointer"
                            >
                              <div className="flex items-center gap-2 flex-1">
                                {staff.avatar_url ? (
                                  <img
                                    src={staff.avatar_url}
                                    alt={staff.full_name}
                                    className="w-8 h-8 rounded-full"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-semibold">
                                    {staff.full_name?.[0] || '?'}
                                  </div>
                                )}
                                <span>{staff.full_name}</span>
                              </div>
                              <Check
                                className={`ml-auto h-4 w-4 ${
                                  isFollowing ? "opacity-100" : "opacity-0"
                                }`}
                              />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
                
                {selectedTask?.followers && selectedTask.followers.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {selectedTask.followers.map((follower) => (
                      <div key={follower.email} className="flex items-center gap-2 p-2 bg-white rounded border">
                        {follower.avatar ? (
                          <img
                            src={follower.avatar}
                            alt={follower.name}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-semibold">
                            {follower.name?.[0] || '?'}
                          </div>
                        )}
                        <span className="flex-1 text-sm">{follower.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleToggleFollower(follower.email)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reminders */}
              <div className="mt-6">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Bell className="w-4 h-4" />
                  {t.sidebar.reminders || "Reminders"}
                </h4>
                
                {selectedTask?.reminders && selectedTask.reminders.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {selectedTask.reminders.map((reminder, idx) => (
                      <div key={reminder.id || idx} className="p-2 bg-white rounded border text-xs">
                        <div className="font-medium">{format(new Date(reminder.reminder_date), 'MMM d, yyyy h:mm a')}</div>
                        <div className="text-gray-600">
                          To: {Array.isArray(reminder.reminder_to) 
                            ? reminder.reminder_to.map(r => r.name).join(', ')
                            : (staffProfiles.find(s => s.user_email === reminder.reminder_to)?.full_name || reminder.reminder_to)}
                        </div>
                        {reminder.is_recurring && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            {reminder.recurrence_frequency?.replace(/_/g, ' ')}
                          </Badge>
                        )}
                        {reminder.reminder_description && (
                          <div className="text-gray-500 mt-1">{reminder.reminder_description}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!showReminderForm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowReminderForm(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t.common.add} {t.calendar.reminder.toLowerCase()}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Input
                      type="datetime-local"
                      value={reminderData.reminder_date}
                      onChange={(e) => setReminderData({...reminderData, reminder_date: e.target.value})}
                      placeholder={`${t.calendar.reminder} ${t.common.date.toLowerCase()}`}
                      className="text-xs"
                    />
                    
                    <Popover open={openReminderAssignees} onOpenChange={setOpenReminderAssignees}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-between text-xs"
                        >
                          {reminderData.reminder_to.length > 0
                            ? `${reminderData.reminder_to.length} selected`
                            : `${t.common.select} recipients...`}
                          <Users className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[260px] p-0">
                        <Command>
                          <CommandInput placeholder={`${t.common.search} staff...`} />
                          <CommandEmpty>No staff found.</CommandEmpty>
                          <CommandGroup className="max-h-48 overflow-y-auto">
                            {staffProfiles.map((staff) => {
                              const isSelected = reminderData.reminder_to.some(r => r.email === staff.user_email);
                              return (
                                <CommandItem
                                  key={staff.user_email}
                                  onSelect={() => handleToggleReminderAssignee(staff.user_email)}
                                  className="cursor-pointer text-xs"
                                >
                                  <div className="flex items-center gap-2 flex-1">
                                    {staff.avatar_url ? (
                                      <img src={staff.avatar_url} alt={staff.full_name} className="w-6 h-6 rounded-full" />
                                    ) : (
                                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-semibold">
                                        {staff.full_name?.[0] || '?'}
                                      </div>
                                    )}
                                    <span>{staff.full_name}</span>
                                  </div>
                                  <Check className={`ml-auto h-3 w-3 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {reminderData.reminder_to.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {reminderData.reminder_to.map(person => (
                          <Badge key={person.email} variant="secondary" className="text-xs">
                            {person.name}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <Input
                      value={reminderData.reminder_description}
                      onChange={(e) => setReminderData({...reminderData, reminder_description: e.target.value})}
                      placeholder={`${t.calendar.reminder} ${t.common.notes.toLowerCase()} (${t.common.optional.toLowerCase()})`}
                      className="text-xs"
                    />

                    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded border">
                      <input
                        type="checkbox"
                        id="is-recurring"
                        checked={reminderData.is_recurring}
                        onChange={(e) => setReminderData({...reminderData, is_recurring: e.target.checked})}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="is-recurring" className="text-xs cursor-pointer">
                        Recurring {t.calendar.reminder.toLowerCase()}
                      </Label>
                    </div>

                    {reminderData.is_recurring && (
                      <Select
                        value={reminderData.recurrence_frequency}
                        onValueChange={(v) => setReminderData({...reminderData, recurrence_frequency: v})}
                      >
                        <SelectTrigger className="text-xs">
                          <SelectValue placeholder={`${t.common.select} frequency`} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Every Day</SelectItem>
                          <SelectItem value="every_3_days">Every 3 Days</SelectItem>
                          <SelectItem value="weekly">Every Week</SelectItem>
                          <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                          <SelectItem value="monthly">Every Month</SelectItem>
                        </SelectContent>
                      </Select>
                    )}

                    <div className="flex items-center gap-2 p-2 bg-blue-50 rounded border border-blue-200">
                      <input
                        type="checkbox"
                        id="add-to-calendar"
                        checked={reminderData.add_to_calendar}
                        onChange={(e) => setReminderData({...reminderData, add_to_calendar: e.target.checked})}
                        className="w-4 h-4"
                      />
                      <Label htmlFor="add-to-calendar" className="text-xs cursor-pointer">
                        {t.common.add} to {t.calendar.title}
                      </Label>
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAddReminder} className="flex-1">{t.common.save}</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowReminderForm(false)} className="flex-1">{t.common.cancel}</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Timesheet */}
              <div className="mt-6">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  {t.sidebar.dailyReports || "Timesheet"}
                </h4>
                
                {selectedTask?.timesheets && selectedTask.timesheets.length > 0 ? (
                  <div className="mb-3">
                    <div className="text-xs font-semibold text-gray-700 mb-2">Time Entries:</div>
                    <div className="space-y-2">
                      {selectedTask.timesheets.map((entry, idx) => (
                        <div key={idx} className="p-2 bg-white rounded border text-xs">
                          <div className="font-medium">{entry.member_name}</div>
                          <div className="text-gray-600">
                            {format(new Date(entry.start_time), 'MMM d, h:mm a')} - {format(new Date(entry.end_time), 'h:mm a')}
                          </div>
                          <div className="text-blue-600 font-semibold">{formatTimeSpent(entry.time_spent_minutes)}</div>
                          {entry.note && <div className="text-gray-500 mt-1">{entry.note}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 mb-3">{t.common.noResults} time logged yet.</p>
                )}

                {!showTimesheetForm ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setShowTimesheetForm(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t.common.add} {t.sidebar.dailyReports?.slice(0, -1) || "Time Entry"}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Select
                      value={timesheetData.member_email}
                      onValueChange={(v) => setTimesheetData({...timesheetData, member_email: v})}
                    >
                      <SelectTrigger className="text-xs">
                        <SelectValue placeholder={`${t.common.select} member`} />
                      </SelectTrigger>
                      <SelectContent>
                        {staffProfiles.filter(s => s.user_email).map(staff => (
                          <SelectItem key={staff.user_email} value={staff.user_email}>
                            {staff.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="datetime-local"
                      value={timesheetData.start_time}
                      onChange={(e) => setTimesheetData({...timesheetData, start_time: e.target.value})}
                      placeholder={`${t.calendar.startTime || "Start time"}`}
                      className="text-xs"
                    />
                    <Input
                      type="datetime-local"
                      value={timesheetData.end_time}
                      onChange={(e) => setTimesheetData({...timesheetData, end_time: e.target.value})}
                      placeholder={`${t.calendar.endTime || "End time"}`}
                      className="text-xs"
                    />
                    <Textarea
                      value={timesheetData.note}
                      onChange={(e) => setTimesheetData({...timesheetData, note: e.target.value})}
                      placeholder={`${t.common.notes} (${t.common.optional.toLowerCase()})`}
                      rows={2}
                      className="text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleAddTimesheet} className="flex-1">{t.common.save}</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowTimesheetForm(false)} className="flex-1">{t.common.cancel}</Button>
                    </div>
                  </div>
                )}
              </div>

              {/* File Upload */}
              <div className="mt-6">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Paperclip className="w-4 h-4" />
                  Attachments ({taskFiles.length})
                </h4>
                <div className="border-2 border-dashed rounded-lg p-4 text-center hover:border-blue-500 transition-colors">
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                    disabled={uploadingFile}
                  />
                  <label htmlFor="file-upload" className={uploadingFile ? 'cursor-wait' : 'cursor-pointer'}>
                    {uploadingFile ? (
                      <Loader2 className="w-8 h-8 mx-auto mb-2 text-blue-500 animate-spin" />
                    ) : (
                      <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    )}
                    <p className="text-sm text-gray-600">
                      {uploadingFile ? 'Uploading files...' : 'Drop files here to upload'}
                    </p>
                  </label>
                </div>
                
                {taskFiles.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {taskFiles.map(file => {
                      const isImage = file.type?.startsWith('image/');
                      const isPDF = file.type === 'application/pdf';
                      
                      return (
                        <div
                          key={file.id}
                          className="group relative border rounded-lg overflow-hidden bg-gray-50 hover:shadow-lg transition-all cursor-pointer"
                          onClick={() => setViewingFile(file)}
                        >
                          {isImage ? (
                            <img 
                              src={file.url} 
                              alt={file.name}
                              className="w-full h-32 object-cover"
                            />
                          ) : isPDF ? (
                            <div className="w-full h-32 bg-red-100 flex items-center justify-center">
                              <FileText className="w-10 h-10 text-red-600" />
                            </div>
                          ) : (
                            <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                              <FileText className="w-10 h-10 text-gray-400" />
                            </div>
                          )}
                          <div className="p-2">
                            <p className="font-medium text-xs truncate">{file.name}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {formatFileSize(file.size)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Archive/Delete Buttons */}
              <div className="mt-6 space-y-2">
                {!selectedTask?.is_archived ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleArchiveTask(selectedTask)}
                  >
                    <Archive className="w-4 h-4 mr-2" />
                    Archive Task
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleUnarchiveTask(selectedTask)}
                  >
                    <ArchiveRestore className="w-4 h-4 mr-2" />
                    Unarchive Task
                  </Button>
                )}
                
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    if (window.confirm(t.tasks.deleteConfirm)) {
                      deleteTaskMutation.mutate(selectedTask.id);
                      setShowTaskDetailDialog(false);
                    }
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t.common.delete}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* File Viewer Dialog */}
      {viewingFile && (
        <Dialog open={!!viewingFile} onOpenChange={() => setViewingFile(null)}>
          <DialogContent className="sm:max-w-4xl sm:max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>{viewingFile.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = viewingFile.url;
                    a.download = viewingFile.name;
                    a.click();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </DialogTitle>
            </DialogHeader>
            <div className="pt-4">
              {viewingFile.type?.startsWith('image/') ? (
                <img 
                  src={viewingFile.url} 
                  alt={viewingFile.name}
                  className="w-full h-auto rounded-lg"
                />
              ) : viewingFile.type === 'application/pdf' ? (
                <iframe 
                  src={viewingFile.url} 
                  className="w-full h-[600px] rounded-lg border"
                  title={viewingFile.name}
                />
              ) : (
                <div className="text-center py-12">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-600 mb-4">Preview not available for this file type</p>
                  <Button onClick={() => {
                    const a = document.createElement('a');
                    a.href = viewingFile.url;
                    a.download = viewingFile.name;
                    a.click();
                  }}>
                    <Download className="w-4 h-4 mr-2" />
                    Download File
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {boards.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No task boards found. Please create one in settings.</p>
        </div>
      )}

      {/* Merge Action Bar */}
      {mergingMode && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white shadow-2xl border rounded-full px-6 py-3 flex items-center gap-4 z-50">
          <span className="font-semibold text-sm">{selectedForMerge.length} tasks selected</span>
          <div className="h-4 w-px bg-gray-300"></div>
          <Button 
            size="sm" 
            variant="ghost" 
            onClick={() => {
              setMergingMode(false);
              setSelectedForMerge([]);
            }}
          >
            Cancel
          </Button>
          <Button 
            size="sm" 
            className="bg-blue-600 hover:bg-blue-700 rounded-full"
            disabled={selectedForMerge.length < 2}
            onClick={handleMergeClick}
          >
            Merge Selected
          </Button>
        </div>
      )}

      {/* Merge Dialog */}
      <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge {t.tasks.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select the primary {t.tasks.title.slice(0, -1).toLowerCase()} to keep. {t.tasks.description}, comments, and {t.sidebar.documents?.toLowerCase() || 'files'} from other {t.tasks.title.toLowerCase()} will be merged into this one.
            </p>
            
            <div className="space-y-2">
              {tasks.filter(t => selectedForMerge.includes(t.id)).map(task => (
                <div 
                  key={task.id}
                  className={`p-3 border rounded-lg cursor-pointer flex items-center gap-3 ${
                    primaryMergeId === task.id ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setPrimaryMergeId(task.id)}
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                    primaryMergeId === task.id ? 'border-blue-600 bg-blue-600' : 'border-gray-400'
                  }`}>
                    {primaryMergeId === task.id && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{task.name}</div>
                    <div className="text-xs text-gray-500">
                      Created by {task.created_by} • {format(new Date(task.created_date || new Date()), 'MMM d')}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setShowMergeDialog(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleConfirmMerge}
                disabled={!primaryMergeId || mergeTasksMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {mergeTasksMutation.isPending ? 'Merging...' : 'Confirm Merge'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <SubcontractorFinder
        open={showSubcontractorFinder}
        onOpenChange={setShowSubcontractorFinder}
        jobAddress={jobLocationForSub?.address}
        jobLatitude={jobLocationForSub?.latitude}
        jobLongitude={jobLocationForSub?.longitude}
        requiredSpecialty={null}
        companyId={myCompany?.id}
        onSubcontractorSelected={handleSubSelected}
      />
    </div>
  );
}