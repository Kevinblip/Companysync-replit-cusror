import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Mail, Phone, MessageCircle, Eye, Edit, Trash2, Download, RefreshCw, Calendar, Columns3, TrendingUp, TrendingDown, Minus, Flame, Snowflake, ThermometerSun, Trophy, UserPlus, Camera, AlertCircle, FileText, Sparkles, CheckCircle2, Filter, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import Dialer from "../components/communication/Dialer";
import EmailDialog from "../components/communication/EmailDialog";
import SMSDialog from "../components/communication/SMSDialog";
import { useNavigate, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import LeadLeaderboard from "../components/leads/LeadLeaderboard";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import QuickTaskDialog from "@/components/tasks/QuickTaskDialog";
import { toast } from 'sonner';
import { useRoleBasedData } from "../components/hooks/useRoleBasedData";
import { useImpersonationGuard } from "../components/hooks/useImpersonationGuard";
import { TablePageSkeleton } from "@/components/PageSkeleton";
import SwipeableCard from "../components/SwipeableCard";
import { MapPin } from "lucide-react";
import useTranslation from "@/hooks/useTranslation";
import LeadFormFields from "@/components/shared/LeadFormFields";
import LeadCleanupDialog from "@/components/shared/LeadCleanupDialog";
import LeadDetailDialog from "@/components/shared/LeadDetailDialog";

export default function Leads() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [showDialog, setShowDialog] = useState(false);
  const [isLeadSheetOpen, setIsLeadSheetOpen] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [viewingLead, setViewingLead] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);
  const [selectedLeads, setSelectedLeads] = useState([]);
  const [quickFilter, setQuickFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    phone_2: "",
    company: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    status: "new",
    source: "manual",
    lead_source: "",
    referred_by: "",
    value: 0,
    is_active: true,
    notes: "",
    last_contact_date: "",
    next_follow_up_date: "",
    assigned_to: "",
    assigned_to_users: []
  });
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [scoreFilter, setScoreFilter] = useState("all");
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [sortBy, setSortBy] = useState('created_date'); // 🔥 CHANGED: Default to newest first instead of score
  const [sortOrder, setSortOrder] = useState('desc');
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [taskRelatedLead, setTaskRelatedLead] = useState(null);
  const [showCleanupDialog, setShowCleanupDialog] = useState(false);
  const [pendingLeadData, setPendingLeadData] = useState(null);
  const [duplicateConfirmInfo, setDuplicateConfirmInfo] = useState(null);
  const [taskForm, setTaskForm] = useState({
    name: "",
    description: "",
    priority: "medium",
    due_date: "",
    assigned_to: "",
    status: "not_started"
  });


  const [visibleColumns, setVisibleColumns] = useState({
    id: false,
    company: false,
    name: true,
    email: true,
    phone: true,
    phone_2: false,
    address: true,
    source: true,
    tags: true,
    assigned: true,
    status: true,
    value: true,
    last_contact: false,
    next_follow_up: true,
    active: false,
    date_created: false,
  });

  const toggleColumn = (column) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const queryClient = useQueryClient();

  // 🔐 Use centralized role-based data hook
  const { 
    user, 
    myCompany: myCompanyData, 
    myStaffProfile,
    filterLeads,
    hasPermission,
    isAdmin,
    isDataLoading: isRoleDataLoading
  } = useRoleBasedData();

  const { isImpersonating, guardAction } = useImpersonationGuard();

  // Load STAFF profiles for THIS company
  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompanyData?.id],
    queryFn: () => myCompanyData?.id ? base44.entities.StaffProfile.filter({ company_id: myCompanyData.id }, "-created_date", 1000) : [],
    initialData: [],
    enabled: !!user && !!myCompanyData?.id,
  });

  // 🔥 NEW: Check if current user is a sales rep (should auto-assign leads to themselves)
  const isSalesRep = React.useMemo(() => {
    if (!myStaffProfile) return false;
    
    // Consider someone a sales rep if they have commission_rate set, 
    // or if their role includes "sales", "rep", "closer", etc.
    const hasCommission = (myStaffProfile.commission_rate || 0) > 0;
    const roleName = (myStaffProfile.role_name || '').toLowerCase();
    const isSalesRole = roleName.includes('sales') || 
                        roleName.includes('rep') || 
                        roleName.includes('closer') ||
                        roleName.includes('lead gen');
    
    return hasCommission || isSalesRole;
  }, [myStaffProfile]);

  const safeFormatDate = (dateValue, formatString = 'MMM d, yyyy') => {
    if (!dateValue) return '-';
    try {
      const date = new Date(dateValue);
      if (isNaN(date.getTime())) return '-';
      return format(date, formatString);
    } catch (e) {
      console.error("Error formatting date:", e, "Value:", dateValue);
      return '-';
    }
  };

  // 🔐 Use role-based data to fetch leads for the correct company context (handles impersonation)
  const { data: allLeads = [], isLoading: isLoadingLeads } = useQuery({
    queryKey: ['leads', myCompanyData?.id],
    queryFn: () => myCompanyData?.id ? base44.entities.Lead.filter({ company_id: myCompanyData.id }, "-created_date", 10000) : [],
    initialData: [],
    enabled: !!myCompanyData?.id
  });

  // 🔐 Filter leads based on role permissions using the hook
  const leads = React.useMemo(() => {
    if (typeof filterLeads !== 'function') return [];
    return filterLeads(allLeads) || [];
  }, [allLeads, filterLeads]);

  // Count leads missing company_id (across all leads, not just filtered ones)
  const leadsWithoutCompany = allLeads.filter(l => !l.company_id).length;

  // 🆕 Backfill mutation
  const backfillCompanyIdMutation = useMutation({
    mutationFn: async () => {
      const result = await base44.functions.invoke('backfillLeadCompanyIds', {});
      return result.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success(`✅ Fixed ${data.updated} leads! Refresh page to see them.`);
      setTimeout(() => window.location.reload(), 1500); // Reload to reflect changes, as filters might hide them
    },
    onError: (error) => {
      toast.error('Failed to fix leads: ' + error.message);
    }
  });

  const { data: duplicateWarningsData = [] } = useQuery({
    queryKey: ['lead-customer-duplicates', myCompanyData?.id],
    queryFn: async () => {
      if (!myCompanyData?.id) return [];
      const res = await base44.functions.invoke('findLeadCustomerDuplicates', { company_id: myCompanyData.id });
      return res.data.warnings || [];
    },
    enabled: !!myCompanyData?.id,
    initialData: []
  });

  const emptyLeads = leads.filter(l => 
    (!l.name || l.name.trim() === '') && 
    (!l.email || l.email.trim() === '') && 
    (!l.phone || l.phone.trim() === '')
  );

  // Detect duplicate leads within Leads (keep newest by created_date)
  const duplicateLeadsToDelete = React.useMemo(() => {
    const groups = {};
    (allLeads || []).forEach(l => {
      const phoneKey = (l.phone || '').replace(/\D/g, '').slice(-10);
      const emailKey = (l.email || '').toLowerCase();
      const key = l.ghl_contact_id || emailKey || phoneKey;
      if (!key) return; // skip records without identifiers
      if (!groups[key]) groups[key] = [];
      groups[key].push(l);
    });
    const dups = [];
    Object.values(groups).forEach(group => {
      if (group.length <= 1) return;
      group.sort((a,b) => new Date(b.created_date) - new Date(a.created_date));
      dups.push(...group.slice(1)); // delete all but newest
    });
    return dups;
  }, [allLeads]);

  const cleanupEmptyLeadsMutation = useMutation({
    mutationFn: async () => {
      let count = 0;
      for (const lead of emptyLeads) {
        await base44.entities.Lead.delete(lead.id);
        count++;
      }
      return count;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      toast.success(`Deleted ${count} empty leads`);
    }
  });

  const deleteDuplicateLeadsMutation = useMutation({
    mutationFn: async () => {
      let succeeded = 0;
      let failed = 0;
      for (const lead of duplicateLeadsToDelete) {
        try {
          await base44.entities.Lead.delete(lead.id);
          succeeded++;
        } catch (e) {
          // Fallback: fix company_id first, then retry delete (handles context mismatch)
          try {
            if (myCompanyData?.id) {
              await base44.entities.Lead.update(lead.id, { company_id: myCompanyData.id });
            }
            await base44.entities.Lead.delete(lead.id);
            succeeded++;
          } catch (e2) {
            failed++;
            console.error('Delete duplicate failed after fallback', lead.id, e2);
          }
        }
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', myCompanyData?.id] });
      queryClient.invalidateQueries({ queryKey: ['lead-customer-duplicates'] });
      if (failed > 0) {
        toast.warning(`Deleted ${succeeded} duplicate lead${succeeded === 1 ? '' : 's'}, ${failed} could not be deleted`);
      } else {
        toast.success(`Deleted ${succeeded} duplicate lead${succeeded === 1 ? '' : 's'}`);
      }
    }
  });

  const resolveDuplicatesMutation = useMutation({
    mutationFn: async () => {
      let succeeded = 0;
      let failed = 0;
      for (const warning of duplicateWarningsData) {
        try {
          await base44.entities.Lead.delete(warning.leadId);
          succeeded++;
        } catch (e) {
          // Fallback: fix company_id first, then retry delete
          try {
            if (myCompanyData?.id) {
              await base44.entities.Lead.update(warning.leadId, { company_id: myCompanyData.id });
            }
            await base44.entities.Lead.delete(warning.leadId);
            succeeded++;
          } catch (e2) {
            failed++;
            console.error('Failed to delete duplicate lead after fallback', warning.leadId, e2);
          }
        }
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['leads', myCompanyData?.id] });
      queryClient.invalidateQueries({ queryKey: ['lead-customer-duplicates'] });
      if (failed > 0) {
        toast.warning(`Deleted ${succeeded} duplicate lead${succeeded === 1 ? '' : 's'}, ${failed} could not be deleted`);
      } else {
        toast.success(`Deleted ${succeeded} duplicate lead${succeeded === 1 ? '' : 's'}`);
      }
    }
  });

  const { data: communications = [] } = useQuery({
    queryKey: ['communications', myCompanyData?.id],
    queryFn: () => myCompanyData?.id ? base44.entities.Communication.filter({ company_id: myCompanyData.id }, "-created_date", 1000) : [],
    initialData: [],
    enabled: !!myCompanyData?.id
  });

  const { data: calendarEvents = [] } = useQuery({
    queryKey: ['calendar-events', myCompanyData?.id],
    queryFn: () => myCompanyData?.id ? base44.entities.CalendarEvent.filter({ company_id: myCompanyData.id }, "-start_time", 1000) : [],
    initialData: [],
    enabled: !!myCompanyData?.id
  });

  const { data: leadScores = [] } = useQuery({
    queryKey: ['lead-scores', myCompanyData?.id],
    queryFn: () => myCompanyData?.id ? base44.entities.LeadScore.filter({ company_id: myCompanyData.id }, "-total_score") : [],
    initialData: [],
    enabled: !!myCompanyData?.id
  });

  const { data: inspections = [] } = useQuery({
    queryKey: ['lead-inspections', myCompanyData?.id],
    queryFn: () => myCompanyData?.id ? base44.entities.InspectionJob.filter({ company_id: myCompanyData.id, related_lead_id: { $ne: null } }) : [],
    initialData: [],
    enabled: !!myCompanyData?.id
  });



  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const viewLeadId = urlParams.get('view_lead_id');

    if (viewLeadId && leads.length > 0) {
      const leadToView = leads.find(l => l.id === viewLeadId);
      if (leadToView) {
        setViewingLead(getLeadWithContactInfo(leadToView));
        const newUrl = window.location.pathname;
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, [leads, location.search]);

  // 🔔 Real-time subscription for leads
  useEffect(() => {
    const unsubscribe = base44.entities.Lead.subscribe((event) => {
      // Invalidate leads query to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-customer-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['lead-scores'] });
    });
    return () => unsubscribe();
  }, [queryClient]);


  const createLeadMutation = useMutation({
    onMutate: async (leadData) => {
      await queryClient.cancelQueries({ queryKey: ['leads'] });
      const previousLeads = queryClient.getQueryData(['leads']);
      
      const optimisticLead = {
        ...leadData,
        id: 'temp-' + Date.now(),
        created_date: new Date().toISOString(),
        company_id: myCompanyData?.id,
        assigned_to: leadData.assigned_to_users?.[0] || "",
        // Add minimal required fields for display
        status: leadData.status || 'new',
        source: leadData.source || 'manual',
        is_active: true,
        value: leadData.value || 0
      };

      queryClient.setQueryData(['leads'], (old) => {
        return [optimisticLead, ...(old || [])];
      });

      setShowDialog(false);
      
      return { previousLeads };
    },
    onError: (err, newLead, context) => {
      queryClient.setQueryData(['leads'], context.previousLeads);
      toast.error('Failed to create lead: ' + err.message);
    },
    mutationFn: async (leadData) => {
      const dataToSend = {
        ...leadData,
        company_id: myCompanyData?.id,
        assigned_to: leadData.assigned_to_users?.[0] || ""
      };
      const newLead = await base44.entities.Lead.create(dataToSend);

      // 🔥 FIX: ALWAYS send notifications - even for unassigned leads!
      if (myCompanyData?.id) {
        try {
          const staffProfilesData = await base44.entities.StaffProfile.filter({ company_id: myCompanyData.id });
          const recipients = new Set(); // Use Set to avoid duplicates

          // 1️⃣ ALWAYS notify the person who CREATED the lead
          recipients.add(user?.email);

          // 2️⃣ Notify ALL assignees (if any)
          if (newLead.assigned_to_users && newLead.assigned_to_users.length > 0) {
            newLead.assigned_to_users.forEach(email => recipients.add(email));
          }

          if (myCompanyData?.created_by) {
            recipients.add(myCompanyData.created_by);
          }

          // 🔥 Trigger workflow with proper data
          const assigneeNames = newLead.assigned_to_users && newLead.assigned_to_users.length > 0
            ? newLead.assigned_to_users.map(email => {
                const staff = staffProfilesData.find(s => s.user_email === email);
                return staff?.full_name || email;
              }).join(', ')
            : 'Unassigned';

          // Send in-app notification to EVERYONE and email if applicable
          for (const recipientEmail of recipients) {
            try {
              await base44.entities.Notification.create({
                company_id: myCompanyData.id,
                user_email: recipientEmail,
                title: '🎯 New Lead Created',
                message: `Lead: ${newLead.name}${newLead.phone ? ' • ' + newLead.phone : ''}${newLead.source ? ' • Source: ' + newLead.source : ''}`,
                type: 'lead_created',
                related_entity_type: 'Lead',
                related_entity_id: newLead.id,
                link_url: '/leads?view_lead_id=' + newLead.id,
                is_read: false
              });

              // Send email notification
              await base44.functions.invoke('sendUnifiedEmail', {
                to: recipientEmail,
                subject: '🎯 New Lead Created',
                html: `<h2>New Lead Alert</h2>
                  <p><strong>Lead Name:</strong> ${newLead.name}</p>
                  <p><strong>Email:</strong> ${newLead.email || 'Not provided'}</p>
                  <p><strong>Phone:</strong> ${newLead.phone || 'Not provided'}</p>
                  <p><strong>Source:</strong> ${newLead.source || 'Not specified'}</p>
                  <p><strong>Status:</strong> ${newLead.status || 'new'}</p>
                  <p><strong>Assigned To:</strong> ${assigneeNames}</p>
                  <p><strong>Estimated Value:</strong> $${newLead.value || 0}</p>
                  <p><a href="${window.location.origin}/leads?view_lead_id=${newLead.id}">View Lead Details</a></p>`,
                companyId: myCompanyData.id,
                skipLogging: true // System notification, don't log to comms
              });
            } catch (notifError) {
              console.error('Failed to create notification for', recipientEmail, notifError);
            }
          }

          await base44.functions.invoke('triggerWorkflow', {
            triggerType: 'lead_created',
            companyId: myCompanyData.id,
            entityType: 'Lead',
            entityId: newLead.id,
            entityData: {
              lead_name: newLead.name,
              customer_name: newLead.name, // For workflow compatibility
              lead_email: newLead.email || '',
              customer_email: newLead.email || '', // For workflow compatibility
              lead_phone: newLead.phone || '',
              source: newLead.source || '',
              lead_source: newLead.lead_source || newLead.source || '',
              lead_status: newLead.status || '',
              assigned_to: assigneeNames,
              assigned_to_name: assigneeNames,
              app_url: window.location.origin
            }
          });

          console.log('✅ Notifications sent to:', Array.from(recipients).join(', '));
        } catch (error) {
          console.error('Failed to send lead notifications:', error);
        }
      }

      return newLead;
    },
    onSuccess: async (newLead) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead-customer-duplicates'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
      setShowDialog(false);
      setIsLeadSheetOpen(false);
      setEditingLead(null);
      
      // 🔥 UNIVERSAL WORKFLOW TRIGGER
      if (myCompanyData?.id) {
        try {
          await base44.functions.invoke('autoTriggerWorkflowsFromMutation', {
            action: 'create',
            entityType: 'Lead',
            entityId: newLead.id,
            entityData: newLead,
            companyId: myCompanyData.id
          });
          console.log('✅ Workflows triggered for new lead:', newLead.id);
        } catch (error) {
          console.error('⚠️ Workflow trigger failed:', error);
        }
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => {
      const dataToSend = {
        ...data,
        assigned_to: data.assigned_to_users?.[0] || ""
      };
      return base44.entities.Lead.update(id, dataToSend);
    },
    onMutate: ({ id }) => {
      const cachedLeads = queryClient.getQueryData(['leads', myCompanyData?.id]) || [];
      const previousLead = cachedLeads.find(l => l.id === id);
      return { previousAssignees: previousLead?.assigned_to_users || [] };
    },
    onSuccess: async (updatedLead, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      handleCloseDialog();
      setIsLeadSheetOpen(false);

      // Notify newly assigned reps and admins about reassignment
      const prevAssignees = context?.previousAssignees || [];
      const newAssignees = variables.data.assigned_to_users || [];
      const addedAssignees = newAssignees.filter(e => !prevAssignees.includes(e));

      if (addedAssignees.length > 0 && myCompanyData?.id) {
        try {
          const staffProfilesData = staffProfiles.length > 0
            ? staffProfiles
            : await base44.entities.StaffProfile.filter({ company_id: myCompanyData.id });
          const leadName = updatedLead?.name || variables.data.name || 'a lead';
          const actorName = user?.full_name || user?.email || 'Someone';
          const assigneeNames = addedAssignees.map(email => {
            const sp = staffProfilesData.find(s => s.user_email === email);
            return sp?.full_name || email;
          }).join(', ');

          const recipients = new Set(addedAssignees);
          if (myCompanyData?.created_by) {
            recipients.add(myCompanyData.created_by);
          }

          for (const recipientEmail of recipients) {
            const isAssignee = addedAssignees.includes(recipientEmail);
            const title = isAssignee ? '📋 Lead Assigned to You' : '📋 Lead Reassigned';
            const message = isAssignee
              ? `${actorName} assigned you to lead: ${leadName}`
              : `${actorName} assigned lead "${leadName}" to ${assigneeNames}`;
            try {
              await base44.entities.Notification.create({
                company_id: myCompanyData.id,
                user_email: recipientEmail,
                title,
                message,
                type: 'lead_assigned',
                related_entity_type: 'Lead',
                related_entity_id: variables.id,
                link_url: '/leads?view_lead_id=' + variables.id,
                is_read: false
              });
              await base44.functions.invoke('sendUnifiedEmail', {
                to: recipientEmail,
                subject: title,
                html: `<h2>${title}</h2>
                  <p>${message}</p>
                  <p><a href="${window.location.origin}/leads?view_lead_id=${variables.id}">View Lead Details</a></p>`,
                companyId: myCompanyData.id,
                skipLogging: true
              });
            } catch (notifError) {
              console.error('Failed to notify', recipientEmail, notifError);
            }
          }
          queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] });
        } catch (error) {
          console.error('Failed to send assignment notifications:', error);
        }
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const leadToDelete = leads.find(l => l.id === id);
      await base44.entities.Lead.delete(id);
      return leadToDelete;
    },
    onSuccess: async (deletedLead) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      
      // Send notifications to admins
      if (myCompanyData?.id && deletedLead) {
        try {
          if (myCompanyData?.created_by) {
            await base44.entities.Notification.create({
              company_id: myCompanyData.id,
              user_email: myCompanyData.created_by,
              title: '🗑️ Lead Deleted',
              message: `${user?.full_name || 'Someone'} deleted lead: ${deletedLead.name}${deletedLead.phone ? ' • ' + deletedLead.phone : ''}`,
              type: 'lead_deleted',
              is_read: false
            });

            await base44.functions.invoke('sendUnifiedEmail', {
              to: myCompanyData.created_by,
              subject: '🗑️ Lead Deleted',
              message: `Lead "${deletedLead.name}" was deleted by ${user?.full_name || user?.email}.\n\nDetails:\n- Email: ${deletedLead.email || 'N/A'}\n- Phone: ${deletedLead.phone || 'N/A'}\n- Source: ${deletedLead.source || 'N/A'}\n- Status: ${deletedLead.status || 'N/A'}`,
              companyId: myCompanyData.id,
              skipLogging: true
            });
          }

          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        } catch (error) {
          console.error('Failed to send delete notifications:', error);
        }
      }
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids) => {
      let successCount = 0;
      let errorCount = 0;
      const errors = [];
      const deletedLeads = [];

      for (const id of ids) {
        try {
          const leadToDelete = leads.find(l => l.id === id);
          await base44.entities.Lead.delete(id);
          if (leadToDelete) deletedLeads.push(leadToDelete);
          successCount++;
        } catch (error) {
          errorCount++;
          errors.push({ id, error: error.message });
          console.error(`Failed to delete lead ${id}:`, error);
        }
      }

      return { successCount, errorCount, errors, deletedLeads };
    },
    onSuccess: async (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      setSelectedLeads([]);

      // Send notifications to admins
      if (myCompanyData?.id && result.deletedLeads.length > 0) {
        try {
          const leadNames = result.deletedLeads.map(l => l.name).join(', ');

          if (myCompanyData?.created_by) {
            await base44.entities.Notification.create({
              company_id: myCompanyData.id,
              user_email: myCompanyData.created_by,
              title: `🗑️ ${result.deletedLeads.length} Lead(s) Deleted`,
              message: `${user?.full_name || 'Someone'} deleted ${result.deletedLeads.length} lead(s): ${leadNames}`,
              type: 'lead_deleted',
              is_read: false
            });

            await base44.functions.invoke('sendUnifiedEmail', {
              to: myCompanyData.created_by,
              subject: `🗑️ ${result.deletedLeads.length} Lead(s) Deleted`,
              message: `${result.deletedLeads.length} lead(s) were deleted by ${user?.full_name || user?.email}.\n\nDeleted leads:\n${result.deletedLeads.map(l => `- ${l.name} (${l.email || l.phone || 'No contact'})`).join('\n')}`,
              companyId: myCompanyData.id,
              skipLogging: true
            });
          }

          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        } catch (error) {
          console.error('Failed to send bulk delete notifications:', error);
        }
      }

      if (result.errorCount > 0) {
        alert(`Deleted ${result.successCount} leads successfully.\n${result.errorCount} leads could not be deleted (they may have been already deleted or don't exist).`);
      } else {
        alert(`Successfully deleted ${result.successCount} leads!`);
      }
    },
    onError: (error) => {
      console.error("Bulk delete failed:", error);
      alert('Failed to delete leads. Please try again.');
    }
  });

  const convertToCustomerMutation = useMutation({
    mutationFn: async (lead) => {
      // 🔥 FIX: Add company_id when converting lead to customer
      const customerData = {
        company_id: myCompanyData?.id || lead.company_id, // Use lead's company_id as fallback
        name: lead.name,
        company_name: lead.company || "",
        email: lead.email || "",
        phone: lead.phone || "",
        phone_2: lead.phone_2 || "",
        street: lead.street || "",
        city: lead.city || "",
        state: lead.state || "",
        zip: lead.zip || "",
        address: lead.address || "",
        customer_type: "residential",
        source: lead.source || "other",
        referral_source: lead.lead_source || "",
        is_active: lead.is_active !== false,
        notes: [
          lead.notes || "",
          `\n\n--- Converted from Lead ---`,
          `Original Lead ID: ${lead.id}`,
          `Lead Status: ${lead.status}`,
          `Lead Value: $${lead.value || 0}`,
          `Created: ${safeFormatDate(lead.created_date)}`,
          `Last Contact: ${safeFormatDate(lead.last_contact_date)}`,
          lead.next_follow_up_date ? `Follow-up Date: ${safeFormatDate(lead.next_follow_up_date)}` : ""
        ].filter(Boolean).join("\n"),
        assigned_to: lead.assigned_to_users?.[0] || lead.assigned_to || "",
        assigned_to_users: Array.isArray(lead.assigned_to_users) ? lead.assigned_to_users : (lead.assigned_to ? [lead.assigned_to] : []) // 🔥 FIX: Also copy assigned_to_users
      };

      const newCustomer = await base44.entities.Customer.create(customerData);

      // Delete the lead
      await base44.entities.Lead.delete(lead.id);

      return newCustomer;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['lead-customer-duplicates'] });
      alert(`✅ Lead converted to customer successfully!\n\nCustomer: ${customer.name}`);
      setViewingLead(null);
    },
    onError: (error) => {
      alert(`❌ Failed to convert lead: ${error.message}`);
    }
  });

  const getLeadScore = (leadId) => {
    return leadScores.find(s => s.lead_id === leadId);
  };

  const updateLeadScore = async (leadId, action, points, description) => {
    try {
      await base44.functions.invoke('updateLeadScore', {
        leadId,
        action,
        points,
        actionDescription: description
      });
      queryClient.invalidateQueries({ queryKey: ['lead-scores'] });
    } catch (error) {
      console.error('Failed to update lead score:', error);
    }
  };

  const getLeadWithContactInfo = (lead) => {
    const leadComms = communications.filter(c => {
      const matchByName = c.contact_name && lead.name && c.contact_name.toLowerCase() === lead.name.toLowerCase();
      const matchByPhone1 = c.contact_phone && lead.phone && c.contact_phone === lead.phone;
      const matchByPhone2 = c.contact_phone && lead.phone_2 && c.contact_phone === lead.phone_2;
      const matchByEmail = c.contact_email && lead.email && c.contact_email.toLowerCase() === lead.email.toLowerCase();

      return matchByName || matchByPhone1 || matchByPhone2 || matchByEmail;
    }).sort((a, b) => new Date(b.created_date).getTime() - new Date(a.created_date).getTime());

    const lastContact = leadComms.length > 0
      ? leadComms[0].created_date
      : lead.created_date;

    const upcomingEvents = calendarEvents.filter(e =>
      e.related_lead && lead.name && e.related_lead.toLowerCase() === lead.name.toLowerCase() &&
      new Date(e.start_time).getTime() > new Date().getTime() &&
      e.status !== 'cancelled'
    ).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    let nextFollowUp = lead.next_follow_up_date;
    if (!nextFollowUp && upcomingEvents.length > 0) {
        nextFollowUp = upcomingEvents[0].start_time;
    }

    return {
      ...lead,
      last_contact_date: lastContact,
      next_follow_up_date: nextFollowUp,
      communication_count: leadComms.length
    };
  };

  // 🔥 FIX: Deduplicate staff profiles by email
  const uniqueStaffProfiles = React.useMemo(() => {
    const seen = new Set();
    return staffProfiles.filter(staff => {
      if (seen.has(staff.user_email)) {
        return false;
      }
      seen.add(staff.user_email);
      return true;
    });
  }, [staffProfiles]);

  const getStaffAvatars = React.useCallback((assignedUsers) => {
    if (!assignedUsers || assignedUsers.length === 0) return [];
    return assignedUsers.map(email => {
      const staff = uniqueStaffProfiles.find(s => s.user_email === email);
      return {
        email,
        avatar_url: staff?.avatar_url || null,
        full_name: staff?.full_name || email,
        initials: staff?.full_name
          ? staff.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
          : (email && email.length > 0 ? email[0].toUpperCase() : '?')
      };
    });
  }, [uniqueStaffProfiles]);

  const handleEdit = (lead) => {
    setEditingLead(lead);
    setFormData({
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      phone_2: lead.phone_2 || "",
      company: lead.company || "",
      street: lead.street || "",
      city: lead.city || "",
      state: lead.state || "",
      zip: lead.zip || "",
      status: lead.status || "new",
      source: lead.source || "manual",
      lead_source: lead.lead_source || "",
      referred_by: lead.referred_by || "",
      value: lead.value || 0,
      is_active: lead.is_active !== false,
      notes: lead.notes || "",
      last_contact_date: lead.last_contact_date || "",
      next_follow_up_date: lead.next_follow_up_date || "",
      assigned_to: lead.assigned_to || "",
      assigned_to_users: Array.isArray(lead.assigned_to_users) ? lead.assigned_to_users : (lead.assigned_to ? [lead.assigned_to] : [])
    });
    setShowDialog(true);
  };

  const handleDelete = (id) => {
    if (!guardAction("Deleting leads")) return;
    if (window.confirm(t.leads.deleteConfirm)) {
      deleteMutation.mutate(id);
    }
  };

  const handleCloseDialog = () => {
    setShowDialog(false);
    setIsLeadSheetOpen(false);
    setEditingLead(null);
    setFormData({
      name: "",
      email: "",
      phone: "",
      phone_2: "",
      company: "",
      street: "",
      city: "",
      state: "",
      zip: "",
      status: "new",
      source: "manual",
      lead_source: "",
      referred_by: "",
      value: 0,
      is_active: true,
      notes: "",
      last_contact_date: "",
      next_follow_up_date: "",
      assigned_to: "",
      assigned_to_users: []
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!guardAction("Creating/updating leads")) return;
    if (editingLead) {
      updateMutation.mutate({ id: editingLead.id, data: formData });
    } else {
      const newPhone = (formData.phone || '').replace(/\D/g, '');
      const newEmail = (formData.email || '').toLowerCase().trim();
      const newName = (formData.name || '').toLowerCase().trim();
      const existingMatch = (allLeads || []).find(l => {
        const lPhone = (l.phone || '').replace(/\D/g, '');
        const lEmail = (l.email || '').toLowerCase().trim();
        const lName = (l.name || '').toLowerCase().trim();
        return (newPhone.length >= 7 && lPhone === newPhone) ||
               (newEmail && lEmail === newEmail) ||
               (newName && lName === newName);
      });
      if (existingMatch) {
        setPendingLeadData(formData);
        setDuplicateConfirmInfo({ matchedName: existingMatch.name, matchedPhone: existingMatch.phone, matchedEmail: existingMatch.email });
        return;
      }
      createLeadMutation.mutate(formData);
    }
  };

  const renderFormFields = () => (
    <LeadFormFields formData={formData} setFormData={setFormData} staffProfiles={staffProfiles} t={t} />
  );

  const handleConvertToCustomer = (lead) => {
    if (!guardAction("Converting leads")) return;
    if (window.confirm(`Convert "${lead.name}" to a customer?\n\nAll lead data (notes, contact info, etc.) will be transferred to the customer record.`)) {
      convertToCustomerMutation.mutate(lead);
    }
  };

  const handleToggleActive = (lead) => {
    updateMutation.mutate({
      id: lead.id,
      data: { ...lead, is_active: !lead.is_active }
    });
  };

  const handleStatusChange = (lead, newStatus) => {
    if (!guardAction("Updating leads")) return;
    const oldStatus = lead.status;
    
    updateMutation.mutate({
      id: lead.id,
      data: { ...lead, status: newStatus }
    });
    
    let points = 0;
    let description = `Lead status changed to ${newStatus}`;
    if (newStatus === 'qualified') points = 25;
    else if (newStatus === 'proposal') points = 30;
    else if (newStatus === 'negotiation') points = 40;
    else if (newStatus === 'won') points = 100;
    else if (newStatus === 'lost') points = -50;

    if (points !== 0) updateLeadScore(lead.id, 'status_change', points, description);

    // 🔔 NEW: Trigger workflow for lead status change
    if (myCompanyData?.id && oldStatus !== newStatus) {
      base44.functions.invoke('triggerWorkflow', {
        triggerType: 'lead_status_changed',
        companyId: myCompanyData.id,
        entityType: 'Lead',
        entityId: lead.id,
        entityData: {
          lead_name: lead.name,
          name: lead.name,
          lead_email: lead.email || '',
          lead_phone: lead.phone || '',
          old_status: oldStatus,
          new_status: newStatus,
          lead_status: newStatus,
          status: newStatus,
          app_url: window.location.origin
        }
      }).catch(error => {
        console.error('Failed to trigger lead status change workflow:', error);
      });
    }
  };

  const handleCommunication = (lead, type) => {
    setSelectedLead(lead);

    if (type === 'phone') {
      updateLeadScore(lead.id, 'call_initiated', 30, 'Called lead');
      setShowDialer(true);
    }
    if (type === 'email') {
      updateLeadScore(lead.id, 'email_sent', 20, 'Sent email');
      setShowEmailDialog(true);
    }
    if (type === 'sms') {
      updateLeadScore(lead.id, 'sms_sent', 15, 'Sent SMS');
      setShowSMSDialog(true);
    }
  };

  const handleCreateEstimate = (lead) => {
    updateLeadScore(lead.id, 'estimate_created', 40, 'Created estimate for lead');
    navigate(createPageUrl('CreateEstimate') + `?lead_id=${lead.id}`);
  };

  const handleSelectAll = () => {
    const currentPageLeadIds = paginatedLeads.map(lead => lead.id);
    const areAllCurrentPageSelected = currentPageLeadIds.every(id => selectedLeads.includes(id));

    if (areAllCurrentPageSelected) {
      setSelectedLeads(prev => prev.filter(id => !currentPageLeadIds.includes(id)));
    } else {
      setSelectedLeads(prev => [...new Set([...prev, ...currentPageLeadIds])]);
    }
  };

  const handleSelectLead = (id) => {
    if (selectedLeads.includes(id)) {
      setSelectedLeads(selectedLeads.filter(leadId => leadId !== id));
    } else {
      setSelectedLeads([...selectedLeads, id]);
    }
  };

  const handleBulkDelete = () => {
    if (!guardAction("Deleting leads")) return;
    if (selectedLeads.length === 0) {
      alert('Please select at least one lead to delete.');
      return;
    }

    const existingSelectedLeads = selectedLeads.filter(id =>
      leads.some(lead => lead.id === id)
    );

    if (existingSelectedLeads.length === 0) {
      alert('No valid leads selected. They may have been already deleted.');
      setSelectedLeads([]);
      return;
    }

    if (existingSelectedLeads.length < selectedLeads.length) {
      const difference = selectedLeads.length - existingSelectedLeads.length;
      if (!window.confirm(`${difference} of your selected leads no longer exist.\n\nDelete the remaining ${existingSelectedLeads.length} leads? This cannot be undone!`)) {
        setSelectedLeads(existingSelectedLeads);
        return;
      }
    } else {
      if (!window.confirm(`Are you sure you want to delete ${existingSelectedLeads.length} selected leads? This cannot be undone!`)) {
        return;
      }
    }

    bulkDeleteMutation.mutate(existingSelectedLeads);
  };

  const handleExportCSV = (exportMode = 'dynamic') => {
    let leadsToExport = [];

    if (exportMode === 'selectedOnly') {
      leadsToExport = filteredLeads.filter(lead => selectedLeads.includes(lead.id));
    } else {
      leadsToExport = selectedLeads.length > 0
        ? filteredLeads.filter(lead => selectedLeads.includes(lead.id))
        : filteredLeads;
    }

    if (leadsToExport.length === 0) {
      alert('No leads to export');
      return;
    }

    const headers = ['ID', 'Company', 'Primary Contact', 'Email', 'Phone 1', 'Phone 2', 'Street', 'City', 'State', 'Zip', 'Source', 'Status', 'Value', 'Active', 'Date Created', 'Last Contact Date', 'Next Follow Up Date', 'Notes', 'Assigned To (Emails)'];
    const rows = leadsToExport.map(lead => {
      const enrichedLead = getLeadWithContactInfo(lead);
      return [
        lead.id,
        lead.company || '',
        lead.name || '',
        lead.email || '',
        lead.phone || '',
        lead.phone_2 || '',
        lead.street || '',
        lead.city || '',
        lead.state || '',
        lead.zip || '',
        lead.source || '',
        lead.status || '',
        lead.value || 0,
        lead.is_active ? 'Yes' : 'No',
        safeFormatDate(lead.created_date, 'yyyy-MM-dd'),
        safeFormatDate(enrichedLead.last_contact_date, 'yyyy-MM-dd HH:mm'),
        safeFormatDate(enrichedLead.next_follow_up_date, 'yyyy-MM-dd'),
        lead.notes || '',
        (Array.isArray(lead.assigned_to_users) && lead.assigned_to_users.length > 0) ? lead.assigned_to_users.join('; ') : (lead.assigned_to || '')
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `leads_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();

    alert(`Exported ${leadsToExport.length} leads to CSV!`);
  };

  const handleBulkStatusChange = (newStatus) => {
    if (selectedLeads.length === 0) {
      alert('Please select leads first');
      return;
    }

    if (window.confirm(`Change status to "${newStatus}" for ${selectedLeads.length} selected leads?`)) {
      selectedLeads.forEach(id => {
        const lead = leads.find(l => l.id === id);
        if (lead) {
          updateMutation.mutate({
            id: lead.id,
            data: { ...lead, status: newStatus }
          });
          let points = 0;
          let description = `Bulk status change to ${newStatus}`;
          if (newStatus === 'qualified') points = 25;
          else if (newStatus === 'proposal') points = 30;
          else if (newStatus === 'negotiation') points = 40;
          else if (newStatus === 'won') points = 100;
          else if (newStatus === 'lost') points = -50;

          if (points !== 0) updateLeadScore(lead.id, 'status_change', points, description);
        }
      });
      setSelectedLeads([]);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      'new': 'bg-blue-100 text-blue-700 border-blue-200',
      'contacted': 'bg-yellow-100 text-yellow-700 border-yellow-200',
      'qualified': 'bg-green-100 text-green-700 border-green-200',
      'proposal': 'bg-purple-100 text-purple-700 border-purple-200',
      'negotiation': 'bg-orange-100 text-orange-700 border-orange-200',
      'won': 'bg-emerald-100 text-emerald-700 border-emerald-200',
      'lost': 'bg-red-100 text-red-700 border-red-200',
    };
    return colors[status] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  // Helper to get tag color based on tag name
  const getTagColor = (tag) => {
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('sales rep')) return 'bg-blue-100 text-blue-700 border-blue-300';
    if (tagLower.includes('ladder') || tagLower.includes('assistant')) return 'bg-green-100 text-green-700 border-green-300';
    if (tagLower.includes('inspection') || tagLower.includes('lead inspection')) return 'bg-purple-100 text-purple-700 border-purple-300';
    if (tagLower.includes('roof')) return 'bg-orange-100 text-orange-700 border-orange-300';
    if (tagLower.includes('fb') || tagLower.includes('facebook')) return 'bg-indigo-100 text-indigo-700 border-indigo-300';
    if (tagLower.includes('social')) return 'bg-pink-100 text-pink-700 border-pink-300';
    return 'bg-gray-100 text-gray-700 border-gray-300';
  };

  const getSourceBadge = (lead) => {
    const sourceColors = {
      'storm_tracker': 'bg-orange-100 text-orange-700 border-orange-200',
      'property_importer': 'bg-purple-100 text-purple-700 border-purple-200',
      'website': 'bg-blue-100 text-blue-700 border-blue-200',
      'referral': 'bg-green-100 text-green-700 border-green-200',
      'manual': 'bg-gray-100 text-gray-700 border-gray-200',
      'cold_call': 'bg-cyan-100 text-cyan-700 border-cyan-200',
      'social_media': 'bg-indigo-100 text-indigo-700 border-indigo-200',
      'advertisement': 'bg-pink-100 text-pink-700 border-pink-200',
      'gohighlevel': 'bg-purple-100 text-purple-700 border-purple-200',
      'other': 'bg-gray-100 text-gray-700 border-gray-200'
    };

    const sourceLabels = {
      'storm_tracker': '⛈️ Storm',
      'property_importer': '🏘️ Import',
      'website': '🌐 Website',
      'referral': '👥 Referral',
      'manual': '✍️ Manual',
      'cold_call': '📞 Cold Call',
      'social_media': '📱 Social',
      'advertisement': '📢 Ad',
      'gohighlevel': '🚀 GHL',
      'other': 'Other'
    };

    return (
      <Badge variant="outline" className={sourceColors[lead.source] || sourceColors.other}>
        {sourceLabels[lead.source] || lead.source}
      </Badge>
    );
  };

  const handleScheduleMeeting = (lead) => {
    updateLeadScore(lead.id, 'meeting_scheduled', 20, 'Meeting scheduled with lead');
    navigate(createPageUrl('Calendar') + `?lead=${encodeURIComponent(lead.name)}&action=new`);
  };

  const handleSetFollowUp = async (lead, days) => {
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + days);

    updateMutation.mutate({
      id: lead.id,
      data: { ...lead, next_follow_up_date: followUpDate.toISOString() }
    });
    updateLeadScore(lead.id, 'followup_set', 10, `Follow-up set for ${safeFormatDate(followUpDate, 'MMM d')}`);
  };

  const createTaskMutation = useMutation({
    mutationFn: (taskData) => base44.entities.Task.create({
      ...taskData,
      company_id: myCompanyData?.id,
      related_to: taskRelatedLead?.name,
      source: "lead"
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowTaskDialog(false);
      setTaskRelatedLead(null);
      setTaskForm({
        name: "",
        description: "",
        priority: "medium",
        due_date: "",
        assigned_to: "",
        status: "not_started"
      });
      alert('✅ Task created successfully!');
    },
    onError: (error) => {
      alert('Failed to create task: ' + error.message);
    }
  });

  const renderTemperatureBadge = (leadId) => {
    const score = getLeadScore(leadId);
    if (!score) return null;

    const tempConfig = {
      hot: { icon: Flame, color: 'bg-red-100 text-red-700 border-red-300', label: t.leads.hot },
      warm: { icon: ThermometerSun, color: 'bg-orange-100 text-orange-700 border-orange-300', label: t.leads.warm },
      cold: { icon: Snowflake, color: 'bg-blue-100 text-blue-700 border-blue-300', label: t.leads.cold }
    };

    const config = tempConfig[score.temperature] || tempConfig.cold;
    const Icon = config.icon;

    const recentHistory = (score.score_history || []).slice(-3);
    let trendPoints = 0;
    if (recentHistory.length > 1) {
        trendPoints = recentHistory.reduce((sum, entry) => sum + entry.points, 0);
    }

    let TrendIcon = Minus;
    let trendColor = 'text-gray-400';
    if (trendPoints > 10) {
        TrendIcon = TrendingUp;
        trendColor = 'text-green-500';
    } else if (trendPoints < -10) {
        TrendIcon = TrendingDown;
        trendColor = 'text-red-500';
    }

    return (
      <div className="flex items-center gap-1">
        <Badge variant="outline" className={`${config.color} flex items-center gap-1 font-semibold`}>
          <Icon className="w-3 h-3" />
          {score.total_score}
        </Badge>
        {score.score_history && score.score_history.length > 1 && (
            <TrendIcon className={`w-4 h-4 ${trendColor}`} />
        )}
      </div>
    );
  };

  const getFilteredLeadsByQuickFilter = () => {
    const now = new Date();
    const allLeadsWithInfo = leads.map(getLeadWithContactInfo);

    let filtered = allLeadsWithInfo;

    // Apply source filter FIRST
    if (sourceFilter !== "all") {
      filtered = filtered.filter(leadItem => leadItem.source === sourceFilter);
    }

    // Apply tag filter
    if (tagFilter !== "all") {
      filtered = filtered.filter(leadItem => 
        leadItem.tags && leadItem.tags.includes(tagFilter)
      );
    }

    switch(quickFilter) {
      case "needs_follow_up":
        filtered = filtered.filter(leadItem => {
          if (!leadItem.next_follow_up_date) return false;
          return new Date(leadItem.next_follow_up_date).setHours(0,0,0,0) <= now.setHours(0,0,0,0);
        });
        break;
      case "no_contact_7_days":
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(leadItem => {
          if (!leadItem.last_contact_date) return true;
          return new Date(leadItem.last_contact_date) < sevenDaysAgo;
        });
        break;
      case "contacted_today":
        filtered = filtered.filter(leadItem => {
          if (!leadItem.last_contact_date) return false;
          const lastContact = new Date(leadItem.last_contact_date);
          return lastContact.toDateString() === now.toDateString();
        });
        break;
      case "upcoming_follow_ups":
        filtered = filtered.filter(leadItem => {
          if (!leadItem.next_follow_up_date) return false;
          const followUp = new Date(leadItem.next_follow_up_date);
          return followUp.setHours(0,0,0,0) > now.setHours(0,0,0,0);
        });
        break;
      case "all":
      default:
        break;
    }

    return filtered;
  };

  const leadsAfterQuickFilter = getFilteredLeadsByQuickFilter();

  const filteredLeadsWithScore = leadsAfterQuickFilter.filter(lead => {
    const matchesSearch = lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.lead_source?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.referred_by?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.street?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.state?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.zip?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.phone?.includes(searchTerm) ||
      lead.phone_2?.includes(searchTerm);

    if (!matchesSearch) return false;

    if (scoreFilter === "all") return true;

    const score = getLeadScore(lead.id);
    if (!score) return scoreFilter === "cold";

    return score.temperature === scoreFilter;
  });

  const sortedLeads = React.useMemo(() => {
    return [...filteredLeadsWithScore].sort((a, b) => {
      if (sortBy === 'score') {
        const scoreA = getLeadScore(a.id);
        const scoreB = getLeadScore(b.id);
        const scoreValA = scoreA?.total_score ?? -Infinity;
        const scoreValB = scoreB?.total_score ?? -Infinity;
        return sortOrder === 'desc' ? scoreValB - scoreValA : scoreValA - scoreValB;
      } else if (sortBy === 'created_date') {
        const dateA = new Date(a.created_date).getTime();
        const dateB = new Date(b.created_date).getTime();
        if (isNaN(dateA) && isNaN(dateB)) return 0;
        if (isNaN(dateA)) return sortOrder === 'desc' ? 1 : -1;
        if (isNaN(dateB)) return sortOrder === 'desc' ? -1 : 1;
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      }
      return 0;
    });
  }, [filteredLeadsWithScore, sortBy, sortOrder, getLeadScore]);

  const filteredLeads = sortedLeads;

  const effectivePageSize = pageSize === 'all' ? filteredLeads.length : pageSize;
  const totalPages = effectivePageSize === 0 ? 0 : Math.ceil(filteredLeads.length / effectivePageSize);
  const paginatedLeads = pageSize === 'all'
    ? filteredLeads
    : filteredLeads.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  const totalLeads = leads.length;
  const activeLeads = leads.filter(l => l.is_active !== false).length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const qualifiedLeads = leads.filter(l => l.status === 'qualified').length;
  const wonLeads = leads.filter(l => l.status === 'won').length;
  const totalLeadValue = leads.reduce((sum, l) => sum + Number(l.value || 0), 0);

  if (isLoadingLeads || isRoleDataLoading) {
    return <TablePageSkeleton />;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.leads.title}</h1>
        <button
          onClick={() => navigate(createPageUrl('Customers'))}
          className="text-blue-600 hover:underline text-sm flex items-center gap-1 mt-1"
        >
          Customers →
        </button>
      </div>

      {duplicateWarningsData.length > 0 && (
        <Card className="bg-yellow-50 border-yellow-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 mb-2">
                  ⚠️ Potential Duplicate Contacts Found ({duplicateWarningsData.length})
                </h3>
                <div className="space-y-1 text-sm text-yellow-800">
                  {duplicateWarningsData.slice(0, 3).map((warning, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span>•</span>
                      <span>
                        Lead "<strong>{warning.leadName}</strong>" matches Customer: {warning.customerNames}
                      </span>
                    </div>
                  ))}
                  {duplicateWarningsData.length > 3 && (
                    <div className="text-yellow-700 mt-2">
                      + {duplicateWarningsData.length - 3} more potential duplicates
                    </div>
                  )}
                </div>
                <p className="text-xs text-yellow-700 mt-2">
                  💡 Consider converting these leads to customers or merging the records.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="bg-white hover-elevate no-default-hover-elevate">
          <CardContent className="p-3">
            <div className="text-xl font-bold text-gray-900">{totalLeads}</div>
            <div className="text-xs text-gray-500">{t.leads.totalLeads}</div>
          </CardContent>
        </Card>
        <Card className="bg-white hover-elevate no-default-hover-elevate">
          <CardContent className="p-3">
            <div className="text-xl font-bold text-green-600">{activeLeads}</div>
            <div className="text-xs text-gray-500">{t.leads.title} ({t.common.active})</div>
          </CardContent>
        </Card>
        <Card className="bg-white hover-elevate no-default-hover-elevate">
          <CardContent className="p-3">
            <div className="text-xl font-bold text-blue-600">{newLeads}</div>
            <div className="text-xs text-gray-500">{t.leads.newLead} {t.leads.title}</div>
          </CardContent>
        </Card>
        <Card className="bg-white hover-elevate no-default-hover-elevate">
          <CardContent className="p-3">
            <div className="text-xl font-bold text-purple-600">{qualifiedLeads}</div>
            <div className="text-xs text-gray-500">{t.leads.qualified}</div>
          </CardContent>
        </Card>
        <Card className="bg-white hover-elevate no-default-hover-elevate">
          <CardContent className="p-3">
            <div className="text-xl font-bold text-green-600">{wonLeads}</div>
            <div className="text-xs text-gray-500">{t.leads.won}</div>
          </CardContent>
        </Card>
        <Card className="bg-white hover-elevate no-default-hover-elevate">
          <CardContent className="p-3">
            <div className="text-xl font-bold text-gray-900">${(totalLeadValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="text-xs text-gray-500">{t.leads.value} ({t.leads.pipeline || "Pipeline"})</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="leads" className="w-full">
        <TabsList>
          <TabsTrigger value="leads">{t.leads.title}</TabsTrigger>
          <TabsTrigger value="inspections" className="flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Inspections ({inspections.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="space-y-4">
          {/* Filters toolbar */}
                      <div className="p-3 bg-white rounded-lg border shadow-sm">
                        <div className="flex items-center gap-2">
                          {/* Quick Filters (Type/Source) */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="gap-2">
                                <Sparkles className="w-4 h-4" />
                                {t.leads.filters}
                                {(tagFilter !== 'all' || sourceFilter !== 'all') && (
                                  <Badge variant="secondary" className="ml-2">
                                    {(tagFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0)}
                                  </Badge>
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuContent align="start" className="w-64 z-[60]">
                                <DropdownMenuLabel>{t.common.type}</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={tagFilter} onValueChange={setTagFilter}>
                                  <DropdownMenuRadioItem value="all">{t.common.all} ({leads.length})</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="sales reps">Sales Reps ({leads.filter(l => l.tags?.includes('sales reps')).length})</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="ladder assistants">Ladder ({leads.filter(l => l.tags?.includes('ladder assistants')).length})</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="lead inspections">Inspections ({leads.filter(l => l.tags?.includes('lead inspections')).length})</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>

                                <DropdownMenuSeparator />

                                <DropdownMenuLabel>{t.leads.source}</DropdownMenuLabel>
                                <DropdownMenuRadioGroup value={sourceFilter} onValueChange={setSourceFilter}>
                                  <DropdownMenuRadioItem value="all">{t.common.all} ({leads.length})</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="gohighlevel">GHL ({leads.filter(l => l.source === 'gohighlevel').length})</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="storm_tracker">Storm ({leads.filter(l => l.source === 'storm_tracker').length})</DropdownMenuRadioItem>
                                  <DropdownMenuRadioItem value="manual">Manual ({leads.filter(l => l.source === 'manual').length})</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>

                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => { setTagFilter('all'); setSourceFilter('all'); }}>
                                  {t.common.clearFilters}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenuPortal>
                          </DropdownMenu>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" className="gap-2">
                                <Filter className="w-4 h-4" />
                                {t.leads.filters}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuContent align="start" className="w-56 z-[60]">
                                <DropdownMenuItem onClick={() => { setTagFilter('all'); setSourceFilter('all'); }}>
                                  {t.common.clearFilters}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenuPortal>
                          </DropdownMenu>
                        </div>
                      </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
            {isMobile ? (
              <Button 
                className="flex-1 bg-blue-600 hover:bg-blue-700 h-12" 
                onClick={() => {
                  setEditingLead(null);
                  setFormData({
                    name: "",
                    email: "",
                    phone: "",
                    phone_2: "",
                    company: "",
                    street: "",
                    city: "",
                    state: "",
                    zip: "",
                    status: "new",
                    source: "manual",
                    lead_source: "",
                    referred_by: "",
                    value: 0,
                    is_active: true,
                    notes: "",
                    last_contact_date: "",
                    next_follow_up_date: "",
                    assigned_to: "",
                    assigned_to_users: user ? [user.email] : []
                  });
                  setIsLeadSheetOpen(true);
                }}
                data-testid="button-add-lead"
              >
                <Plus className="w-5 h-5 mr-2" />
                {t.leads.addLead}
              </Button>
            ) : (
              <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogTrigger asChild>
                  <Button
                    className="bg-blue-600 hover:bg-blue-700 text-sm h-9"
                    onClick={() => {
                      setEditingLead(null);
                      setFormData({
                        name: "",
                        email: "",
                        phone: "",
                        phone_2: "",
                        company: "",
                        street: "",
                        city: "",
                        state: "",
                        zip: "",
                        status: "new",
                        source: "manual",
                        lead_source: "",
                        referred_by: "",
                        value: 0,
                        is_active: true,
                        notes: "",
                        last_contact_date: "",
                        next_follow_up_date: "",
                        assigned_to: "",
                        assigned_to_users: user ? [user.email] : [] // 🔥 Auto-assign creator
                      });
                    }}
                    data-testid="button-add-lead"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {t.leads.addLead}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>{editingLead ? t.leads.editLead : t.leads.addLead}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleSubmit} className="space-y-4 pb-24">
                    {renderFormFields()}
                    <div className="flex justify-end gap-3">
                      <Button type="button" variant="outline" onClick={handleCloseDialog}>
                        {t.common.cancel}
                      </Button>
                      <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                        {editingLead ? t.common.update : t.common.create}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}

            <Sheet open={isLeadSheetOpen} onOpenChange={setIsLeadSheetOpen}>
              <SheetContent side="bottom" className="h-[90vh] p-0 overflow-hidden z-[200]">
                <SheetHeader className="p-6 border-b sticky top-0 bg-white z-[100]">
                  <SheetTitle>{editingLead ? t.leads.editLead : t.leads.addLead}</SheetTitle>
                </SheetHeader>
                <div className="overflow-y-auto h-[calc(90vh-140px)] p-6 pb-32">
                  <form id="lead-form-mobile" onSubmit={handleSubmit}>
                    {renderFormFields()}
                  </form>
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t flex gap-3 z-[100]">
                  <Button variant="outline" className="flex-1 h-12" onClick={() => setIsLeadSheetOpen(false)}>
                    {t.common.cancel}
                  </Button>
                  <Button type="submit" form="lead-form-mobile" className="flex-1 h-12 bg-blue-600 hover:bg-blue-700" disabled={createLeadMutation.isPending || updateMutation.isPending}>
                    {(createLeadMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingLead ? t.common.update : t.common.create}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>

              <Button variant="outline" onClick={() => navigate(createPageUrl('LeadFinder'))} className="text-sm h-9">
                <Search className="w-4 h-4 mr-2" />
                {t.sidebar.leadFinder}
              </Button>

              <Button 
                variant="outline" 
                onClick={() => setShowCleanupDialog(true)} 
                className="text-sm h-9 border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {t.common.cleanup || "Cleanup"}
                {(duplicateWarningsData.length > 0 || leadsWithoutCompany > 0 || emptyLeads.length > 0) && (
                  <Badge className="ml-2 bg-orange-600 text-white h-5 px-1.5">
                    {duplicateWarningsData.length + (leadsWithoutCompany > 0 ? 1 : 0) + (emptyLeads.length > 0 ? 1 : 0)}
                  </Badge>
                )}
              </Button>

              {leads.filter(l => l.source === 'gohighlevel').length > 0 && (
                <Button 
                  variant="outline" 
                  onClick={async () => {
                    if (confirm(`Tag and assign all ${leads.filter(l => l.source === 'gohighlevel').length} GHL leads to Kevin and Victoria?`)) {
                      try {
                        const result = await base44.functions.invoke('tagExistingGHLLeads');
                        if (result.data.success) {
                          toast.success(`✅ ${result.data.message}`);
                          queryClient.invalidateQueries({ queryKey: ['leads'] });
                        } else {
                          toast.error(`❌ ${result.data.error}`);
                        }
                      } catch (error) {
                        toast.error('Failed to tag leads: ' + error.message);
                      }
                    }
                  }}
                  className="text-sm h-9 border-purple-300 text-purple-700 hover:bg-purple-50"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Tag GHL Leads
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowLeaderboard(!showLeaderboard)}
                className="text-sm h-9 border-yellow-300 text-yellow-700 hover:bg-yellow-50"
              >
                <Trophy className="w-4 h-4 mr-2" />
                {showLeaderboard ? t.common.hide || 'Hide' : t.common.show || 'Show'} Leaderboard
              </Button>
              {selectedLeads.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t.common.delete} {selectedLeads.length} {t.common.selected}
                </Button>
              )}
            </div>
          </div>

          {showLeaderboard && (
            <LeadLeaderboard
              leadScores={leadScores}
              leads={leads}
              onLeadClick={(lead) => setViewingLead(getLeadWithContactInfo(lead))}
            />
          )}

          <Card className="bg-white shadow-sm">
            <div className="px-6 py-4 border-b bg-gray-50">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder={t.leads.searchLeads}
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-10"
                    size="sm"
                  />
                </div>

                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <Select value={pageSize.toString()} onValueChange={(value) => {
                    setPageSize(value === 'all' ? 'all' : parseInt(value));
                    setCurrentPage(1);
                  }}>
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                    </SelectContent>
                  </Select>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Columns3 className="w-4 h-4 mr-2" />
                        Columns
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.id}
                        onCheckedChange={() => toggleColumn('id')}
                      >
                        ID
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.company}
                        onCheckedChange={() => toggleColumn('company')}
                      >
                        Company
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.name}
                        onCheckedChange={() => toggleColumn('name')}
                        disabled
                      >
                        Primary Contact (Required)
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.email}
                        onCheckedChange={() => toggleColumn('email')}
                      >
                        {t.leads.email}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.phone}
                        onCheckedChange={() => toggleColumn('phone')}
                      >
                        {t.leads.phone} 1
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.phone_2}
                        onCheckedChange={() => toggleColumn('phone_2')}
                      >
                        {t.leads.phone} 2
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.source}
                        onCheckedChange={() => toggleColumn('source')}
                      >
                        {t.leads.source}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.tags}
                        onCheckedChange={() => toggleColumn('tags')}
                      >
                        Tags
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.assigned}
                        onCheckedChange={() => toggleColumn('assigned')}
                      >
                        {t.leads.assignedTo}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.status}
                        onCheckedChange={() => toggleColumn('status')}
                      >
                        {t.leads.status}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.value}
                        onCheckedChange={() => toggleColumn('value')}
                      >
                        {t.leads.value}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.last_contact}
                        onCheckedChange={() => toggleColumn('last_contact')}
                      >
                        {t.leads.lastActivity}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.next_follow_up}
                        onCheckedChange={() => toggleColumn('next_follow_up')}
                      >
                        {t.leads.followUp}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.active}
                        onCheckedChange={() => toggleColumn('active')}
                      >
                        Active
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={visibleColumns.date_created}
                        onCheckedChange={() => toggleColumn('date_created')}
                      >
                        Date Created
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button variant="outline" size="sm" onClick={() => handleExportCSV('dynamic')}>
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" disabled={selectedLeads.length === 0}>
                        Bulk Actions
                        {selectedLeads.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {selectedLeads.length}
                          </Badge>
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('new')}>
                        {t.leads.status} → {t.leads.newLead}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('contacted')}>
                        {t.leads.status} → {t.leads.contacted}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('qualified')}>
                        {t.leads.status} → {t.leads.qualified}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('proposal')}>
                        {t.leads.status} → {t.leads.proposalSent}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('negotiation')}>
                        {t.leads.status} → {t.leads.negotiation}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('won')}>
                        {t.leads.status} → {t.leads.won}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleBulkStatusChange('lost')}>
                        {t.leads.status} → {t.leads.lost}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleExportCSV('selectedOnly')}>
                        <Download className="w-4 h-4 mr-2" />
                        Export Selected
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={handleBulkDelete}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Selected
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['leads'] })}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            <CardContent className="p-0">
              {isMobile ? (
                <div className="px-3 py-3 space-y-0">
                  {paginatedLeads.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <UserPlus className="w-16 h-16 mx-auto mb-3 text-gray-300" />
                      <p className="font-medium">{t.leads.noLeads}</p>
                      <p className="text-sm mt-1">Try adjusting your search or filters</p>
                    </div>
                  )}
                  {paginatedLeads.map((lead) => {
                    const leadScore = getLeadScore(lead.id);
                    return (
                      <SwipeableCard
                        key={lead.id}
                        onCall={lead.phone ? () => handleCommunication(lead, 'phone') : null}
                        onEmail={lead.email ? () => handleCommunication(lead, 'email') : null}
                        onSMS={lead.phone ? () => handleCommunication(lead, 'sms') : null}
                        onDelete={() => handleDelete(lead.id)}
                        className="p-4 rounded-lg shadow-sm border border-gray-200"
                      >
                        <div
                          onClick={() => navigate(createPageUrl('LeadProfile') + `?id=${lead.id}`)}
                          className="space-y-2"
                          data-testid={`lead-card-${lead.id}`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1 pr-2 min-w-0">
                              <h3 className="font-semibold text-base text-gray-900 truncate">{lead.name}</h3>
                              {lead.company && (
                                <p className="text-sm text-gray-500 mt-0.5 truncate">{lead.company}</p>
                              )}
                            </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <Badge variant="outline" className={getStatusColor(lead.status)}>
                              {lead.status === 'new' ? t.leads.newLead : 
                               lead.status === 'contacted' ? t.leads.contacted :
                               lead.status === 'qualified' ? t.leads.qualified :
                               lead.status === 'proposal' ? t.leads.proposalSent :
                               lead.status === 'negotiation' ? t.leads.negotiation :
                               lead.status === 'won' ? t.leads.won :
                               lead.status === 'lost' ? t.leads.lost :
                               lead.status}
                            </Badge>
                            {renderTemperatureBadge(lead.id)}
                          </div>
                          </div>

                          <div className="space-y-1.5">
                            {lead.phone && (
                              <div className="flex items-center gap-2 text-sm">
                                <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <a href={`tel:${lead.phone}`} className="text-blue-600 font-medium" onClick={(e) => e.stopPropagation()}>
                                  {lead.phone}
                                </a>
                              </div>
                            )}
                            {lead.email && (
                              <div className="flex items-center gap-2 text-sm">
                                <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <span className="text-blue-600 truncate">{lead.email}</span>
                              </div>
                            )}
                            {(lead.street || lead.city) && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <span className="truncate">{[lead.street, lead.city, lead.state].filter(Boolean).join(', ')}</span>
                              </div>
                            )}
                          </div>

                          {lead.service_needed && (
                            <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 truncate">
                              {lead.service_needed}
                            </p>
                          )}

                          <div className="flex items-center justify-between text-xs text-gray-400 pt-1.5 border-t border-gray-100">
                            <span>{lead.source || 'No source'}</span>
                            {lead.value > 0 && (
                              <span className="font-semibold text-green-600 text-sm">${lead.value.toLocaleString()}</span>
                            )}
                            <span>{safeFormatDate(lead.created_date, 'MMM d')}</span>
                          </div>
                        </div>
                      </SwipeableCard>
                    );
                  })}
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-2 py-3 text-left w-8">
                        <Checkbox
                          checked={paginatedLeads.length > 0 && paginatedLeads.every(lead => selectedLeads.includes(lead.id))}
                          indeterminate={paginatedLeads.length > 0 && paginatedLeads.some(lead => selectedLeads.includes(lead.id)) && !paginatedLeads.every(lead => selectedLeads.includes(lead.id))}
                          onCheckedChange={handleSelectAll}
                          disabled={paginatedLeads.length === 0}
                          className="h-3.5 w-3.5 scale-90"
                        />
                      </th>
                      {visibleColumns.id && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                      )}
                      {visibleColumns.name && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-2">
                          <span>{t.leads.name}</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="flex items-center gap-1 hover:text-gray-700 ml-auto">
                                <span className="text-[10px] font-normal lowercase text-gray-400">
                                  {sortBy === 'created_date' ? (sortOrder === 'desc' ? 'Newest' : 'Oldest') : 'Sort'}
                                </span>
                                <Filter className="w-3 h-3 text-gray-400" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setSortBy('created_date'); setSortOrder('desc'); }}>
                                🆕 Newest First
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setSortBy('created_date'); setSortOrder('asc'); }}>
                                📅 Oldest First
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setSortBy('score'); setSortOrder('desc'); }}>
                                🔥 Hottest First
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { setSortBy('value'); setSortOrder('desc'); }}>
                                💰 Highest Value
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </th>
                      )}
                      {visibleColumns.company && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                      )}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <span className="sr-only">Sort</span>
                      </th>
                      {visibleColumns.email && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.email}</th>
                      )}
                      {visibleColumns.phone && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.phone}</th>
                      )}
                      {visibleColumns.phone_2 && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.phone} 2</th>
                      )}
                      {visibleColumns.address && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.address}</th>
                      )}
                      {visibleColumns.source && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.source}</th>
                      )}
                      {visibleColumns.assigned && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.assignedTo}</th>
                      )}
                      {visibleColumns.tags && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tags</th>
                      )}
                      {visibleColumns.status && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.status}</th>
                      )}
                      {visibleColumns.value && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.value}</th>
                      )}
                      {visibleColumns.last_contact && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.lastActivity}</th>
                      )}
                      {visibleColumns.next_follow_up && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t.leads.followUp}</th>
                      )}
                      {visibleColumns.active && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Active</th>
                      )}
                      {visibleColumns.date_created && (
                        <th className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          Date Created
                        </th>
                      )}
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedLeads.map((lead, index) => {
                      const leadWithInfo = getLeadWithContactInfo(lead);
                      const isOverdue = leadWithInfo.next_follow_up_date && new Date(leadWithInfo.next_follow_up_date).setHours(0,0,0,0) <= new Date().setHours(0,0,0,0);
                      const leadScore = getLeadScore(lead.id);
                      const isDuplicate = duplicateWarningsData.some(w => w.leadId === lead.id);

                      return (
                        <tr key={lead.id} className={`hover:bg-gray-50 ${
                          isDuplicate ? 'bg-yellow-50/50' :
                          isOverdue ? 'bg-red-50' :
                          leadScore?.temperature === 'hot' ? 'bg-red-50/30' : ''
                        }`}>
                          <td className="px-2 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={selectedLeads.includes(lead.id)}
                                onCheckedChange={() => handleSelectLead(lead.id)}
                                className="h-3.5 w-3.5 scale-90"
                              />
                              {isDuplicate && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div>
                                        <AlertCircle className="w-4 h-4 text-yellow-600 cursor-help" />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>⚠️ Possible duplicate - exists in Customers</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </td>
                          {visibleColumns.id && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{index + 1 + (currentPage - 1) * effectivePageSize}</td>
                          )}
                          {visibleColumns.name && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <button
                                onClick={() => navigate(createPageUrl('LeadProfile') + `?id=${lead.id}`)}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {lead.name}
                              </button>
                            </td>
                          )}
                          {visibleColumns.company && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">{lead.company || '-'}</td>
                          )}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {renderTemperatureBadge(lead.id)}
                            {leadScore && leadScore.score_history && leadScore.score_history.length > 1 && (
                              <button
                                onClick={() => setViewingLead(leadWithInfo)}
                                className="text-xs text-blue-600 hover:underline mt-1 block"
                              >
                                View history
                              </button>
                            )}
                          </td>
                          {visibleColumns.email && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-blue-600">{lead.email || '-'}</span>
                                {lead.email && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 hover:bg-blue-50"
                                    onClick={() => handleCommunication(lead, 'email')}
                                    title="Send email"
                                  >
                                    <Mail className="w-4 h-4 text-blue-600" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          )}
                          {visibleColumns.phone && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-900">{lead.phone || '-'}</span>
                                {lead.phone && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 hover:bg-green-50"
                                      onClick={() => handleCommunication(lead, 'phone')}
                                      title="Call"
                                    >
                                      <Phone className="w-4 h-4 text-green-600" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 hover:bg-purple-50"
                                      onClick={() => handleCommunication(lead, 'sms')}
                                      title="Send SMS"
                                    >
                                      <MessageCircle className="w-4 h-4 text-purple-600" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </td>
                          )}
                          {visibleColumns.phone_2 && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-900">{lead.phone_2 || '-'}</span>
                                {lead.phone_2 && (
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 hover:bg-green-50"
                                      onClick={() => {
                                        setSelectedLead({ ...lead, phone: lead.phone_2 });
                                        setShowDialer(true);
                                      }}
                                      title="Call"
                                    >
                                      <Phone className="w-4 h-4 text-green-600" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 hover:bg-purple-50"
                                      onClick={() => {
                                        setSelectedLead({ ...lead, phone: lead.phone_2 });
                                        setShowSMSDialog(true);
                                      }}
                                      title="Send SMS"
                                    >
                                      <MessageCircle className="w-4 h-4 text-purple-600" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </td>
                          )}
                          {visibleColumns.address && (
                            <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                              {[lead.street, lead.city, lead.state].filter(Boolean).join(', ') || '-'}
                            </td>
                          )}
                          {visibleColumns.source && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex flex-col gap-1">
                                {getSourceBadge(lead)}
                                {lead.lead_source && (
                                  <span className="text-xs text-gray-500 truncate max-w-[150px]" title={lead.lead_source}>
                                    {lead.lead_source}
                                  </span>
                                )}
                              </div>
                            </td>
                          )}
                          {visibleColumns.assigned && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              {(() => {
                                const assignedUsers = lead.assigned_to_users || (lead.assigned_to ? [lead.assigned_to] : []);
                                const staffAvatars = assignedUsers.map(email => {
                                  const staff = uniqueStaffProfiles.find(s => s.user_email === email);
                                  return {
                                    email,
                                    avatar_url: staff?.avatar_url || null,
                                    full_name: staff?.full_name || email,
                                    initials: staff?.full_name
                                      ? staff.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                                      : (email && email.length > 0 ? email[0].toUpperCase() : '?')
                                  };
                                });

                                if (staffAvatars.length === 0) {
                                  return <span className="text-gray-400">-</span>;
                                }

                                return (
                                  <div className="flex -space-x-2">
                                    {staffAvatars.slice(0, 3).map((staff) => (
                                      <TooltipProvider key={staff.email}>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <div className="flex-shrink-0">
                                              <Avatar className="w-8 h-8 border-2 border-white">
                                                <AvatarImage src={staff.avatar_url} alt={staff.full_name} />
                                                <AvatarFallback className="bg-blue-100 text-blue-600 text-xs font-semibold">
                                                  {staff.initials}
                                                </AvatarFallback>
                                              </Avatar>
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>{staff.full_name}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    ))}
                                    {staffAvatars.length > 3 && (
                                      <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 border-2 border-white flex items-center justify-center text-xs font-semibold">
                                        +{staffAvatars.length - 3}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          )}
                          {visibleColumns.tags && (
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1 max-w-[200px]">
                                {lead.tags && lead.tags.length > 0 ? (
                                  lead.tags.map(tag => (
                                    <Badge
                                      key={tag}
                                      variant="outline"
                                      className={getTagColor(tag)}
                                    >
                                      {tag}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </div>
                            </td>
                          )}
                          {visibleColumns.status && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Select value={lead.status} onValueChange={(v) => handleStatusChange(lead, v)}>
                                <SelectTrigger className="w-32 h-8">
                                  <Badge variant="outline" className={getStatusColor(lead.status)}>
                                    {lead.status === 'new' ? t.leads.newLead : 
                                     lead.status === 'contacted' ? t.leads.contacted :
                                     lead.status === 'qualified' ? t.leads.qualified :
                                     lead.status === 'proposal' ? t.leads.proposalSent :
                                     lead.status === 'negotiation' ? t.leads.negotiation :
                                     lead.status === 'won' ? t.leads.won :
                                     lead.status === 'lost' ? t.leads.lost :
                                     lead.status}
                                  </Badge>
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new">{t.leads.newLead}</SelectItem>
                                  <SelectItem value="contacted">{t.leads.contacted}</SelectItem>
                                  <SelectItem value="qualified">{t.leads.qualified}</SelectItem>
                                  <SelectItem value="proposal">{t.leads.proposalSent}</SelectItem>
                                  <SelectItem value="negotiation">{t.leads.negotiation}</SelectItem>
                                  <SelectItem value="won">{t.leads.won}</SelectItem>
                                  <SelectItem value="lost">{t.leads.lost}</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          )}
                          {visibleColumns.value && (
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-green-600">
                              ${(lead.value || 0).toLocaleString()}
                            </td>
                          )}
                          {visibleColumns.last_contact && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {safeFormatDate(leadWithInfo.last_contact_date, 'MMM d, yyyy')}
                              {leadWithInfo.communication_count > 0 && (
                                <Badge variant="outline" className="mt-1 text-xs">
                                  {leadWithInfo.communication_count} contacts
                                </Badge>
                              )}
                            </td>
                          )}
                          {visibleColumns.next_follow_up && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {leadWithInfo.next_follow_up_date ? (
                                <span className={isOverdue ? 'text-red-600 font-semibold' : 'text-gray-900'}>
                                  {safeFormatDate(leadWithInfo.next_follow_up_date, 'MMM d, yyyy')}
                                  {isOverdue && (
                                    <Badge variant="destructive" className="ml-1 text-xs">
                                      Overdue
                                    </Badge>
                                  )}
                                </span>
                              ) : (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                                      {t.leads.followUp}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent>
                                    <DropdownMenuItem onClick={() => handleSetFollowUp(lead, 1)}>
                                      Tomorrow
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleSetFollowUp(lead, 3)}>
                                      In 3 Days
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleSetFollowUp(lead, 7)}>
                                      In 1 Week
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleSetFollowUp(lead, 14)}>
                                      In 2 Weeks
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </td>
                          )}
                          {visibleColumns.active && (
                            <td className="px-4 py-3 whitespace-nowrap">
                              <Switch
                                checked={lead.is_active}
                                onCheckedChange={() => handleToggleActive(lead)}
                              />
                            </td>
                          )}
                          {visibleColumns.date_created && (
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                              {safeFormatDate(lead.created_date, 'yyyy-MM-dd')}
                            </td>
                          )}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                onClick={() => handleCreateEstimate(lead)}
                                className="bg-green-600 hover:bg-green-700 text-xs h-7"
                                title="Create estimate"
                              >
                                Create Estimate
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleScheduleMeeting(lead)}
                                className="text-xs h-7 w-7 p-0"
                                title="Schedule meeting"
                              >
                                📅
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 w-7 p-0">
                                    ⋮
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => navigate(createPageUrl('LeadProfile') + `?id=${lead.id}`)}>
                                    <Eye className="w-4 h-4 mr-2" />
                                    View Profile
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleEdit(lead)}>
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleConvertToCustomer(lead)}
                                    className="text-blue-600"
                                    disabled={convertToCustomerMutation.isPending}
                                  >
                                    <UserPlus className="w-4 h-4 mr-2" />
                                    {t.leads.convertToCustomer}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCommunication(lead, 'email')}>
                                    <Mail className="w-4 h-4 mr-2" />
                                    Send Email
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCommunication(lead, 'phone')}>
                                    <Phone className="w-4 h-4 mr-2" />
                                    Call
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCommunication(lead, 'sms')}>
                                   <MessageCircle className="w-4 h-4 mr-2" />
                                   Send SMS
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                   setTaskRelatedLead(lead);
                                   setShowTaskDialog(true);
                                  }}>
                                   <CheckCircle2 className="w-4 h-4 mr-2" />
                                   Add Related Task
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDelete(lead.id)} className="text-red-600">
                                   <Trash2 className="w-4 h-4 mr-2" />
                                   Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {paginatedLeads.length === 0 && (
                      <tr>
                        <td colSpan={16} className="px-6 py-12 text-center text-gray-500">
                          {t.leads.noLeads}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              )}

              {filteredLeads.length > 0 && pageSize !== 'all' && totalPages > 1 && (
                <div className="px-6 py-3 border-t flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    Showing {((currentPage - 1) * effectivePageSize) + 1} to {Math.min(currentPage * effectivePageSize, filteredLeads.length)} of {filteredLeads.length} leads
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inspections" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Inspection Leads</CardTitle>
              <p className="text-sm text-gray-500">Leads generated from property inspections</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {inspections.map(inspection => {
                  const relatedLead = leads.find(l => l.id === inspection.related_lead_id);
                  return (
                    <div key={inspection.id} className="p-4 border rounded-lg hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{inspection.client_name}</h3>
                          <p className="text-sm text-gray-600">{inspection.property_address}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline">{inspection.status}</Badge>
                            <Badge>{inspection.lead_source}</Badge>
                            {relatedLead && (
                              <Badge className="bg-green-100 text-green-800">
                                Lead: {relatedLead.status}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(createPageUrl(`InspectionCapture?id=${inspection.id}`))}
                        >
                          View Inspection
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {inspections.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <Camera className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No inspection leads yet</p>
                    <p className="text-sm">Inspections will automatically create leads here</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LeadDetailDialog
        viewingLead={viewingLead}
        onClose={() => setViewingLead(null)}
        onEdit={handleEdit}
        onConvertToCustomer={handleConvertToCustomer}
        isConverting={convertToCustomerMutation.isPending}
        onCreateInspection={(lead) => {
          navigate(createPageUrl('NewInspection') + `?lead_id=${lead.id}&client_name=${encodeURIComponent(lead.name)}&property_address=${encodeURIComponent([lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', '))}`);
        }}
        onCreateEstimate={handleCreateEstimate}
        onCreateAIEstimate={(lead) => {
          const params = new URLSearchParams({
            lead_id: lead.id,
            customer_name: lead.name || '',
            customer_email: lead.email || '',
            customer_phone: lead.phone || '',
            property_address: [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
          });
          navigate(createPageUrl('AIEstimator') + `?${params.toString()}`);
        }}
        onAddTask={(lead) => {
          setTaskRelatedLead(lead);
          setShowTaskDialog(true);
        }}
        onCall={(lead) => handleCommunication(lead, 'phone')}
        onEmail={(lead) => handleCommunication(lead, 'email')}
        onSMS={(lead) => handleCommunication(lead, 'sms')}
        onScheduleMeeting={handleScheduleMeeting}
        getLeadScore={getLeadScore}
        renderTemperatureBadge={renderTemperatureBadge}
        getStatusColor={getStatusColor}
        getSourceBadge={getSourceBadge}
        safeFormatDate={safeFormatDate}
        communications={communications}
        calendarEvents={calendarEvents}
        staffProfiles={staffProfiles}
        t={t}
      />

      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
        defaultNumber={selectedLead?.phone || selectedLead?.phone_2}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        defaultTo={selectedLead?.email}
        defaultName={selectedLead?.name}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        defaultTo={selectedLead?.phone || selectedLead?.phone_2}
        defaultName={selectedLead?.name}
      />

      <LeadCleanupDialog
        open={showCleanupDialog}
        onOpenChange={setShowCleanupDialog}
        emptyLeads={emptyLeads}
        leadsWithoutCompany={leadsWithoutCompany}
        duplicateLeadsToDelete={duplicateLeadsToDelete}
        duplicateWarningsData={duplicateWarningsData}
        cleanupEmptyLeadsMutation={cleanupEmptyLeadsMutation}
        backfillCompanyIdMutation={backfillCompanyIdMutation}
        deleteDuplicateLeadsMutation={deleteDuplicateLeadsMutation}
        resolveDuplicatesMutation={resolveDuplicatesMutation}
      />

      <QuickTaskDialog
        open={showTaskDialog}
        onOpenChange={setShowTaskDialog}
        relatedTo={taskRelatedLead}
        relationType="lead"
      />

      <Dialog open={!!duplicateConfirmInfo} onOpenChange={(open) => { if (!open) { setDuplicateConfirmInfo(null); setPendingLeadData(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="w-5 h-5" />
              Duplicate Lead Detected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-700">
              A lead with matching information already exists:
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-1">
              {duplicateConfirmInfo?.matchedName && <p><span className="font-medium">Name:</span> {duplicateConfirmInfo.matchedName}</p>}
              {duplicateConfirmInfo?.matchedPhone && <p><span className="font-medium">Phone:</span> {duplicateConfirmInfo.matchedPhone}</p>}
              {duplicateConfirmInfo?.matchedEmail && <p><span className="font-medium">Email:</span> {duplicateConfirmInfo.matchedEmail}</p>}
            </div>
            <p className="text-sm text-gray-500">Do you want to create a duplicate, or cancel and edit the existing lead instead?</p>
          </div>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="outline" onClick={() => { setDuplicateConfirmInfo(null); setPendingLeadData(null); }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => {
              if (pendingLeadData) createLeadMutation.mutate(pendingLeadData);
              setDuplicateConfirmInfo(null);
              setPendingLeadData(null);
            }}>
              Create Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}