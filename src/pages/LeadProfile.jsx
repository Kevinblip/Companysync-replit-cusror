import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  User,
  Phone,
  Mail,
  MapPin,
  ArrowLeft,
  DollarSign,
  FileText,
  Briefcase,
  Calendar,
  MessageCircle,
  UserPlus,
  Camera,
  Sparkles,
  CheckCircle2,
  Edit,
  TrendingUp,
  Flame,
  ThermometerSun,
  Snowflake,
  Paperclip,
  Download,
  Eye,
  Folder,
  Plus,
  Loader2,
  Trash2,
  Send,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { format } from "date-fns";
import QuickTaskDialog from "@/components/tasks/QuickTaskDialog";
import AssignmentDialog from "@/components/inspections/AssignmentDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import Dialer from "@/components/communication/Dialer";
import EmailDialog from "@/components/communication/EmailDialog";
import SMSDialog from "@/components/communication/SMSDialog";
import useRoleBasedData from "@/components/hooks/useRoleBasedData";

export default function LeadProfile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState(null);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [viewingFile, setViewingFile] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [isNewInspectionOpen, setIsNewInspectionOpen] = useState(false);
  const [bidMailerStatus, setBidMailerStatus] = useState('idle');
  const [bidMailerResult, setBidMailerResult] = useState(null);

  const { user, myCompany, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (id) {
      setLeadId(id);
    }
  }, []);

  const { data: lead, isLoading: leadLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: async () => {
      if (!leadId) return null;
      // Fetch directly by ID to bypass company filtering issues
      const results = await base44.entities.Lead.filter({ id: leadId });
      return results?.[0] || null;
    },
    enabled: !!leadId,
  });

  const { data: communications = [] } = useQuery({
    queryKey: ['lead-communications', leadId, myCompany?.id],
    queryFn: () => (leadId && myCompany) ? base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!leadId && !!myCompany,
    initialData: [],
  });

  const { data: calendarEvents = [] } = useQuery({
    queryKey: ['lead-events', leadId, myCompany?.id],
    queryFn: () => (leadId && myCompany) ? base44.entities.CalendarEvent.filter({ company_id: myCompany.id }, "-start_time") : [],
    enabled: !!leadId && !!myCompany,
    initialData: [],
  });

  const { data: leadScores = [] } = useQuery({
    queryKey: ['lead-scores', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.LeadScore.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', leadId, lead?.name, myCompany?.id],
    queryFn: async () => {
      if (!leadId || !lead || !myCompany) return [];
      const byId = await base44.entities.Document.filter({ company_id: myCompany.id, related_entity_id: leadId });
      const byName = lead.name ? await base44.entities.Document.filter({ company_id: myCompany.id, related_customer: lead.name }) : [];

      // Merge and deduplicate
      const allFiles = [...byId, ...byName];
      const uniqueFiles = allFiles.filter((file, index, self) => 
        index === self.findIndex(f => f.id === file.id)
      );
      return uniqueFiles;
    },
    enabled: !!leadId && !!lead && !!myCompany,
    initialData: [],
  });

  const { data: inspectionJobs = [] } = useQuery({
    queryKey: ['lead-inspection-jobs', leadId, lead?.name, myCompany?.id],
    queryFn: async () => {
      if (!leadId || !lead || !myCompany) return [];
      const byId = await base44.entities.InspectionJob.filter({ related_lead_id: leadId, company_id: myCompany.id });
      const byName = lead.name ? await base44.entities.InspectionJob.filter({ client_name: lead.name, company_id: myCompany.id }) : [];
      const merged = [...byId, ...byName];
      return merged.filter((job, idx, self) => idx === self.findIndex(j => j.id === job.id));
    },
    enabled: !!leadId && !!lead && !!myCompany,
    initialData: [],
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
    initialData: [],
  });

  const { data: linkedEstimates = [] } = useQuery({
    queryKey: ['lead-estimates', leadId, lead?.name, lead?.email, myCompany?.id],
    queryFn: async () => {
      if (!leadId || !lead) return [];
      const companyFilter = myCompany?.id ? { company_id: myCompany.id } : {};
      const results = await Promise.allSettled([
        base44.entities.Estimate.filter({ lead_id: leadId, ...companyFilter }),
        lead.name ? base44.entities.Estimate.filter({ customer_name: { $contains: lead.name }, ...companyFilter }) : Promise.resolve([]),
        lead.email ? base44.entities.Estimate.filter({ customer_email: lead.email, ...companyFilter }) : Promise.resolve([]),
      ]);
      const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
      return all.filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);
    },
    enabled: !!leadId && !!lead,
    initialData: [],
  });

  const { data: bidMailerCheck } = useQuery({
    queryKey: ['bid-mailer-status', leadId],
    queryFn: async () => {
      if (!leadId) return { sent_recently: false };
      const resp = await fetch(`/api/hooks/bid-mailer-status?lead_id=${encodeURIComponent(leadId)}`);
      if (!resp.ok) return { sent_recently: false };
      return resp.json();
    },
    enabled: !!leadId,
    initialData: { sent_recently: false },
  });

  const handleSendBidMailer = async () => {
    if (!lead || !myCompany) return;
    const address = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ');
    if (!address) {
      toast.error('This lead has no address. Add an address before sending a bid mailer.');
      return;
    }
    const fieldPhotos = documents.filter(d => d.category === 'front' || d.category === 'damage' || d.category === 'roof_detail');
    const fieldPhotoUrl = fieldPhotos[0]?.file_url || '';
    setBidMailerStatus('sending');
    try {
      const currentUser = staffProfiles.find(s => s.user_email === user?.email);
      const resp = await fetch('/api/hooks/bid-mailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          address,
          field_photo_url: fieldPhotoUrl,
          rep_name: currentUser?.full_name || currentUser?.name || user?.full_name || user?.email || ''
        })
      });
      const result = await resp.json();
      if (!resp.ok) {
        setBidMailerStatus('error');
        toast.error(result.message || result.error || 'Failed to send bid mailer');
        return;
      }
      setBidMailerStatus('sent');
      setBidMailerResult(result);
      queryClient.invalidateQueries({ queryKey: ['bid-mailer-status', leadId] });
      queryClient.invalidateQueries({ queryKey: ['lead-communications', leadId] });
      toast.success(result.dry_run
        ? `Bid mailer generated (dry run) for ${result.owner_name} — $${result.total_bid?.toLocaleString()}`
        : `Bid mailer sent to ${result.owner_name} — $${result.total_bid?.toLocaleString()}`);
    } catch (err) {
      setBidMailerStatus('error');
      toast.error('Failed to send bid mailer: ' + err.message);
    }
  };


  const leadDirectValue = Number(lead?.value) || 0;
  const estimatesMaxValue = linkedEstimates.length > 0 ? Math.max(...linkedEstimates.map(e => Number(e.total_rcv || e.amount || 0))) : 0;
  const effectiveLeadValue = leadDirectValue || estimatesMaxValue;

  const leadScore = leadScores.find(s => s.lead_id === leadId);

  const uploadFileMutation = useMutation({
    mutationFn: async (file) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      
      return base44.entities.Document.create({
        company_id: myCompany?.id,
        document_name: file.name,
        file_url: file_url,
        file_size: file.size,
        file_type: file.type,
        category: 'other',
        related_entity_type: 'Lead',
        related_entity_id: leadId,
        uploaded_by: user?.email,
        description: `Uploaded from lead profile`
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setUploadingFile(false);
      setShowFileUpload(false);
      toast.success('✅ File uploaded!');
    },
    onError: (error) => {
      setUploadingFile(false);
      toast.error('Failed to upload: ' + error.message);
    }
  });

  const deleteFileMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('✅ File deleted!');
    },
    onError: (error) => {
      toast.error('Failed to delete: ' + error.message);
    }
  });

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    setUploadingFile(true);
    for (const file of files) {
      await uploadFileMutation.mutateAsync(file);
    }
  };

  useEffect(() => {
    if (lead && showEditDialog && !editForm) {
      setEditForm({
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
        value: lead.value || 0,
        notes: lead.notes || "",
        assigned_to_users: lead.assigned_to_users || [],
      });
    }
  }, [lead, showEditDialog, editForm]);

  const updateLeadMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Lead.update(id, data),
    onMutate: ({ id }) => {
      const cachedLead = queryClient.getQueryData(['lead', id]) || lead;
      return { previousAssignees: cachedLead?.assigned_to_users || [] };
    },
    onSuccess: async (updatedLead, variables, context) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      setShowEditDialog(false);
      setEditForm(null);
      toast.success('✅ Lead updated successfully!');

      // Notify newly assigned reps
      const prevAssignees = context?.previousAssignees || [];
      const newAssignees = variables.data.assigned_to_users || [];
      const addedAssignees = newAssignees.filter(e => !prevAssignees.includes(e));

      if (addedAssignees.length > 0 && myCompany?.id) {
        try {
          const staffData = staffProfiles.length > 0
            ? staffProfiles
            : await base44.entities.StaffProfile.filter({ company_id: myCompany.id });
          const leadName = updatedLead?.name || variables.data.name || 'a lead';
          const actorName = user?.full_name || user?.email || 'Someone';
          const assigneeNames = addedAssignees.map(email => {
            const sp = staffData.find(s => s.user_email === email);
            return sp?.full_name || email;
          }).join(', ');

          const recipients = new Set(addedAssignees);
          if (myCompany?.created_by) {
            recipients.add(myCompany.created_by);
          }

          for (const recipientEmail of recipients) {
            const isAssignee = addedAssignees.includes(recipientEmail);
            const title = isAssignee ? '📋 Lead Assigned to You' : '📋 Lead Reassigned';
            const message = isAssignee
              ? `${actorName} assigned you to lead: ${leadName}`
              : `${actorName} assigned lead "${leadName}" to ${assigneeNames}`;
            try {
              await base44.entities.Notification.create({
                company_id: myCompany.id,
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
                companyId: myCompany.id,
                skipLogging: true
              });
            } catch (notifError) {
              console.error('Failed to notify', recipientEmail, notifError);
            }
          }
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        } catch (error) {
          console.error('Failed to send assignment notifications:', error);
        }
      }
    },
    onError: (error) => {
      toast.error('Failed to update lead: ' + error.message);
    }
  });

  const convertToCustomerMutation = useMutation({
    mutationFn: async (leadData) => {
      const customerData = {
        company_id: myCompany?.id || leadData.company_id,
        name: leadData.name,
        company_name: leadData.company || "",
        email: leadData.email || "",
        phone: leadData.phone || "",
        phone_2: leadData.phone_2 || "",
        street: leadData.street || "",
        city: leadData.city || "",
        state: leadData.state || "",
        zip: leadData.zip || "",
        address: leadData.address || "",
        customer_type: "residential",
        source: leadData.source || "other",
        referral_source: leadData.lead_source || "",
        is_active: leadData.is_active !== false,
        notes: [
          leadData.notes || "",
          `\n\n--- Converted from Lead ---`,
          `Original Lead ID: ${leadData.id}`,
          `Lead Status: ${leadData.status}`,
          `Lead Value: $${leadData.value || 0}`,
          `Created: ${format(new Date(leadData.created_date), 'MMM d, yyyy')}`,
        ].filter(Boolean).join("\n"),
        assigned_to: leadData.assigned_to_users?.[0] || leadData.assigned_to || "",
        assigned_to_users: Array.isArray(leadData.assigned_to_users) ? leadData.assigned_to_users : (leadData.assigned_to ? [leadData.assigned_to] : [])
      };

      const newCustomer = await base44.entities.Customer.create(customerData);
      await base44.entities.Lead.delete(leadData.id);

      return newCustomer;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      alert(`✅ Lead converted to customer successfully!`);
      navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`);
    },
    onError: (error) => {
      alert(`❌ Failed to convert lead: ${error.message}`);
    }
  });

  const leadComms = communications.filter(c => {
    const matchByLeadId = c.lead_id && leadId && c.lead_id === leadId;
    const matchByName = c.contact_name && lead?.name && c.contact_name.toLowerCase() === lead.name.toLowerCase();
    const matchByPhone1 = c.contact_phone && lead?.phone && c.contact_phone === lead.phone;
    const matchByPhone2 = c.contact_phone && lead?.phone_2 && c.contact_phone === lead.phone_2;
    const matchByEmail = c.contact_email && lead?.email && c.contact_email.toLowerCase() === lead.email.toLowerCase();

    return matchByLeadId || matchByName || matchByPhone1 || matchByPhone2 || matchByEmail;
  });

  const leadEvents = calendarEvents.filter(e =>
    e.related_lead && lead?.name && e.related_lead.toLowerCase() === lead.name.toLowerCase()
  );

  const filesByCategory = documents.reduce((acc, file) => {
    const cat = file.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(file);
    return acc;
  }, {});

  const defaultCategories = [
    { value: "front", label: "Front View", icon: "🏠" },
    { value: "rear", label: "Rear View", icon: "🏡" },
    { value: "left_slope", label: "Left Slope", icon: "📐" },
    { value: "right_slope", label: "Right Slope", icon: "📐" },
    { value: "left_elevation", label: "Left Elevation", icon: "🏢" },
    { value: "right_elevation", label: "Right Elevation", icon: "🏢" },
    { value: "roof_detail", label: "Roof Detail", icon: "🔍" },
    { value: "damage", label: "Damage Photo", icon: "⚠️" },
    { value: "contract", label: "Contract", icon: "📄" },
    { value: "invoice", label: "Invoice", icon: "🧾" },
    { value: "other", label: "Other", icon: "📸" }
  ];

  if (leadLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
            <p className="text-gray-500">Loading lead...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 🔐 Access guard: non-admins can only view their own leads
  const canAccessLead = !lead || !effectiveUserEmail || !isPermissionsReady || isAdmin ||
    hasPermission('leads', 'view_global') ||
    lead.assigned_to === effectiveUserEmail ||
    lead.assigned_to_users?.includes(effectiveUserEmail) ||
    lead.created_by === effectiveUserEmail;

  if (lead && !leadLoading && !canAccessLead) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-gray-500 mb-4">You don't have access to this lead.</p>
            <Button onClick={() => navigate(createPageUrl('Leads'))}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Leads
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-gray-500 mb-4">Lead not found</p>
            <Button onClick={() => navigate(createPageUrl('Leads'))}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Leads
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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

  const renderTemperatureBadge = () => {
    if (!leadScore) return null;

    const tempConfig = {
      hot: { icon: Flame, color: 'bg-red-100 text-red-700 border-red-300', label: 'HOT' },
      warm: { icon: ThermometerSun, color: 'bg-orange-100 text-orange-700 border-orange-300', label: 'WARM' },
      cold: { icon: Snowflake, color: 'bg-blue-100 text-blue-700 border-blue-300', label: 'COLD' }
    };

    const config = tempConfig[leadScore.temperature] || tempConfig.cold;
    const Icon = config.icon;

    return (
      <Badge variant="outline" className={`${config.color} flex items-center gap-1 font-semibold text-lg px-3 py-1`}>
        <Icon className="w-5 h-5" />
        {leadScore.total_score}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster richColors position="top-right" />
      {/* Gradient Header */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-500 to-purple-600 text-white p-6 md:p-8">
        <div className="max-w-6xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => navigate(createPageUrl('Leads'))}
            className="text-white hover:bg-white/20 mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Leads
          </Button>

          <div className="flex items-start gap-6">
            {/* Large Avatar Circle */}
            <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-12 h-12 text-blue-600" />
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-3xl md:text-4xl font-bold">{lead.name}</h1>
                {renderTemperatureBadge()}
              </div>
              
              <div className="flex gap-2 flex-wrap mb-4">
                <Badge variant="outline" className={`${getStatusColor(lead.status)} text-sm`}>
                  {lead.status}
                </Badge>
                <Badge className="bg-white/20 text-white border-white/30 text-sm">
                  {lead.is_active ? '✅ Active' : '❌ Inactive'}
                </Badge>
                {lead.source && (
                  <Badge className="bg-white/20 text-white border-white/30 text-sm">
                    {lead.source.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>

              {/* Action Buttons Grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Button
                  onClick={() => {
                    const params = new URLSearchParams({
                      lead_id: lead.id,
                      customer_name: lead.name || '',
                      customer_email: lead.email || '',
                      customer_phone: lead.phone || '',
                      property_address: [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
                    });
                    navigate(createPageUrl('CreateEstimate') + `?${params.toString()}`);
                  }}
                  className="bg-white text-blue-600 hover:bg-blue-50 h-12"
                  data-testid="button-new-estimate"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  New Estimate
                </Button>

                <Button
                  onClick={() => {
                    const params = new URLSearchParams({
                      lead_id: lead.id,
                      customer_name: lead.name || '',
                      customer_email: lead.email || '',
                      customer_phone: lead.phone || '',
                      property_address: [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
                    });
                    navigate(createPageUrl('AIEstimator') + `?${params.toString()}`);
                  }}
                  className="bg-white text-purple-600 hover:bg-purple-50 h-12"
                  data-testid="button-ai-estimate"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  AI Estimate
                </Button>

                <Button
                  onClick={() => navigate(createPageUrl('NewInspection') + `?lead_id=${lead.id}&client_name=${encodeURIComponent(lead.name)}&property_address=${encodeURIComponent([lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', '))}`)}
                  className="bg-white text-orange-600 hover:bg-orange-50 h-12"
                  data-testid="button-new-inspection"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  New Inspection
                </Button>

                <Button
                  onClick={() => setShowDialer(true)}
                  className="bg-white text-green-600 hover:bg-green-50 h-12"
                  data-testid="button-call"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call
                </Button>

                {lead.street && (
                  <Button
                    onClick={handleSendBidMailer}
                    disabled={bidMailerStatus === 'sending' || bidMailerCheck?.sent_recently}
                    className={`h-12 ${bidMailerCheck?.sent_recently ? 'bg-gray-300 text-gray-600 cursor-not-allowed' : bidMailerStatus === 'sent' ? 'bg-emerald-500 text-white' : 'bg-white text-amber-600 hover:bg-amber-50'}`}
                    data-testid="button-send-bid-mailer"
                  >
                    {bidMailerStatus === 'sending' ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                    ) : bidMailerCheck?.sent_recently ? (
                      <><CheckCircle2 className="w-4 h-4 mr-2" />Mailer Sent</>
                    ) : bidMailerStatus === 'sent' ? (
                      <><CheckCircle2 className="w-4 h-4 mr-2" />Sent!</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" />Bid Mailer</>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Sidebar Navigation */}
          <div className="md:col-span-3 space-y-2">
            <Card>
              <CardContent className="p-0">
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('profile-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <User className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Profile</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('communications-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <MessageCircle className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Communications ({leadComms.length})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('meetings-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <Calendar className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Meetings ({leadEvents.length})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('files-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <Folder className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Files ({documents.length})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('crewcam-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <Camera className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">CrewCam ({inspectionJobs.length})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors flex items-center gap-3"
                  onClick={() => setShowTaskDialog(true)}
                >
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Add Task</span>
                </button>
              </CardContent>
            </Card>

            <Button
              onClick={() => convertToCustomerMutation.mutate(lead)}
              disabled={convertToCustomerMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 h-12"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              {convertToCustomerMutation.isPending ? 'Converting...' : 'Convert to Customer'}
            </Button>

            <Button
              onClick={() => setShowEditDialog(true)}
              variant="outline"
              className="w-full h-12"
            >
              <Edit className="w-4 h-4 mr-2" />
              Edit Lead
            </Button>
          </div>

          {/* Main Content */}
          <div className="md:col-span-9 space-y-6">
            {/* Lead Details */}
            <Card id="profile-section">
              <CardHeader>
                <CardTitle>Lead Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-500 text-xs">Primary Contact Name</Label>
                    <p className="font-semibold text-lg">{lead.name}</p>
                  </div>

                  {lead.company && (
                    <div>
                      <Label className="text-gray-500 text-xs">Company</Label>
                      <p className="font-semibold text-lg flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-gray-400" />
                        {lead.company}
                      </p>
                    </div>
                  )}

                  {lead.email && (
                    <div>
                      <Label className="text-gray-500 text-xs">Email</Label>
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <a href={`mailto:${lead.email}`} className="font-medium text-blue-600 hover:underline">
                          {lead.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {lead.phone && (
                    <div>
                      <Label className="text-gray-500 text-xs">Phone</Label>
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <a href={`tel:${lead.phone}`} className="font-medium text-green-600 hover:underline">
                          {lead.phone}
                        </a>
                      </div>
                    </div>
                  )}

                  {lead.phone_2 && (
                    <div>
                      <Label className="text-gray-500 text-xs">Phone 2</Label>
                      <div className="flex items-center gap-2">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <a href={`tel:${lead.phone_2}`} className="font-medium text-green-600 hover:underline">
                          {lead.phone_2}
                        </a>
                      </div>
                    </div>
                  )}

                  {(lead.street || lead.city) && (
                    <div className="col-span-2">
                      <Label className="text-gray-500 text-xs">Address</Label>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-gray-400 mt-1" />
                        <p className="font-medium">
                          {lead.street && <span>{lead.street}<br /></span>}
                          {lead.city && <span>{lead.city}, </span>}
                          {lead.state && <span>{lead.state} </span>}
                          {lead.zip && <span>{lead.zip}</span>}
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <Label className="text-gray-500 text-xs">Estimated Value</Label>
                    <p className="font-semibold text-lg text-green-600 flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      ${effectiveLeadValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {linkedEstimates.length > 0 && <p className="text-xs text-gray-400 mt-0.5">{linkedEstimates.length} estimate{linkedEstimates.length !== 1 ? 's' : ''} on file</p>}
                  </div>

                  <div>
                    <Label className="text-gray-500 text-xs">Assigned To</Label>
                    {lead.assigned_to_users && lead.assigned_to_users.length > 0 ? (
                      <div className="flex -space-x-2 mt-1">
                        {lead.assigned_to_users.map(email => {
                          const staff = staffProfiles.find(s => s.user_email === email);
                          const initials = staff?.full_name
                            ? staff.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                            : (email?.[0]?.toUpperCase() || '?');
                          return (
                            <TooltipProvider key={email}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Avatar className="w-8 h-8 border-2 border-white cursor-default">
                                    <AvatarImage src={staff?.avatar_url} alt={staff?.full_name || email} />
                                    <AvatarFallback className="bg-blue-100 text-blue-600 text-xs font-semibold">
                                      {initials}
                                    </AvatarFallback>
                                  </Avatar>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{staff?.full_name || email}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="font-medium text-gray-400 mt-1">Not assigned</p>
                    )}
                  </div>

                  <div>
                    <Label className="text-gray-500 text-xs">Created Date</Label>
                    <p className="font-medium">{format(new Date(lead.created_date), 'MMM d, yyyy')}</p>
                  </div>
                </div>

                {lead.notes && (
                  <div className="pt-4 border-t">
                    <Label className="text-gray-500 text-xs">Notes</Label>
                    <p className="mt-2 text-gray-700 whitespace-pre-wrap">{lead.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Score History */}
            {leadScore && leadScore.score_history && leadScore.score_history.length > 0 && (
              <Card id="score-section">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Score History
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[...leadScore.score_history].reverse().slice(0, 10).map((entry, idx) => (
                    <div key={idx} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{entry.actionDescription || entry.action}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {format(new Date(entry.timestamp), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`${entry.points > 0 ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'} font-semibold`}
                      >
                        {entry.points > 0 ? '+' : ''}{entry.points}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Communications */}
            <Card id="communications-section">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  Communications ({leadComms.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {leadComms.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No communications yet</p>
                    <div className="flex gap-2 justify-center mt-4">
                      <Button size="sm" onClick={() => setShowDialer(true)}>
                        <Phone className="w-4 h-4 mr-2" />
                        Call
                      </Button>
                      <Button size="sm" onClick={() => setShowEmailDialog(true)}>
                        <Mail className="w-4 h-4 mr-2" />
                        Email
                      </Button>
                      <Button size="sm" onClick={() => setShowSMSDialog(true)}>
                        <MessageCircle className="w-4 h-4 mr-2" />
                        SMS
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {leadComms.slice(0, 10).map(comm => {
                      const recUrl = comm.recording_url || comm.data?.recording_url;
                      const transcript = comm.transcription || comm.data?.transcription;
                      const isCall = comm.communication_type === 'call';
                      const isOutbound = comm.direction === 'outbound';
                      const msgText = comm.message || comm.body || '';
                      const ts = comm.created_date || comm.created_at;
                      return (
                        <div key={comm.id} className="p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-start gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                              isCall ? 'bg-green-100' :
                              comm.communication_type === 'email' ? 'bg-blue-100' :
                              'bg-purple-100'
                            }`}>
                              {isCall && <Phone className="w-5 h-5 text-green-600" />}
                              {comm.communication_type === 'email' && <Mail className="w-5 h-5 text-blue-600" />}
                              {!isCall && comm.communication_type !== 'email' && <MessageCircle className="w-5 h-5 text-purple-600" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">{comm.communication_type}</Badge>
                                  {comm.direction && <Badge variant="outline" className="capitalize text-xs">{isOutbound ? 'Out' : 'In'}</Badge>}
                                  {comm.duration_minutes && <span className="text-xs text-gray-400">{Math.round(comm.duration_minutes)} min</span>}
                                </div>
                                <span className="text-xs text-gray-500 flex-shrink-0">
                                  {ts ? format(new Date(ts), 'MMM d, h:mm a') : ''}
                                </span>
                              </div>
                              {comm.subject && <p className="font-medium text-sm mb-1">{comm.subject}</p>}
                              {msgText && <p className="text-sm text-gray-600 truncate">{msgText}</p>}
                              {comm.ai_summary && (
                                <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">{comm.ai_summary}</p>
                              )}
                              {recUrl && (
                                <div className="mt-2">
                                  <audio controls className="w-full h-8" preload="metadata" data-testid={`audio-player-${comm.id}`}>
                                    <source src={`/api/twilio/recording-proxy?url=${encodeURIComponent(recUrl)}${myCompany?.id ? `&companyId=${encodeURIComponent(myCompany.id)}` : ''}`} type="audio/mpeg" />
                                  </audio>
                                </div>
                              )}
                              {transcript && (
                                <div className="mt-2 p-2 bg-white border border-gray-200 rounded text-xs text-gray-600 whitespace-pre-line max-h-32 overflow-y-auto" data-testid={`transcript-${comm.id}`}>
                                  {transcript}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Meetings */}
            <Card id="meetings-section">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Meetings ({leadEvents.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {leadEvents.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No meetings scheduled</p>
                    <Button
                      size="sm"
                      onClick={() => navigate(createPageUrl('Calendar') + `?lead=${encodeURIComponent(lead.name)}&action=new`)}
                      className="mt-3"
                    >
                      📅 Schedule Meeting
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {leadEvents.slice(0, 5).map(event => (
                      <div key={event.id} className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="font-semibold">{event.title}</h4>
                            <p className="text-sm text-gray-600 mt-1">{event.description}</p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                              <span>📅 {format(new Date(event.start_time), 'MMM d, yyyy h:mm a')}</span>
                              {event.location && <span>📍 {event.location}</span>}
                            </div>
                          </div>
                          <Badge>{event.event_type}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Files */}
            <Card id="files-section">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Folder className="w-5 h-5 text-blue-600" />
                    Files & Photos ({documents.length})
                  </h2>
                  <Button onClick={() => setShowFileUpload(!showFileUpload)} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Upload Files
                  </Button>
                </div>

                {showFileUpload && (
                  <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
                    <Label>Select Files</Label>
                    <Input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      multiple
                      onChange={handleFileUpload}
                      disabled={uploadingFile}
                    />
                    {uploadingFile && (
                      <div className="mt-2 flex items-center gap-2 text-blue-600">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Uploading...</span>
                      </div>
                    )}
                  </div>
                )}

                {Object.keys(filesByCategory).length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Folder className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p>No files uploaded yet</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(filesByCategory).sort(([catA], [catB]) => {
                      if (catA === 'other') return 1;
                      if (catB === 'other') return -1;
                      const labelA = defaultCategories.find(c => c.value === catA)?.label || catA.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                      const labelB = defaultCategories.find(c => c.value === catB)?.label || catB.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                      return labelA.localeCompare(labelB);
                    }).map(([category, categoryFiles]) => {
                      const catInfo = defaultCategories.find(c => c.value === category) || { 
                        label: category.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase()), 
                        icon: "📁"
                      };
                      
                      return (
                        <div key={category} className="border rounded-lg p-4 bg-white">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="font-semibold flex items-center gap-2">
                              <span>{catInfo.icon}</span>
                              <span>{catInfo.label}</span>
                              <Badge variant="secondary">{categoryFiles.length}</Badge>
                            </h3>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {categoryFiles.map((doc) => {
                              const isImage = doc.file_type?.startsWith('image/');
                              const isPDF = doc.file_type === 'application/pdf';
                              
                              return (
                                <div 
                                  key={doc.id}
                                  className="group relative border rounded-lg overflow-hidden bg-gray-50 hover:shadow-lg transition-all cursor-pointer"
                                  onClick={() => setViewingFile(doc)}
                                >
                                  {isImage ? (
                                    <img 
                                      src={doc.file_url} 
                                      alt={doc.document_name}
                                      className="w-full h-40 object-cover"
                                    />
                                  ) : isPDF ? (
                                    <div className="w-full h-40 bg-red-100 flex items-center justify-center">
                                      <FileText className="w-12 h-12 text-red-600" />
                                    </div>
                                  ) : (
                                    <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
                                      <FileText className="w-12 h-12 text-gray-400" />
                                    </div>
                                  )}
                                  <div className="p-3">
                                    <p className="font-medium text-sm truncate">{doc.document_name}</p>
                                    <p className="text-xs text-gray-400 mt-1">
                                      {format(new Date(doc.created_date), 'MMM d, yyyy')}
                                    </p>
                                  </div>
                                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="bg-white h-7 w-7 text-red-600"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (confirm('Delete this file?')) {
                                          deleteFileMutation.mutate(doc.id);
                                        }
                                      }}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>


            <Card id="crewcam-section">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Camera className="w-5 h-5 text-blue-600" />
                    CrewCam Inspections ({inspectionJobs.length})
                  </h2>
                  <Button onClick={() => setIsNewInspectionOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                    <Camera className="w-4 h-4 mr-2" />
                    New Inspection
                  </Button>
                </div>
                {inspectionJobs.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">
                    <Camera className="w-14 h-14 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No CrewCam jobs yet</p>
                    <p className="text-sm mt-1">Create an inspection assignment for this lead</p>
                    <Button onClick={() => setIsNewInspectionOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700">
                      <Camera className="w-4 h-4 mr-2" />
                      Create First Inspection
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {inspectionJobs.map(job => (
                      <div key={job.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer" onClick={() => navigate(createPageUrl('InspectionsDashboard') + `?job=${job.id}`)}>
                        <div>
                          <p className="font-medium">{job.property_address || job.client_name || 'Unnamed Job'}</p>
                          <p className="text-sm text-gray-500">{job.inspection_type || 'Property Damage Assessment'} • {job.scheduled_date ? new Date(job.scheduled_date).toLocaleDateString() : 'No date set'}</p>
                        </div>
                        <Badge variant={job.status === 'completed' ? 'default' : job.status === 'in_progress' ? 'secondary' : 'outline'}>
                          {job.status || 'assigned'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </div>

      <QuickTaskDialog
        open={showTaskDialog}
        onOpenChange={setShowTaskDialog}
        relatedTo={lead}
        relationType="lead"
      />

      <Dialer
        open={showDialer}
        onOpenChange={setShowDialer}
        defaultNumber={lead.phone || lead.phone_2}
        defaultName={lead.name}
      />
      <EmailDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        defaultTo={lead.email}
        defaultName={lead.name}
      />
      <SMSDialog
        open={showSMSDialog}
        onOpenChange={setShowSMSDialog}
        defaultTo={lead.phone || lead.phone_2}
        defaultName={lead.name}
      />

      {/* Edit Lead Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Lead</DialogTitle>
          </DialogHeader>
          {editForm && (
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!editForm.name) {
                toast.error('Please enter a name');
                return;
              }
              updateLeadMutation.mutate({ id: lead.id, data: editForm });
            }} className="space-y-4 py-4 pb-24">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Primary Contact Name *</Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm({...editForm, name: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <Label>Company</Label>
                  <Input
                    value={editForm.company}
                    onChange={(e) => setEditForm({...editForm, company: e.target.value})}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Phone</Label>
                  <Input
                    type="tel"
                    value={editForm.phone}
                    onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                  />
                </div>
                <div>
                  <Label>Phone 2</Label>
                  <Input
                    type="tel"
                    value={editForm.phone_2}
                    onChange={(e) => setEditForm({...editForm, phone_2: e.target.value})}
                  />
                </div>
              </div>

              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Address</h3>
                <div className="space-y-4">
                  <div>
                    <Label>Street Address</Label>
                    <Input
                      value={editForm.street}
                      onChange={(e) => setEditForm({...editForm, street: e.target.value})}
                      placeholder="123 Main Street"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label>City</Label>
                      <Input
                        value={editForm.city}
                        onChange={(e) => setEditForm({...editForm, city: e.target.value})}
                        placeholder="Cleveland"
                      />
                    </div>
                    <div>
                      <Label>State</Label>
                      <Input
                        value={editForm.state}
                        onChange={(e) => setEditForm({...editForm, state: e.target.value})}
                        placeholder="OH"
                        maxLength={2}
                      />
                    </div>
                    <div>
                      <Label>Zip Code</Label>
                      <Input
                        value={editForm.zip}
                        onChange={(e) => setEditForm({...editForm, zip: e.target.value})}
                        placeholder="44101"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Status</Label>
                  <Select value={editForm.status} onValueChange={(v) => setEditForm({...editForm, status: v})}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="proposal">Proposal</SelectItem>
                      <SelectItem value="negotiation">Negotiation</SelectItem>
                      <SelectItem value="won">Won</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Estimated Value</Label>
                  <Input
                    type="number"
                    value={editForm.value}
                    onChange={(e) => setEditForm({...editForm, value: parseFloat(e.target.value) || 0})}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <Label>Assigned To</Label>
                <Select
                  value={editForm.assigned_to_users?.[0] || ""}
                  onValueChange={(v) => {
                    const currentUsers = editForm.assigned_to_users || [];
                    let updatedUsers = [];

                    if (v === 'clear_all') {
                      updatedUsers = [];
                    } else if (currentUsers.includes(v)) {
                      updatedUsers = currentUsers.filter(u => u !== v);
                    } else {
                      updatedUsers = [...currentUsers, v];
                    }
                    
                    setEditForm({
                      ...editForm, 
                      assigned_to_users: updatedUsers,
                      assigned_to: updatedUsers[0] || ""
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={
                      editForm.assigned_to_users && editForm.assigned_to_users.length > 0
                        ? `${editForm.assigned_to_users.length} assigned`
                        : "Select staff members"
                    } />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clear_all">Clear All</SelectItem>
                    {staffProfiles.filter(s => s.user_email).map(staff => {
                      const isSelected = editForm.assigned_to_users?.includes(staff.user_email);
                      return (
                        <SelectItem key={staff.user_email} value={staff.user_email}>
                          <div className="flex items-center gap-2">
                            {isSelected && <span className="font-bold text-green-600">✓</span>}
                            {staff.full_name || staff.user_email}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {editForm.assigned_to_users && editForm.assigned_to_users.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {editForm.assigned_to_users.map(email => {
                      const staff = staffProfiles.find(s => s.user_email === email);
                      return (
                        <Badge key={email} variant="secondary" className="text-xs">
                          {staff?.full_name || email}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <Label>Notes</Label>
                <Textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm({...editForm, notes: e.target.value})}
                  rows={4}
                  placeholder="Add notes about this lead..."
                />
              </div>

              <DialogFooter className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowEditDialog(false);
                    setEditForm(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateLeadMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {updateLeadMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {viewingFile && (
        <Dialog open={!!viewingFile} onOpenChange={() => setViewingFile(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>{viewingFile.document_name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = viewingFile.file_url;
                    a.download = viewingFile.document_name;
                    a.click();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </DialogTitle>
            </DialogHeader>
            <div className="pt-4">
              {viewingFile.file_type?.startsWith('image/') ? (
                <img 
                  src={viewingFile.file_url} 
                  alt={viewingFile.document_name}
                  className="w-full h-auto rounded-lg"
                />
              ) : viewingFile.file_type === 'application/pdf' ? (
                <iframe 
                  src={viewingFile.file_url} 
                  className="w-full h-[600px] rounded-lg border"
                  title={viewingFile.document_name}
                />
              ) : (
                <div className="text-center py-12">
                  <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                  <p className="text-gray-600 mb-4">Preview not available for this file type</p>
                  <Button onClick={() => {
                    const a = document.createElement('a');
                    a.href = viewingFile.file_url;
                    a.download = viewingFile.document_name;
                    a.click();
                  }}>
                    <Download className="w-4 h-4 mr-2" />
                    Download File
                  </Button>
                </div>
              )}
              {viewingFile.description && (
                <div className="bg-gray-50 p-4 rounded-lg mt-4">
                  <p className="text-sm text-gray-600">{viewingFile.description}</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <AssignmentDialog
        isOpen={isNewInspectionOpen}
        onOpenChange={setIsNewInspectionOpen}
        prefillLead={lead}
        onAssignmentSent={() => {
          setIsNewInspectionOpen(false);
          queryClient.invalidateQueries({ queryKey: ['lead-inspection-jobs'] });
          setTimeout(() => document.getElementById('crewcam-section')?.scrollIntoView({ behavior: 'smooth' }), 500);
        }}
      />
    </div>
  );
}