import React, { useState, useEffect } from "react";
import PropertyFrontView from "@/components/PropertyFrontView";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Clock,
  Pencil,
  Save,
  StickyNote,
  X,
  RotateCcw,
  Shield,
  Hash,
  Tag,
  ExternalLink,
  ClipboardList,
  FileSignature,
  Send,
  Minus,
  Maximize2,
  CalendarCheck,
  Palette,
  CloudLightning,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl, validateE164Phone } from "@/utils";
import { format } from "date-fns";
import QuickTaskDialog from "@/components/tasks/QuickTaskDialog";
import AssignmentDialog from "@/components/inspections/AssignmentDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import Dialer from "@/components/communication/Dialer";
import EmailDialog from "@/components/communication/EmailDialog";
import SMSDialog from "@/components/communication/SMSDialog";
import useRoleBasedData from "@/components/hooks/useRoleBasedData";
import ColorVisualizerPanel from "@/components/visualizer/ColorVisualizerPanel";
import { HIDDEN_FEATURES } from "@/config/hiddenFeatures";
import { cleanLookupValue } from "@/utils/lookupValue";

// Convert an ISO timestamp to the value format expected by <input type="datetime-local">
// Returns "" for missing, invalid, or un-parseable input (e.g. AI-captured "sometime Tuesday").
function toDatetimeLocalStr(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

// Safely convert a datetime-local input value to an ISO string.
// Returns undefined if the value is empty or not a valid date.
function datetimeLocalToIso(val) {
  if (!val) return undefined;
  try {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

export default function LeadProfile() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leadId, setLeadId] = useState(null);
  const [showTaskDialog, setShowTaskDialog] = useState(false);
  const [showDialer, setShowDialer] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showSMSDialog, setShowSMSDialog] = useState(false);
  const [isHandingBackSarah, setIsHandingBackSarah] = useState(false);
  // Edit dialog for appointment approval: lets staff adjust time/address/title before confirming.
  const [apptEditDialog, setApptEditDialog] = useState({ open: false, item: null, form: {} });
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [viewingFile, setViewingFile] = useState(null);
  const [fileZoom, setFileZoom] = useState(1);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [isNewInspectionOpen, setIsNewInspectionOpen] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editedNoteText, setEditedNoteText] = useState('');
  const [leadPhoneErrors, setLeadPhoneErrors] = useState({ phone: null, phone_2: null });

  const { user, myCompany, isAdmin, hasPermission, isPermissionsReady, effectiveUserEmail } = useRoleBasedData();
  const [showSendForSignatureDialog, setShowSendForSignatureDialog] = useState(false);
  const [signatureSelectedTemplate, setSignatureSelectedTemplate] = useState(null);
  const [signatureContractForm, setSignatureContractForm] = useState({ contract_name: "", delivery_method: "email" });
  const [resendingSessionId, setResendingSessionId] = useState(null);

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

  const { data: contractTemplates = [] } = useQuery({
    queryKey: ['contract-templates', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.ContractTemplate.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: leadSigningSessions = [] } = useQuery({
    queryKey: ['lead-signing-sessions', leadId, myCompany?.id],
    queryFn: () => (leadId && myCompany?.id) ? base44.entities.ContractSigningSession.filter({ lead_id: leadId, company_id: myCompany.id }, '-created_date', 200) : [],
    enabled: !!leadId && !!myCompany?.id,
  });

  const handleResendSigningLink = async (sessionId) => {
    setResendingSessionId(sessionId);
    try {
      const token = localStorage.getItem('base44_access_token');
      const res = await fetch('/api/contracts/send-signing-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: String(sessionId) }),
      });
      const data = await res.json();
      if (data?.success) {
        toast.success(data.message || 'Signing link re-sent successfully');
        queryClient.invalidateQueries({ queryKey: ['lead-signing-sessions', leadId, myCompany?.id] });
      } else {
        toast.error(data?.error || 'Failed to re-send signing link');
      }
    } catch (err) {
      toast.error('Failed to re-send signing link: ' + err.message);
    } finally {
      setResendingSessionId(null);
    }
  };

  const createSigningSessionMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.ContractSigningSession.create({
        company_id: myCompany?.id,
        template_id: data.template.id,
        template_name: data.template.template_name,
        contract_name: data.contract_name,
        customer_name: lead.name,
        customer_email: lead.email || '',
        customer_phone: lead.phone || '',
        lead_id: lead.id,
        delivery_method: data.delivery_method,
        rep_name: user?.full_name,
        rep_email: user?.email,
        status: 'draft',
        current_signer: 'rep'
      });
    },
    onSuccess: (session) => {
      setShowSendForSignatureDialog(false);
      const signUrl = createPageUrl('SignContractRep') + '?sessionId=' + session.id;
      navigate(signUrl, { state: { sessionId: String(session.id), session } });
    },
    onError: (error) => {
      toast.error('Failed to start signing: ' + error.message);
    }
  });

  const { data: communications = [] } = useQuery({
    queryKey: ['lead-communications', leadId, myCompany?.id],
    queryFn: () => (leadId && myCompany) ? base44.entities.Communication.filter({ company_id: myCompany.id }, "-created_date") : [],
    enabled: !!leadId && !!myCompany,
  });

  const { data: calendarEvents = [] } = useQuery({
    queryKey: ['lead-events', leadId, myCompany?.id],
    queryFn: () => (leadId && myCompany) ? base44.entities.CalendarEvent.filter({ company_id: myCompany.id }, "-start_time") : [],
    enabled: !!leadId && !!myCompany,
  });

  const { data: leadScores = [] } = useQuery({
    queryKey: ['lead-scores', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.LeadScore.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
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
  });

  const { data: inspectionMedia = [] } = useQuery({
    queryKey: ['lead-inspection-media', inspectionJobs.map(j => j.id).join(',')],
    queryFn: async () => {
      if (!inspectionJobs || inspectionJobs.length === 0) return [];
      const media = await base44.entities.JobMedia.filter({
        related_entity_type: 'InspectionJob',
        related_entity_id: { $in: inspectionJobs.map(j => j.id) }
      });
      return media || [];
    },
    enabled: inspectionJobs.length > 0,
  });

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['staff-profiles', myCompany?.id],
    queryFn: () => myCompany ? base44.entities.StaffProfile.filter({ company_id: myCompany.id }) : [],
    enabled: !!myCompany,
  });

  const { data: linkedEstimates = [] } = useQuery({
    queryKey: ['lead-estimates', leadId, lead?.name, lead?.email, myCompany?.id],
    queryFn: async () => {
      if (!leadId || !lead) return [];
      const companyFilter = myCompany?.id ? { company_id: myCompany.id } : {};
      // Never look up by a placeholder value. A lead saved with the literal text
      // "null" for its email is truthy, and matching on it pulled back every
      // estimate in the company that had no email on it.
      const lookupName = cleanLookupValue(lead.name);
      const lookupEmail = cleanLookupValue(lead.email);
      const results = await Promise.allSettled([
        base44.entities.Estimate.filter({ lead_id: leadId, ...companyFilter }),
        lookupName ? base44.entities.Estimate.filter({ customer_name: { $contains: lookupName }, ...companyFilter }) : Promise.resolve([]),
        lookupEmail ? base44.entities.Estimate.filter({ customer_email: lookupEmail, ...companyFilter }) : Promise.resolve([]),
      ]);
      const [byLead, byName, byEmail] = results.map(r => (r.status === 'fulfilled' && Array.isArray(r.value)) ? r.value : []);
      // A name/email hit only belongs on this lead when the estimate isn't
      // already attached to somebody else. Without this, a shared first name
      // ("Sam") drags other people's estimates onto this profile.
      const isOwnedOrUnlinked = (e) => (!e.lead_id || e.lead_id === leadId) && !e.customer_id;
      const all = [...byLead, ...byName.filter(isOwnedOrUnlinked), ...byEmail.filter(isOwnedOrUnlinked)];
      return all.filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i);
    },
    enabled: !!leadId && !!lead,
  });

  const { data: leadActionItems = [] } = useQuery({
    queryKey: ['action-items-lead', leadId, myCompany?.id],
    queryFn: () => (leadId && myCompany?.id) ? base44.entities.ActionItem.filter({ company_id: myCompany.id, related_lead_id: leadId }) : [],
    enabled: !!leadId && !!myCompany?.id,
  });

  const activeLeadActions = leadActionItems.filter(i => i.status === 'pending' || i.status === 'overdue');

  const { data: leadNoteEntities = [] } = useQuery({
    queryKey: ['lead-notes', leadId],
    queryFn: async () => {
      if (!leadId) return [];
      return base44.entities.CustomerNote.filter({ lead_id: leadId }, '-created_date', 500);
    },
    enabled: !!leadId,
  });

  const { data: leadTasks = [] } = useQuery({
    queryKey: ['lead-tasks', leadId, lead?.name, myCompany?.id],
    queryFn: () => (lead?.name && myCompany) ? base44.entities.Task.filter({ related_to: lead.name, company_id: myCompany.id }) : [],
    enabled: !!lead?.name && !!myCompany,
  });

  const leadNotesCount = (lead?.notes ? 1 : 0)
    + leadNoteEntities.filter(n => n.source_type !== 'task').length
    + leadTasks.reduce((acc, t) => acc + 1 + (t.comments || []).length, 0);

  const addLeadNoteMutation = useMutation({
    mutationFn: async (noteData) => {
      const newNote = await base44.entities.CustomerNote.create(noteData);
      // Notify all assigned staff + all admins (except the author)
      const adminEmails = staffProfiles.filter(s => s.is_administrator).map(s => s.user_email).filter(Boolean);
      const recipients = [...new Set([...(lead?.assigned_to_users || []), ...adminEmails])].filter(e => e !== noteData.created_by);
      const authorName = noteData.created_by_name || noteData.created_by || 'Someone';
      const profileUrl = window.location.origin + createPageUrl('LeadProfile') + `?id=${leadId}`;
      for (const email of recipients) {
        try {
          await base44.entities.Notification.create({
            company_id: myCompany?.id,
            user_email: email,
            title: `📝 New Note on Lead: ${lead.name}`,
            message: `${authorName} added a note: "${noteData.note.substring(0, 100)}${noteData.note.length > 100 ? '…' : ''}"`,
            type: 'customer_note',
            related_entity_type: 'Lead',
            related_entity_id: leadId,
            link_url: profileUrl,
            is_read: false,
          });
          await base44.functions.invoke('sendEmailWithBranding', {
            to: email,
            companyId: myCompany?.id,
            subject: `New Note on Lead: ${lead.name}`,
            html: `<div style="font-family:Arial,sans-serif;color:#333;">
<h2 style="color:#1e40af;">New Note Added</h2>
<p><strong>${authorName}</strong> added a note on lead <strong>${lead.name}</strong>:</p>
<div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:12px;margin:16px 0;border-radius:4px;">
<p style="margin:0;white-space:pre-wrap;">${noteData.note}</p>
</div>
<p><a href="${profileUrl}" style="background:#2563eb;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;display:inline-block;">View Lead Profile</a></p>
</div>`,
          });
        } catch (_) {}
      }
      return newNote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-notes', leadId] });
      setNewNoteText('');
      setShowAddNote(false);
      toast.success('Note added!');
    },
    onError: (err) => toast.error('Failed to add note: ' + err.message),
  });

  const updateLeadNoteMutation = useMutation({
    mutationFn: ({ id, note }) => base44.entities.CustomerNote.update(id, { note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-notes', leadId] });
      setEditingNoteId(null);
      toast.success('Note updated');
    },
    onError: (err) => toast.error('Failed to update note: ' + err.message),
  });

  const deleteLeadNoteMutation = useMutation({
    mutationFn: (id) => base44.entities.CustomerNote.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-notes', leadId] });
      toast.success('Note deleted');
    },
    onError: (err) => toast.error('Failed to delete note: ' + err.message),
  });

  const completeActionMutation = useMutation({
    mutationFn: (id) => base44.entities.ActionItem.update(id, { status: 'completed', completed_at: new Date().toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items-lead'] });
      toast.success('Action item completed');
    },
  });

  const updateActionMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ActionItem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items-lead'] });
    },
  });

  // Approve an AI-booked appointment from the lead profile: create the real
  // CalendarEvent (status "scheduled" so existing reminders fire), then
  // complete the action item.
  const approveAppointmentMutation = useMutation({
    mutationFn: async ({ item, overrides = {} }) => {
      // Idempotency: re-check the item is still pending before creating an
      // event, so two tabs/users can't double-book the same appointment.
      try {
        const fresh = await base44.entities.ActionItem.filter({ id: item.id });
        const current = fresh?.[0];
        if (current && (current.status === 'completed' || current.status === 'dismissed')) {
          throw new Error('already_handled');
        }
      } catch (e) {
        if (e?.message === 'already_handled') throw e;
        /* lookup failed — proceed best-effort */
      }
      const appt = item.proposed_appointment || {};
      // Staff-edited values win over the AI-proposed values.
      const start = overrides.start_time || appt.start_time || new Date(Date.now() + 86400000).toISOString();
      const end = overrides.end_time || appt.end_time || new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
      const title = overrides.title || appt.title;
      const address = overrides.address !== undefined ? overrides.address : (appt.address || lead?.address || '');
      const description = overrides.description !== undefined ? overrides.description : (appt.description || '');
      await base44.entities.CalendarEvent.create({
        company_id: myCompany?.id,
        title: title || `Appointment - ${lead?.name || appt.contact_name || 'Customer'}`,
        start_time: start,
        end_time: end,
        location: address,
        description: description,
        event_type: 'appointment',
        status: 'scheduled',
        related_lead: lead?.name || appt.contact_name || undefined,
        related_lead_id: lead?.id || undefined,
        assigned_to: lead?.assigned_to || user?.email || undefined,
      });
      await base44.entities.ActionItem.update(item.id, { status: 'completed', completed_at: new Date().toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action-items-lead'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-user'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events-company'] });
      toast.success('Appointment added to the calendar');
    },
    onError: (err) => {
      if (err?.message === 'already_handled') {
        queryClient.invalidateQueries({ queryKey: ['action-items-lead'] });
        toast.info('This appointment was already handled.');
        return;
      }
      toast.error('Could not schedule appointment: ' + (err?.message || 'unknown error'));
    },
  });

  const leadDirectValue = Number(lead?.value) || 0;
  const nonSupplementEstimates = linkedEstimates.filter(e => !e.supplement_of);
  const estimatesMaxValue = nonSupplementEstimates.length > 0 ? Math.max(...nonSupplementEstimates.map(e => Number(e.total_rcv || e.amount || 0))) : 0;
  const effectiveLeadValue = leadDirectValue || estimatesMaxValue;

  const groupedLinkedEstimates = (() => {
    const originals = linkedEstimates.filter(e => !e.supplement_of);
    const supplements = linkedEstimates.filter(e => !!e.supplement_of);
    const result = [];
    for (const orig of originals) {
      result.push({ ...orig, _isOriginal: true });
      const children = supplements.filter(s => s.supplement_of === orig.id);
      for (const child of children) {
        result.push({ ...child, _isSupplement: true });
      }
    }
    const orphans = supplements.filter(s => !originals.find(o => o.id === s.supplement_of));
    for (const orphan of orphans) {
      result.push({ ...orphan, _isSupplement: true });
    }
    return result;
  })();

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
        source: lead.source || "",
        lead_source: lead.lead_source || "",
        insurance_company: lead.insurance_company || "",
        claim_number: lead.claim_number || "",
        last_contact_date: lead.last_contact_date || "",
        next_follow_up_date: lead.next_follow_up_date || "",
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
      queryClient.invalidateQueries({ queryKey: ['my-assignments-leads'] });
      setShowEditDialog(false);
      setEditForm(null);
      setLeadPhoneErrors({ phone: null, phone_2: null });
      toast.success('✅ Lead updated successfully!');

      // Auto-push contact field changes to linked inspections
      try {
        const newStreet = variables.data.street ?? lead?.street ?? '';
        const newCity   = variables.data.city   ?? lead?.city   ?? '';
        const newState  = variables.data.state  ?? lead?.state  ?? '';
        const newZip    = variables.data.zip    ?? lead?.zip    ?? '';
        const newPhone  = variables.data.phone  ?? lead?.phone  ?? '';
        const newEmail  = variables.data.email  ?? lead?.email  ?? '';

        const oldAddress = [lead?.street, lead?.city, lead?.state, lead?.zip].filter(Boolean).join(', ');
        const newAddress = [newStreet, newCity, newState, newZip].filter(Boolean).join(', ');

        const addressChanged = newAddress !== oldAddress;
        const phoneChanged   = newPhone !== (lead?.phone ?? '');
        const emailChanged   = newEmail !== (lead?.email ?? '');

        if (addressChanged || phoneChanged || emailChanged) {
          const linkedJobs = await base44.entities.InspectionJob.filter({ related_lead_id: leadId });
          if (linkedJobs.length > 0) {
            const patch = {};
            if (addressChanged) patch.property_address = newAddress;
            if (phoneChanged)   patch.client_phone     = newPhone;
            if (emailChanged)   patch.client_email     = newEmail;
            await Promise.all(linkedJobs.map(job => base44.entities.InspectionJob.update(job.id, patch)));
            queryClient.invalidateQueries({ queryKey: ['inspection-jobs'] });
            toast.success(`📋 ${linkedJobs.length} linked inspection${linkedJobs.length > 1 ? 's' : ''} updated with new contact info.`);
          }
        }
      } catch (syncErr) {
        console.warn('[LeadProfile] Could not auto-sync inspections:', syncErr.message);
      }

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

      // Cross-post notes to CustomerNote feed when lead notes field is changed
      const prevNotes = lead?.notes || '';
      const newNotes = variables.data.notes || '';
      if (newNotes && newNotes !== prevNotes && myCompany?.id) {
        try {
          const staffMember = staffProfiles.find(s => s.user_email === user?.email);
          await base44.entities.CustomerNote.create({
            lead_id: leadId,
            company_id: myCompany.id,
            note: newNotes,
            source_type: 'lead',
            source_label: 'Lead Notes',
            created_by: user?.email,
            created_by_name: staffMember?.full_name || staffMember?.name || user?.full_name || user?.email,
            created_at: new Date().toISOString(),
          });
          queryClient.invalidateQueries({ queryKey: ['lead-notes', leadId] });
        } catch (e) {
          console.warn('[LeadProfile] Could not cross-post notes to CustomerNote:', e.message);
        }
      }
    },
    onError: (error) => {
      toast.error('Failed to update lead: ' + error.message);
    }
  });

  const leadOutreachMutation = useMutation({
    mutationFn: async (enabled) => {
      const response = await base44.functions.invoke('setLeadConfirmationOutreach', { leadId: lead.id, enabled });
      const result = response?.data ?? response;
      if (result?.error) throw new Error(result.error);
      return { ...result, enabled };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.setQueryData(['lead', leadId], (current) => current ? {
        ...current,
        data: {
          ...(current.data || {}),
          alex_outreach_enabled: result.enabled,
          alex_outreach_status: result.status || (result.enabled ? 'texted' : 'stopped'),
        },
      } : current);
      toast.success(result.enabled
        ? 'Alex outreach is on. The homeowner will receive the confirmation text now.'
        : 'Alex outreach has been stopped for this lead.');
    },
    onError: (error) => toast.error(error.message || 'Could not update Alex outreach for this lead.'),
  });

  const convertToCustomerMutation = useMutation({
    mutationFn: async (leadData) => {
      // Build structured customer_notes from lead notes so they appear in the Notes tab
      const leadConversionNotes = [];
      if (leadData.notes) {
        leadConversionNotes.push({
          id: `note_lead_conv_${Date.now()}`,
          note: `[Converted from Lead – ${format(new Date(leadData.created_date), 'MMM d, yyyy')}]: ${leadData.notes}`,
          created_at: new Date().toISOString(),
          created_by: leadData.assigned_to || 'system',
          source: 'lead_conversion'
        });
      }
      const summaryParts = [
        `Lead Status: ${leadData.status}`,
        leadData.value ? `Lead Value: $${leadData.value}` : '',
        leadData.last_contact_date ? `Last Contact: ${format(new Date(leadData.last_contact_date), 'MMM d, yyyy')}` : '',
      ].filter(Boolean);
      if (summaryParts.length > 0) {
        leadConversionNotes.push({
          id: `note_lead_hist_${Date.now() + 1}`,
          note: `[Lead History]: ${summaryParts.join(' | ')}`,
          created_at: new Date().toISOString(),
          created_by: leadData.assigned_to || 'system',
          source: 'lead_conversion'
        });
      }

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
        customer_notes: leadConversionNotes,
        assigned_to: leadData.assigned_to_users?.[0] || leadData.assigned_to || "",
        assigned_to_users: Array.isArray(leadData.assigned_to_users) ? leadData.assigned_to_users : (leadData.assigned_to ? [leadData.assigned_to] : [])
      };

      const newCustomer = await base44.entities.Customer.create(customerData);

      // Migrate existing CustomerNote records for this lead to include the new customer_id
      try {
        const existingLeadNotes = await base44.entities.CustomerNote.filter({ lead_id: leadData.id });
        for (const noteRec of existingLeadNotes) {
          await base44.entities.CustomerNote.update(noteRec.id, { customer_id: newCustomer.id });
        }
      } catch (e) {
        console.warn('[LeadProfile] Could not migrate CustomerNote records on conversion:', e.message);
      }

      // Create a CustomerNote for the lead notes captured at conversion time
      if (leadData.notes) {
        try {
          await base44.entities.CustomerNote.create({
            customer_id: newCustomer.id,
            lead_id: leadData.id,
            company_id: myCompany?.id || leadData.company_id,
            note: `[Converted from Lead – ${format(new Date(leadData.created_date), 'MMM d, yyyy')}]: ${leadData.notes}`,
            source_type: 'lead',
            source_label: 'Lead Conversion',
            created_by: leadData.assigned_to || user?.email || 'system',
            created_by_name: user?.full_name || user?.email || 'system',
            created_at: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('[LeadProfile] Could not create conversion CustomerNote:', e.message);
        }
      }

      await base44.entities.Lead.delete(leadData.id);

      return newCustomer;
    },
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['my-assignments-leads'] });
      alert(`✅ Lead converted to customer successfully!`);
      navigate(createPageUrl('CustomerProfile') + `?id=${customer.id}`);
    },
    onError: (error) => {
      alert(`❌ Failed to convert lead: ${error.message}`);
    }
  });

  const leadComms = communications.filter(c => {
    const matchByName = c.contact_name && lead?.name && c.contact_name.toLowerCase() === lead.name.toLowerCase();
    const matchByPhone1 = c.contact_phone && lead?.phone && c.contact_phone === lead.phone;
    const matchByPhone2 = c.contact_phone && lead?.phone_2 && c.contact_phone === lead.phone_2;
    const matchByEmail = c.contact_email && lead?.email && c.contact_email.toLowerCase() === lead.email.toLowerCase();

    return matchByName || matchByPhone1 || matchByPhone2 || matchByEmail;
  });

  const isLeadRepOwned = React.useMemo(() => {
    const phones = [lead?.phone, lead?.phone_2].filter(Boolean);
    if (phones.length === 0) return false;
    const outbound = leadComms.filter(c => c.direction === 'outbound' && c.contact_phone && phones.includes(c.contact_phone));
    if (outbound.length === 0) return false;
    const latest = [...outbound].sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))[0];
    return latest?.data?.sent_by_rep === true || latest?.data?.sent_by_rep === 'true';
  }, [leadComms, lead]);

  const handleHandBackToSarah = async () => {
    const phone = lead?.phone || lead?.phone_2;
    if (!myCompany?.id || !phone) return;
    setIsHandingBackSarah(true);
    try {
      const resp = await base44.functions.invoke('handBackToSarah', { companyId: myCompany.id, contactPhone: phone });
      if (resp?.data?.success) {
        toast.success('Alex is back in control', { description: `Alex will now auto-reply to ${lead?.name || phone}.` });
        queryClient.invalidateQueries({ queryKey: ['communications'] });
      } else {
        toast.error('Could not hand back to Alex', { description: resp?.data?.error || 'Unknown error' });
      }
    } catch (err) {
      toast.error('Could not hand back to Alex', { description: err.message });
    } finally {
      setIsHandingBackSarah(false);
    }
  };

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
    { value: "estimate", label: "Estimate", icon: "🧾" },
    { value: "contract", label: "Contract", icon: "📄" },
    { value: "insurance", label: "Insurance", icon: "🛡️" },
    { value: "invoice", label: "Invoice", icon: "🧾" },
    { value: "receipt", label: "Receipt / Payment", icon: "💵" },
    { value: "permit", label: "Permit", icon: "📋" },
    { value: "scope_of_work", label: "Scope of Work", icon: "📝" },
    { value: "photos", label: "Property Photos", icon: "📸" },
    { value: "other", label: "Other", icon: "📁" }
  ];

  if (leadLoading) {
    return (
      <div className="p-3 sm:p-6">
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
    lead.assigned_to === effectiveUserEmail ||
    lead.assigned_to_users?.includes(effectiveUserEmail) ||
    lead.created_by === effectiveUserEmail;

  if (lead && !leadLoading && !canAccessLead) {
    return (
      <div className="p-3 sm:p-6">
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
      <div className="p-3 sm:p-6">
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
          <nav className="flex items-center gap-1.5 text-sm mb-4 text-white/80">
            <button
              onClick={() => navigate(createPageUrl('Leads'))}
              className="hover:text-white underline underline-offset-2 transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Leads
            </button>
            <span className="text-white/50">/</span>
            <span className="text-white font-medium truncate max-w-[200px]">{lead.name}</span>
          </nav>

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
                {leadSigningSessions.length > 0 && (() => {
                  const totalContracts = leadSigningSessions.length;
                  const pendingContracts = leadSigningSessions.filter(s => s.status !== 'completed').length;
                  return (
                    <Badge
                      className={`border-transparent text-sm cursor-pointer gap-1 ${
                        pendingContracts > 0
                          ? "bg-amber-400 text-amber-950 hover:bg-amber-300"
                          : "bg-green-500 text-white hover:bg-green-400"
                      }`}
                      data-testid="badge-lead-contracts-summary"
                      onClick={() => document.getElementById('contracts-section')?.scrollIntoView({ behavior: 'smooth' })}
                    >
                      <FileSignature className="w-3 h-3" />
                      {totalContracts} contract{totalContracts !== 1 ? 's' : ''}
                      {pendingContracts > 0 && ` — ${pendingContracts} pending`}
                    </Badge>
                  );
                })()}
              </div>

              {/* Action Buttons Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  AI Estimate
                </Button>

                <Button
                  onClick={() => navigate(createPageUrl('NewInspection') + `?lead_id=${lead.id}&client_name=${encodeURIComponent(lead.name)}&property_address=${encodeURIComponent([lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', '))}`)}
                  className="bg-white text-orange-600 hover:bg-orange-50 h-12"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  New Inspection
                </Button>

                {HIDDEN_FEATURES.COLOR_VISUALIZER !== false && (
                  <Button
                    onClick={() => document.getElementById('color-visualizer-section')?.scrollIntoView({ behavior: 'smooth' })}
                    className="bg-white text-purple-600 hover:bg-purple-50 h-12"
                    data-testid="button-color-visualizer"
                  >
                    <Palette className="w-4 h-4 mr-2" />
                    Color Visualizer
                  </Button>
                )}

                <Button
                  onClick={() => setShowDialer(true)}
                  className="bg-white text-green-600 hover:bg-green-50 h-12"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call
                </Button>
                <Button
                  data-testid="button-send-for-signature"
                  onClick={() => {
                    setSignatureSelectedTemplate(null);
                    setSignatureContractForm({ contract_name: "", delivery_method: "email" });
                    setShowSendForSignatureDialog(true);
                  }}
                  className="bg-white text-green-600 hover:bg-green-50 h-12"
                >
                  <FileSignature className="w-4 h-4 mr-2" />
                  Send for Signature
                </Button>
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
                  <span className="font-medium">PhotoSync ({inspectionJobs.length})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('notes-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <StickyNote className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Notes ({leadNotesCount})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('estimates-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Estimates ({linkedEstimates.length})</span>
                </button>
                <button
                  className="w-full p-4 text-left hover:bg-blue-50 transition-colors border-b flex items-center gap-3"
                  onClick={() => document.getElementById('contracts-section')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  <FileSignature className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">Contracts ({leadSigningSessions.length})</span>
                </button>
                {HIDDEN_FEATURES.COLOR_VISUALIZER !== false && (
                  <button
                    className="w-full p-4 text-left hover:bg-purple-50 transition-colors border-b flex items-center gap-3"
                    onClick={() => document.getElementById('color-visualizer-section')?.scrollIntoView({ behavior: 'smooth' })}
                  >
                    <Palette className="w-5 h-5 text-purple-600" />
                    <span className="font-medium">Color Visualizer</span>
                  </button>
                )}
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

                  {(lead.street || lead.city || lead.address) && (
                    <div className="col-span-2">
                      <Label className="text-gray-500 text-xs">Address</Label>
                      <div className="flex items-start gap-2">
                        <MapPin className="w-4 h-4 text-gray-400 mt-1" />
                        <p className="font-medium">
                          {lead.street ? (
                            <>
                              <span>{lead.street}<br /></span>
                              {lead.city && <span>{lead.city}, </span>}
                              {lead.state && <span>{lead.state} </span>}
                              {lead.zip && <span>{lead.zip}</span>}
                            </>
                          ) : (
                            <span>{lead.address}</span>
                          )}
                        </p>
                      </div>
                      {(() => {
                        const addr = [lead.street, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || lead.address;
                        return addr ? <PropertyFrontView address={addr} className="mt-2" /> : null;
                      })()}
                    </div>
                  )}

                  <div className="col-span-2 rounded-lg border bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label className="text-gray-700 text-xs">Alex outreach</Label>
                        <p className="text-xs text-gray-500 mt-1">
                          {lead.data?.alex_outreach_status === 'texted' && 'Text sent — waiting for a reply.'}
                          {lead.data?.alex_outreach_status === 'replied' && 'The homeowner or your team replied — no call will be placed.'}
                          {lead.data?.alex_outreach_status === 'called' && 'Alex placed the follow-up call.'}
                          {lead.data?.alex_outreach_status === 'called_fallback_text' && 'The call could not be placed, so Alex sent one follow-up text.'}
                          {lead.data?.alex_outreach_status === 'stopped' && 'Stopped for this lead.'}
                          {!lead.data?.alex_outreach_status && 'Turn this on to text the homeowner immediately and call if there is no reply.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={lead.data?.alex_outreach_enabled ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500'}>
                          {lead.data?.alex_outreach_status || 'not started'}
                        </Badge>
                        <Switch
                          checked={lead.data?.alex_outreach_enabled === true}
                          disabled={leadOutreachMutation.isPending}
                          onCheckedChange={(enabled) => leadOutreachMutation.mutate(enabled)}
                          data-testid="switch-lead-alex-outreach"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-gray-500 text-xs">Estimated Value</Label>
                    <p className="font-semibold text-lg text-green-600 flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      ${effectiveLeadValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    {groupedLinkedEstimates.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1">
                        {groupedLinkedEstimates.map(est => (
                          <a
                            key={est.id}
                            href={createPageUrl('EstimateEditor') + `?estimate_id=${est.id}`}
                            className={`inline-flex items-center gap-1 text-xs hover:underline border rounded px-2 py-0.5 ${est._isSupplement ? 'ml-3 text-orange-600 bg-orange-50 border-orange-200' : 'text-blue-600 bg-blue-50 border-blue-200'}`}
                          >
                            {est._isSupplement ? (
                              <span className="font-semibold mr-0.5">↳</span>
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            {est.estimate_number || est.estimate_title || 'Estimate'}
                            {est._isSupplement && est.supplement_of_number && (
                              <span className="text-orange-500 ml-1">({est.supplement_of_number})</span>
                            )}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {lead.lead_source === 'storm_canvass' && (
                    <div>
                      <Label className="text-gray-500 text-xs">Source</Label>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 flex items-center gap-1">
                          <CloudLightning className="w-3 h-3" />
                          Storm Canvass
                        </Badge>
                      </div>
                      {lead.data?.storm_title && (
                        <p className="text-xs text-slate-600 mt-1 ml-0.5 font-medium">{lead.data.storm_title}</p>
                      )}
                      <p className="text-xs text-slate-400 mt-0.5 ml-0.5">Cold canvass address — no prior contact</p>
                    </div>
                  )}
                  {lead.source && lead.lead_source !== 'storm_canvass' && (
                    <div>
                      <Label className="text-gray-500 text-xs">Source</Label>
                      <p className="font-medium flex items-center gap-2 mt-0.5">
                        <Tag className="w-4 h-4 text-gray-400" />
                        {lead.source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                      </p>
                      {lead.lead_source && (
                        <p className="text-xs text-gray-500 mt-0.5 ml-6">Referred by: {lead.lead_source}</p>
                      )}
                    </div>
                  )}

                  {(lead.insurance_company || lead.claim_number) && (
                    <div>
                      <Label className="text-gray-500 text-xs">Insurance</Label>
                      {lead.insurance_company && (
                        <p className="font-medium flex items-center gap-2 mt-0.5">
                          <Shield className="w-4 h-4 text-gray-400" />
                          {lead.insurance_company}
                        </p>
                      )}
                      {lead.claim_number && (
                        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1 ml-6">
                          <Hash className="w-3 h-3" />
                          Claim: {lead.claim_number}
                        </p>
                      )}
                    </div>
                  )}

                  {lead.last_contact_date && (
                    <div>
                      <Label className="text-gray-500 text-xs">Last Contact</Label>
                      <p className="font-medium flex items-center gap-2 mt-0.5">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {format(new Date(lead.last_contact_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  )}

                  {lead.next_follow_up_date && (
                    <div>
                      <Label className="text-gray-500 text-xs">Next Follow-Up</Label>
                      <p className="font-medium flex items-center gap-2 mt-0.5">
                        <Clock className="w-4 h-4 text-gray-400" />
                        {format(new Date(lead.next_follow_up_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                  )}

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

            {activeLeadActions.length > 0 && (
              <Card id="action-items-section" className="border-l-4 border-l-orange-500">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-orange-700">
                    <CheckCircle2 className="w-5 h-5" />
                    Action Items ({activeLeadActions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {activeLeadActions.map(item => (
                    <div key={item.id} className="p-3 bg-orange-50 rounded-lg border border-orange-200" data-testid={`lead-action-item-${item.id}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900">{item.title}</p>
                          {item.due_at && (
                            <p className={`text-xs mt-1 ${new Date(item.due_at) < new Date() ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                              {new Date(item.due_at) < new Date() ? 'Overdue' : `Due ${format(new Date(item.due_at), 'MMM d, h:mm a')}`}
                            </p>
                          )}
                        </div>
                      </div>
                      {item.type === 'pending_appointment_approval' ? (
                        <>
                          {item.proposed_appointment && (
                            <div className="text-xs text-gray-700 mt-1 space-y-0.5">
                              {item.proposed_appointment.start_time && (
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {(() => { try { return format(new Date(item.proposed_appointment.start_time), "EEE, MMM d 'at' h:mm a"); } catch { return item.proposed_appointment.start_time; } })()}
                                </div>
                              )}
                              {item.proposed_appointment.address && (
                                <div className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {item.proposed_appointment.address}</div>
                              )}
                            </div>
                          )}
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              className="bg-blue-600 hover:bg-blue-700 text-white h-7 text-xs"
                              disabled={approveAppointmentMutation.isPending}
                              onClick={() => {
                                const appt = item.proposed_appointment || {};
                                setApptEditDialog({
                                  open: true,
                                  item,
                                  form: {
                                    title: appt.title || `Appointment - ${lead?.name || appt.contact_name || 'Customer'}`,
                                    start: toDatetimeLocalStr(appt.start_time),
                                    end: toDatetimeLocalStr(appt.end_time),
                                    address: appt.address || lead?.address || '',
                                    notes: appt.description || '',
                                  },
                                });
                              }}
                              data-testid={`approve-lead-appointment-${item.id}`}
                            >
                              <CalendarCheck className="w-3 h-3 mr-1" /> Approve & Add to Calendar
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { updateActionMutation.mutate({ id: item.id, data: { status: 'dismissed' } }); toast.success('Dismissed'); }} data-testid={`dismiss-lead-appointment-${item.id}`}>
                              <X className="w-3 h-3 mr-1" /> Dismiss
                            </Button>
                          </div>
                        </>
                      ) : (
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => completeActionMutation.mutate(item.id)} data-testid={`complete-lead-action-${item.id}`}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Done
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`snooze-lead-action-${item.id}`}>
                              <Clock className="w-3 h-3 mr-1" /> Snooze
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {[{ label: '1 hour', h: 1 }, { label: '4 hours', h: 4 }, { label: 'Tomorrow', h: 24 }, { label: '1 week', h: 168 }].map(opt => (
                              <DropdownMenuItem key={opt.h} onClick={() => { updateActionMutation.mutate({ id: item.id, data: { status: 'snoozed', snoozed_until: new Date(Date.now() + opt.h * 3600000).toISOString() } }); toast.success(`Snoozed for ${opt.label}`); }}>
                                {opt.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {lead?.assigned_to && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { updateActionMutation.mutate({ id: item.id, data: { assigned_to: lead.assigned_to } }); toast.success('Reassigned to lead owner'); }} data-testid={`reassign-lead-action-${item.id}`}>
                            <UserPlus className="w-3 h-3 mr-1" /> Reassign
                          </Button>
                        )}
                      </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {leadSigningSessions.length > 0 && (() => {
              const latest = leadSigningSessions[0];
              const signingStatusConfig = {
                draft:             { label: 'Draft',              color: 'bg-gray-100 text-gray-700 border-gray-300' },
                signed_by_rep:     { label: 'Signed by Rep',      color: 'bg-blue-100 text-blue-700 border-blue-300' },
                sent_to_customer:  { label: 'Sent to Customer',   color: 'bg-amber-100 text-amber-700 border-amber-300' },
                awaiting_customer: { label: 'Awaiting Customer',  color: 'bg-amber-100 text-amber-700 border-amber-300' },
                completed:         { label: 'Completed',          color: 'bg-green-100 text-green-700 border-green-300' },
              };
              const cfg = signingStatusConfig[latest.status] || { label: latest.status, color: 'bg-gray-100 text-gray-700 border-gray-300' };
              const createdAt = latest.created_date || latest.created_at;
              return (
                <div
                  className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 cursor-pointer hover:bg-blue-100 transition-colors"
                  data-testid="card-lead-latest-contract-summary"
                  onClick={() => {
                    if (latest.status === 'completed') {
                      navigate(createPageUrl('ContractSigning') + '?sessionId=' + latest.id);
                    } else {
                      navigate(createPageUrl('SignContractRep') + '?sessionId=' + latest.id);
                    }
                  }}
                >
                  <FileSignature className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-blue-800">Latest Contract</p>
                    <p className="text-sm font-medium text-gray-900 truncate">{latest.contract_name || latest.template_name || 'Contract'}</p>
                    {createdAt && <p className="text-xs text-gray-500">{format(new Date(createdAt), 'MMM d, yyyy')}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap flex-shrink-0 ${cfg.color}`}>{cfg.label}</span>
                </div>
              );
            })()}

            {/* Communications */}
            <Card id="communications-section">
              <CardHeader>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <MessageCircle className="w-5 h-5" />
                    Communications ({leadComms.length})
                  </CardTitle>
                  {isLeadRepOwned && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        Alex paused
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
                        onClick={handleHandBackToSarah}
                        disabled={isHandingBackSarah}
                      >
                        {isHandingBackSarah ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RotateCcw className="w-3 h-3 mr-1" />}
                        Hand back to Alex
                      </Button>
                    </div>
                  )}
                </div>
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
                    {leadComms.slice(0, 5).map(comm => (
                      <div key={comm.id} className="p-4 bg-gray-50 rounded-lg">
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
                                {comm.created_date && !isNaN(new Date(comm.created_date).getTime()) ? format(new Date(comm.created_date), 'MMM d, h:mm a') : 'No date'}
                              </span>
                            </div>
                            {comm.subject && (
                              <p className="font-medium text-sm mb-1">{comm.subject}</p>
                            )}
                            <p className="text-sm text-gray-600">{comm.message}</p>
                          </div>
                        </div>
                      </div>
                    ))}
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
              <CardContent className="p-3 sm:p-6">
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
                                      {doc.created_date && !isNaN(new Date(doc.created_date).getTime()) ? format(new Date(doc.created_date), 'MMM d, yyyy') : 'No date'}
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
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <Camera className="w-5 h-5 text-blue-600" />
                    PhotoSync Inspections ({inspectionJobs.length})
                  </h2>
                  <Button onClick={() => setIsNewInspectionOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                    <Camera className="w-4 h-4 mr-2" />
                    New Inspection
                  </Button>
                </div>
                {inspectionJobs.length === 0 ? (
                  <div className="text-center py-10 text-gray-500">
                    <Camera className="w-14 h-14 mx-auto mb-3 text-gray-300" />
                    <p className="font-medium">No PhotoSync jobs yet</p>
                    <p className="text-sm mt-1">Create an inspection assignment for this lead</p>
                    <Button onClick={() => setIsNewInspectionOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700">
                      <Camera className="w-4 h-4 mr-2" />
                      Create First Inspection
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {inspectionJobs.map(job => {
                      const assignedStaff = job.assigned_to_email
                        ? staffProfiles.find(s => s.user_email === job.assigned_to_email)
                        : null;
                      const assignedName = assignedStaff?.full_name || assignedStaff?.name || job.assigned_to_name || (job.assigned_to_email ? job.assigned_to_email.split('@')[0] : null);
                      const assignedInitials = assignedName ? assignedName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
                      const jobMedia = inspectionMedia.filter(m => m.related_entity_id === job.id);
                      const whatsappCount = jobMedia.filter(m => m.source === 'whatsapp_upload').length;
                      const standardCount = jobMedia.filter(m => m.source === 'crew_upload').length;
                      const hasPhotoCounts = whatsappCount > 0 || standardCount > 0;
                      return (
                        <div key={job.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer" onClick={() => navigate(createPageUrl('InspectionCapture') + `?jobId=${job.id}`)}>
                          <div>
                            <p className="font-medium">{job.property_address || job.client_name || 'Unnamed Job'}</p>
                            <p className="text-sm text-gray-500">{job.inspection_type || 'Property Damage Assessment'} • {job.scheduled_date ? new Date(job.scheduled_date).toLocaleDateString() : 'No date set'}</p>
                            {hasPhotoCounts && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                <span className="font-medium">{whatsappCount + standardCount} photos</span>
                                <span className="mx-1">·</span>
                                <span className="text-green-600 font-medium">{whatsappCount} WhatsApp</span>
                                <span className="mx-1">·</span>
                                <span className="text-blue-600 font-medium">{standardCount} Standard</span>
                              </p>
                            )}
                            {assignedName && (
                              <div className="flex items-center gap-1.5 mt-1.5">
                                <Avatar className="w-5 h-5">
                                  {assignedStaff?.avatar_url && <AvatarImage src={assignedStaff.avatar_url} alt={assignedName} />}
                                  <AvatarFallback className="text-[9px] bg-blue-100 text-blue-700">{assignedInitials}</AvatarFallback>
                                </Avatar>
                                <span className="text-xs text-blue-700 font-medium">Assigned to: {assignedName}</span>
                              </div>
                            )}
                          </div>
                          <Badge variant={job.status === 'completed' ? 'default' : job.status === 'in_progress' ? 'secondary' : 'outline'}>
                            {job.status || 'assigned'}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notes Feed */}
            <Card id="notes-section">
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <StickyNote className="w-5 h-5 text-blue-600" />
                    Notes ({leadNotesCount})
                  </h2>
                  <Button
                    size="sm"
                    onClick={() => { setShowAddNote(true); setNewNoteText(''); }}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="button-add-lead-note"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Note
                  </Button>
                </div>

                {showAddNote && (
                  <div className="mb-4 p-4 border rounded-lg bg-blue-50 border-blue-200 space-y-3">
                    <Textarea
                      value={newNoteText}
                      onChange={(e) => setNewNoteText(e.target.value)}
                      placeholder="Type your note here..."
                      className="min-h-[80px] bg-white"
                      autoFocus
                      data-testid="textarea-new-lead-note"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button size="sm" variant="outline" onClick={() => { setShowAddNote(false); setNewNoteText(''); }}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                        disabled={addLeadNoteMutation.isPending || !newNoteText.trim()}
                        data-testid="button-save-lead-note"
                        onClick={() => {
                          if (!newNoteText.trim()) return;
                          const staffMember = staffProfiles.find(s => s.user_email === user?.email);
                          addLeadNoteMutation.mutate({
                            lead_id: leadId,
                            company_id: myCompany?.id,
                            note: newNoteText.trim(),
                            source_type: 'manual',
                            created_by: user?.email,
                            created_by_name: staffMember?.full_name || staffMember?.name || user?.full_name || user?.email,
                            created_at: new Date().toISOString(),
                          });
                        }}
                      >
                        {addLeadNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                        Save Note
                      </Button>
                    </div>
                  </div>
                )}

                {(() => {
                  const SOURCE_CONFIG = {
                    manual:         { label: 'Manual',     color: 'bg-gray-100 text-gray-700 border-gray-300' },
                    task:           { label: 'Task',       color: 'bg-blue-100 text-blue-700 border-blue-300' },
                    build_schedule: { label: 'Build',      color: 'bg-orange-100 text-orange-700 border-orange-300' },
                    lead:           { label: 'Lead',       color: 'bg-purple-100 text-purple-700 border-purple-300' },
                    inspection:     { label: 'Inspection', color: 'bg-green-100 text-green-700 border-green-300' },
                    project:        { label: 'Project',    color: 'bg-teal-100 text-teal-700 border-teal-300' },
                    communication:  { label: 'Comm',       color: 'bg-cyan-100 text-cyan-700 border-cyan-300' },
                  };
                  // Lead.notes inline field shown as a synthetic note entry
                  const inlineLeadNote = lead?.notes ? [{
                    _type: 'activity',
                    id: `lead-inline-notes-${lead.id}`,
                    note: lead.notes,
                    source_type: 'lead',
                    source_label: 'Lead Notes',
                    created_at: lead.created_date || new Date().toISOString(),
                    created_by: lead.created_by || '',
                    created_by_name: null,
                  }] : [];

                  const entityNotes = leadNoteEntities
                    .filter(n => n.source_type !== 'task')
                    .map(n => ({
                      _type: 'entity',
                      id: n.id,
                      note: n.note,
                      created_at: n.created_at || n.created_date || new Date().toISOString(),
                      created_by: n.created_by,
                      created_by_name: n.created_by_name,
                      source_type: n.source_type || 'manual',
                      source_label: n.source_label || null,
                    }));
                  const taskNotes = leadTasks.flatMap(t => {
                    const taskStatus = (t.status || '').replace(/_/g, ' ');
                    const details = [
                      t.assigned_to_name ? `Assigned: ${t.assigned_to_name}` : null,
                      taskStatus ? `Status: ${taskStatus}` : null,
                      t.due_date ? `Due: ${new Date(t.due_date).toLocaleDateString()}` : null,
                    ].filter(Boolean).join(' · ');
                    const taskEntry = {
                      _type: 'activity',
                      id: `task-${t.id}`,
                      source_type: 'task',
                      source_label: null,
                      note: t.title + (t.description ? `\n${t.description}` : '') + (details ? `\n${details}` : ''),
                      created_at: t.created_date || t.created_at || new Date().toISOString(),
                      created_by: t.created_by,
                      created_by_name: t.assigned_to_name || null,
                    };
                    const commentEntries = (t.comments || []).map(c => ({
                      _type: 'activity',
                      id: `task-comment-${t.id}-${c.id || c.timestamp}`,
                      source_type: 'task',
                      source_label: `Task: ${t.title || t.name || ''}`,
                      note: c.text || '',
                      created_at: c.timestamp || new Date().toISOString(),
                      created_by: c.user_email || c.created_by || '',
                      created_by_name: c.user || c.author || c.created_by_name || '',
                    }));
                    return [taskEntry, ...commentEntries];
                  });
                  const allNotes = [...inlineLeadNote, ...entityNotes, ...taskNotes]
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                  if (allNotes.length === 0) return (
                    <div className="text-center py-10 text-gray-500">
                      <StickyNote className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p className="font-medium">No notes yet</p>
                      <p className="text-sm mt-1">Add notes to track important lead information</p>
                    </div>
                  );
                  return (
                  <div className="space-y-3">
                    {allNotes.map((note) => {
                        const isEditing = editingNoteId === note.id;
                        const srcConf = SOURCE_CONFIG[note.source_type] || SOURCE_CONFIG.manual;
                        const isManual = note._type === 'entity' && note.source_type === 'manual';
                        const authorName = note.created_by_name ||
                          staffProfiles.find(s => s.user_email === note.created_by)?.full_name ||
                          note.created_by;
                        return (
                          <div key={note.id} className="p-4 border rounded-lg bg-gray-50 hover:bg-gray-100" data-testid={`lead-note-item-${note.id}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <Textarea
                                    value={editedNoteText}
                                    onChange={(e) => setEditedNoteText(e.target.value)}
                                    className="mb-2 min-h-[80px]"
                                    autoFocus
                                  />
                                ) : (
                                  <p className="text-gray-800 whitespace-pre-wrap break-words">{note.note}</p>
                                )}
                                <div className="flex items-center flex-wrap gap-2 mt-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${srcConf.color}`}>
                                    {note.source_label || srcConf.label}
                                  </span>
                                  <span className="text-xs text-gray-400">
                                    {(note.created_at || note.created_date) && !isNaN(new Date(note.created_at || note.created_date).getTime()) ? format(new Date(note.created_at || note.created_date), 'MMM d, yyyy h:mm a') : 'No date'}
                                  </span>
                                  {authorName && (
                                    <>
                                      <span className="text-xs text-gray-300">•</span>
                                      <span className="text-xs text-gray-500">{authorName}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {isManual && (
                                <div className="flex gap-1 flex-shrink-0">
                                  {isEditing ? (
                                    <>
                                      <Button
                                        size="icon" variant="ghost"
                                        className="h-8 w-8 text-green-600 hover:bg-green-50"
                                        disabled={updateLeadNoteMutation.isPending}
                                        onClick={() => {
                                          if (!editedNoteText.trim()) { toast.error('Note cannot be empty'); return; }
                                          updateLeadNoteMutation.mutate({ id: note.id, note: editedNoteText.trim() });
                                        }}
                                        title="Save"
                                      >
                                        {updateLeadNoteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                      </Button>
                                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingNoteId(null)} title="Cancel">
                                        <X className="w-4 h-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button
                                        size="icon" variant="ghost" className="h-8 w-8"
                                        onClick={() => { setEditingNoteId(note.id); setEditedNoteText(note.note); }}
                                        title="Edit note"
                                      >
                                        <Pencil className="w-4 h-4" />
                                      </Button>
                                      <Button
                                        size="icon" variant="ghost"
                                        className="text-red-600 hover:bg-red-50 h-8 w-8"
                                        disabled={deleteLeadNoteMutation.isPending}
                                        onClick={() => {
                                          if (confirm('Delete this note?')) deleteLeadNoteMutation.mutate(note.id);
                                        }}
                                        title="Delete note"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Estimates */}
            <Card id="estimates-section">
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-blue-600" />
                    Estimates ({linkedEstimates.length})
                  </h2>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
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
                    >
                      <Plus className="w-4 h-4 mr-1" /> New Estimate
                    </Button>
                    <Button
                      size="sm"
                      className="bg-purple-600 hover:bg-purple-700"
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
                    >
                      <Sparkles className="w-4 h-4 mr-1" /> AI Estimate
                    </Button>
                  </div>
                </div>

                {groupedLinkedEstimates.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">No estimates yet</div>
                ) : (
                  <div className="space-y-2">
                    {groupedLinkedEstimates.map((est) => {
                      const amount = Number(est.total_rcv || est.total_amount || est.amount || 0);
                      const statusColors = {
                        draft:    'bg-gray-100 text-gray-700 border-gray-300',
                        sent:     'bg-blue-100 text-blue-700 border-blue-300',
                        accepted: 'bg-green-100 text-green-700 border-green-300',
                        declined: 'bg-red-100 text-red-700 border-red-300',
                      };
                      const statusCls = statusColors[est.status] || statusColors.draft;
                      return (
                        <div
                          key={est.id}
                          className={`p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors flex items-center justify-between gap-3 ${est._isSupplement ? 'ml-4 border-dashed' : ''}`}
                          onClick={() => navigate(createPageUrl('EstimateEditor') + `?estimate_id=${est.id}`)}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">
                                {est._isSupplement && <span className="text-gray-400 mr-1">↳</span>}
                                {est.estimate_number || est.id.slice(0, 8)}
                                {est.title ? ` — ${est.title}` : ''}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${statusCls}`}>
                                {est.status || 'draft'}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">
                              {est.created_date ? format(new Date(est.created_date), 'MMM d, yyyy') : ''}
                              {est.created_by_name ? ` · ${est.created_by_name}` : ''}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-gray-800 shrink-0">
                            {amount > 0 ? `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Contracts / Signing History */}
            <Card id="contracts-section">
              <CardContent className="p-3 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <FileSignature className="w-5 h-5 text-blue-600" />
                    Contracts ({leadSigningSessions.length})
                  </h2>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="button-send-contract-lead"
                    onClick={() => setShowSendForSignatureDialog(true)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Send for Signature
                  </Button>
                </div>
                {(() => {
                  const signingStatusConfig = {
                    draft:             { label: 'Draft',             color: 'bg-gray-100 text-gray-700 border-gray-300' },
                    signed_by_rep:     { label: 'Signed by Rep',     color: 'bg-blue-100 text-blue-700 border-blue-300' },
                    sent_to_customer:  { label: 'Sent to Customer',  color: 'bg-amber-100 text-amber-700 border-amber-300' },
                    awaiting_customer: { label: 'Awaiting Customer', color: 'bg-amber-100 text-amber-700 border-amber-300' },
                    completed:         { label: 'Completed',         color: 'bg-green-100 text-green-700 border-green-300' },
                  };
                  if (leadSigningSessions.length === 0) {
                    return <div className="text-center py-8 text-gray-500 text-sm">No signing sessions yet</div>;
                  }
                  return (
                    <div className="space-y-3">
                      {leadSigningSessions.map((session) => {
                        const cfg = signingStatusConfig[session.status] || { label: session.status, color: 'bg-gray-100 text-gray-700 border-gray-300' };
                        const createdAt = session.created_date || session.created_at;
                        return (
                          <div
                            key={session.id}
                            className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                            data-testid={`row-lead-signing-session-${session.id}`}
                            onClick={() => {
                              if (session.status === 'completed') {
                                navigate(createPageUrl('ContractSigning') + '?sessionId=' + session.id);
                              } else {
                                navigate(createPageUrl('SignContractRep') + '?sessionId=' + session.id);
                              }
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium truncate">{session.contract_name || session.template_name || 'Contract'}</div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {(session.status === 'sent_to_customer' || session.status === 'awaiting_customer') && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-blue-600 hover:bg-blue-50"
                                    disabled={resendingSessionId === session.id}
                                    data-testid={`button-resend-signing-${session.id}`}
                                    title="Re-send signing link to customer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleResendSigningLink(session.id);
                                    }}
                                  >
                                    {resendingSessionId === session.id
                                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      : <Send className="w-3.5 h-3.5" />}
                                  </Button>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${cfg.color}`}>{cfg.label}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
                              {session.rep_name && <span>Rep: {session.rep_name}</span>}
                              {createdAt && <span>Created: {format(new Date(createdAt), 'MMM d, yyyy')}</span>}
                              {session.completed_at && <span>Completed: {format(new Date(session.completed_at), 'MMM d, yyyy')}</span>}
                              {session.sent_to_customer_at && (session.status === 'sent_to_customer' || session.status === 'awaiting_customer') && (
                                <span>Last sent: {format(new Date(session.sent_to_customer_at), 'MMM d, yyyy h:mm a')}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
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
        isRepOwned={isLeadRepOwned}
        onHandBack={handleHandBackToSarah}
      />

      {/* Edit Lead Dialog */}
      <Dialog open={showEditDialog} onOpenChange={(open) => {
        if (!open) {
          setShowEditDialog(false);
          setEditForm(null);
          setLeadPhoneErrors({ phone: null, phone_2: null });
        }
      }}>
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
              const phoneErr = validateE164Phone(editForm.phone || '');
              const phone2Err = validateE164Phone(editForm.phone_2 || '');
              setLeadPhoneErrors({ phone: phoneErr, phone_2: phone2Err });
              if (phoneErr || phone2Err) return;
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
                    onChange={(e) => {
                      setEditForm({...editForm, phone: e.target.value});
                      setLeadPhoneErrors(prev => ({ ...prev, phone: validateE164Phone(e.target.value) }));
                    }}
                    className={leadPhoneErrors.phone ? "border-red-500" : ""}
                  />
                  {leadPhoneErrors.phone && <p className="text-sm text-red-500 mt-1">{leadPhoneErrors.phone}</p>}
                </div>
                <div>
                  <Label>Phone 2</Label>
                  <Input
                    type="tel"
                    value={editForm.phone_2}
                    onChange={(e) => {
                      setEditForm({...editForm, phone_2: e.target.value});
                      setLeadPhoneErrors(prev => ({ ...prev, phone_2: validateE164Phone(e.target.value) }));
                    }}
                    className={leadPhoneErrors.phone_2 ? "border-red-500" : ""}
                  />
                  {leadPhoneErrors.phone_2 && <p className="text-sm text-red-500 mt-1">{leadPhoneErrors.phone_2}</p>}
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

              <div className="border-t pt-4">
                <h3 className="font-semibold mb-3">Lead Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Source</Label>
                    <Select value={editForm.source} onValueChange={(v) => setEditForm({...editForm, source: v})}>
                      <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="referral">Referral</SelectItem>
                        <SelectItem value="website">Website</SelectItem>
                        <SelectItem value="storm">Storm</SelectItem>
                        <SelectItem value="door_to_door">Door to Door</SelectItem>
                        <SelectItem value="social_media">Social Media</SelectItem>
                        <SelectItem value="google">Google</SelectItem>
                        <SelectItem value="yard_sign">Yard Sign</SelectItem>
                        <SelectItem value="AI Estimator">AI Estimator</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Referral / Lead Source</Label>
                    <Input
                      value={editForm.lead_source}
                      onChange={(e) => setEditForm({...editForm, lead_source: e.target.value})}
                      placeholder="Who referred them?"
                    />
                  </div>
                  <div>
                    <Label>Insurance Company</Label>
                    <Input
                      value={editForm.insurance_company}
                      onChange={(e) => setEditForm({...editForm, insurance_company: e.target.value})}
                      placeholder="e.g. State Farm"
                    />
                  </div>
                  <div>
                    <Label>Claim Number</Label>
                    <Input
                      value={editForm.claim_number}
                      onChange={(e) => setEditForm({...editForm, claim_number: e.target.value})}
                      placeholder="Insurance claim #"
                    />
                  </div>
                  <div>
                    <Label>Last Contact Date</Label>
                    <Input
                      type="date"
                      value={editForm.last_contact_date ? editForm.last_contact_date.split('T')[0] : ''}
                      onChange={(e) => setEditForm({...editForm, last_contact_date: e.target.value})}
                    />
                  </div>
                  <div>
                    <Label>Next Follow-Up Date</Label>
                    <Input
                      type="date"
                      value={editForm.next_follow_up_date ? editForm.next_follow_up_date.split('T')[0] : ''}
                      onChange={(e) => setEditForm({...editForm, next_follow_up_date: e.target.value})}
                    />
                  </div>
                </div>
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
                    setLeadPhoneErrors({ phone: null, phone_2: null });
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
        <Dialog open={!!viewingFile} onOpenChange={(open) => { if (!open) { setViewingFile(null); setFileZoom(1); } }}>
          <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] max-h-[95vh] overflow-hidden flex flex-col p-4 md:p-6">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 pr-8">
                <span className="truncate text-base md:text-lg">{viewingFile.document_name}</span>
                <div className="flex gap-2 items-center flex-wrap">
                  {viewingFile.file_type?.startsWith('image/') && (
                    <div className="flex items-center gap-1 border rounded-lg p-1 bg-gray-50">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setFileZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
                        disabled={fileZoom <= 0.5}
                        title="Zoom out"
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                      <span className="text-xs font-medium w-12 text-center tabular-nums select-none">{Math.round(fileZoom * 100)}%</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setFileZoom(z => Math.min(3, Math.round((z + 0.25) * 100) / 100))}
                        disabled={fileZoom >= 3}
                        title="Zoom in"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setFileZoom(1)}
                        title="Reset zoom"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
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
                </div>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4 flex-1 overflow-auto min-h-0">
              {viewingFile.file_type?.startsWith('image/') ? (
                <div className="w-full h-full overflow-auto flex items-start justify-center bg-gray-50 rounded-lg">
                  <img 
                    src={viewingFile.file_url} 
                    alt={viewingFile.document_name}
                    className="h-auto rounded-lg origin-top transition-transform"
                    style={{ width: `${fileZoom * 100}%`, maxWidth: fileZoom <= 1 ? '100%' : 'none' }}
                  />
                </div>
              ) : viewingFile.file_type === 'application/pdf' ? (
                <iframe 
                  src={viewingFile.file_url} 
                  className="w-full h-full min-h-[70vh] rounded-lg border"
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

      <Dialog open={showSendForSignatureDialog} onOpenChange={setShowSendForSignatureDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="w-5 h-5 text-green-600" />
              Send for Signature
            </DialogTitle>
          </DialogHeader>

          {contractTemplates.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FileSignature className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium mb-1">No contract templates yet</p>
              <p className="text-sm mb-4">Set up templates on the Contract Templates page first.</p>
              <Button
                onClick={() => { setShowSendForSignatureDialog(false); navigate(createPageUrl('ContractTemplates')); }}
                variant="outline"
              >
                Go to Contract Templates
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!signatureSelectedTemplate) { toast.error('Please select a template'); return; }
                if (!signatureContractForm.contract_name.trim()) { toast.error('Please enter a job description'); return; }
                if (signatureContractForm.delivery_method === 'email' && !lead.email) { toast.error('This lead has no email on file'); return; }
                if (signatureContractForm.delivery_method === 'sms' && !lead.phone) { toast.error('This lead has no phone on file'); return; }
                createSigningSessionMutation.mutate({ template: signatureSelectedTemplate, ...signatureContractForm });
              }}
              className="space-y-4"
            >
              <div>
                <Label className="font-semibold">Contract Template *</Label>
                <Select
                  value={signatureSelectedTemplate?.id || ''}
                  onValueChange={(id) => {
                    const t = contractTemplates.find(t => t.id === id);
                    setSignatureSelectedTemplate(t || null);
                    if (t && !signatureContractForm.contract_name) {
                      setSignatureContractForm(prev => ({ ...prev, contract_name: `${lead.name} - ${t.template_name}` }));
                    }
                  }}
                >
                  <SelectTrigger data-testid="select-signature-template">
                    <SelectValue placeholder="Pick a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractTemplates.map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="font-semibold">Job / Contract Description *</Label>
                <p className="text-xs text-gray-500 mb-1">e.g. "Smith Residence – Roof Replacement"</p>
                <Input
                  data-testid="input-signature-contract-name"
                  value={signatureContractForm.contract_name}
                  onChange={(e) => setSignatureContractForm(prev => ({ ...prev, contract_name: e.target.value }))}
                  placeholder="Auto-filled from template name"
                  required
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium text-gray-700 mb-2">Lead (pre-filled)</p>
                <p><span className="text-gray-500">Name:</span> {lead.name}</p>
                {lead.email && <p><span className="text-gray-500">Email:</span> {lead.email}</p>}
                {lead.phone && <p><span className="text-gray-500">Phone:</span> {lead.phone}</p>}
              </div>

              <div>
                <Label className="font-semibold">Send Via *</Label>
                <div className="flex gap-4 mt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="email"
                      checked={signatureContractForm.delivery_method === 'email'}
                      onChange={(e) => setSignatureContractForm(prev => ({ ...prev, delivery_method: e.target.value }))}
                      className="w-4 h-4"
                    />
                    <Mail className="w-4 h-4 text-blue-600" />
                    Email
                    {!lead.email && <span className="text-xs text-red-500">(no email on file)</span>}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      value="sms"
                      checked={signatureContractForm.delivery_method === 'sms'}
                      onChange={(e) => setSignatureContractForm(prev => ({ ...prev, delivery_method: e.target.value }))}
                      className="w-4 h-4"
                    />
                    <MessageCircle className="w-4 h-4 text-green-600" />
                    SMS
                    {!lead.phone && <span className="text-xs text-red-500">(no phone on file)</span>}
                  </label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t">
                <Button type="button" variant="outline" onClick={() => setShowSendForSignatureDialog(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-green-600 hover:bg-green-700"
                  disabled={createSigningSessionMutation.isPending}
                  data-testid="button-start-signing"
                >
                  {createSigningSessionMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" />Start Signing</>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Color Visualizer embedded section */}
      {HIDDEN_FEATURES.COLOR_VISUALIZER !== false && (
        <div className="max-w-6xl mx-auto px-6 pb-6">
          <Card id="color-visualizer-section">
            <CardContent className="p-0">
              {lead && (
                <ColorVisualizerPanel
                  entity={lead}
                  entityType="Lead"
                  companyId={lead?.company_id}
                  queryKey={['lead', leadId]}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Appointment edit dialog — lets staff adjust time/address/title before confirming */}
      <Dialog
        open={apptEditDialog.open}
        onOpenChange={(open) => !open && setApptEditDialog((s) => ({ ...s, open: false }))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-blue-600" /> Review &amp; Confirm Appointment
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500 -mt-1">
            Check the details the AI captured and correct anything before adding to the calendar.
          </p>
          <div className="space-y-3 mt-1">
            <div>
              <label className="text-xs font-medium text-gray-700">Title</label>
              <Input
                value={apptEditDialog.form.title || ''}
                onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))}
                placeholder="Appointment title"
                className="mt-1"
                data-testid="input-appt-edit-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700">Start date &amp; time</label>
                <Input
                  type="datetime-local"
                  value={apptEditDialog.form.start || ''}
                  onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, start: e.target.value } }))}
                  className="mt-1"
                  data-testid="input-appt-edit-start"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">End date &amp; time</label>
                <Input
                  type="datetime-local"
                  value={apptEditDialog.form.end || ''}
                  onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, end: e.target.value } }))}
                  className="mt-1"
                  data-testid="input-appt-edit-end"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Address</label>
              <Input
                value={apptEditDialog.form.address || ''}
                onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, address: e.target.value } }))}
                placeholder="Property address"
                className="mt-1"
                data-testid="input-appt-edit-address"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">Notes</label>
              <Textarea
                value={apptEditDialog.form.notes || ''}
                onChange={(e) => setApptEditDialog((s) => ({ ...s, form: { ...s.form, notes: e.target.value } }))}
                placeholder="Any additional notes"
                rows={2}
                className="mt-1"
                data-testid="textarea-appt-edit-notes"
              />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setApptEditDialog((s) => ({ ...s, open: false }))}
              data-testid="button-appt-edit-cancel"
            >
              Cancel
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={approveAppointmentMutation.isPending}
              onClick={() => {
                const f = apptEditDialog.form;
                const startIso = datetimeLocalToIso(f.start);
                if (!startIso) {
                  toast.error('Please enter a valid start date and time before confirming.');
                  return;
                }
                const overrides = {
                  title: f.title || undefined,
                  start_time: startIso,
                  end_time: datetimeLocalToIso(f.end),
                  address: f.address,
                  description: f.notes,
                };
                setApptEditDialog((s) => ({ ...s, open: false }));
                approveAppointmentMutation.mutate({ item: apptEditDialog.item, overrides });
              }}
              data-testid="button-appt-edit-confirm"
            >
              {approveAppointmentMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CalendarCheck className="w-4 h-4 mr-2" />
              )}
              Confirm &amp; Add to Calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}